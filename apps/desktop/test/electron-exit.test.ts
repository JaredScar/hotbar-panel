import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopRoot, '../..');
const agentEntry = path.join(repoRoot, 'apps', 'agent', 'dist', 'index.js');
const echoScript = path.join(repoRoot, 'templates', 'echo', 'server.mjs');

test('quitting the Electron window leaves the agent-owned server running', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-desktop-'));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-electron-'));
  const agent = spawn(process.execPath, ['--experimental-sqlite', agentEntry, 'start'], {
    env: {
      ...process.env,
      HOTBAR_DEV: '1',
      HOTBAR_HOST: '127.0.0.1',
      HOTBAR_PORT: '0',
      HOTBAR_TOKEN: 'test-token',
      HOTBAR_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  try {
    const port = await readPort(agent);
    const created = await api<{ id: string }>(port, 'POST', '/api/servers', {
      name: 'Echo',
      command: [process.execPath, echoScript],
      cwd: path.dirname(echoScript),
      stop: { stdin: 'stop', timeoutMs: 5000 },
    });
    await api(port, 'POST', `/api/servers/${created.id}/power`, { action: 'start' });
    await waitForLog(port, created.id, /ready ppid=/);

    const electronPath = require('electron') as string;
    const electron = spawn(electronPath, ['.'], {
      cwd: desktopRoot,
      env: {
        ...process.env,
        HOTBAR_DESKTOP_QUIT: '1',
        HOTBAR_ELECTRON_USER_DATA: userData,
      },
      stdio: 'ignore',
      windowsHide: true,
    });
    const code = await exitCode(electron, 25_000);
    assert.equal(code, 0);

    const stdin = await fetch(`http://127.0.0.1:${port}/api/servers/${created.id}/stdin`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: JSON.stringify({ line: 'still-alive' }),
    });
    assert.equal(stdin.status, 204);
    await waitForLog(port, created.id, /echo: still-alive/);
    await api(port, 'POST', `/api/servers/${created.id}/power`, { action: 'stop' });
  } finally {
    agent.kill();
    await exitCode(agent, 5_000).catch(() => undefined);
  }
});

async function readPort(agent: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => reject(new Error(`agent did not start\n${buffer}`)), 15_000);
    agent.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const match = buffer.match(/HOTBAR_READY port=(\d+)/);
      if (match?.[1]) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    agent.stderr?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
    });
    agent.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`agent exited ${code} before ready\n${buffer}`));
    });
  });
}

async function api<T>(port: number, method: string, pathname: string, body?: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${pathname} -> ${response.status} ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function waitForLog(port: number, id: string, pattern: RegExp): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 8_000) {
    const snapshot = await api<{ lines: Array<{ line: string }> }>(port, 'GET', `/api/servers/${id}/logs`);
    if (snapshot.lines.some((line) => pattern.test(line.line))) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timed out waiting for ${pattern}`);
}

function exitCode(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('timed out waiting for process exit'));
    }, timeoutMs);
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}
