import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import {
  hasPermission,
  type AgentEvent,
  type MachineInfo,
  type Permission,
  type Principal,
} from '@hotbar/shared';
import type { AgentConfig } from './config.js';
import { createNamedDatabase, databasesFor, deleteNamedDatabase, revealDatabasePassword, rotateNamedDatabase } from './databases.js';
import { acceptedDownloadIds, assertDownloadAccepted, databaseDownloadPlan } from './downloads.js';
import { listActivity, openDatabase, writeActivity } from './db.js';
import { HttpError } from './errors.js';
import { ServerManager, type ManagerEvent } from './manager.js';
import { startBackupLoop } from './minecraft/backup.js';
import { actOnPlayer, collectPlayers } from './minecraft/players.js';
import { MinecraftService } from './minecraft/service.js';
import { PanelLink } from './panel-link.js';
import { notifyDesktop } from './notify.js';
import { registerOps } from './routes-ops.js';
import { notifyWebhook } from './settings.js';
import { runHostOp } from './host-ops.js';
import { sftpPassword, startSftp } from './sftp.js';
import { parseCreateServer, readPowerAction, readStdin } from './validate.js';

const POWER_PERMISSION: Record<string, Permission> = {
  start: 'control.start',
  stop: 'control.stop',
  restart: 'control.restart',
  kill: 'control.kill',
};

export interface RunningAgent {
  app: FastifyInstance;
  port: number;
  manager: ServerManager;
  close: () => Promise<void>;
}

