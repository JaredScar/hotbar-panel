import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { validateTemplate, type ServerView } from '@hotbar/shared';
import { startAgent, type RunningAgent } from '../dist/app.js';
import type { AgentConfig } from '../dist/config.js';

const script = fileURLToPath(new URL('../../../templates/echo/server.mjs', import.meta.url));
const agents: RunningAgent[] = [];

after(async () => {
  await Promise.all(agents.map((agent) => agent.close()));
});

test('a browser on this machine can save settings', async () => {
  const agent = await boot('*');
  const response = await fetch(url(agent, '/api/health'), {
    method: 'OPTIONS',
    headers: {
      origin: 'http://127.0.0.1:4200',
      'access-control-request-method': 'PUT',
      'access-control-request-headers': 'authorization,content-type',
    },
  });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('access-control-allow-methods') ?? '', /\bPUT\b/);
  assert.match(response.headers.get('access-control-allow-methods') ?? '', /\bDELETE\b/);
});

test('builtin templates match the allow-list', () => {
  for (const name of ['fivem', 'echo', 'custom']) {
    const file = fileURLToPath(new URL(`../../../templates/${name}/template.yaml`, import.meta.url));
    const parsed: unknown = parseYaml(fs.readFileSync(file, 'utf8'));
    const result = validateTemplate(parsed);
    assert.equal(result.ok, true, `${name}: ${result.errors.join('; ')}`);
    assert.equal(result.usesShell, false);
  }
});

test('register, stream, stop, and delete a hand-created process', async () => {
  const agent = await boot('*');
  const created = await request<ServerView>(agent, 'POST', '/api/servers', {
    name: 'Echo',
    command: [process.execPath, script],
    cwd: path.dirname(script),
    env: { LICENSE_KEY: 'super-secret-key' },
    stop: { stdin: 'stop', timeoutMs: 5000 },
    allocation: { ip: '127.0.0.1', port: 25565, primary: true },
  });
  assert.equal(created.state, 'offline');
  assert.equal(created.allocation?.port, 25565);

  const started = await request<ServerView>(agent, 'POST', `/api/servers/${created.id}/power`, { action: 'start' });
  assert.equal(started.state, 'running');
  assert.equal(started.pid !== null, true);

  const ready = await waitForLine(agent, created.id, /ready ppid=(\d+)/);
  const parent = Number(ready.match(/ready ppid=(\d+)/)?.[1]);
  const machine = await request<{ pid: number }>(agent, 'GET', '/api/machine');
  assert.equal(parent, machine.pid);

  const stdin = await fetch(url(agent, `/api/servers/${created.id}/stdin`), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ line: 'super-secret-key' }),
  });
  assert.equal(stdin.status, 204);
  const echoed = await waitForLine(agent, created.id, /echo: \*{8}/);
  assert.match(echoed, /echo: \*{8}/);
  const snapshot = await request<{ lines: Array<{ line: string }> }>(agent, 'GET', `/api/servers/${created.id}/logs`);
  assert.equal(snapshot.lines.some((line) => line.line.includes('super-secret-key')), false);

  const stopped = await request<ServerView>(agent, 'POST', `/api/servers/${created.id}/power`, { action: 'stop' });
  assert.equal(stopped.state, 'offline');
  assert.equal(stopped.pid, null);

  const activity = await request<Array<{ event: string; target: string | null }>>(agent, 'GET', '/api/activity');
  assert.equal(activity.some((entry) => entry.event === 'server.power' && entry.target === created.id), true);
  assert.equal(activity.some((entry) => entry.event === 'server.create'), true);

  const removed = await fetch(url(agent, `/api/servers/${created.id}`), {
    method: 'DELETE',
    headers: { authorization: 'Bearer test-token' },
  });
  assert.equal(removed.status, 204);
});

test('missing token is 401 and a limited token cannot start a server', async () => {
  const agent = await boot(['server.read']);
  const anonymous = await fetch(url(agent, '/api/servers'));
  assert.equal(anonymous.status, 401);

  const listed = await fetch(url(agent, '/api/servers'), { headers: headers() });
  assert.equal(listed.status, 200);

  const created = await fetch(url(agent, '/api/servers'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      name: 'Nope',
      command: [process.execPath, script],
      cwd: path.dirname(script),
    }),
  });
  assert.equal(created.status, 403);
});

test('a string command is rejected instead of being passed to a shell', async () => {
  const agent = await boot('*');
  const response = await fetch(url(agent, '/api/servers'), {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ name: 'Bad', command: 'node server.js', cwd: path.dirname(script) }),
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /argument array/);
});

test('a crashing server restarts and then stops after five crashes', async () => {
  const agent = await boot('*');
  const created = await request<ServerView>(agent, 'POST', '/api/servers', {
    name: 'Crash',
    command: [process.execPath, '-e', 'process.exit(1)'],
    cwd: os.tmpdir(),
    autoRestart: true,
    stop: { timeoutMs: 1000 },
  });
  await request(agent, 'POST', `/api/servers/${created.id}/power`, { action: 'start' });
  const line = await waitForLine(agent, created.id, /stopped restarting after 5 crashes/, 20_000);
  assert.match(line, /stopped restarting after 5 crashes/);
});

async function boot(permissions: AgentConfig['permissions']): Promise<RunningAgent> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-agent-'));
  const agent = await startAgent({
    host: '127.0.0.1',
    port: 0,
    token: 'test-token',
    permissions,
    dataDir,
    serversRoot: path.join(dataDir, 'servers'),
    dev: true,
    version: 'test',
  });
  agents.push(agent);
  return agent;
}

function headers(): Record<string, string> {
  return { authorization: 'Bearer test-token', 'content-type': 'application/json' };
}

function url(agent: RunningAgent, pathname: string): string {
  return `http://127.0.0.1:${agent.port}${pathname}`;
}

async function request<T>(agent: RunningAgent, method: string, pathname: string, body?: unknown): Promise<T> {
  const response = await fetch(url(agent, pathname), {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${pathname} -> ${response.status} ${text}`);
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function waitForLine(agent: RunningAgent, id: string, pattern: RegExp, timeoutMs = 8000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const snapshot = await request<{ lines: Array<{ line: string }> }>(agent, 'GET', `/api/servers/${id}/logs`);
    const found = snapshot.lines.find((line) => pattern.test(line.line));
    if (found) return found.line;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timed out waiting for ${pattern}`);
}
