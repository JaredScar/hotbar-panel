import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import type { AgentEvent, AgentUplink, PanelDownlink } from '@hotbar/shared';
import { HttpError } from './errors.js';
import type { ServerManager } from './manager.js';
import { assertEd25519PublicKey, envelope, generateEd25519, openEnvelope, publicKeyFromPrivate } from './sign.js';

interface LinkRecord {
  url: string;
  nodeId: string;
  panelPublicKey: string;
}

interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export class PanelLink {
  private socket: WebSocket | null = null;
  private manager: ServerManager | null = null;
  private record: LinkRecord | null;
  private keys: KeyPair | null;
  private generation = 0;
  private timer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private active = false;

  constructor(
    private readonly dataDir: string,
    private readonly version: string,
  ) {
    this.record = readRecord(dataDir);
    this.keys = readKeys(dataDir);
  }

  attach(manager: ServerManager): void {
    this.manager = manager;
    if (this.record && this.keys) {
      this.active = true;
      this.connect();
    }
  }

  private rpc: ((method: string, serverId: string, body: unknown) => Promise<unknown>) | null = null;

  setRpc(handler: (method: string, serverId: string, body: unknown) => Promise<unknown>): void {
    this.rpc = handler;
  }

  url(): string | null {
    return this.record?.url ?? null;
  }

  async pair(rawUrl: string, code: string): Promise<void> {
    const url = normalizePanelUrl(rawUrl);
    const trimmed = code.trim();
    if (trimmed.length < 8 || trimmed.length > 32) throw new HttpError(400, 'pairing code is invalid');
    const keys = generateEd25519();
    let response: Response;
    try {
      response = await fetch(`${url}/api/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'Hotbar/0.1.0 (local)' },
        body: JSON.stringify({ code: trimmed, publicKey: keys.publicKey, hostname: os.hostname(), os: process.platform }),
      });
    } catch {
      throw new HttpError(502, 'could not reach the panel');
    }
    const payload = (await response.json().catch(() => ({}))) as { error?: string; nodeId?: string; panelPublicKey?: string };
    if (!response.ok || !payload.nodeId || !payload.panelPublicKey) {
      throw new HttpError(response.status === 400 ? 400 : 502, payload.error ?? 'pairing failed');
    }
    try {
      assertEd25519PublicKey(payload.panelPublicKey);
    } catch {
      throw new HttpError(502, 'panel key is invalid');
    }
    writeKeys(this.dataDir, keys);
    this.keys = keys;
    this.record = { url, nodeId: payload.nodeId, panelPublicKey: payload.panelPublicKey };
    writeRecord(this.dataDir, this.record);
    this.active = true;
    this.attempt = 0;
    this.connect();
  }

  unlink(): void {
    this.generation += 1;
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
    this.record = null;
    this.keys = null;
    fs.rmSync(path.join(this.dataDir, 'panel-link.json'), { force: true });
    fs.rmSync(path.join(this.dataDir, 'agent-ed25519.pem'), { force: true });
  }

  stop(): void {
    this.generation += 1;
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
  }

  forward(event: AgentEvent): void {
    if (event.type === 'hello' || event.type === 'install.progress') return;
    this.send(event);
  }

  snapshot(): void {
    if (!this.manager) return;
    this.send({ type: 'snapshot', servers: this.manager.list() });
  }

  private connect(): void {
    if (!this.record || !this.keys || !this.active) return;
    const generation = ++this.generation;
    const record = this.record;
    const previous = this.socket;
    this.socket = null;
    previous?.close();
    const socket = new WebSocket(`${record.url.replace(/^http/i, 'ws')}/api/agents`);
    this.socket = socket;
    socket.on('open', () => {
      if (generation !== this.generation) return;
      this.attempt = 0;
      this.send({ type: 'hello', agentVersion: this.version, nodeId: record.nodeId });
      this.snapshot();
    });
    socket.on('message', (data) => {
      const message = openEnvelope<PanelDownlink>(record.panelPublicKey, data.toString());
      if (!message) {
        socket.close();
        return;
      }
      void this.handle(message);
    });
    socket.on('close', () => {
      if (generation !== this.generation) return;
      if (this.socket === socket) this.socket = null;
      this.schedule();
    });
    socket.on('error', () => socket.close());
  }

  private schedule(): void {
    if (!this.active || !this.record) return;
    if (this.timer) clearTimeout(this.timer);
    const delay = Math.min(30_000, 1000 * 2 ** this.attempt);
    this.attempt += 1;
    this.timer = setTimeout(() => this.connect(), delay);
    this.timer.unref();
  }

  private async handle(message: PanelDownlink): Promise<void> {
    if (!this.manager) return;
    if (message.type === 'server.power') {
      try {
        await this.manager.power(message.serverId, message.action);
      } catch (error) {
        this.send({
          type: 'command.error',
          serverId: message.serverId,
          message: error instanceof Error ? error.message : 'power failed',
        });
      }
      return;
    }
    if (message.type === 'server.stdin') {
      try {
        this.manager.send(message.serverId, message.line);
      } catch (error) {
        this.send({
          type: 'command.error',
          serverId: message.serverId,
          message: error instanceof Error ? error.message : 'command failed',
        });
      }
      return;
    }
    if (message.type === 'logs.request') {
      try {
        this.send({ type: 'logs.result', requestId: message.requestId, snapshot: this.manager.logs(message.serverId) });
      } catch {
        this.send({ type: 'logs.result', requestId: message.requestId, snapshot: { lines: [], nextCursor: 0 } });
      }
      return;
    }
    if (message.type === 'rpc') {
      try {
        if (!this.rpc) throw new Error('this agent cannot run that request');
        const body = await this.rpc(message.method, message.serverId, message.body);
        this.send({ type: 'rpc.result', requestId: message.requestId, ok: true, body });
      } catch (error) {
        this.send({
          type: 'rpc.result',
          requestId: message.requestId,
          ok: false,
          error: error instanceof Error ? error.message : 'request failed',
        });
      }
    }
  }

  private send(message: AgentUplink): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.keys) return;
    this.socket.send(envelope(this.keys.privateKey, message));
  }
}

function normalizePanelUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new HttpError(400, 'panel URL is invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'panel URL must be http or https');
  if (url.username || url.password) throw new HttpError(400, 'panel URL must not include credentials');
  if (!url.hostname) throw new HttpError(400, 'panel URL is invalid');
  return url.origin;
}

function readRecord(dataDir: string): LinkRecord | null {
  const file = path.join(dataDir, 'panel-link.json');
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as LinkRecord;
    if (!parsed.url || !parsed.nodeId || !parsed.panelPublicKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRecord(dataDir: string, record: LinkRecord): void {
  fs.writeFileSync(path.join(dataDir, 'panel-link.json'), `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

function readKeys(dataDir: string): KeyPair | null {
  const file = path.join(dataDir, 'agent-ed25519.pem');
  if (!fs.existsSync(file)) return null;
  try {
    const privateKey = fs.readFileSync(file, 'utf8');
    return { publicKey: publicKeyFromPrivate(privateKey), privateKey };
  } catch {
    return null;
  }
}

function writeKeys(dataDir: string, keys: KeyPair): void {
  const file = path.join(dataDir, 'agent-ed25519.pem');
  fs.writeFileSync(file, keys.privateKey, { encoding: 'utf8', mode: 0o600 });
  restrict(file);
}

function restrict(file: string): void {
  if (process.platform !== 'win32') return;
  const username = process.env.USERNAME;
  if (!username) return;
  const child = spawn('icacls', [file, '/inheritance:r', '/grant:r', `${username}:(R)`], { windowsHide: true, stdio: 'ignore' });
  child.on('error', () => undefined);
}
