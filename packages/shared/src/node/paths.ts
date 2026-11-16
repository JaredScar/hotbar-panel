import os from 'node:os';
import path from 'node:path';

/** Per-user data directory for the agent token, SQLite file, and server installs. */
export function defaultDataDir(): string {
  if (process.platform === 'win32') {
    const base = process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'Hotbar');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Hotbar');
  }
  const base = process.env['XDG_DATA_HOME'] ?? path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'hotbar');
}
