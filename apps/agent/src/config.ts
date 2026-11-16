import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HOTBAR_VERSION, type Permission } from '@hotbar/shared';
import { defaultDataDir } from '@hotbar/shared/node';

export interface AgentConfig {
  host: '127.0.0.1';
  port: number;
  token: string;
  permissions: '*' | readonly Permission[];
  dataDir: string;
  serversRoot: string;
  dev: boolean;
  version: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const dev = env.HOTBAR_DEV === '1';
  const host = env.HOTBAR_HOST ?? '127.0.0.1';
  if (host !== '127.0.0.1') {
    throw new Error('The Hotbar agent only binds to 127.0.0.1');
  }
  const dataDir = path.resolve(env.HOTBAR_DATA_DIR ?? defaultDataDir());
  fs.mkdirSync(dataDir, { recursive: true });
  const serversRoot = path.resolve(env.HOTBAR_SERVERS_ROOT ?? path.join(dataDir, 'servers'));
  fs.mkdirSync(serversRoot, { recursive: true });
  const port = Number(env.HOTBAR_PORT ?? 7878);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('HOTBAR_PORT must be an integer from 0 to 65535');
  }
  return {
    host: '127.0.0.1',
    port,
    token: resolveToken(dataDir, dev, env.HOTBAR_TOKEN),
    permissions: '*',
    dataDir,
    serversRoot,
    dev,
    version: HOTBAR_VERSION,
  };
}

function resolveToken(dataDir: string, dev: boolean, fromEnv: string | undefined): string {
  if (fromEnv) {
    if (!dev && fromEnv === 'dev-local-token') {
      throw new Error('Refusing the well-known dev token when HOTBAR_DEV is not set');
    }
    if (fromEnv.length < 8) throw new Error('HOTBAR_TOKEN is too short');
    return fromEnv;
  }
  const tokenPath = path.join(dataDir, 'agent.token');
  if (fs.existsSync(tokenPath)) {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim();
    if (existing.length < 16) throw new Error('agent.token is invalid');
    return existing;
  }
  const token = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(tokenPath, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
  restrictTokenFile(tokenPath);
  return token;
}

function restrictTokenFile(tokenPath: string): void {
  if (process.platform !== 'win32') return;
  const username = process.env.USERNAME;
  if (!username) return;
  const child = spawn('icacls', [tokenPath, '/inheritance:r', '/grant:r', `${username}:(R)`], {
    windowsHide: true,
    stdio: 'ignore',
  });
  child.on('error', () => {
    // The file mode is already owner-oriented. ACL tightening is best-effort.
  });
}
