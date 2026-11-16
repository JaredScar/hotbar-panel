import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { WebSocket } from 'ws';
import { createPanel } from '../dist/main.js';
import { envelope, generateEd25519, openEnvelope } from '../dist/sign.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-panel-'));
const panel = await createPanel({ dataDir, host: '127.0.0.1', port: 0 });
const base = `http://127.0.0.1:${panel.port}`;

after(async () => {
  await panel.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('accounts, pairing, and a signed power command', async () => {
  const created = await post('/api/auth/register', { email: 'owner@example.com', password: 'correct horse' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const token = created.body.accessToken;
  assert.equal(typeof token, 'string');

  const wrong = await post('/api/auth/login', { email: 'owner@example.com', password: 'not-the-password' });
  assert.equal(wrong.status, 401);

  const pairing = await post('/api/pairings', {}, token);
  assert.equal(pairing.status, 201);
  const keys = generateEd25519();
  const paired = await post('/api/pair', {
    code: pairing.body.code,
    publicKey: keys.publicKey,
    hostname: 'test-host',
    os: 'win32',
  });
  assert.equal(paired.status, 201);
  const reused = await post('/api/pair', {
    code: pairing.body.code,
    publicKey: keys.publicKey,
    hostname: 'test-host',
    os: 'win32',
  });
  assert.equal(reused.status, 400);

  const server = {
    id: 'server-1',
    name: 'Paper',
    templateId: 'minecraft-paper',
    templateVersion: 1,
    command: ['java', '-jar', 'server.jar', 'nogui'],
    cwd: 'C:\\servers\\paper',
    env: {},
    stop: { stdin: 'stop', timeoutMs: 1000 },
    allocation: { ip: '127.0.0.1', port: 25565, primary: true },
    limits: { cpu: 0, memory: 0, disk: 0 },
    autoStart: false,
    autoRestart: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    state: 'offline',
    stats: null,
    startedAt: null,
    pid: null,
  };

  const socket = new WebSocket(`ws://127.0.0.1:${panel.port}/api/agents`);
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  socket.on('message', (data) => {
    const message = openEnvelope(paired.body.panelPublicKey, data.toString());
    if (!message || message.type !== 'server.power') return;
    socket.send(
      envelope(keys.privateKey, {
        type: 'server.state',
        serverId: message.serverId,
        state: 'starting',
        startedAt: null,
        pid: 42,
      }),
    );
  });
  socket.send(envelope(keys.privateKey, { type: 'hello', agentVersion: '0.1.0', nodeId: paired.body.nodeId }));
  socket.send(envelope(keys.privateKey, { type: 'snapshot', servers: [server] }));

  await waitFor(async () => {
    const list = await get('/api/servers', token);
    return list.status === 200 && list.body.some((item) => item.name === 'Paper');
  });

  const powered = await post('/api/servers/server-1/power', { action: 'start' }, token);
  assert.equal(powered.status, 201);
  assert.equal(powered.body.state, 'starting');
  socket.close();
});

async function waitFor(check) {
  const start = Date.now();
  while (Date.now() - start < 3000) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('timed out waiting for the panel');
}

async function post(pathname, body, token) {
  return send('POST', pathname, body, token);
}

async function get(pathname, token) {
  return send('GET', pathname, undefined, token);
}

async function send(method, pathname, body, token) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = await response.json();
  return { status: response.status, body: parsed };
}
