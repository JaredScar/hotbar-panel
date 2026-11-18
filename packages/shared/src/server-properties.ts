export type PropertyKind = 'text' | 'number' | 'boolean' | 'select' | 'secret';

export interface PropertyChoice {
  value: string;
  label: string;
}

export interface PropertyField {
  key: string;
  label: string;
  help: string;
  kind: PropertyKind;
  group: string;
  options?: PropertyChoice[];
  min?: number;
  max?: number;
  maxLength?: number;
  defaultValue?: string;
}

export const PROPERTY_GROUPS = ['World', 'Gameplay', 'Players', 'Messages', 'Network', 'Remote access', 'Resource pack', 'Advanced'] as const;

const GAMEMODE: PropertyChoice[] = [
  { value: 'survival', label: 'Survival' },
  { value: 'creative', label: 'Creative' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'spectator', label: 'Spectator' },
];

const DIFFICULTY: PropertyChoice[] = [
  { value: 'peaceful', label: 'Peaceful' },
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' },
];

const COMPRESSION: PropertyChoice[] = [
  { value: 'deflate', label: 'Deflate' },
  { value: 'none', label: 'None' },
  { value: 'lz4', label: 'LZ4' },
];

export const PROPERTY_FIELDS: readonly PropertyField[] = [
  { key: 'level-name', label: 'World name', help: 'Folder name for the world.', kind: 'text', group: 'World', maxLength: 64, defaultValue: 'world' },
  { key: 'level-seed', label: 'Seed', help: 'Leave empty for a random world.', kind: 'text', group: 'World', maxLength: 128 },
  { key: 'level-type', label: 'World type', help: 'minecraft:normal, minecraft:flat, minecraft:large_biomes, or minecraft:amplified.', kind: 'text', group: 'World', maxLength: 128, defaultValue: 'minecraft:normal' },
  { key: 'generator-settings', label: 'Generator settings', help: 'Extra settings for a flat or custom world.', kind: 'text', group: 'World', maxLength: 1024 },
  { key: 'generate-structures', label: 'Generate structures', help: 'Villages, strongholds, and other structures.', kind: 'boolean', group: 'World', defaultValue: 'true' },
  { key: 'max-world-size', label: 'World size limit', help: 'Radius, in blocks, from the spawn.', kind: 'number', group: 'World', min: 1, max: 29999984, defaultValue: '29999984' },
  { key: 'view-distance', label: 'View distance', help: 'Chunks sent to each player.', kind: 'number', group: 'World', min: 2, max: 32, defaultValue: '10' },
  { key: 'simulation-distance', label: 'Simulation distance', help: 'Chunks where mobs and crops keep updating.', kind: 'number', group: 'World', min: 2, max: 32, defaultValue: '10' },
  { key: 'gamemode', label: 'Gamemode', help: 'How new players start.', kind: 'select', group: 'Gameplay', options: GAMEMODE, defaultValue: 'survival' },
  { key: 'force-gamemode', label: 'Force gamemode', help: 'Return every player to the default gamemode on join.', kind: 'boolean', group: 'Gameplay', defaultValue: 'false' },
  { key: 'difficulty', label: 'Difficulty', help: 'How hard the world is.', kind: 'select', group: 'Gameplay', options: DIFFICULTY, defaultValue: 'easy' },
  { key: 'hardcore', label: 'Hardcore', help: 'A player who dies is banned.', kind: 'boolean', group: 'Gameplay', defaultValue: 'false' },
  { key: 'pvp', label: 'Player versus player', help: 'Players can hurt each other.', kind: 'boolean', group: 'Gameplay', defaultValue: 'true' },
  { key: 'allow-flight', label: 'Allow flight', help: 'Mods and flight plugins are not kicked.', kind: 'boolean', group: 'Gameplay', defaultValue: 'false' },
  { key: 'allow-nether', label: 'Allow the Nether', help: 'Players can enter the Nether.', kind: 'boolean', group: 'Gameplay', defaultValue: 'true' },
  { key: 'spawn-monsters', label: 'Spawn monsters', help: 'Hostile mobs appear.', kind: 'boolean', group: 'Gameplay', defaultValue: 'true' },
  { key: 'spawn-animals', label: 'Spawn animals', help: 'Passive mobs appear.', kind: 'boolean', group: 'Gameplay', defaultValue: 'true' },
  { key: 'spawn-npcs', label: 'Spawn villagers', help: 'Villagers appear.', kind: 'boolean', group: 'Gameplay', defaultValue: 'true' },
  { key: 'spawn-protection', label: 'Spawn protection', help: 'Radius, in blocks, that only operators can change.', kind: 'number', group: 'Gameplay', min: 0, max: 29999984, defaultValue: '16' },
  { key: 'enable-command-block', label: 'Command blocks', help: 'Command blocks can run.', kind: 'boolean', group: 'Gameplay', defaultValue: 'false' },
  { key: 'max-players', label: 'Max players', help: 'How many people can be online at once.', kind: 'number', group: 'Players', min: 1, max: 9999, defaultValue: '20' },
  { key: 'player-idle-timeout', label: 'Idle kick', help: 'Minutes before an idle player is kicked. 0 never kicks.', kind: 'number', group: 'Players', min: 0, max: 10080, defaultValue: '0' },
  { key: 'white-list', label: 'Whitelist', help: 'Only listed players can join.', kind: 'boolean', group: 'Players', defaultValue: 'false' },
  { key: 'enforce-whitelist', label: 'Enforce whitelist', help: 'Kick players who are removed from the whitelist.', kind: 'boolean', group: 'Players', defaultValue: 'false' },
  { key: 'online-mode', label: 'Online mode', help: 'Check accounts with Minecraft. Turn off only for a private offline server.', kind: 'boolean', group: 'Players', defaultValue: 'true' },
  { key: 'prevent-proxy-connections', label: 'Block proxy joins', help: 'Refuse connections that look like they came through a proxy.', kind: 'boolean', group: 'Players', defaultValue: 'false' },
  { key: 'enforce-secure-profile', label: 'Secure chat', help: 'Require signed chat from the official client.', kind: 'boolean', group: 'Players', defaultValue: 'true' },
  { key: 'hide-online-players', label: 'Hide who is online', help: 'The server list does not show player names.', kind: 'boolean', group: 'Players', defaultValue: 'false' },
  { key: 'op-permission-level', label: 'Operator level', help: 'What a new operator is allowed to do. 4 is full access.', kind: 'number', group: 'Players', min: 0, max: 4, defaultValue: '4' },
  { key: 'function-permission-level', label: 'Function level', help: 'Permission level used by functions.', kind: 'number', group: 'Players', min: 1, max: 4, defaultValue: '2' },
  { key: 'pause-when-empty-seconds', label: 'Pause when empty', help: 'Seconds to wait before pausing an empty server. 0 never pauses.', kind: 'number', group: 'Players', min: 0, max: 86400, defaultValue: '60' },
  { key: 'motd', label: 'Message of the day', help: 'Shown in the server list. Use \\n for a second line.', kind: 'text', group: 'Messages', maxLength: 256 },
  { key: 'enable-status', label: 'Reply to server list', help: 'The server answers status pings.', kind: 'boolean', group: 'Messages', defaultValue: 'true' },
  { key: 'broadcast-console-to-ops', label: 'Send console to operators', help: 'Operators see console messages in chat.', kind: 'boolean', group: 'Messages', defaultValue: 'true' },
  { key: 'server-port', label: 'Port', help: 'Stop the server before changing this.', kind: 'number', group: 'Network', min: 1, max: 65535, defaultValue: '25565' },
  { key: 'server-ip', label: 'Listen address', help: 'Leave empty to listen on every address on this computer.', kind: 'text', group: 'Network', maxLength: 64 },
  { key: 'network-compression-threshold', label: 'Compression', help: 'Packet size before compression. -1 turns it off.', kind: 'number', group: 'Network', min: -1, max: 65535, defaultValue: '256' },
  { key: 'rate-limit', label: 'Rate limit', help: 'Packets a player can send before being kicked. 0 turns it off.', kind: 'number', group: 'Network', min: 0, max: 10000, defaultValue: '0' },
  { key: 'use-native-transport', label: 'Native networking', help: 'Use the faster networking built into the server.', kind: 'boolean', group: 'Network', defaultValue: 'true' },
  { key: 'log-ips', label: 'Log player addresses', help: 'Write join addresses into the server log.', kind: 'boolean', group: 'Network', defaultValue: 'true' },
  { key: 'enable-query', label: 'Game query', help: 'Answer GameSpy query requests.', kind: 'boolean', group: 'Network', defaultValue: 'false' },
  { key: 'query.port', label: 'Query port', help: 'Port for GameSpy query.', kind: 'number', group: 'Network', min: 1, max: 65535, defaultValue: '25565' },
  { key: 'enable-rcon', label: 'Remote console', help: 'Allow RCON connections.', kind: 'boolean', group: 'Remote access', defaultValue: 'false' },
  { key: 'rcon.port', label: 'RCON port', help: 'Port for the remote console.', kind: 'number', group: 'Remote access', min: 1, max: 65535, defaultValue: '25575' },
  { key: 'rcon.password', label: 'RCON password', help: 'Password for the remote console.', kind: 'secret', group: 'Remote access', maxLength: 128 },
  { key: 'broadcast-rcon-to-ops', label: 'Send RCON to operators', help: 'Operators see remote console commands.', kind: 'boolean', group: 'Remote access', defaultValue: 'true' },
  { key: 'management-server-enabled', label: 'Management server', help: 'Minecraft’s local management server.', kind: 'boolean', group: 'Remote access', defaultValue: 'false' },
  { key: 'management-server-host', label: 'Management address', help: 'Address the management server binds.', kind: 'text', group: 'Remote access', maxLength: 64 },
  { key: 'management-server-port', label: 'Management port', help: 'Port for the management server.', kind: 'number', group: 'Remote access', min: 0, max: 65535, defaultValue: '0' },
  { key: 'management-server-secret', label: 'Management secret', help: 'Secret for the management server.', kind: 'secret', group: 'Remote access', maxLength: 256 },
  { key: 'status-heartbeat-interval', label: 'Status heartbeat', help: 'Seconds between management status updates.', kind: 'number', group: 'Remote access', min: 0, max: 120, defaultValue: '0' },
  { key: 'resource-pack', label: 'Resource pack URL', help: 'Pack the client is asked to download.', kind: 'text', group: 'Resource pack', maxLength: 512 },
  { key: 'resource-pack-sha1', label: 'Resource pack SHA-1', help: 'Checksum for that pack.', kind: 'text', group: 'Resource pack', maxLength: 64 },
  { key: 'resource-pack-prompt', label: 'Resource pack prompt', help: 'Message shown before the download.', kind: 'text', group: 'Resource pack', maxLength: 256 },
  { key: 'resource-pack-id', label: 'Resource pack id', help: 'UUID of the pack.', kind: 'text', group: 'Resource pack', maxLength: 64 },
  { key: 'require-resource-pack', label: 'Require the pack', help: 'Players who refuse the pack are disconnected.', kind: 'boolean', group: 'Resource pack', defaultValue: 'false' },
  { key: 'initial-enabled-packs', label: 'Enabled packs', help: 'Packs turned on for a new world.', kind: 'text', group: 'Resource pack', maxLength: 512 },
  { key: 'initial-disabled-packs', label: 'Disabled packs', help: 'Packs turned off for a new world.', kind: 'text', group: 'Resource pack', maxLength: 512 },
  { key: 'enable-jmx-monitoring', label: 'JMX monitoring', help: 'Expose Java management metrics.', kind: 'boolean', group: 'Advanced', defaultValue: 'false' },
  { key: 'entity-broadcast-range-percentage', label: 'Entity range', help: 'Percent of the normal distance where entities are sent.', kind: 'number', group: 'Advanced', min: 10, max: 1000, defaultValue: '100' },
  { key: 'max-chained-neighbor-updates', label: 'Neighbor updates', help: 'How far a block update can chain. -1 is unlimited.', kind: 'number', group: 'Advanced', min: -1, max: 1000000, defaultValue: '1000000' },
  { key: 'max-tick-time', label: 'Watchdog', help: 'Milliseconds a tick may take before the watchdog acts. -1 turns it off.', kind: 'number', group: 'Advanced', min: -1, max: 600000, defaultValue: '60000' },
  { key: 'sync-chunk-writes', label: 'Sync chunk writes', help: 'Wait for chunk files to finish writing.', kind: 'boolean', group: 'Advanced', defaultValue: 'true' },
  { key: 'region-file-compression', label: 'Region compression', help: 'How chunk files are compressed.', kind: 'select', group: 'Advanced', options: COMPRESSION, defaultValue: 'deflate' },
  { key: 'text-filtering-config', label: 'Text filter', help: 'Config for the chat filter, usually empty.', kind: 'text', group: 'Advanced', maxLength: 256 },
  { key: 'bug-report-link', label: 'Bug report link', help: 'Link shown when the server reports an error.', kind: 'text', group: 'Advanced', maxLength: 256 },
];

