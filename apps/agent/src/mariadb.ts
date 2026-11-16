import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { HttpError } from './errors.js';
import { resolveExecutable } from './executable.js';

export const MARIADB_IMAGE = 'mariadb:11.4';
const CONTAINER = 'hotbar-mariadb';
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{1,48}$/;
const PASSWORD = /^[A-Za-z0-9_-]{20,64}$/;

export function serverDatabaseName(serverId: string, name: string): string {
  if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(name)) {
    throw new HttpError(400, 'database name must start with a letter and use only letters, numbers, and underscores');
  }
  const prefix = serverId.replace(/[^a-f0-9]/gi, '').slice(0, 8).toLowerCase();
  if (prefix.length < 8) throw new HttpError(400, 'server id is not valid');
  return `hb_${prefix}_${name}`;
}

export function createDatabaseSql(database: string, password: string): string {
  assertIdentifier(database);
  assertPassword(password);
  return [
    `CREATE DATABASE IF NOT EXISTS \`${database}\`;`,
    `CREATE USER IF NOT EXISTS '${database}'@'%' IDENTIFIED BY '${password}';`,
    `ALTER USER '${database}'@'%' IDENTIFIED BY '${password}';`,
    `GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${database}'@'%';`,
    'FLUSH PRIVILEGES;',
  ].join(' ');
}

export function rotatePasswordSql(database: string, password: string): string {
  assertIdentifier(database);
  assertPassword(password);
  return `ALTER USER '${database}'@'%' IDENTIFIED BY '${password}'; FLUSH PRIVILEGES;`;
}

export function dropDatabaseSql(database: string): string {
  assertIdentifier(database);
  return `DROP DATABASE IF EXISTS \`${database}\`; DROP USER IF EXISTS '${database}'@'%'; FLUSH PRIVILEGES;`;
}

export function newDatabasePassword(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export async function ensureMariaDb(dataDir: string): Promise<{ host: '127.0.0.1'; port: number }> {
  const docker = dockerPath();
  const password = readOrCreateSecret(path.join(dataDir, 'mariadb-root.secret'));
  const statePath = path.join(dataDir, 'mariadb.json');
  const status = await containerStatus(docker);
  if (status === 'missing') {
    const saved = readState(statePath);
    const port = saved?.port && saved.port > 0 ? saved.port : await freePort(3306);
    const volume = path.join(dataDir, 'mariadb-data');
    fs.mkdirSync(volume, { recursive: true });
    const started = await run(docker, [
      'run',
      '-d',
      '--name',
      CONTAINER,
      '--restart',
      'unless-stopped',
      '-p',
      `127.0.0.1:${port}:3306`,
      '-v',
      `${dockerPathOf(volume)}:/var/lib/mysql`,
      '-e',
      `MARIADB_ROOT_PASSWORD=${password}`,
      MARIADB_IMAGE,
    ]);
    if (started.code !== 0) {
      throw new HttpError(500, `MariaDB did not start. ${redact(started.stderr || started.stdout, password)}`);
    }
    writeState(statePath, port);
    await waitUntilReady(docker, password);
    return { host: '127.0.0.1', port };
  }
  if (status !== 'running') {
    const started = await run(docker, ['start', CONTAINER]);
    if (started.code !== 0) {
      throw new HttpError(500, `MariaDB did not start. ${redact(started.stderr || started.stdout, password)}`);
    }
  }
  const port = readState(statePath)?.port || (await publishedPort(docker));
  await waitUntilReady(docker, password);
  return { host: '127.0.0.1', port };
}

export async function mariadbImagePresent(): Promise<boolean> {
  try {
    const docker = dockerPath();
    const result = await run(docker, ['image', 'inspect', MARIADB_IMAGE]);
    return result.code === 0;
  } catch {
    return false;
  }
}

export async function execMariaSql(dataDir: string, sql: string): Promise<void> {
  const docker = dockerPath();
  const password = readOrCreateSecret(path.join(dataDir, 'mariadb-root.secret'));
  const result = await run(
    docker,
    ['exec', '-i', CONTAINER, 'mariadb', '-uroot', `-p${password}`, '--protocol=socket'],
    sql,
  );
  if (result.code !== 0) {
    throw new HttpError(500, `MariaDB rejected the request. ${redact(result.stderr || result.stdout, password)}`);
  }
}

function dockerPath(): string {
  try {
    return resolveExecutable('docker');
  } catch {
    throw new HttpError(400, 'Docker is required to install MariaDB. Install Docker, then create the database again.');
  }
}

function assertIdentifier(value: string): void {
  if (!IDENTIFIER.test(value)) throw new HttpError(400, 'database name must start with a letter and use only letters, numbers, and underscores');
}

function assertPassword(value: string): void {
  if (!PASSWORD.test(value)) throw new HttpError(500, 'generated database password was rejected');
}

function readOrCreateSecret(file: string): string {
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length < 16) throw new HttpError(500, 'the saved MariaDB secret is unusable');
    return existing;
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${secret}\n`, { encoding: 'utf8', mode: 0o600 });
  restrictFile(file);
  return secret;
}

function restrictFile(file: string): void {
  if (process.platform !== 'win32') return;
  const username = process.env.USERNAME;
  if (!username) return;
  const child = spawn('icacls', [file, '/inheritance:r', '/grant:r', `${username}:(R)`], { windowsHide: true, stdio: 'ignore' });
  child.on('error', () => {
    // The file mode is already owner-oriented. ACL tightening is best-effort.
  });
}

function readState(file: string): { port: number } | null {
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { port?: number };
    return typeof parsed.port === 'number' ? { port: parsed.port } : null;
  } catch {
    return null;
  }
}

function writeState(file: string, port: number): void {
  fs.writeFileSync(file, JSON.stringify({ port, image: MARIADB_IMAGE }), { encoding: 'utf8', mode: 0o600 });
}

async function containerStatus(docker: string): Promise<'missing' | 'running' | 'stopped'> {
  const result = await run(docker, ['inspect', '--format', '{{.State.Status}}', CONTAINER]);
  if (result.code !== 0) return 'missing';
  return result.stdout.trim() === 'running' ? 'running' : 'stopped';
}

async function publishedPort(docker: string): Promise<number> {
  const result = await run(docker, ['port', CONTAINER, '3306']);
  const match = result.stdout.match(/:(\d+)\s*$/m);
  const port = match ? Number(match[1]) : 0;
  if (!port) throw new HttpError(500, 'MariaDB is installed but its port could not be read');
  return port;
}

async function waitUntilReady(docker: string, password: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  let last = '';
  while (Date.now() < deadline) {
    const result = await run(docker, ['exec', CONTAINER, 'mariadb-admin', 'ping', '-uroot', `-p${password}`, '--silent']);
    if (result.code === 0) return;
    last = result.stderr || result.stdout;
    await delay(2000);
  }
  throw new HttpError(500, `MariaDB did not become ready. ${redact(last, password)}`);
}

function dockerPathOf(directory: string): string {
  return directory.replace(/\\/g, '/');
}

function freePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    if (start > 3399) {
      reject(new HttpError(500, 'no free port for MariaDB'));
      return;
    }
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      resolve(freePort(start + 1));
    });
    server.listen(start, '127.0.0.1', () => {
      server.close(() => resolve(start));
    });
  });
}

function run(command: string, args: string[], input?: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

function redact(text: string, secret: string): string {
  const cleaned = secret.length >= 8 ? text.split(secret).join('[redacted]') : text;
  return cleaned.replace(/\s+/g, ' ').trim().slice(0, 400);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
