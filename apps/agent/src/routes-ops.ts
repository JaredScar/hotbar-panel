import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { validateTemplate, type Permission } from '@hotbar/shared';
import type { AgentConfig } from './config.js';
import { deleteSchedule, insertSchedule, listSchedules } from './db.js';
import { assertDownloadAccepted } from './downloads.js';
import { eggToTemplate } from './eggs.js';
import { HttpError } from './errors.js';
import { resolveExecutable } from './executable.js';
import { listFiles, makeDirectory, readFileText, removePath, renamePath, saveUpload, writeFileText } from './files.js';
import type { ServerManager } from './manager.js';
import { createServerBackup, restoreServerBackup } from './minecraft/backup.js';
import { installModpack, searchModpacks } from './modrinth.js';
import { readSettings, writeSettings } from './settings.js';

const CRON = /^(\*|[0-9]{1,2}(,[0-9]{1,2})*)(\s+(\*|[0-9]{1,2}(,[0-9]{1,2})*)){4}$/;
const STEAM_APPS: Record<string, { name: string; windows: string; linux: string }> = {
  '2394010': { name: 'Palworld', windows: 'PalServer.exe', linux: 'PalServer' },
  '258550': { name: 'Rust', windows: 'RustDedicated.exe', linux: 'RustDedicated' },
};