const FIELD_BY_KEY = new Map(PROPERTY_FIELDS.map((field) => [field.key, field]));
const KEY = /^[A-Za-z0-9._-]{1,80}$/;

export function propertyField(key: string): PropertyField | undefined {
  return FIELD_BY_KEY.get(key);
}

/** Returns an error message, or null when the value can be written. */
export function checkPropertyValue(key: string, value: string): string | null {
  if (!KEY.test(key)) return 'A setting name is not valid';
  if (key === 'motd' && (/[\r\n\0]/.test(value) || value.length > 256)) {
    return 'Message of the day must be 256 characters or less, on one line. Use \\\\n for a second line.';
  }
  if (/[\r\n\0]/.test(value)) return `${labelOf(key)} must stay on one line`;
  const field = FIELD_BY_KEY.get(key);
  if (!field) return value.length > 1024 ? `${key} is too long` : null;
  if (field.maxLength !== undefined && value.length > field.maxLength) return `${field.label} is too long`;
  if (field.kind === 'boolean' && value !== 'true' && value !== 'false') return `${field.label} must be on or off`;
  if (field.kind === 'select' && field.options && value !== '' && !field.options.some((option) => option.value === value)) {
    return `${field.label} is not one of the choices`;
  }
  if (field.kind === 'number') {
    if (!/^-?\d+$/.test(value)) return `${field.label} must be a whole number`;
    const number = Number(value);
    if (field.min !== undefined && number < field.min) return `${field.label} is too small`;
    if (field.max !== undefined && number > field.max) return `${field.label} is too big`;
  }
  return null;
}

function labelOf(key: string): string {
  return FIELD_BY_KEY.get(key)?.label ?? key;
}