export async function startAgent(config: AgentConfig): Promise<RunningAgent> {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.serversRoot, { recursive: true });
  const db = openDatabase(config.dataDir);
  const sockets = new Set<WebSocket>();
  const link = new PanelLink(config.dataDir, config.version);
  const manager = new ServerManager(db, (event) => {
    try {
      broadcast(sockets, event, config.version);
      link.forward(toWire(event, config.version));
      if (event.type === 'removed' || (event.type === 'log' && event.line.line === 'server registered')) link.snapshot();
    } catch {
      // A browser or panel socket can throw while sending. That must not stop the agent.
    }
  }, (message) => {
    void notifyWebhook(config.dataDir, message);
    notifyDesktop('Hotbar', message);
  });
  link.setRpc(async (method, serverId, body) => {
    if (method === 'install.read') return minecraft.currentInstall(serverId);
    if (method === 'version.change') {
      const input = body as { provider?: string; version?: string };
      assertDownloadAccepted(body, [
        {
          id: 'server',
          title: `${input?.provider ?? 'server'} ${input?.version ?? ''}`.trim(),
          detail: 'The server files for this version, if they are not already saved on this computer.',
        },
      ]);
      return minecraft.changeVersion(serverId, input?.provider as never, input?.version ?? '');
    }
    return runHostOp(config, db, manager, method, serverId, body);
  });
  link.attach(manager);
  manager.init();

  const minecraft = new MinecraftService(config, manager, db, (event) => sendRaw(sockets, event));
  const stopBackups = startBackupLoop(config, manager, db);
  const principal: Principal = { id: 'local-token', permissions: config.permissions };
  const app = Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024 });
  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type'],
  });
  await app.register(websocket);

  app.setErrorHandler((error, _request, reply) => {
    const statusCode = error instanceof HttpError ? error.statusCode : error instanceof Error ? statusOf(error) : 500;
    const message = error instanceof Error ? error.message : 'internal error';
    const hidden = !(error instanceof HttpError) && statusCode >= 500;
    const downloads = error instanceof HttpError ? error.details : undefined;
    void reply.status(statusCode).send({
      error: hidden ? 'internal error' : message,
      ...(downloads !== undefined ? { downloads } : {}),
    });
  });

  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'OPTIONS' || request.url.split('?')[0] === '/api/ws') return;
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : '';
    if (token !== config.token) {
      audit(db, request, 'auth.unauthorized', null, {});
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  const guard = (request: FastifyRequest, permission: Permission): void => {
    if (!hasPermission(principal, permission)) {
      audit(db, request, 'auth.forbidden', null, { permission });
      throw new HttpError(403, 'forbidden');
    }
  };

  app.get('/api/health', async (request) => {
    guard(request, 'server.read');
    audit(db, request, 'health.read', null, {});
    return { ok: true, version: config.version };
  });

  app.get('/api/machine', async (request) => {
    guard(request, 'server.read');
    audit(db, request, 'machine.read', null, {});
    return machineInfo(config, link.url());
  });

  app.get('/api/servers', async (request) => {
    guard(request, 'server.read');
    audit(db, request, 'server.list', null, {});
    return manager.list();
  });

  app.post('/api/servers', async (request, reply) => {
    guard(request, 'servers.create');
    const created = manager.create(parseCreateServer(request.body));
    audit(db, request, 'server.create', created.id, { name: created.name });
    return reply.code(201).send(created);
  });

  app.post('/api/servers/demo', async (request, reply) => {
    guard(request, 'servers.create');
    if (!config.dev) throw new HttpError(404, 'not found');
    const script = fileURLToPath(new URL('../../../templates/echo/server.mjs', import.meta.url));
    const created = manager.create(
      parseCreateServer({
        name: 'Echo',
        command: [process.execPath, script],
        cwd: path.dirname(script),
        stop: { stdin: 'stop', timeoutMs: 5000 },
      }),
    );
    audit(db, request, 'server.create', created.id, { demo: true });
    return reply.code(201).send(created);
  });

  app.get('/api/servers/:id', async (request) => {
    guard(request, 'server.read');
    const id = (request.params as { id: string }).id;
    audit(db, request, 'server.read', id, {});
    return manager.get(id);
  });

  app.delete('/api/servers/:id', async (request, reply) => {
    guard(request, 'servers.delete');
    const id = (request.params as { id: string }).id;
    manager.remove(id);
    audit(db, request, 'server.delete', id, {});
    return reply.code(204).send();
  });

  app.post('/api/servers/:id/power', async (request) => {
    const action = readPowerAction(request.body);
    guard(request, POWER_PERMISSION[action] ?? 'control.stop');
    const id = (request.params as { id: string }).id;
    const view = await manager.power(id, action);
    audit(db, request, 'server.power', id, { action });
    return view;
  });

  app.post('/api/servers/:id/stdin', async (request, reply) => {
    guard(request, 'control.console');
    const id = (request.params as { id: string }).id;
    const line = readStdin(request.body);
    manager.send(id, line);
    audit(db, request, 'server.stdin', id, { bytes: line.length });
    return reply.code(204).send();
  });

  app.get('/api/servers/:id/players', async (request) => {
    guard(request, 'server.read');
    const id = (request.params as { id: string }).id;
    return collectPlayers(manager, id);
  });

  app.post('/api/servers/:id/players', async (request) => {
    guard(request, 'control.console');
    const id = (request.params as { id: string }).id;
    const body = request.body as { action?: string; name?: string; reason?: string };
    const result = await actOnPlayer(manager, id, body?.action ?? '', body?.name ?? '', body?.reason ?? '');
    audit(db, request, 'server.players', id, { action: body?.action ?? '' });
    return result;
  });

  app.get('/api/servers/:id/logs', async (request) => {
    guard(request, 'control.console');
    const id = (request.params as { id: string }).id;
    audit(db, request, 'server.logs', id, {});
    return manager.logs(id);
  });

  app.get('/api/minecraft/versions', async (request) => {
    guard(request, 'server.read');
    const query = request.query as { provider?: string; snapshots?: string };
    return minecraft.versions(query.provider ?? '', query.snapshots === '1' || query.snapshots === 'true');
  });

  app.post('/api/minecraft', async (request, reply) => {
    guard(request, 'servers.create');
    const job = minecraft.begin(request.body);
    audit(db, request, 'minecraft.create', job.jobId, {});
    return reply.code(202).send(job);
  });

  app.get('/api/servers/:id/properties', async (request) => {
    guard(request, 'startup.read');
    return minecraft.readProperties((request.params as { id: string }).id);
  });

  app.put('/api/servers/:id/properties', async (request) => {
    guard(request, 'startup.update');
    const id = (request.params as { id: string }).id;
    const saved = minecraft.writeProperties(id, request.body);
    try {
      audit(db, request, 'server.properties', id, {});
    } catch {
      // The file is already saved. A log failure must not look like the agent died.
    }
    return saved;
  });

  app.get('/api/servers/:id/reachability', async (request) => {
    guard(request, 'server.read');
    return minecraft.reachability((request.params as { id: string }).id);
  });

  app.get('/api/servers/:id/install', async (request) => {
    guard(request, 'startup.read');
    return minecraft.currentInstall((request.params as { id: string }).id);
  });

  app.post('/api/servers/:id/version', async (request) => {
    guard(request, 'startup.update');
    const id = (request.params as { id: string }).id;
    const body = request.body as { provider?: string; version?: string };
    assertDownloadAccepted(request.body, [
      {
        id: 'server',
        title: `${body?.provider ?? 'server'} ${body?.version ?? ''}`.trim(),
        detail: 'The server files for this version, if they are not already saved on this computer.',
      },
    ]);
    const saved = await minecraft.changeVersion(id, body?.provider as never, body?.version ?? '');
    audit(db, request, 'server.version', id, { provider: saved.provider, version: saved.version });
    return saved;
  });

  app.post('/api/link', async (request) => {
    guard(request, 'servers.create');
    const body = request.body as { url?: string; code?: string };
    if (typeof body?.url !== 'string' || typeof body.code !== 'string') throw new HttpError(400, 'url and code are required');
    await link.pair(body.url, body.code);
    audit(db, request, 'panel.link', link.url(), {});
    return machineInfo(config, link.url());
  });

  app.delete('/api/link', async (request) => {
    guard(request, 'servers.create');
    link.unlink();
    audit(db, request, 'panel.unlink', null, {});
    return machineInfo(config, null);
  });

  app.get('/api/activity', async (request) => {
    guard(request, 'activity.read');
    audit(db, request, 'activity.list', null, {});
    return listActivity(db, 100);
  });

  registerOps(app, config, db, manager, guard);

  app.get('/api/ws', { websocket: true }, (socket: WebSocket, request: FastifyRequest) => {
    const origin = request.headers.origin;
    if (origin && !isAllowedOrigin(origin)) {
      socket.close(4003, 'origin');
      return;
    }
    const token = (request.query as { access_token?: string }).access_token;
    if (token !== config.token) {
      socket.close(4001, 'unauthorized');
      return;
    }
    if (!hasPermission(principal, 'websocket.connect')) {
      socket.close(4003, 'forbidden');
      return;
    }
    sockets.add(socket);
    socket.send(JSON.stringify({ type: 'hello', agentVersion: config.version }));
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));
  });

  const sftp = await startSftp(config.dataDir, manager);

  app.get('/api/servers/:id/sftp', async (request) => {
    guard(request, 'file.sftp');
    const id = (request.params as { id: string }).id;
    const server = manager.get(id);
    return { host: '127.0.0.1', port: sftp.port, username: server.id, password: sftpPassword(config.dataDir, server.id) };
  });

  app.get('/api/servers/:id/databases', async (request) => {
    guard(request, 'database.read');
    const id = (request.params as { id: string }).id;
    manager.get(id);
    return databasesFor(db, id);
  });

  app.post('/api/servers/:id/databases', async (request) => {
    guard(request, 'database.create');
    const id = (request.params as { id: string }).id;
    manager.get(id);
    const name = ((request.body as { name?: string }).name ?? '').trim();
    const created = await createNamedDatabase(db, config.dataDir, id, name, acceptedDownloadIds(request.body));
    if (created.status === 'created') manager.note(id, `database ${name} created`);
    return created;
  });

  app.get('/api/servers/:id/databases/plan', async (request) => {
    guard(request, 'database.read');
    const id = (request.params as { id: string }).id;
    manager.get(id);
    return databaseDownloadPlan();
  });

  app.get('/api/servers/:id/databases/:databaseId/password', async (request) => {
    guard(request, 'database.view_password');
    const { id, databaseId } = request.params as { id: string; databaseId: string };
    manager.get(id);
    return revealDatabasePassword(db, id, databaseId);
  });

  app.post('/api/servers/:id/databases/:databaseId/password', async (request) => {
    guard(request, 'database.update');
    const { id, databaseId } = request.params as { id: string; databaseId: string };
    manager.get(id);
    const rotated = await rotateNamedDatabase(db, config.dataDir, id, databaseId);
    manager.note(id, 'database password rotated');
    return rotated;
  });

  app.delete('/api/servers/:id/databases/:databaseId', async (request) => {
    guard(request, 'database.delete');
    const { id, databaseId } = request.params as { id: string; databaseId: string };
    manager.get(id);
    await deleteNamedDatabase(db, config.dataDir, id, databaseId);
    manager.note(id, 'database deleted');
    return { ok: true };
  });

  app.post('/api/eggs/:id/launch', async (request) => {
    guard(request, 'servers.create');
    const id = (request.params as { id: string }).id;
    const file = path.join(config.dataDir, 'eggs', `${id}.json`);
    if (!fs.existsSync(file)) throw new HttpError(404, 'imported egg not found');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { template?: { name?: string; startup?: { command?: string[] }; runtimes?: { docker?: { image?: string } } } };
    const command = saved.template?.startup?.command ?? [];
    const image = saved.template?.runtimes?.docker?.image;
    if (!image || command.length === 0 || command[0] === 'echo') {
      throw new HttpError(400, 'this egg has no Docker image or its startup uses a shell');
    }
    assertDownloadAccepted(request.body, [
      {
        id: 'image',
        title: image,
        detail: 'Docker downloads this image if it is not already on this computer.',
      },
    ]);
    const root = path.join(config.serversRoot, id);
    fs.mkdirSync(root, { recursive: true });
    return manager.create({
      name: saved.template?.name || id,
      command: ['docker', 'run', '--rm', '-i', '--name', `hotbar-${id}`.slice(0, 60), '-v', `${root}:/data`, image, ...command],
      cwd: root,
      env: {},
      stop: { timeoutMs: 15_000 },
      allocation: null,
      autoStart: false,
      autoRestart: false,
      templateId: id,
      templateVersion: 1,
    });
  });

  await app.listen({ host: config.host, port: config.port });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;

  return {
    app,
    port,
    manager,
    close: async () => {
      stopBackups();
      await sftp.close();
      link.stop();
      for (const socket of sockets) socket.close();
      await manager.shutdown();
      await app.close();
      db.close();
    },
  };
}

