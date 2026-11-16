const KEY = /^[A-Za-z0-9._-]+$/;

export function parseProperties(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    if (!key) continue;
    values[key] = line.slice(index + 1);
  }
  return values;
}

export function updateProperties(text: string, updates: Record<string, string>): string {
  for (const [key, value] of Object.entries(updates)) {
    if (!KEY.test(key)) throw new Error(`invalid property name: ${key}`);
    if (/[\r\n\0]/.test(value)) throw new Error(`invalid value for ${key}`);
  }
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/).map((line) => {
    if (/^\s*#/.test(line) || !line.includes('=')) return line;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    if (!(key in updates)) return line;
    seen.add(key);
    return `${key}=${updates[key]}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  const body = lines.join('\n');
  return body.endsWith('\n') ? body : `${body}\n`;
}

export function initialProperties(input: {
  port: number;
  gamemode: string;
  difficulty: string;
  maxPlayers: number;
  motd: string;
  whitelist: boolean;
  onlineMode: boolean;
  seed: string;
}): string {
  return updateProperties(
    '#Minecraft server properties\n#Hotbar keeps lines it does not edit.\n',
    {
      'server-port': String(input.port),
      'server-ip': '',
      gamemode: input.gamemode,
      difficulty: input.difficulty,
      'max-players': String(input.maxPlayers),
      motd: input.motd,
      'white-list': String(input.whitelist),
      'enforce-whitelist': String(input.whitelist),
      'online-mode': String(input.onlineMode),
      'level-seed': input.seed,
      'spawn-protection': '16',
    },
  );
}

export const EULA_TEXT =
  '#By changing the setting below to TRUE you are indicating your agreement to the Minecraft EULA (https://aka.ms/MinecraftEULA).\neula=true\n';
