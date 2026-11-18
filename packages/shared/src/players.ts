export interface McPlayer {
  name: string;
  online: boolean;
  op: boolean;
  whitelisted: boolean;
  banned: boolean;
  banReason: string | null;
}

export interface McPlayers {
  minecraft: boolean;
  running: boolean;
  online: number;
  max: number | null;
  whitelist: boolean | null;
  players: McPlayer[];
}

export type McPlayerAction =
  | 'kick'
  | 'ban'
  | 'pardon'
  | 'op'
  | 'deop'
  | 'whitelist-add'
  | 'whitelist-remove'
  | 'whitelist-on'
  | 'whitelist-off';

const PLAYER_NAME = /^(?:\.)?[A-Za-z0-9_]{1,16}$/;

export function isPlayerName(name: string): boolean {
  return PLAYER_NAME.test(name);
}

export function plainLog(line: string): string {
  return line.replace(/\u001b\[[0-9;]*m/g, '').replace(/\u00a7./g, '');
}

/** Minecraft's `list` reply. The log prefix and color codes are ignored. */
export function parseOnlineList(line: string): { online: number; max: number; names: string[] } | null {
  const plain = plainLog(line);
  const match =
    /There are (\d+) of a max(?:imum)? of (\d+) players online[:.]?\s*(.*?)\s*$/i.exec(plain) ??
    /There are (\d+)\/(\d+) players online[:.]?\s*(.*?)\s*$/i.exec(plain) ??
    /There are (\d+) out of maximum (\d+) players online[:.]?\s*(.*?)\s*$/i.exec(plain);
  if (!match) return null;
  const names = (match[3] ?? '')
    .split(',')
    .map((part) => part.trim().replace(/\s*\([^)]*\)\s*$/, ''))
    .filter((name) => PLAYER_NAME.test(name));
  return { online: Number(match[1]), max: Number(match[2]), names };
}

/** A join or leave line from the server log. */
export function parsePresence(line: string): { name: string; online: boolean } | null {
  const plain = plainLog(line);
  const joined = /((?:\.)?[A-Za-z0-9_]{1,16}) joined the game\b/.exec(plain);
  if (joined?.[1] && PLAYER_NAME.test(joined[1])) return { name: joined[1], online: true };
  const left = /((?:\.)?[A-Za-z0-9_]{1,16}) left the game\b/.exec(plain);
  if (left?.[1] && PLAYER_NAME.test(left[1])) return { name: left[1], online: false };
  return null;
}