function sendRaw(sockets: Set<WebSocket>, event: AgentEvent): void {
  let message: string;
  try {
    message = JSON.stringify(event);
  } catch {
    return;
  }
  deliver(sockets, message);
}

function broadcast(sockets: Set<WebSocket>, event: ManagerEvent, version: string): void {
  let message: string;
  try {
    message = JSON.stringify(toWire(event, version));
  } catch {
    return;
  }
  deliver(sockets, message);
}

function deliver(sockets: Set<WebSocket>, message: string): void {
  for (const socket of sockets) {
    try {
      if (socket.readyState === socket.OPEN) socket.send(message);
    } catch {
      sockets.delete(socket);
    }
  }
}

function toWire(event: ManagerEvent, version: string): AgentEvent {
  if (event.type === 'state') {
    return {
      type: 'server.state',
      serverId: event.server.def.id,
      state: event.server.state,
      startedAt: event.server.startedAt,
      pid: event.server.pid,
    };
  }
  if (event.type === 'log') return { type: 'server.log', line: event.line };
  if (event.type === 'stats') {
    if (!event.server.stats) {
      return {
        type: 'server.state',
        serverId: event.server.def.id,
        state: event.server.state,
        startedAt: event.server.startedAt,
        pid: event.server.pid,
      };
    }
    return {
      type: 'server.stats',
      serverId: event.server.def.id,
      stats: event.server.stats,
      startedAt: event.server.startedAt,
    };
  }
  if (event.type === 'removed') return { type: 'server.removed', serverId: event.serverId };
  return { type: 'hello', agentVersion: version };
}

