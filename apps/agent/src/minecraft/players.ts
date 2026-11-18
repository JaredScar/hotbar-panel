import fs from 'node:fs';
import {
  isPlayerName,
  parseOnlineList,
  type McPlayer,
  type McPlayerAction,
  type McPlayers,
  type ServerView,
} from '@hotbar/shared';
import { HttpError } from '../errors.js';
import { resolveInJail } from '../jail.js';
import type { ServerManager } from '../manager.js';
import { parseProperties, updateProperties } from './properties.js';

const ACTIONS = new Set<McPlayerAction>([
  'kick',
  'ban',
  'pardon',
  'op',
  'deop',
  'whitelist-add',
  'whitelist-remove',
  'whitelist-on',
  'whitelist-off',
]);

export function playerCommand(action: string, name: string, reason: string): string {
  if (!ACTIONS.has(action as McPlayerAction)) throw new HttpError(400, 'action is not valid');
  const needsName = action !== 'whitelist-on' && action !== 'whitelist-off';
  if (needsName && !isPlayerName(name)) throw new HttpError(400, 'player name is not valid');
  if (/[\r\n\0]/.test(reason)) throw new HttpError(400, 'reason cannot include a new line');
  const cleanReason = reason.trim().slice(0, 80);
  if (action === 'kick') return cleanReason ? `kick ${name} ${cleanReason}` : `kick ${name}`;
  if (action === 'ban') return cleanReason ? `ban ${name} ${cleanReason}` : `ban ${name}`;
  if (action === 'pardon') return `pardon ${name}`;
  if (action === 'op') return `op ${name}`;
  if (action === 'deop') return `deop ${name}`;
  if (action === 'whitelist-add') return `whitelist add ${name}`;
  if (action === 'whitelist-remove') return `whitelist remove ${name}`;
  if (action === 'whitelist-on') return 'whitelist on';
  return 'whitelist off';
}

export async function collectPlayers(manager: ServerManager, id: string): Promise<McPlayers> {
  const server = findServer(manager, id);
  if (!isMinecraft(server)) return empty(false, false);
  const saved = readSavedPlayers(server.cwd);
  const live = server.state === 'running' ? await askWhoIsOnline(manager, id) : null;
  return mergePlayers(saved, live, server.state === 'running');
}

export async function actOnPlayer(manager: ServerManager, id: string, action: string, name: string, reason: string): Promise<McPlayers> {
  const server = findServer(manager, id);
  if (!isMinecraft(server)) throw new HttpError(400, 'Player actions are for a Minecraft server.');
  const command = playerCommand(action, name, reason);
  if (server.state !== 'running') {
    if (action === 'whitelist-on' || action === 'whitelist-off') {
      writeWhitelist(server.cwd, action === 'whitelist-on');
      return collectPlayers(manager, id);
    }
    throw new HttpError(409, 'Start the server before changing players.');
  }
  manager.send(id, command);
  return collectPlayers(manager, id);
}

export function readSavedPlayers(root: string): {
  whitelist: boolean | null;
  max: number | null;
  ops: string[];
  whitelisted: string[];
  banned: Array<{ name: string; reason: string | null }>;
  known: string[];
} {
  const properties = readProperties(root);
  const maxPlayers = Number(properties['max-players']);
  return {
    whitelist: properties['white-list'] === undefined ? null : properties['white-list'] === 'true',
    max: Number.isInteger(maxPlayers) && maxPlayers > 0 ? maxPlayers : null,
    ops: namesIn(root, 'ops.json'),
    whitelisted: namesIn(root, 'whitelist.json'),
    banned: banRows(root),
    known: namesIn(root, 'usercache.json'),
  };
}

function mergePlayers(
  saved: ReturnType<typeof readSavedPlayers>,
  live: { online: number; max: number; names: string[] } | null,
  running: boolean,
): McPlayers {
  const byName = new Map<string, McPlayer>();
  const ensure = (name: string): McPlayer => {
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (existing) return existing;
    const created: McPlayer = { name, online: false, op: false, whitelisted: false, banned: false, banReason: null };
    byName.set(key, created);
    return created;
  };
  for (const name of [...saved.known, ...saved.ops, ...saved.whitelisted, ...saved.banned.map((row) => row.name)]) ensure(name);
  for (const name of saved.ops) ensure(name).op = true;
  for (const name of saved.whitelisted) ensure(name).whitelisted = true;
  for (const row of saved.banned) {
    const player = ensure(row.name);
    player.banned = true;
    player.banReason = row.reason;
  }
  if (live) {
    const online = new Set(live.names.map((name) => name.toLowerCase()));
    for (const player of byName.values()) player.online = online.has(player.name.toLowerCase());
    for (const name of live.names) {
      const player = ensure(name);
      player.name = name;
      player.online = true;
    }
  }
  const players = [...byName.values()].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  return {
    minecraft: true,
    running,
    online: live?.online ?? players.filter((player) => player.online).length,
    max: live?.max ?? saved.max,
    whitelist: saved.whitelist,
    players,
  };
}

async function askWhoIsOnline(manager: ServerManager, id: string): Promise<{ online: number; max: number; names: string[] } | null> {
  const pending = manager.expect(id, parseOnlineList, 4000);
  try {
    manager.send(id, 'list');
  } catch (error) {
    pending.cancel();
    throw error;
  }
  return pending.promise;
}

function writeWhitelist(root: string, enabled: boolean): void {
  let file: string;
  try {
    file = resolveInJail(root, 'server.properties');
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'path is not valid');
  }
  if (!fs.existsSync(file)) throw new HttpError(404, 'server.properties was not found');
  const next = updateProperties(fs.readFileSync(file, 'utf8'), { 'white-list': String(enabled) });
  fs.writeFileSync(file, next);
}

function readProperties(root: string): Record<string, string> {
  try {
    const file = resolveInJail(root, 'server.properties');
    if (!fs.existsSync(file)) return {};
    return parseProperties(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function namesIn(root: string, relative: string): string[] {
  const names: string[] = [];
  for (const row of readArray(root, relative)) {
    const name = nameOf(row);
    if (name) names.push(name);
  }
  return names;
}

function banRows(root: string): Array<{ name: string; reason: string | null }> {
  const rows: Array<{ name: string; reason: string | null }> = [];
  for (const row of readArray(root, 'banned-players.json')) {
    const name = nameOf(row);
    if (!name) continue;
    const reason = row && typeof row === 'object' && 'reason' in row && typeof row.reason === 'string' ? row.reason.slice(0, 120) : null;
    rows.push({ name, reason });
  }
  return rows;
}

function readArray(root: string, relative: string): unknown[] {
  try {
    const file = resolveInJail(root, relative);
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function nameOf(row: unknown): string | null {
  if (!row || typeof row !== 'object' || !('name' in row)) return null;
  const name = row.name;
  return typeof name === 'string' && isPlayerName(name) ? name : null;
}

function isMinecraft(server: ServerView): boolean {
  if (server.templateId?.startsWith('minecraft-')) return true;
  try {
    return fs.existsSync(resolveInJail(server.cwd, 'server.properties'));
  } catch {
    return false;
  }
}

function findServer(manager: ServerManager, id: string): ServerView {
  const server = manager.list().find((item) => item.id === id);
  if (!server) throw new HttpError(404, 'server not found');
  return server;
}

function empty(minecraft: boolean, running: boolean): McPlayers {
  return { minecraft, running, online: 0, max: null, whitelist: null, players: [] };
}
