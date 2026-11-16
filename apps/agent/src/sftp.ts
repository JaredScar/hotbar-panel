import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Server, utils } = require('ssh2') as typeof import('ssh2');
import { HttpError } from './errors.js';
import { resolveInJail } from './jail.js';
import type { ServerManager } from './manager.js';

const STATUS = utils.sftp.STATUS_CODE;
const OPEN = utils.sftp.OPEN_MODE;

interface SftpStream {
  on(event: string, listener: (...args: never[]) => void): void;
  status(reqid: number, code: number): void;
  handle(reqid: number, handle: Buffer): void;
  data(reqid: number, data: Buffer): void;
  name(reqid: number, names: Array<{ filename: string; longname: string; attrs: { mode: number; size: number; mtime: number } }>): void;
  attrs(reqid: number, attrs: { mode: number; size: number; mtime: number }): void;
}

interface OpenHandle {
  fd?: number;
  dir?: string;
  listed?: boolean;
}

export interface SftpEndpoint {
  port: number;
  close: () => Promise<void>;
}

export function sftpPassword(dataDir: string, serverId: string): string {
  const file = path.join(dataDir, 'sftp.json');
  const current = readPasswords(file);
  if (current[serverId]) return current[serverId];
  current[serverId] = crypto.randomBytes(18).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(current), { encoding: 'utf8', mode: 0o600 });
  return current[serverId];
}

