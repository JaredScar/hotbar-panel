import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { resolveExecutable } from '../executable.js';

export function lanAddresses(): string[] {
  const found: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      if (entry.family === 'IPv4') found.push(entry.address);
    }
  }
  return found;
}

export function displayAddress(): string {
  return lanAddresses()[0] ?? '127.0.0.1';
}

export function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '0.0.0.0', () => {
      server.close(() => resolve(true));
    });
  });
}

export async function nextFreePort(
  start: number,
  span: number,
  used: Set<number>,
  probe: (port: number) => Promise<boolean> = canBind,
): Promise<number> {
  for (let port = start; port < start + span; port += 1) {
    if (used.has(port)) continue;
    if (await probe(port)) return port;
  }
  throw new Error(`no free port from ${start}`);
}

export async function nextGamePort(used: Set<number>): Promise<number> {
  return nextFreePort(25565, 50, used);
}

export function canBindUdp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    let settled = false;
    const done = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.close();
      resolve(open);
    };
    socket.once('error', () => done(false));
    socket.bind(port, '0.0.0.0', () => done(true));
  });
}

export function tcpOpen(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export async function allowFirewall(port: number): Promise<string> {
  if (process.platform !== 'win32') return 'Firewall rules are added on Windows only.';
  try {
    const netsh = resolveExecutable('netsh');
    const tcp = await run([
      netsh,
      'advfirewall',
      'firewall',
      'add',
      'rule',
      `name=Hotbar-TCP-${port}`,
      'dir=in',
      'action=allow',
      'protocol=TCP',
      `localport=${port}`,
    ]);
    const udp = await run([
      netsh,
      'advfirewall',
      'firewall',
      'add',
      'rule',
      `name=Hotbar-UDP-${port}`,
      'dir=in',
      'action=allow',
      'protocol=UDP',
      `localport=${port}`,
    ]);
    if (tcp.code !== 0 || udp.code !== 0) {
      return 'Firewall rule was not added. Allow the port in Windows Firewall if friends cannot join. That needs an administrator.';
    }
    return `Allowed inbound TCP and UDP ${port}.`;
  } catch {
    return 'Firewall rule was not added. Allow the port in Windows Firewall if friends cannot join.';
  }
}

export function run(
  command: string[],
  cwd?: string,
  options?: { timeoutMs?: number; onOutput?: (text: string) => void },
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result: { code: number; stdout: string; stderr: string }) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const timer = options?.timeoutMs
      ? setTimeout(() => {
          killTree(child.pid);
          finish({ code: 1, stdout, stderr: `${stderr}\ncommand timed out` });
        }, options.timeoutMs)
      : undefined;
    const take = (current: string, chunk: string) => {
      options?.onOutput?.(chunk);
      return `${current}${chunk}`.slice(-20_000);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = take(stdout, chunk);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = take(stderr, chunk);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => finish({ code: code ?? 1, stdout, stderr }));
  });
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

export function findNamedFile(root: string, fileName: string, depth = 0): string | null {
  if (depth > 6) return null;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const wanted = fileName.toLowerCase();
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === wanted) return path.join(root, entry.name);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = findNamedFile(path.join(root, entry.name), fileName, depth + 1);
    if (found) return found;
  }
  return null;
}
