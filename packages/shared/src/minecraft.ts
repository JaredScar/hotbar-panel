export const MC_PROVIDERS = ['vanilla', 'paper', 'spigot', 'purpur', 'fabric', 'forge', 'neoforge', 'quilt'] as const;

export type McProviderId = (typeof MC_PROVIDERS)[number];

export const GAMES = ['minecraft', 'fivem', 'hytale'] as const;

export type GameId = (typeof GAMES)[number];

export interface McVersion {
  id: string;
  stable: boolean;
}

export type McGamemode = 'survival' | 'creative' | 'adventure' | 'spectator';
export type McDifficulty = 'peaceful' | 'easy' | 'normal' | 'hard';

export interface McCreateRequest {
  name: string;
  game: GameId;
  provider: McProviderId;
  version: string;
  memoryMb: number;
  eulaAccepted: boolean;
  gamemode: McGamemode;
  difficulty: McDifficulty;
  maxPlayers: number;
  motd: string;
  whitelist: boolean;
  onlineMode: boolean;
  seed: string;
  /** Cfx.re key. Required for FiveM and ignored for the other games. */
  licenseKey: string;
  /** Download ids the user agreed to. Hotbar does not download until this includes them. */
  acceptDownloads?: string[];
}

export interface ServerProperties {
  values: Record<string, string>;
}

export interface Reachability {
  local: boolean;
  addresses: string[];
}
