import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  databaseNameTaken,
  deleteDatabaseRow,
  findDatabase,
  insertDatabase,
  listDatabases,
  updateDatabasePassword,
  type StoredDatabase,
} from './db.js';
import { HttpError } from './errors.js';
import { databaseDownloadPlan, installDockerDesktop } from './downloads.js';
import {
  createDatabaseSql,
  dropDatabaseSql,
  ensureMariaDb,
  execMariaSql,
  newDatabasePassword,
  rotatePasswordSql,
  serverDatabaseName,
} from './mariadb.js';

export type DatabaseCreateResult =
  | {
      status: 'created';
      id: string;
      name: string;
      kind: string;
      target: string;
      host: string;
      port: number;
      username: string;
      dbName: string;
      password: string;
    }
  | { status: 'installer'; message: string };

export function databasesFor(db: DatabaseSync, serverId: string): StoredDatabase[] {
  return listDatabases(db, serverId);
}

export async function createNamedDatabase(
  db: DatabaseSync,
  dataDir: string,
  serverId: string,
  name: string,
  accepted: ReadonlySet<string>,
): Promise<DatabaseCreateResult> {
  if (databaseNameTaken(db, serverId, name)) throw new HttpError(409, 'this server already has a database with that name');
  const plan = await databaseDownloadPlan();
  if (plan.blocked) throw new HttpError(400, plan.blocked);
  const pending = plan.downloads.filter((item) => !accepted.has(item.id));
  if (pending.length > 0) throw new HttpError(409, 'Confirm the download before Hotbar starts it.', pending);
  if (plan.downloads.some((item) => item.id === 'docker')) {
    await installDockerDesktop(dataDir);
    return {
      status: 'installer',
      message: 'Docker Desktop is installing for this user. Start Docker when it finishes, then create the database again.',
    };
  }
  const dbName = serverDatabaseName(serverId, name);
  const password = newDatabasePassword();
  const endpoint = await ensureMariaDb(dataDir);
  await execMariaSql(dataDir, createDatabaseSql(dbName, password));
  const row: StoredDatabase & { serverId: string; password: string } = {
    id: crypto.randomUUID(),
    serverId,
    name,
    kind: 'mariadb',
    host: endpoint.host,
    port: endpoint.port,
    username: dbName,
    dbName,
    password,
    target: `${endpoint.host}:${endpoint.port}/${dbName}`,
  };
  insertDatabase(db, row);
  return { status: 'created', ...row };
}

export function revealDatabasePassword(db: DatabaseSync, serverId: string, id: string): { password: string } {
  const row = owned(db, serverId, id);
  if (row.kind !== 'mariadb' || !row.password) throw new HttpError(404, 'this database has no password');
  return { password: row.password };
}

export async function rotateNamedDatabase(db: DatabaseSync, dataDir: string, serverId: string, id: string): Promise<{ password: string }> {
  const row = owned(db, serverId, id);
  if (row.kind !== 'mariadb' || !row.dbName) throw new HttpError(400, 'only a MariaDB database can get a new password');
  await ensureMariaDb(dataDir);
  const password = newDatabasePassword();
  await execMariaSql(dataDir, rotatePasswordSql(row.dbName, password));
  updateDatabasePassword(db, serverId, id, password);
  return { password };
}

export async function deleteNamedDatabase(db: DatabaseSync, dataDir: string, serverId: string, id: string): Promise<void> {
  const row = owned(db, serverId, id);
  if (row.kind === 'mariadb' && row.dbName) {
    await ensureMariaDb(dataDir);
    await execMariaSql(dataDir, dropDatabaseSql(row.dbName));
  }
  deleteDatabaseRow(db, serverId, id);
}

function owned(db: DatabaseSync, serverId: string, id: string) {
  const row = findDatabase(db, serverId, id);
  if (!row) throw new HttpError(404, 'database not found');
  return row;
}
