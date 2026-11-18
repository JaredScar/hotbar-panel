import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentConfig } from './config.js';
import { createNamedDatabase, databasesFor, deleteNamedDatabase, revealDatabasePassword, rotateNamedDatabase } from './databases.js';
import { acceptedDownloadIds, assertDownloadAccepted, databaseDownloadPlan } from './downloads.js';
import { deleteSchedule, insertSchedule, listActivity, listSchedules, readInstall } from './db.js';
import { HttpError } from './errors.js';
import { listFiles, makeDirectory, readFileText, removePath, renamePath, saveUpload, writeFileText } from './files.js';
import type { ServerManager } from './manager.js';
import { createServerBackup, restoreServerBackup } from './minecraft/backup.js';
import { actOnPlayer, collectPlayers } from './minecraft/players.js';
import { addonDownloadOffer, installAddon, installModpack, searchAddons, searchModpacks } from './modrinth.js';

const CRON = /^(\*|[0-9]{1,2}(,[0-9]{1,2})*)(\s+(\*|[0-9]{1,2}(,[0-9]{1,2})*)){4}$/;

export async function runHostOp(
  config: AgentConfig,
  db: DatabaseSync,
  manager: ServerManager,
  method: string,
  serverId: string,
  body: unknown,
): Promise<unknown> {
  const input = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '');
  if (method === 'activity.list') return listActivity(db, 100);
  const server = manager.list().find((item) => item.id === serverId);
  if (!server) throw new HttpError(404, 'server not found');
  if (method === 'files.list') return listFiles(server.cwd, text('path'));
  if (method === 'files.read') return readFileText(server.cwd, text('path'));
  if (method === 'files.write') {
    writeFileText(server.cwd, text('path'), text('text'));
    return { ok: true };
  }
  if (method === 'files.mkdir') {
    makeDirectory(server.cwd, text('path'));
    return { ok: true };
  }
  if (method === 'files.rename') {
    renamePath(server.cwd, text('from'), text('to'));
    return { ok: true };
  }
  if (method === 'files.upload') {
    saveUpload(server.cwd, text('directory'), text('name'), text('base64'));
    return { ok: true };
  }
  if (method === 'files.delete') {
    removePath(server.cwd, text('path'));
    return { ok: true };
  }
  if (method === 'backups.list') return listBackups(config.dataDir, server.id);
  if (method === 'backups.create') {
    const name = await createServerBackup(config.dataDir, server.id, server.cwd);
    manager.note(server.id, `backup written (${name})`);
    return { name };
  }
  if (method === 'backups.restore') {
    if (server.state !== 'offline') throw new HttpError(409, 'stop the server before restoring a backup');
    await restoreServerBackup(config.dataDir, server.id, server.cwd, text('name'));
    manager.note(server.id, `restored backup ${text('name')}`);
    return { ok: true };
  }
  if (method === 'backups.delete') {
    const name = text('name');
    if (!/^[A-Za-z0-9._-]+\.zip$/.test(name)) throw new HttpError(400, 'backup name is not valid');
    fs.rmSync(path.join(config.dataDir, 'backups', server.id, name), { force: true });
    return { ok: true };
  }
  if (method === 'schedules.list') return listSchedules(db, server.id);
  if (method === 'schedules.create') {
    const task = text('task');
    const cron = text('cron').trim();
    if (task !== 'backup' && task !== 'power' && task !== 'command') throw new HttpError(400, 'task must be backup, power, or command');
    if (!CRON.test(cron)) throw new HttpError(400, 'cron must be five fields, using * or numbers');
    const name = text('name').trim().slice(0, 64);
    if (!name) throw new HttpError(400, 'name is required');
    const id = crypto.randomUUID();
    insertSchedule(db, { id, serverId: server.id, name, cron, task });
    const payload = text('payload');
    if (payload.length <= 200) db.prepare('UPDATE schedules SET payload = ? WHERE id = ?').run(payload, id);
    return listSchedules(db, server.id).find((row) => row.id === id);
  }
  if (method === 'schedules.delete') {
    deleteSchedule(db, server.id, text('scheduleId'));
    return { ok: true };
  }
  if (method === 'databases.plan') return databaseDownloadPlan();
  if (method === 'databases.list') return databasesFor(db, server.id);
  if (method === 'databases.create') {
    const created = await createNamedDatabase(db, config.dataDir, server.id, text('name').trim(), acceptedDownloadIds(body));
    if (created.status === 'created') manager.note(server.id, `database ${created.name} created`);
    return created;
  }
  if (method === 'databases.password') return revealDatabasePassword(db, server.id, text('databaseId'));
  if (method === 'databases.rotate') {
    const rotated = await rotateNamedDatabase(db, config.dataDir, server.id, text('databaseId'));
    manager.note(server.id, 'database password rotated');
    return rotated;
  }
  if (method === 'databases.delete') {
    await deleteNamedDatabase(db, config.dataDir, server.id, text('databaseId'));
    manager.note(server.id, 'database deleted');
    return { ok: true };
  }
  if (method === 'addons.search') {
    const install = readInstall(db, server.id);
    if (!install) throw new HttpError(400, 'this server has no Minecraft version yet');
    return searchAddons(text('q'), install.provider, install.version);
  }
  if (method === 'addon.install') {
    if (server.state !== 'offline') throw new HttpError(409, 'stop the server before installing');
    const install = readInstall(db, server.id);
    if (!install) throw new HttpError(400, 'this server has no Minecraft version yet');
    assertDownloadAccepted(body, [addonDownloadOffer(install.provider, install.version)]);
    const filename = await installAddon(server.cwd, text('projectId'), install.provider, install.version, (line) => manager.note(server.id, line));
    return { ok: true, filename };
  }
  if (method === 'startup.save') {
    const memoryMb = input['memoryMb'] === undefined ? undefined : Number(input['memoryMb']);
    const stopTimeoutMs = input['stopTimeoutSec'] === undefined ? undefined : Number(input['stopTimeoutSec']) * 1000;
    if (input['memoryMb'] !== undefined && !Number.isInteger(memoryMb)) throw new HttpError(400, 'memory is not valid');
    if (input['stopStdin'] !== undefined && typeof input['stopStdin'] !== 'string') throw new HttpError(400, 'stop command is not valid');
    if (input['stopTimeoutSec'] !== undefined && !Number.isInteger(Number(input['stopTimeoutSec']))) throw new HttpError(400, 'stop timeout is not valid');
    return manager.updateLaunch(server.id, {
      ...(memoryMb !== undefined ? { memoryMb } : {}),
      ...(typeof input['stopStdin'] === 'string' ? { stopStdin: input['stopStdin'] } : {}),
      ...(stopTimeoutMs !== undefined ? { stopTimeoutMs } : {}),
      ...(typeof input['autoStart'] === 'boolean' ? { autoStart: input['autoStart'] } : {}),
      ...(typeof input['autoRestart'] === 'boolean' ? { autoRestart: input['autoRestart'] } : {}),
    });
  }
  if (method === 'players.list') return collectPlayers(manager, server.id);
  if (method === 'players.action') return actOnPlayer(manager, server.id, text('action'), text('name'), text('reason'));
  if (method === 'modpacks.search') return searchModpacks(text('q'));
  if (method === 'modpack.install') {
    if (server.state !== 'offline') throw new HttpError(409, 'stop the server before installing a modpack');
    assertDownloadAccepted(body, [
      {
        id: 'modpack',
        title: 'Modrinth pack',
        detail: 'The pack and the server files it lists, from Modrinth.',
      },
    ]);
    await installModpack(server.cwd, text('projectId'), (line) => manager.note(server.id, line));
    return { ok: true };
  }
  throw new HttpError(400, 'unknown request');
}

function listBackups(dataDir: string, serverId: string) {
  const dir = path.join(dataDir, 'backups', serverId);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.zip'))
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return { name, size: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
