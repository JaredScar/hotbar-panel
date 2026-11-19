import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assessZipEntries, ZIP_LIMITS, type ZipEntry } from '@hotbar/shared';
import { HttpError } from './errors.js';
import { PathJailError, resolveInJail } from './jail.js';
import { resolveExecutable } from './executable.js';
import { run } from './minecraft/network.js';

const ZIP_BYTES = 256 * 1024 * 1024;
const FOLDER_NAME = /^[A-Za-z0-9._-]{1,64}$/;

export function parseTarListLine(line: string): ZipEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('l') || trimmed.startsWith('h')) return null;
  const gnu = /^[-dcbps][\w@.+-]{9}\s+\S+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+[\d:]+\s+(.*)$/.exec(trimmed);
  const bsd = /^[-dcbps][\w@.+-]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+[\d:]+\s+(.*)$/.exec(trimmed);
  const match = gnu ?? bsd;
  if (!match?.[2]) return null;
  const name = match[2].replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (!name || name === '.') return null;
  return { name, uncompressedBytes: Number(match[1]) };
}

export function worldRootIn(names: readonly string[]): string | null {
  const cleaned = names
    .map((name) => name.replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, ''))
    .filter((name) => name && !name.startsWith('link:'));
  if (cleaned.includes('level.dat')) return '';
  const roots = new Set<string>();
  for (const name of cleaned) {
    if (!name.endsWith('/level.dat')) continue;
    const root = name.slice(0, -'/level.dat'.length);
    if (root && !root.includes('/')) roots.add(root);
  }
  if (roots.size !== 1) return null;
  return [...roots][0] ?? null;
}

export function worldDirectory(cwd: string): { name: string; folder: string } {
  const name = worldFolderName(cwd);
  return { name, folder: resolveInJail(cwd, name) };
}

export function worldFolderName(cwd: string): string {
  let text = '';
  try {
    text = fs.readFileSync(resolveInJail(cwd, 'server.properties'), 'utf8');
  } catch {
    return 'world';
  }
  const match = /^level-name=(.*)$/m.exec(text);
  const name = (match?.[1] ?? 'world').trim() || 'world';
  if (!FOLDER_NAME.test(name)) throw new HttpError(400, 'level-name has to be one folder name');
  return name;
}

export async function zipFolder(root: string, relative: string): Promise<string> {
  const requested = relative.replaceAll('\\', '/').replace(/\/$/, '');
  if (!requested || requested === '.') throw new HttpError(400, 'choose a folder inside the server');
  const source = jail(root, requested);
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) throw new HttpError(400, 'choose a folder');
  const name = path.basename(source);
  const parent = path.posix.dirname(requested);
  const destRelative = path.posix.join(parent === '.' ? '' : parent, `${name}.zip`);
  const dest = jail(root, destRelative);
  if (fs.existsSync(dest)) throw new HttpError(409, `${name}.zip already exists`);
  await tar(['-a', '-cf', dest, '-C', source, '.']);
  return destRelative;
}

