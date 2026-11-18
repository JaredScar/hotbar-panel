import crypto from 'node:crypto';
import type { WebSocket } from 'ws';
import type { AgentUplink, LogSnapshot, PanelDownlink, PowerAction, ServerView } from '@hotbar/shared';
import { envelope, openEnvelope } from './sign.js';
import { PanelError, type PanelStore } from './store.js';

const ACTIONS = new Set<PowerAction>(['start', 'stop', 'restart', 'kill']);

const RPC_PERMISSION: Record<string, string> = {
  'files.list': 'file.read',
  'files.read': 'file.read',
  'files.write': 'file.update',
  'files.mkdir': 'file.create',
  'files.rename': 'file.update',
  'files.upload': 'file.create',
  'files.delete': 'file.delete',
  'backups.list': 'backup.read',
  'backups.create': 'backup.create',
  'backups.restore': 'backup.restore',
  'backups.delete': 'backup.delete',
  'schedules.list': 'schedule.read',
  'schedules.create': 'schedule.create',
  'schedules.delete': 'schedule.delete',
  'activity.list': 'activity.read',
  'modpacks.search': 'file.read',
  'modpack.install': 'file.create',
  'addons.search': 'file.read',
  'addon.install': 'file.create',
  'install.read': 'startup.read',
  'players.list': 'server.read',
  'players.action': 'control.console',
  'version.change': 'startup.update',
};