export function registerOps(
  app: FastifyInstance,
  config: AgentConfig,
  db: DatabaseSync,
  manager: ServerManager,
  guard: (request: FastifyRequest, permission: Permission) => void,
): void {
  app.get('/api/setup', async (request) => {
    guard(request, 'server.read');
    const settings = readSettings(config.dataDir);
    return {
      completed: settings.setupCompleted,
      serversRoot: config.serversRoot,
      docker: hasTool('docker'),
      steamcmd: hasTool('steamcmd'),
    };
  });

  app.post('/api/setup', async (request) => {
    guard(request, 'servers.create');
    writeSettings(config.dataDir, { setupCompleted: true });
    return { completed: true, serversRoot: config.serversRoot, docker: hasTool('docker'), steamcmd: hasTool('steamcmd') };
  });

  app.get('/api/settings', async (request) => {
    guard(request, 'settings.rename');
    const settings = readSettings(config.dataDir);
    return { discordWebhook: settings.discordWebhook ? 'configured' : '' };
  });

  app.put('/api/settings', async (request) => {
    guard(request, 'settings.rename');
    const body = request.body as { discordWebhook?: string };
    const webhook = typeof body?.discordWebhook === 'string' ? body.discordWebhook.trim() : '';
    try {
      writeSettings(config.dataDir, { discordWebhook: webhook });
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'settings were rejected');
    }
    return { discordWebhook: webhook ? 'configured' : '' };
  });

  app.get('/api/modpacks', async (request) => {
    guard(request, 'file.read');
    const query = (request.query as { q?: string }).q ?? '';
    return searchModpacks(query);
  });

  app.post('/api/eggs', async (request) => {
    guard(request, 'servers.create');
    try {
      const converted = eggToTemplate(request.body);
      const validation = validateTemplate(converted.template);
      if (!validation.ok) throw new Error(validation.errors.join(' '));
      const dir = path.join(config.dataDir, 'eggs');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${converted.template.id}.json`), JSON.stringify(converted, null, 2));
      return converted;
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'egg was rejected');
    }
  });

  app.post('/api/steam', async (request) => {
    guard(request, 'servers.create');
    const body = request.body as { appId?: string; name?: string };
    const appId = body?.appId ?? '';
    const known = STEAM_APPS[appId];
    if (!known) throw new HttpError(400, 'choose Palworld (2394010) or Rust (258550)');
    assertDownloadAccepted(request.body, [
      {
        id: 'steam',
        title: known.name,
        detail: 'SteamCMD downloads this game. The download can be several gigabytes.',
      },
    ]);
    if (!hasTool('steamcmd')) throw new HttpError(400, 'SteamCMD is not on PATH. Install it, then try again.');
    const name = (body.name ?? known.name).trim().slice(0, 64) || known.name;
    const root = path.join(config.serversRoot, `${name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40)}-${crypto.randomUUID().slice(0, 8)}`);
    fs.mkdirSync(root, { recursive: true });
    const steamcmd = resolveExecutable('steamcmd');
    const { run } = await import('./minecraft/network.js');
    const result = await run(
      [steamcmd, '+force_install_dir', root, '+login', 'anonymous', '+app_update', appId, 'validate', '+quit'],
      root,
      { timeoutMs: 30 * 60 * 1000 },
    );
    if (result.code !== 0) throw new HttpError(500, result.stderr.trim() || 'SteamCMD failed');
    const binaryName = process.platform === 'win32' ? known.windows : known.linux;
    const binary = findFile(root, binaryName);
    if (!binary) throw new HttpError(500, `${binaryName} was not found after SteamCMD finished`);
    return manager.create({
      name,
      command: [binary],
      cwd: path.dirname(binary),
      env: {},
      stop: { stdin: 'stop', timeoutMs: 30_000 },
      allocation: null,
      limits: { cpu: 0, memory: 4 * 1024 * 1024 * 1024, disk: 0 },
      autoStart: false,
      autoRestart: false,
      templateId: appId === '2394010' ? 'palworld' : 'rust',
      templateVersion: 1,
    });
  });

  app.get('/api/servers/:id/files', async (request) => {
    guard(request, 'file.read');
    const params = request.params as { id: string };
    const relative = (request.query as { path?: string }).path ?? '';
    return listFiles(cwdOf(manager, params.id), relative);
  });

  app.get('/api/servers/:id/files/content', async (request) => {
    guard(request, 'file.read');
    const params = request.params as { id: string };
    const relative = (request.query as { path?: string }).path ?? '';
    return readFileText(cwdOf(manager, params.id), relative);
  });

  app.put('/api/servers/:id/files/content', async (request) => {
    guard(request, 'file.update');
    const params = request.params as { id: string };
    const body = request.body as { path?: string; text?: string };
    if (typeof body?.path !== 'string' || typeof body.text !== 'string') throw new HttpError(400, 'path and text are required');
    writeFileText(cwdOf(manager, params.id), body.path, body.text);
    return { ok: true };
  });

  app.post('/api/servers/:id/files/mkdir', async (request) => {
    guard(request, 'file.create');
    const params = request.params as { id: string };
    const body = request.body as { path?: string };
    if (typeof body?.path !== 'string') throw new HttpError(400, 'path is required');
    makeDirectory(cwdOf(manager, params.id), body.path);
    return { ok: true };
  });

  app.post('/api/servers/:id/files/rename', async (request) => {
    guard(request, 'file.update');
    const params = request.params as { id: string };
    const body = request.body as { from?: string; to?: string };
    if (typeof body?.from !== 'string' || typeof body.to !== 'string') throw new HttpError(400, 'from and to are required');
    renamePath(cwdOf(manager, params.id), body.from, body.to);
    return { ok: true };
  });

  app.post('/api/servers/:id/files/upload', async (request) => {
    guard(request, 'file.create');
    const params = request.params as { id: string };
    const body = request.body as { directory?: string; name?: string; base64?: string };
    if (typeof body?.name !== 'string' || typeof body.base64 !== 'string') throw new HttpError(400, 'name and base64 are required');
    saveUpload(cwdOf(manager, params.id), body.directory ?? '', body.name, body.base64);
    return { ok: true };
  });

  app.delete('/api/servers/:id/files', async (request) => {
    guard(request, 'file.delete');
    const params = request.params as { id: string };
    const relative = (request.query as { path?: string }).path ?? '';
    removePath(cwdOf(manager, params.id), relative);
    return { ok: true };
  });

  app.get('/api/servers/:id/backups', async (request) => {
    guard(request, 'backup.read');
    const params = request.params as { id: string };
    cwdOf(manager, params.id);
    const dir = path.join(config.dataDir, 'backups', params.id);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.zip'))
      .map((name) => {
        const stat = fs.statSync(path.join(dir, name));
        return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  app.post('/api/servers/:id/backups', async (request) => {
    guard(request, 'backup.create');
    const params = request.params as { id: string };
    const server = mustServer(manager, params.id);
    const name = await createServerBackup(config.dataDir, server.id, server.cwd);
    manager.note(server.id, `backup written (${name})`);
    return { name };
  });

  app.post('/api/servers/:id/backups/restore', async (request) => {
    guard(request, 'backup.restore');
    const params = request.params as { id: string };
    const server = mustServer(manager, params.id);
    if (server.state !== 'offline') throw new HttpError(409, 'stop the server before restoring a backup');
    const body = request.body as { name?: string };
    if (typeof body?.name !== 'string') throw new HttpError(400, 'backup name is required');
    try {
      await restoreServerBackup(config.dataDir, server.id, server.cwd, body.name);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'restore failed');
    }
    manager.note(server.id, `restored backup ${body.name}`);
    return { ok: true };
  });

  app.delete('/api/servers/:id/backups', async (request) => {
    guard(request, 'backup.delete');
    const params = request.params as { id: string };
    cwdOf(manager, params.id);
    const name = (request.query as { name?: string }).name ?? '';
    if (!/^[A-Za-z0-9._-]+\.zip$/.test(name)) throw new HttpError(400, 'backup name is not valid');
    fs.rmSync(path.join(config.dataDir, 'backups', params.id, name), { force: true });
    return { ok: true };
  });

  app.get('/api/servers/:id/schedules', async (request) => {
    guard(request, 'schedule.read');
    const params = request.params as { id: string };
    cwdOf(manager, params.id);
    return listSchedules(db, params.id);
  });

  app.post('/api/servers/:id/schedules', async (request) => {
    guard(request, 'schedule.create');
    const params = request.params as { id: string };
    cwdOf(manager, params.id);
    const body = request.body as { name?: string; cron?: string; task?: string; payload?: string };
    const task = body?.task ?? '';
    if (task !== 'backup' && task !== 'power' && task !== 'command') throw new HttpError(400, 'task must be backup, power, or command');
    if (typeof body?.cron !== 'string' || !CRON.test(body.cron.trim())) throw new HttpError(400, 'cron must be five fields, using * or numbers');
    const name = (body.name ?? 'Schedule').trim().slice(0, 64);
    if (!name) throw new HttpError(400, 'name is required');
    const id = crypto.randomUUID();
    insertSchedule(db, { id, serverId: params.id, name, cron: body.cron.trim(), task });
    if (typeof body.payload === 'string' && body.payload.length <= 200) {
      db.prepare('UPDATE schedules SET payload = ? WHERE id = ?').run(body.payload, id);
    }
    return listSchedules(db, params.id).find((row) => row.id === id);
  });

  app.delete('/api/servers/:id/schedules/:scheduleId', async (request, reply) => {
    guard(request, 'schedule.delete');
    const params = request.params as { id: string; scheduleId: string };
    deleteSchedule(db, params.id, params.scheduleId);
    return reply.code(204).send();
  });

  app.post('/api/servers/:id/modpack', async (request) => {
    guard(request, 'file.create');
    const params = request.params as { id: string };
    const server = mustServer(manager, params.id);
    if (server.state !== 'offline') throw new HttpError(409, 'stop the server before installing a modpack');
    const projectId = (request.body as { projectId?: string }).projectId ?? '';
    assertDownloadAccepted(request.body, [
      {
        id: 'modpack',
        title: 'Modrinth pack',
        detail: 'The pack and the server files it lists, from Modrinth.',
      },
    ]);
    try {
      await installModpack(server.cwd, projectId, (line) => manager.note(server.id, line));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'modpack install failed');
    }
    return { ok: true };
  });
}

function mustServer(manager: ServerManager, id: string) {
  const server = manager.list().find((item) => item.id === id);
  if (!server) throw new HttpError(404, 'server not found');
  return server;
}

function cwdOf(manager: ServerManager, id: string): string {
  return mustServer(manager, id).cwd;
}

function hasTool(name: string): boolean {
  try {
    resolveExecutable(name);
    return true;
  } catch {
    return false;
  }
}

function findFile(root: string, name: string, depth = 0): string | null {
  if (depth > 6) return null;
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(full, name, depth + 1);
      if (nested) return nested;
    } else if (entry.name === name) {
      return full;
    }
  }
  return null;
}