export async function unzipFile(root: string, relative: string): Promise<string> {
  if (!relative.toLowerCase().endsWith('.zip')) throw new HttpError(400, 'choose a .zip file');
  const archive = jail(root, relative);
  const stat = fs.statSync(archive);
  if (!stat.isFile()) throw new HttpError(400, 'choose a .zip file');
  if (stat.size > ZIP_BYTES) throw new HttpError(400, 'zip is larger than 256 MB');
  await assertArchiveSafe(archive);
  const folderName = path.posix.basename(relative.replaceAll('\\', '/')).replace(/\.zip$/i, '');
  if (!folderName || folderName === '.' || folderName === '..') throw new HttpError(400, 'zip name is not valid');
  const parent = path.posix.dirname(relative.replaceAll('\\', '/'));
  const destRelative = path.posix.join(parent === '.' ? '' : parent, folderName);
  const dest = jail(root, destRelative);
  if (fs.existsSync(dest)) throw new HttpError(409, `${folderName} already exists`);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-unzip-'));
  try {
    await tar(['-xf', archive, '-C', temp]);
    fs.mkdirSync(dest);
    copyInto(temp, root, destRelative);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  return destRelative;
}

export async function createFolderZip(folder: string): Promise<string> {
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new HttpError(404, 'world folder not found');
  if (!fs.existsSync(path.join(folder, 'level.dat'))) throw new HttpError(400, 'that folder has no level.dat');
  const dest = path.join(os.tmpdir(), `hotbar-world-${Date.now()}.zip`);
  await tar(['-a', '-cf', dest, '-C', folder, '.']);
  const size = fs.statSync(dest).size;
  if (size > ZIP_LIMITS.maxTotalBytes) {
    fs.rmSync(dest, { force: true });
    throw new HttpError(400, 'world zip is too large');
  }
  return dest;
}

export async function replaceWorldFolder(cwd: string, folderName: string, zipBytes: Buffer): Promise<void> {
  if (zipBytes.length === 0 || zipBytes.length > ZIP_BYTES) throw new HttpError(400, 'world zip has to be under 256 MB');
  if (!FOLDER_NAME.test(folderName)) throw new HttpError(400, 'level-name has to be one folder name');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-world-'));
  const archive = path.join(temp, 'world.zip');
  const extracted = path.join(temp, 'out');
  try {
    fs.writeFileSync(archive, zipBytes);
    const entries = await assertArchiveSafe(archive);
    const root = worldRootIn(entries.map((entry) => entry.name));
    if (root === null) throw new HttpError(400, 'This zip does not contain one Minecraft world (level.dat).');
    fs.mkdirSync(extracted);
    await tar(['-xf', archive, '-C', extracted]);
    const contents = root ? path.join(extracted, root) : extracted;
    if (!fs.existsSync(path.join(contents, 'level.dat'))) throw new HttpError(400, 'This zip does not contain one Minecraft world (level.dat).');
    const stagingName = `${folderName}.hotbar-new`;
    const staging = jail(cwd, stagingName);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    copyInto(contents, cwd, stagingName);
    const destination = jail(cwd, folderName);
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(staging, destination);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

async function assertArchiveSafe(archive: string): Promise<ZipEntry[]> {
  const entries = await listArchive(archive);
  const linked = entries.find((entry) => entry.name.startsWith('link:'));
  if (linked) throw new HttpError(400, 'zip contains a link');
  const assessment = assessZipEntries(entries);
  if (!assessment.ok) throw new HttpError(400, assessment.errors[0] ?? 'zip was rejected');
  return entries;
}

async function listArchive(archive: string): Promise<ZipEntry[]> {
  const tarBin = resolveExecutable('tar');
  const entries: ZipEntry[] = [];
  let stderr = '';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(tarBin, ['-tvf', archive], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) pushEntry(line, entries, child);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-2000);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (buffer.trim()) pushEntry(buffer, entries, child);
      if (code !== 0 && entries.length === 0) reject(new HttpError(400, stderr.trim() || 'could not read the zip'));
      else resolve();
    });
  });
  return entries;
}

function pushEntry(line: string, entries: ZipEntry[], child: ReturnType<typeof spawn>): void {
  if (line.trim().startsWith('l') || line.trim().startsWith('h')) {
    entries.push({ name: 'link:rejected', uncompressedBytes: 0 });
    child.kill();
    return;
  }
  const entry = parseTarListLine(line);
  if (!entry) return;
  entries.push(entry);
  if (entries.length > ZIP_LIMITS.maxEntries) child.kill();
}

async function tar(args: string[]): Promise<void> {
  const result = await run([resolveExecutable('tar'), ...args], undefined, { timeoutMs: 10 * 60 * 1000 });
  if (result.code !== 0) throw new HttpError(400, result.stderr.trim() || 'could not pack the folder');
}

function copyInto(source: string, cwd: string, relative: string): void {
  for (const name of fs.readdirSync(source)) {
    const next = relative ? `${relative}/${name}` : name;
    const full = path.join(source, name);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new HttpError(400, 'zip contains a link');
    if (stat.isDirectory()) {
      jail(cwd, next);
      fs.mkdirSync(jail(cwd, next), { recursive: true });
      copyInto(full, cwd, next);
      continue;
    }
    if (!stat.isFile()) continue;
    const dest = jail(cwd, next);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(full, dest);
  }
}

function jail(root: string, relative: string): string {
  try {
    return resolveInJail(root, relative || '.');
  } catch (error) {
    if (error instanceof PathJailError) throw new HttpError(400, error.message);
    throw error;
  }
}