export class Hub {
  private readonly agents = new Map<string, WebSocket>();
  private readonly browsers = new Map<string, Set<WebSocket>>();
  private readonly subscribers = new Map<string, Set<WebSocket>>();
  private readonly powerWaiters = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readonly logWaiters = new Map<string, { resolve: (snapshot: LogSnapshot) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private readonly rpcWaiters = new Map<string, { resolve: (body: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly store: PanelStore) {}

  acceptAgent(socket: WebSocket): void {
    let nodeId: string | null = null;
    let publicKey: string | null = null;
    const timer = setTimeout(() => {
      if (!nodeId) socket.close(4001, 'hello');
    }, 10_000);
    socket.on('message', (data) => {
      const raw = data.toString();
      if (!publicKey) {
        const opened = readHello(raw);
        if (!opened) {
          socket.close(4001, 'hello');
          return;
        }
        const node = this.store.getNode(opened.nodeId);
        if (!node || !openEnvelope(node.publicKey, raw)) {
          socket.close(4003, 'signature');
          return;
        }
        nodeId = node.id;
        publicKey = node.publicKey;
        clearTimeout(timer);
        this.agents.set(node.id, socket);
        this.store.touchNode(node.id);
        return;
      }
      const message = openEnvelope<AgentUplink>(publicKey, raw);
      if (!message || !nodeId) {
        socket.close(4003, 'signature');
        return;
      }
      this.onAgent(nodeId, message);
    });
    socket.on('close', () => {
      clearTimeout(timer);
      if (nodeId && this.agents.get(nodeId) === socket) this.agents.delete(nodeId);
    });
    socket.on('error', () => socket.close());
  }

  acceptBrowser(socket: WebSocket, userId: string): void {
    const group = this.browsers.get(userId) ?? new Set<WebSocket>();
    group.add(socket);
    this.browsers.set(userId, group);
    socket.send(JSON.stringify({ type: 'hello', agentVersion: 'panel' }));
    socket.on('message', (data) => {
      let message: { type?: string; serverId?: string; line?: string };
      try {
        message = JSON.parse(data.toString()) as { type?: string; serverId?: string; line?: string };
      } catch {
        return;
      }
      if (!message.serverId) return;
      const owned = this.store.ownedServer(userId, message.serverId);
      if (!owned) return;
      if (message.type === 'subscribe') {
        const set = this.subscribers.get(message.serverId) ?? new Set<WebSocket>();
        set.add(socket);
        this.subscribers.set(message.serverId, set);
      }
      if (message.type === 'stdin' && typeof message.line === 'string') {
        this.send(owned.nodeId, { type: 'server.stdin', serverId: owned.view.id, line: message.line.slice(0, 2000) });
      }
    });
    const drop = () => {
      group.delete(socket);
      for (const set of this.subscribers.values()) set.delete(socket);
    };
    socket.on('close', drop);
    socket.on('error', drop);
  }

  close(): void {
    for (const socket of this.agents.values()) socket.close();
    for (const group of this.browsers.values()) {
      for (const socket of group) socket.close();
    }
  }

  async power(userId: string, serverId: string, action: string): Promise<ServerView> {
    if (!ACTIONS.has(action as PowerAction)) throw new PanelError(400, 'action is not valid');
    const permission = action === 'start' ? 'control.start' : action === 'stop' ? 'control.stop' : action === 'restart' ? 'control.restart' : 'control.kill';
    const owned = this.requireAccess(userId, serverId, permission);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.powerWaiters.delete(serverId);
        reject(new PanelError(504, 'the machine did not answer'));
      }, 15_000);
      this.powerWaiters.set(serverId, { resolve, reject, timer });
      const sent = this.send(owned.nodeId, { type: 'server.power', serverId, action: action as PowerAction });
      if (!sent) {
        clearTimeout(timer);
        this.powerWaiters.delete(serverId);
        reject(new PanelError(503, 'that machine is offline'));
      }
    });
    return this.store.ownedServer(userId, serverId)?.view ?? owned.view;
  }

  rpc(userId: string, serverId: string, method: string, body: unknown): Promise<unknown> {
    const permission = RPC_PERMISSION[method];
    if (!permission) throw new PanelError(400, 'unknown request');
    const owned = this.requireAccess(userId, serverId, permission);
    const requestId = crypto.randomUUID();
    const timeout = method === 'modpack.install' || method === 'addon.install' || method === 'backups.create' || method === 'version.change' ? 10 * 60 * 1000 : 20_000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.rpcWaiters.delete(requestId);
        reject(new PanelError(504, 'the machine did not answer'));
      }, timeout);
      this.rpcWaiters.set(requestId, { resolve, reject, timer });
      const sent = this.send(owned.nodeId, { type: 'rpc', requestId, method, serverId, body });
      if (!sent) {
        clearTimeout(timer);
        this.rpcWaiters.delete(requestId);
        reject(new PanelError(503, 'that machine is offline'));
      }
    });
  }

  stdin(userId: string, serverId: string, line: string): void {
    if (typeof line !== 'string' || line.length < 1 || line.length > 2000 || /[\r\n\0]/.test(line)) {
      throw new PanelError(400, 'command is not valid');
    }
    const owned = this.requireAccess(userId, serverId, 'control.console');
    if (!this.send(owned.nodeId, { type: 'server.stdin', serverId, line })) throw new PanelError(503, 'that machine is offline');
  }

  logs(userId: string, serverId: string): Promise<LogSnapshot> {
    const owned = this.requireAccess(userId, serverId, 'server.read');
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.logWaiters.delete(requestId);
        reject(new PanelError(504, 'the machine did not answer'));
      }, 10_000);
      this.logWaiters.set(requestId, { resolve, reject, timer });
      const sent = this.send(owned.nodeId, { type: 'logs.request', requestId, serverId });
      if (!sent) {
        clearTimeout(timer);
        this.logWaiters.delete(requestId);
        reject(new PanelError(503, 'that machine is offline'));
      }
    });
  }

  private requireAccess(userId: string, serverId: string, permission: string) {
    const owned = this.store.accessServer(userId, serverId);
    if (!owned) throw new PanelError(404, 'server not found');
    if (!owned.permissions.includes('*') && !owned.permissions.includes(permission)) throw new PanelError(403, 'forbidden');
    return owned;
  }

  private send(nodeId: string, message: PanelDownlink): boolean {
    const socket = this.agents.get(nodeId);
    if (!socket || socket.readyState !== socket.OPEN) return false;
    socket.send(envelope(this.store.signingKey(), message));
    return true;
  }

  private onAgent(nodeId: string, message: AgentUplink): void {
    if (message.type === 'snapshot') {
      this.store.replaceServers(nodeId, message.servers);
      this.notifyUser(nodeId);
      return;
    }
    if (message.type === 'logs.result') {
      const waiter = this.logWaiters.get(message.requestId);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.logWaiters.delete(message.requestId);
      waiter.resolve(message.snapshot);
      return;
    }
    if (message.type === 'rpc.result') {
      const waiter = this.rpcWaiters.get(message.requestId);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.rpcWaiters.delete(message.requestId);
      if (message.ok) waiter.resolve(message.body);
      else waiter.reject(new PanelError(400, message.error ?? 'request failed'));
      return;
    }
    if (message.type === 'command.error') {
      const waiter = this.powerWaiters.get(message.serverId);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.powerWaiters.delete(message.serverId);
      waiter.reject(new PanelError(409, message.message));
      return;
    }
    if (message.type === 'server.state') {
      this.store.patchServer(message.serverId, { state: message.state, startedAt: message.startedAt, pid: message.pid });
      this.finishPower(message.serverId);
      this.fanout(message.serverId, message);
      return;
    }
    if (message.type === 'server.stats') {
      this.store.patchServer(message.serverId, { stats: message.stats, startedAt: message.startedAt });
      this.fanout(message.serverId, message);
      return;
    }
    if (message.type === 'server.log') {
      this.fanout(message.line.serverId, message);
      return;
    }
    if (message.type === 'server.removed') {
      this.store.removeServer(message.serverId);
      this.fanout(message.serverId, message);
      this.notifyUser(nodeId);
    }
  }

  private finishPower(serverId: string): void {
    const waiter = this.powerWaiters.get(serverId);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.powerWaiters.delete(serverId);
    waiter.resolve();
  }

  private fanout(serverId: string, message: AgentUplink): void {
    const encoded = JSON.stringify(message);
    for (const socket of this.subscribers.get(serverId) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(encoded);
    }
  }

  private notifyUser(nodeId: string): void {
    const node = this.store.getNode(nodeId);
    if (!node) return;
    const encoded = JSON.stringify({ type: 'servers.changed' });
    for (const socket of this.browsers.get(node.userId) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(encoded);
    }
  }
}

function readHello(raw: string): { nodeId: string } | null {
  try {
    const parsed = JSON.parse(raw) as { payload?: string };
    if (typeof parsed.payload !== 'string') return null;
    const message = JSON.parse(parsed.payload) as { type?: string; nodeId?: string };
    if (message.type !== 'hello' || !message.nodeId) return null;
    return { nodeId: message.nodeId };
  } catch {
    return null;
  }
}