function machineInfo(config: AgentConfig, linkedPanel: string | null = null): MachineInfo {
  const platform = os.platform();
  const osName = platform === 'win32' ? 'windows' : platform === 'linux' ? 'linux' : platform === 'darwin' ? 'darwin' : 'other';
  let diskTotalBytes: number | null = null;
  let diskFreeBytes: number | null = null;
  try {
    const stat = fs.statfsSync(config.serversRoot);
    diskTotalBytes = Number(stat.blocks) * Number(stat.bsize);
    diskFreeBytes = Number(stat.bavail) * Number(stat.bsize);
  } catch {
    diskTotalBytes = null;
    diskFreeBytes = null;
  }
  return {
    hostname: os.hostname(),
    os: osName,
    platform,
    arch: os.arch(),
    cpuCount: os.cpus().length,
    memoryTotalBytes: os.totalmem(),
    memoryFreeBytes: os.freemem(),
    diskTotalBytes,
    diskFreeBytes,
    runtime: 'process',
    agentVersion: config.version,
    pid: process.pid,
    agentUptimeMs: Math.round(process.uptime() * 1000),
    mode: 'local',
    linkedPanel,
    dev: config.dev,
    dataDir: config.dataDir,
    serversRoot: config.serversRoot,
  };
}

function audit(
  db: ReturnType<typeof openDatabase>,
  request: FastifyRequest,
  event: string,
  target: string | null,
  properties: Record<string, unknown>,
): void {
  writeActivity(db, {
    at: new Date().toISOString(),
    actor: 'local-token',
    event,
    target,
    ip: request.ip,
    properties,
  });
}

export function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  } catch {
    return false;
  }
}

function statusOf(error: Error): number {
  const maybe = error as Error & { statusCode?: number };
  return typeof maybe.statusCode === 'number' ? maybe.statusCode : 500;
}
