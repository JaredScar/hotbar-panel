import fs from 'node:fs';
import path from 'node:path';

export interface AgentSettings {
  discordWebhook: string;
  setupCompleted: boolean;
}

export function readSettings(dataDir: string): AgentSettings {
  const file = path.join(dataDir, 'settings.json');
  if (!fs.existsSync(file)) return { discordWebhook: '', setupCompleted: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AgentSettings>;
    return {
      discordWebhook: typeof parsed.discordWebhook === 'string' ? parsed.discordWebhook : '',
      setupCompleted: parsed.setupCompleted === true,
    };
  } catch {
    return { discordWebhook: '', setupCompleted: false };
  }
}

export function writeSettings(dataDir: string, patch: Partial<AgentSettings>): AgentSettings {
  const next = { ...readSettings(dataDir), ...patch };
  if (next.discordWebhook && !next.discordWebhook.startsWith('https://discord.com/api/webhooks/')) {
    throw new Error('Discord webhook must start with https://discord.com/api/webhooks/');
  }
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'settings.json'), JSON.stringify(next, null, 2));
  return next;
}

export async function notifyWebhook(dataDir: string, text: string): Promise<void> {
  const url = readSettings(dataDir).discordWebhook;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: text.slice(0, 1800) }),
    });
  } catch {
    // A missed alert must not stop the agent.
  }
}
