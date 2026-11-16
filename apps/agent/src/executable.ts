import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './errors.js';

const SHELL_EXTENSIONS = new Set(['.bat', '.cmd', '.sh', '.bash']);

export function resolveExecutable(command: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!command || command.includes('\0')) {
    throw new HttpError(400, 'executable is empty or invalid');
  }
  if (process.platform === 'win32' && command === 'tar') {
    const systemTar = path.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    if (fs.existsSync(systemTar)) return systemTar;
  }
  const direct = path.isAbsolute(command) || command.includes('/') || command.includes('\\');
  const resolved = direct ? path.resolve(command) : findOnPath(command, env);
  if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new HttpError(400, `executable not found: ${command}`);
  }
  const extension = path.extname(resolved).toLowerCase();
  if (SHELL_EXTENSIONS.has(extension)) {
    throw new HttpError(400, 'startup command must be an executable, not a shell script');
  }
  return resolved;
}

function findOnPath(command: string, env: NodeJS.ProcessEnv): string | null {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const names = [command];
  if (process.platform === 'win32' && path.extname(command) === '') {
    const exts = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
    for (const ext of exts) names.push(command + ext);
  }
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        const extension = path.extname(candidate).toLowerCase();
        if (SHELL_EXTENSIONS.has(extension)) continue;
        return candidate;
      }
    }
  }
  return null;
}

export function buildChildEnv(base: NodeJS.ProcessEnv, extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ...extra };
  delete env.HOTBAR_TOKEN;
  delete env.HOTBAR_DEV;
  delete env.HOTBAR_DATA_DIR;
  delete env.HOTBAR_PORT;
  delete env.HOTBAR_HOST;
  return env;
}
