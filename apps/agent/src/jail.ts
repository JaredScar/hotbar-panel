import fs from 'node:fs';
import path from 'node:path';

export class PathJailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathJailError';
  }
}

/**
 * Resolve `requested` against `root` and return a path that stays inside the root
 * after symlink resolution. Missing leaf names are allowed; their nearest existing
 * ancestor is what gets resolved.
 */
export function resolveInJail(root: string, requested: string): string {
  if (requested.includes('\0') || root.includes('\0')) {
    throw new PathJailError('path contains NUL');
  }
  const rootReal = fs.realpathSync(root);
  const joined = path.resolve(rootReal, requested);
  const resolved = resolveExistingPrefix(joined);
  if (!isInside(rootReal, resolved)) {
    throw new PathJailError('path escapes server root');
  }
  return resolved;
}

function resolveExistingPrefix(target: string): string {
  const missing: string[] = [];
  let current = target;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missing.push(path.basename(current));
    current = parent;
  }
  let real = fs.realpathSync(current);
  for (const part of missing.reverse()) {
    real = path.join(real, part);
  }
  return real;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === '') return true;
  if (relative.startsWith('..')) return false;
  if (path.isAbsolute(relative)) return false;
  return true;
}
