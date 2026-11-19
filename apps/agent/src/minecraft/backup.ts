import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentConfig } from '../config.js';
import { listEnabledSchedules } from '../db.js';
import { resolveExecutable } from '../executable.js';
import type { ServerManager } from '../manager.js';
import { run } from './network.js';

export function cronMatches(cron: string, date: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const fields = [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()];
  return parts.every((part, index) => fieldMatches(part, fields[index] ?? 0));
}

function fieldMatches(part: string, value: number): boolean {
  if (part === '*') return true;
  return part.split(',').some((piece) => piece !== '' && Number(piece) === value);
}

export function startBackupLoop(config: AgentConfig, manager: ServerManager, db: DatabaseSync): () => void {
  let lastMinute = '';
  const timer = setInterval(() => {
    const now = new Date();
    const minute = `${now.toDateString()}-${now.getHours()}-${now.getMinutes()}`;
    if (lastMinute === minute) return;
    lastMinute = minute;
    void runDueSchedules(config, manager, db, now);
  }, 20_000);
  timer.unref();
  return () => clearInterval(timer);
}

async function runDueSchedules(config: AgentConfig, manager: ServerManager, db: DatabaseSync, now: Date): Promise<void> {
  for (const row of listEnabledSchedules(db)) {
    if (!cronMatches(row.cron, now)) continue;
    const server = manager.list().find((item) => item.id === row.serverId);
    if (!server) continue;
    try {
      if (row.task === 'backup') {
        const name = await createServerBackup(config.dataDir, server.id, server.cwd);
        manager.note(server.id, `scheduled backup written (${name})`);
      } else if (row.task === 'power' && (row.payload === 'start' || row.payload === 'stop' || row.payload === 'restart')) {
        await manager.power(server.id, row.payload);
        manager.note(server.id, `schedule ${row.name} sent ${row.payload}`);
      } else if (row.task === 'command' && row.payload) {
        manager.send(server.id, row.payload);
        manager.note(server.id, `schedule ${row.name} sent a command`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      manager.alert(server.id, `Schedule ${row.name} failed for ${server.name}: ${message}`);
    }
  }
}

export function pruneBackupFiles(destDir: string, keep = 7): string[] {
  if (!fs.existsSync(destDir)) return [];
  const names = fs
    .readdirSync(destDir)
    .filter((name) => name.endsWith('.zip') && !name.includes('..'))
    .sort();
  const extra = names.slice(0, Math.max(0, names.length - keep));
  for (const name of extra) fs.rmSync(path.join(destDir, name), { force: true });
  return extra;
}

export async function createServerBackup(dataDir: string, serverId: string, cwd: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destDir = path.join(dataDir, 'backups', serverId);
  const dest = path.join(destDir, `${stamp}.zip`);
  fs.mkdirSync(destDir, { recursive: true });
  const stage = fs.mkdtempSync(path.join(dataDir, 'backup-stage-'));
  const folder = path.basename(cwd);
  try {
    copyReadable(cwd, path.join(stage, folder));
    const tar = resolveExecutable('tar');
    const result = await run([tar, '-a', '-cf', dest, '-C', stage, folder]);
    if (result.code !== 0) throw new Error(result.stderr.trim() || 'backup failed');
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  pruneBackupFiles(destDir);
  return path.basename(dest);
}

function copyReadable(source: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'session.lock') continue;
    const from = path.join(source, entry.name);
    const to = path.join(dest, entry.name);
    try {
      if (entry.isDirectory()) copyReadable(from, to);
      else if (entry.isFile()) fs.copyFileSync(from, to);
    } catch {
      // A live world can hold a file open. The rest of the backup still stands.
    }
  }
}

export async function restoreServerBackup(dataDir: string, serverId: string, cwd: string, name: string): Promise<void> {
  if (!/^[A-Za-z0-9._-]+\.zip$/.test(name)) throw new Error('backup name is not valid');
  const archive = path.join(dataDir, 'backups', serverId, name);
  if (!fs.existsSync(archive)) throw new Error('backup not found');
  const tar = resolveExecutable('tar');
  const listed = await run([tar, '-tf', archive]);
  if (listed.code !== 0) throw new Error(listed.stderr.trim() || 'could not read the backup');
  for (const line of listed.stdout.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('/') || /^[A-Za-z]:/.test(line) || line.split(/[/\\]/).includes('..')) {
      throw new Error('backup contains a path outside the server folder');
    }
  }
  const parent = path.dirname(cwd);
  const result = await run([tar, '-xf', archive, '-C', parent]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || 'restore failed');
}