export function startSftp(dataDir: string, manager: ServerManager): Promise<SftpEndpoint> {
  const keyPath = path.join(dataDir, 'sftp-host.pem');
  if (!fs.existsSync(keyPath)) {
    const pair = utils.generateKeyPairSync('ed25519');
    fs.writeFileSync(keyPath, pair.private, { mode: 0o600 });
  }
  const hostKey = fs.readFileSync(keyPath);
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('error', () => undefined);
    let root = '';
    client.on('authentication', (context) => {
      const ctx = context as { method: string; username: string; password?: string; accept: () => void; reject: () => void };
      if (ctx.method !== 'password') {
        ctx.reject();
        return;
      }
      const match = manager.list().find((item) => item.id === ctx.username);
      const expected = match ? sftpPassword(dataDir, match.id) : '';
      if (!match || !safeEqual(ctx.password ?? '', expected)) {
        ctx.reject();
        return;
      }
      root = match.cwd;
      ctx.accept();
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('sftp', (acceptSftp) => {
          attachSftp(acceptSftp() as unknown as SftpStream, root);
        });
      });
    });
  });
  server.on('error', () => undefined);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolve({
        port,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

function attachSftp(sftp: SftpStream, root: string): void {
  const handles = new Map<number, OpenHandle>();
  let next = 1;
  const reply = (reqid: number, code: number) => sftp.status(reqid, code);
  sftp.on('REALPATH', ((reqid: number, requested: string) => {
    try {
      const full = inside(root, requested);
      sftp.name(reqid, [entry(requested === '' || requested === '.' ? '/' : toSftpPath(root, full), fs.statSync(full))]);
    } catch {
      reply(reqid, STATUS.NO_SUCH_FILE);
    }
  }) as never);
  sftp.on('STAT', stat as never);
  sftp.on('LSTAT', stat as never);
  sftp.on('OPENDIR', ((reqid: number, requested: string) => {
    try {
      const full = inside(root, requested);
      if (!fs.statSync(full).isDirectory()) return reply(reqid, STATUS.FAILURE);
      const id = next++;
      handles.set(id, { dir: full });
      sftp.handle(reqid, handleBuffer(id));
    } catch {
      reply(reqid, STATUS.NO_SUCH_FILE);
    }
  }) as never);
  sftp.on('READDIR', ((reqid: number, handle: Buffer) => {
    const open = handles.get(readHandle(handle));
    if (!open?.dir) return reply(reqid, STATUS.FAILURE);
    if (open.listed) return reply(reqid, STATUS.EOF);
    open.listed = true;
    const names = fs.readdirSync(open.dir).map((name) => entry(name, fs.statSync(path.join(open.dir as string, name))));
    if (names.length === 0) return reply(reqid, STATUS.EOF);
    sftp.name(reqid, names);
  }) as never);
  sftp.on('OPEN', ((reqid: number, requested: string, flags: number) => {
    try {
      const full = inside(root, requested);
      const writing = Boolean(flags & (OPEN.WRITE | OPEN.APPEND | OPEN.CREAT | OPEN.TRUNC));
      let mode = fs.constants.O_RDONLY;
      if (writing) mode = fs.constants.O_RDWR | fs.constants.O_CREAT;
      if (flags & OPEN.TRUNC) mode |= fs.constants.O_TRUNC;
      if (flags & OPEN.APPEND) mode |= fs.constants.O_APPEND;
      const fd = fs.openSync(full, mode);
      const id = next++;
      handles.set(id, { fd });
      sftp.handle(reqid, handleBuffer(id));
    } catch {
      reply(reqid, STATUS.FAILURE);
    }
  }) as never);
  sftp.on('READ', ((reqid: number, handle: Buffer, offset: number, length: number) => {
    const open = handles.get(readHandle(handle));
    if (open?.fd === undefined) return reply(reqid, STATUS.FAILURE);
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(open.fd, buffer, 0, length, offset);
    if (read === 0) return reply(reqid, STATUS.EOF);
    sftp.data(reqid, buffer.subarray(0, read));
  }) as never);
  sftp.on('WRITE', ((reqid: number, handle: Buffer, offset: number, data: Buffer) => {
    const open = handles.get(readHandle(handle));
    if (open?.fd === undefined) return reply(reqid, STATUS.FAILURE);
    fs.writeSync(open.fd, data, 0, data.length, offset);
    reply(reqid, STATUS.OK);
  }) as never);
  sftp.on('CLOSE', ((reqid: number, handle: Buffer) => {
    const id = readHandle(handle);
    const open = handles.get(id);
    if (open?.fd !== undefined) fs.closeSync(open.fd);
    handles.delete(id);
    reply(reqid, STATUS.OK);
  }) as never);
  sftp.on('MKDIR', ((reqid: number, requested: string) => {
    try {
      fs.mkdirSync(inside(root, requested));
      reply(reqid, STATUS.OK);
    } catch {
      reply(reqid, STATUS.FAILURE);
    }
  }) as never);
  sftp.on('REMOVE', ((reqid: number, requested: string) => {
    try {
      fs.rmSync(inside(root, requested));
      reply(reqid, STATUS.OK);
    } catch {
      reply(reqid, STATUS.NO_SUCH_FILE);
    }
  }) as never);
  sftp.on('RMDIR', ((reqid: number, requested: string) => {
    try {
      fs.rmdirSync(inside(root, requested));
      reply(reqid, STATUS.OK);
    } catch {
      reply(reqid, STATUS.FAILURE);
    }
  }) as never);
  sftp.on('RENAME', ((reqid: number, from: string, to: string) => {
    try {
      fs.renameSync(inside(root, from), inside(root, to));
      reply(reqid, STATUS.OK);
    } catch {
      reply(reqid, STATUS.FAILURE);
    }
  }) as never);

  function stat(reqid: number, requested: string): void {
    try {
      const full = inside(root, requested);
      sftp.attrs(reqid, attrs(fs.statSync(full)));
    } catch {
      reply(reqid, STATUS.NO_SUCH_FILE);
    }
  }
}

function inside(root: string, requested: string): string {
  const relative = requested.replaceAll('\\', '/').replace(/^\/+/, '') || '.';
  try {
    return resolveInJail(root, relative);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'path is outside the server');
  }
}

function toSftpPath(root: string, full: string): string {
  const relative = path.relative(root, full).replaceAll('\\', '/');
  return relative === '' ? '/' : `/${relative}`;
}

function entry(name: string, stat: fs.Stats) {
  return { filename: name, longname: name, attrs: attrs(stat) };
}

function attrs(stat: fs.Stats): { mode: number; size: number; mtime: number } {
  const kind = stat.isDirectory() ? fs.constants.S_IFDIR : fs.constants.S_IFREG;
  return { mode: kind | 0o755, size: stat.size, mtime: Math.floor(stat.mtimeMs / 1000) };
}

function handleBuffer(id: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(id);
  return buffer;
}

function readHandle(handle: Buffer): number {
  return handle.length === 4 ? handle.readUInt32BE(0) : -1;
}

function readPasswords(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function safeEqual(input: string, expected: string): boolean {
  const left = Buffer.from(input);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
