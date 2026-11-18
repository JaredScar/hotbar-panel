import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ActivityEntry, ServerDefinition, ServerLimits, ServerStop } from '@hotbar/shared';

interface ServerRow {
  id: string;
  name: string;
  template_id: string | null;
  template_version: number | null;
  command_json: string;
  cwd: string;
  env_json: string;
  stop_json: string;
  allocation_json: string | null;
  limits_json: string;
  auto_start: number;
  auto_restart: number;
  created_at: string;
  updated_at: string;
}

export function openDatabase(dataDir: string): DatabaseSync {
  const db = new DatabaseSync(path.join(dataDir, 'hotbar.sqlite'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      template_id TEXT,
      template_version INTEGER,
      command_json TEXT NOT NULL,
      cwd TEXT NOT NULL,
      env_json TEXT NOT NULL,
      stop_json TEXT NOT NULL,
      allocation_json TEXT,
      limits_json TEXT NOT NULL,
      auto_start INTEGER NOT NULL,
      auto_restart INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      actor TEXT NOT NULL,
      event TEXT NOT NULL,
      target TEXT,
      ip TEXT,
      properties_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mc_installs (
      server_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      mc_version TEXT NOT NULL,
      java_major INTEGER NOT NULL
    );
      CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      cron TEXT NOT NULL,
      task TEXT NOT NULL,
      enabled INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS databases (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      target TEXT NOT NULL
    );
  `);
  const columns = db.prepare('PRAGMA table_info(schedules)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'payload')) {
    db.exec(`ALTER TABLE schedules ADD COLUMN payload TEXT NOT NULL DEFAULT ''`);
  }
  const databaseColumns = db.prepare('PRAGMA table_info(databases)').all() as Array<{ name: string }>;
  const present = new Set(databaseColumns.map((column) => column.name));
  if (!present.has('username')) db.exec(`ALTER TABLE databases ADD COLUMN username TEXT NOT NULL DEFAULT ''`);
  if (!present.has('password')) db.exec(`ALTER TABLE databases ADD COLUMN password TEXT NOT NULL DEFAULT ''`);
  if (!present.has('host')) db.exec(`ALTER TABLE databases ADD COLUMN host TEXT NOT NULL DEFAULT ''`);
  if (!present.has('port')) db.exec(`ALTER TABLE databases ADD COLUMN port INTEGER NOT NULL DEFAULT 0`);
  if (!present.has('db_name')) db.exec(`ALTER TABLE databases ADD COLUMN db_name TEXT NOT NULL DEFAULT ''`);
  return db;
}

export function insertServer(db: DatabaseSync, server: ServerDefinition): void {
  db.prepare(
    `INSERT INTO servers (
      id, name, template_id, template_version, command_json, cwd, env_json, stop_json,
      allocation_json, limits_json, auto_start, auto_restart, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    server.id,
    server.name,
    server.templateId,
    server.templateVersion,
    JSON.stringify(server.command),
    server.cwd,
    JSON.stringify(server.env),
    JSON.stringify(server.stop),
    server.allocation ? JSON.stringify(server.allocation) : null,
    JSON.stringify(server.limits),
    server.autoStart ? 1 : 0,
    server.autoRestart ? 1 : 0,
    server.createdAt,
    server.updatedAt,
  );
}

export function deleteServerRow(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM servers WHERE id = ?').run(id);
  deleteServerExtras(db, id);
}

export function updateAllocation(db: DatabaseSync, id: string, allocation: ServerDefinition['allocation'], updatedAt: string): void {
  db.prepare('UPDATE servers SET allocation_json = ?, updated_at = ? WHERE id = ?').run(
    allocation ? JSON.stringify(allocation) : null,
    updatedAt,
    id,
  );
}

export interface StoredDatabase {
  id: string;
  name: string;
  kind: string;
  target: string;
  host: string;
  port: number;
  username: string;
  dbName: string;
}

interface DatabaseRecord extends StoredDatabase {
  password: string;
}

export function listDatabases(db: DatabaseSync, serverId: string): StoredDatabase[] {
  const rows = db
    .prepare('SELECT id, name, kind, target, host, port, username, db_name FROM databases WHERE server_id = ? ORDER BY name')
    .all(serverId) as Array<Record<string, string | number>>;
  return rows.map(mapDatabase);
}

export function findDatabase(db: DatabaseSync, serverId: string, id: string): DatabaseRecord | null {
  const row = db
    .prepare('SELECT id, name, kind, target, host, port, username, db_name, password FROM databases WHERE server_id = ? AND id = ?')
    .get(serverId, id) as Record<string, string | number> | undefined;
  if (!row) return null;
  return { ...mapDatabase(row), password: String(row['password'] ?? '') };
}

export function databaseNameTaken(db: DatabaseSync, serverId: string, name: string): boolean {
  const row = db.prepare('SELECT id FROM databases WHERE server_id = ? AND name = ?').get(serverId, name);
  return Boolean(row);
}

export function insertDatabase(
  db: DatabaseSync,
  row: StoredDatabase & { serverId: string; password: string },
): void {
  db.prepare(
    `INSERT INTO databases (id, server_id, name, kind, target, username, password, host, port, db_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.serverId, row.name, row.kind, row.target, row.username, row.password, row.host, row.port, row.dbName);
}

export function updateDatabasePassword(db: DatabaseSync, serverId: string, id: string, password: string): void {
  db.prepare('UPDATE databases SET password = ? WHERE server_id = ? AND id = ?').run(password, serverId, id);
}

export function deleteDatabaseRow(db: DatabaseSync, serverId: string, id: string): void {
  db.prepare('DELETE FROM databases WHERE server_id = ? AND id = ?').run(serverId, id);
}

function mapDatabase(row: Record<string, string | number>): StoredDatabase {
  return {
    id: String(row['id']),
    name: String(row['name']),
    kind: String(row['kind']),
    target: String(row['target']),
    host: String(row['host'] ?? ''),
    port: Number(row['port'] ?? 0),
    username: String(row['username'] ?? ''),
    dbName: String(row['db_name'] ?? ''),
  };
}

export function readInstall(db: DatabaseSync, serverId: string): { provider: string; version: string; javaMajor: number } | null {
  const row = db
    .prepare('SELECT provider, mc_version, java_major FROM mc_installs WHERE server_id = ?')
    .get(serverId) as { provider: string; mc_version: string; java_major: number } | undefined;
  if (!row) return null;
  return { provider: row.provider, version: row.mc_version, javaMajor: row.java_major };
}

export function updateInstall(db: DatabaseSync, serverId: string, provider: string, version: string, javaMajor: number): void {
  db.prepare('UPDATE mc_installs SET provider = ?, mc_version = ?, java_major = ? WHERE server_id = ?').run(provider, version, javaMajor, serverId);
}

export function updateServerCommand(db: DatabaseSync, id: string, command: string[], updatedAt: string): void {
  db.prepare('UPDATE servers SET command_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(command), updatedAt, id);
}

export function updateServerStop(db: DatabaseSync, id: string, stop: ServerStop, updatedAt: string): void {
  db.prepare('UPDATE servers SET stop_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(stop), updatedAt, id);
}

export function updateServerFlags(db: DatabaseSync, id: string, autoStart: boolean, autoRestart: boolean, updatedAt: string): void {
  db.prepare('UPDATE servers SET auto_start = ?, auto_restart = ?, updated_at = ? WHERE id = ?').run(autoStart ? 1 : 0, autoRestart ? 1 : 0, updatedAt, id);
}

export function insertInstall(
  db: DatabaseSync,
  row: { serverId: string; provider: string; version: string; javaMajor: number },
): void {
  db.prepare('INSERT INTO mc_installs (server_id, provider, mc_version, java_major) VALUES (?, ?, ?, ?)').run(
    row.serverId,
    row.provider,
    row.version,
    row.javaMajor,
  );
}

export function insertSchedule(
  db: DatabaseSync,
  row: { id: string; serverId: string; name: string; cron: string; task: string },
): void {
  db.prepare('INSERT INTO schedules (id, server_id, name, cron, task, enabled, payload) VALUES (?, ?, ?, ?, ?, 1, ?)').run(
    row.id,
    row.serverId,
    row.name,
    row.cron,
    row.task,
    '',
  );
}

export function listSchedules(db: DatabaseSync, serverId: string): Array<{ id: string; serverId: string; name: string; cron: string; task: string; enabled: boolean; payload: string }> {
  const rows = db
    .prepare('SELECT id, server_id, name, cron, task, enabled, payload FROM schedules WHERE server_id = ? ORDER BY name')
    .all(serverId) as Array<{ id: string; server_id: string; name: string; cron: string; task: string; enabled: number; payload: string }>;
  return rows.map((row) => ({
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    cron: row.cron,
    task: row.task,
    enabled: row.enabled === 1,
    payload: row.payload ?? '',
  }));
}

export function listEnabledSchedules(db: DatabaseSync): Array<{ id: string; serverId: string; name: string; cron: string; task: string; payload: string }> {
  const rows = db
    .prepare('SELECT id, server_id, name, cron, task, payload FROM schedules WHERE enabled = 1')
    .all() as Array<{ id: string; server_id: string; name: string; cron: string; task: string; payload: string }>;
  return rows.map((row) => ({
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    cron: row.cron,
    task: row.task,
    payload: row.payload ?? '',
  }));
}

export function deleteSchedule(db: DatabaseSync, serverId: string, id: string): void {
  db.prepare('DELETE FROM schedules WHERE server_id = ? AND id = ?').run(serverId, id);
}

export function listDueBackups(db: DatabaseSync): { serverId: string }[] {
  const rows = db.prepare(`SELECT server_id FROM schedules WHERE enabled = 1 AND task = 'backup'`).all() as unknown as {
    server_id: string;
  }[];
  return rows.map((row) => ({ serverId: row.server_id }));
}

export function deleteServerExtras(db: DatabaseSync, id: string): void {
  db.prepare('DELETE FROM mc_installs WHERE server_id = ?').run(id);
  db.prepare('DELETE FROM schedules WHERE server_id = ?').run(id);
}

export function listServerRows(db: DatabaseSync): ServerDefinition[] {
  const rows = db.prepare('SELECT * FROM servers ORDER BY name COLLATE NOCASE').all() as unknown as ServerRow[];
  return rows.map(mapServer);
}

export function writeActivity(
  db: DatabaseSync,
  entry: Omit<ActivityEntry, 'id' | 'properties'> & { properties: Record<string, unknown> },
): void {
  db.prepare(
    `INSERT INTO activity_log (at, actor, event, target, ip, properties_json) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(entry.at, entry.actor, entry.event, entry.target, entry.ip, JSON.stringify(entry.properties));
}

export function listActivity(db: DatabaseSync, limit: number): ActivityEntry[] {
  const rows = db
    .prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as Array<{
    id: number;
    at: string;
    actor: string;
    event: string;
    target: string | null;
    ip: string | null;
    properties_json: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    at: row.at,
    actor: row.actor,
    event: row.event,
    target: row.target,
    ip: row.ip,
    properties: JSON.parse(row.properties_json) as Record<string, unknown>,
  }));
}

function mapServer(row: ServerRow): ServerDefinition {
  return {
    id: row.id,
    name: row.name,
    templateId: row.template_id,
    templateVersion: row.template_version,
    command: JSON.parse(row.command_json) as string[],
    cwd: row.cwd,
    env: JSON.parse(row.env_json) as Record<string, string>,
    stop: JSON.parse(row.stop_json) as ServerStop,
    allocation: row.allocation_json ? (JSON.parse(row.allocation_json) as ServerDefinition['allocation']) : null,
    limits: JSON.parse(row.limits_json) as ServerLimits,
    autoStart: row.auto_start === 1,
    autoRestart: row.auto_restart === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
