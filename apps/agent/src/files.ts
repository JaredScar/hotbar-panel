import fs from 'node:fs';
import path from 'node:path';
import type { FileContent, FileEntry } from '@hotbar/shared';
import { HttpError } from './errors.js';
import { PathJailError, resolveInJail } from './jail.js';

const TEXT_LIMIT = 256 * 1024;
const UPLOAD_LIMIT = 8 * 1024 * 1024;

export function listFiles(root: string, relative = ''): FileEntry[] {
  const dir = jail(root, relative);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new HttpError(404, 'folder not found');
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const listed: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue;
    const child = path.posix.join(relative.replaceAll('\\', '/'), entry.name).replace(/^\//, '');
    try {
      jail(root, child);
    } catch {
      continue;
    }
    const full = path.join(dir, entry.name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) continue;
    listed.push({
      name: entry.name,
      path: child,
      directory: stat.isDirectory(),
      size: stat.isDirectory() ? 0 : stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
  }
  return listed.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}

export function readFileText(root: string, relative: string): FileContent {
  const file = jail(root, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'file not found');
  const stat = fs.statSync(file);
  if (stat.size > TEXT_LIMIT) return { path: relative, text: null, binary: true, size: stat.size };
  const bytes = fs.readFileSync(file);
  if (bytes.includes(0)) return { path: relative, text: null, binary: true, size: stat.size };
  return { path: relative, text: bytes.toString('utf8'), binary: false, size: stat.size };
}

export function writeFileText(root: string, relative: string, text: string): void {
  if (typeof text !== 'string' || text.includes('\0') || Buffer.byteLength(text) > TEXT_LIMIT) {
    throw new HttpError(400, 'file is empty, binary, or too large');
  }
  const file = jail(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function makeDirectory(root: string, relative: string): void {
  const dir = jail(root, relative);
  fs.mkdirSync(dir, { recursive: false });
}

export function removePath(root: string, relative: string): void {
  if (!relative || relative === '.' || relative === '/') throw new HttpError(400, 'refusing to delete the server root');
  const target = jail(root, relative);
  fs.rmSync(target, { recursive: true, force: false });
}

export function renamePath(root: string, from: string, to: string): void {
  const source = jail(root, from);
  const dest = jail(root, to);
  fs.renameSync(source, dest);
}

export function saveUpload(root: string, directory: string, name: string, base64: string): void {
  if (!/^[A-Za-z0-9._ -]{1,120}$/.test(name) || name === '.' || name === '..') throw new HttpError(400, 'file name is not valid');
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0 || bytes.length > UPLOAD_LIMIT) throw new HttpError(400, 'upload must be under 8 MB');
  const relative = path.posix.join(directory.replaceAll('\\', '/'), name);
  const file = jail(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function jail(root: string, relative: string): string {
  try {
    return resolveInJail(root, relative || '.');
  } catch (error) {
    if (error instanceof PathJailError) throw new HttpError(400, error.message);
    throw error;
  }
}
