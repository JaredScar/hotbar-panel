import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddonHit, AddonUpdate, ModpackHit } from '@hotbar/shared';
import { resolveInJail } from './jail.js';
import { downloadVerified, assertAllowedUrl } from './minecraft/net.js';
import { run } from './minecraft/network.js';
import { resolveExecutable } from './executable.js';

export interface ModpackFile {
  path: string;
  hashes?: { sha1?: string; sha512?: string };
  downloads?: string[];
  env?: { server?: string };
}

/** Keep files the pack says the server needs. Client-only files stay out. */
export function serverPackFiles(files: ModpackFile[]): ModpackFile[] {
  return files.filter((file) => {
    const role = file.env?.server;
    if (role === 'unsupported') return false;
    if (!file.path || file.path.includes('..') || file.path.startsWith('/') || file.path.includes('\0')) return false;
    return Boolean(file.downloads?.[0] && file.hashes?.sha1);
  });
}

export interface AddonSlot {
  kind: 'plugin' | 'mod';
  folder: 'plugins' | 'mods';
  loaders: string[];
  label: string;
}

const JAR_NAME = /^[A-Za-z0-9._ ()+-]{1,120}\.jar$/;

export function addonSlot(provider: string): AddonSlot | null {
  if (provider === 'paper') return { kind: 'plugin', folder: 'plugins', loaders: ['paper', 'spigot', 'bukkit'], label: 'plugin' };
  if (provider === 'purpur') return { kind: 'plugin', folder: 'plugins', loaders: ['purpur', 'paper', 'spigot', 'bukkit'], label: 'plugin' };
  if (provider === 'spigot') return { kind: 'plugin', folder: 'plugins', loaders: ['spigot', 'bukkit'], label: 'plugin' };
  if (provider === 'fabric') return { kind: 'mod', folder: 'mods', loaders: ['fabric'], label: 'mod' };
  if (provider === 'quilt') return { kind: 'mod', folder: 'mods', loaders: ['quilt'], label: 'mod' };
  if (provider === 'forge') return { kind: 'mod', folder: 'mods', loaders: ['forge'], label: 'mod' };
  if (provider === 'neoforge') return { kind: 'mod', folder: 'mods', loaders: ['neoforge'], label: 'mod' };
  return null;
}

export function addonFacets(slot: AddonSlot, version: string): string[][] {
  const facets = [[`project_type:${slot.kind}`], slot.loaders.map((loader) => `categories:${loader}`)];
  if (version.trim()) facets.push([`versions:${version.trim()}`]);
  return facets;
}

export function safeJarName(filename: string): string | null {
  const name = filename.replace(/\\/g, '/').split('/').pop() ?? '';
  if (name !== filename || !JAR_NAME.test(name) || name.includes('..')) return null;
  return name;
}

export function pickAddonJar(versions: Array<{ files?: Array<{ url?: string; filename?: string; primary?: boolean; hashes?: { sha1?: string } }> }>): { url: string; filename: string; sha1: string } | null {
  const files = versions.flatMap((version) => version.files ?? []);
  const jars = files.flatMap((file) => {
    const filename = file.filename ? safeJarName(file.filename) : null;
    if (!filename || !file.url || !file.hashes?.sha1) return [];
    try {
      assertAllowedUrl(file.url);
    } catch {
      return [];
    }
    return [{ url: file.url, filename, sha1: file.hashes.sha1, primary: file.primary === true }];
  });
  const chosen = jars.find((file) => file.primary) ?? jars[0];
  return chosen ? { url: chosen.url, filename: chosen.filename, sha1: chosen.sha1 } : null;
}

export async function searchAddons(query: string, provider: string, version: string): Promise<AddonHit[]> {
  const slot = addonSlot(provider);
  if (!slot) throw new Error('Vanilla does not load plugins or mods. Change the server type on the Version tab.');
  const text = query.trim().slice(0, 80);
  const facets = encodeURIComponent(JSON.stringify(addonFacets(slot, version)));
  const url = `https://api.modrinth.com/v2/search?limit=12&facets=${facets}&query=${encodeURIComponent(text)}`;
  const body = (await getJson(url)) as { hits?: Array<{ project_id?: string; title?: string; description?: string; downloads?: number }> };
  return (body.hits ?? []).slice(0, 12).map((hit) => ({
    projectId: hit.project_id ?? '',
    title: hit.title ?? slot.label,
    description: (hit.description ?? '').slice(0, 180),
    downloads: hit.downloads ?? 0,
  })).filter((hit) => hit.projectId);
}

export async function installAddon(cwd: string, projectId: string, provider: string, version: string, onLine: (line: string) => void): Promise<string> {
  if (!/^[A-Za-z0-9]{1,16}$/.test(projectId)) throw new Error('project id is not valid');
  const slot = addonSlot(provider);
  if (!slot) throw new Error('Vanilla does not load plugins or mods. Change the server type on the Version tab.');
  const versions = (await getJson(
    `https://api.modrinth.com/v2/project/${projectId}/version?loaders=${encodeURIComponent(JSON.stringify(slot.loaders))}&game_versions=${encodeURIComponent(JSON.stringify([version]))}`,
  )) as Array<{ files?: Array<{ url?: string; filename?: string; primary?: boolean; hashes?: { sha1?: string } }> }>;
  const file = pickAddonJar(versions);
  if (!file) throw new Error(`No ${slot.label} file on Modrinth for ${provider} ${version}.`);
  const dest = resolveInJail(cwd, `${slot.folder}/${file.filename}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  onLine(`Downloading ${file.filename}`);
  await downloadVerified(file.url, dest, { algorithm: 'sha1', expected: file.sha1 }, 80 * 1024 * 1024);
  onLine(`${file.filename} is in ${slot.folder}. Start the server to load it.`);
  return file.filename;
}

interface ModrinthVersion {
  id?: string;
  project_id?: string;
  version_number?: string;
  files?: Array<{ url?: string; filename?: string; primary?: boolean; hashes?: { sha1?: string } }>;
}

export function chooseAddonUpdates(
  installed: Array<{ filename: string; hash: string }>,
  current: Record<string, ModrinthVersion>,
  latest: Record<string, ModrinthVersion>,
): AddonUpdate[] {
  const updates: AddonUpdate[] = [];
  for (const file of installed) {
    const key = file.hash.toLowerCase();
    const have = current[key] ?? current[file.hash];
    const next = latest[key] ?? latest[file.hash];
    if (!have?.id || !next?.id || !next.project_id || have.id === next.id) continue;
    updates.push({
      filename: file.filename,
      projectId: next.project_id,
      installedVersion: have.version_number || have.id,
      latestVersion: next.version_number || next.id,
    });
  }
  return updates;
}

export async function checkAddonUpdates(cwd: string, provider: string, version: string): Promise<AddonUpdate[]> {
  const slot = addonSlot(provider);
  if (!slot) throw new Error('Vanilla does not load plugins or mods. Change the server type on the Version tab.');
  const installed = await hashAddonJars(cwd, slot.folder);
  if (installed.length === 0) return [];
  const hashes = installed.map((file) => file.hash);
  const body = { hashes, algorithm: 'sha1', loaders: slot.loaders, game_versions: version.trim() ? [version.trim()] : [] };
  const [current, latest] = await Promise.all([
    postJson('https://api.modrinth.com/v2/version_files', { hashes, algorithm: 'sha1' }) as Promise<Record<string, ModrinthVersion>>,
    postJson('https://api.modrinth.com/v2/version_files/update', body) as Promise<Record<string, ModrinthVersion>>,
  ]);
  return chooseAddonUpdates(installed, current, latest);
}

export async function updateAddonFile(cwd: string, filename: string, provider: string, version: string, onLine: (line: string) => void): Promise<string> {
  const slot = addonSlot(provider);
  if (!slot) throw new Error('Vanilla does not load plugins or mods. Change the server type on the Version tab.');
  const safe = safeJarName(filename);
  if (!safe) throw new Error('jar name is not valid');
  const currentPath = resolveInJail(cwd, `${slot.folder}/${safe}`);
  if (!fs.existsSync(currentPath) || !fs.statSync(currentPath).isFile()) throw new Error('that jar is not installed');
  const hash = await sha1File(currentPath);
  const body = { hashes: [hash], algorithm: 'sha1', loaders: slot.loaders, game_versions: version.trim() ? [version.trim()] : [] };
  const latest = (await postJson('https://api.modrinth.com/v2/version_files/update', body)) as Record<string, ModrinthVersion>;
  const next = latest[hash] ?? latest[hash.toLowerCase()];
  const file = pickAddonJar(next ? [next] : []);
  if (!file) throw new Error(`No newer ${slot.label} file on Modrinth for ${provider} ${version}.`);
  if (file.sha1.toLowerCase() === hash.toLowerCase()) throw new Error(`${safe} is already the newest file on Modrinth.`);
  const dest = resolveInJail(cwd, `${slot.folder}/${file.filename}`);
  const temp = `${dest}.hotbar-download`;
  onLine(`Downloading ${file.filename}`);
  try {
    await downloadVerified(file.url, temp, { algorithm: 'sha1', expected: file.sha1 }, 80 * 1024 * 1024);
    fs.renameSync(temp, dest);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
  if (path.basename(dest) !== safe) fs.rmSync(currentPath, { force: true });
  onLine(`${file.filename} replaced ${safe}. Start the server to load it.`);
  return file.filename;
}

async function hashAddonJars(cwd: string, folder: string): Promise<Array<{ filename: string; hash: string }>> {
  let dir: string;
  try {
    dir = resolveInJail(cwd, folder);
  } catch {
    return [];
  }
  if (!fs.existsSync(dir)) return [];
  const names = fs.readdirSync(dir).filter((name) => safeJarName(name)).slice(0, 40);
  const hashed: Array<{ filename: string; hash: string }> = [];
  for (const filename of names) {
    const full = path.join(dir, filename);
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.size > 80 * 1024 * 1024) continue;
    hashed.push({ filename, hash: await sha1File(full) });
  }
  return hashed;
}

function sha1File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export function addonDownloadOffer(provider: string, version: string): { id: string; title: string; detail: string } {
  const slot = addonSlot(provider);
  const label = slot?.label ?? 'file';
  return {
    id: 'addon',
    title: `Modrinth ${label}`,
    detail: `One ${label} jar for ${provider} ${version}, from Modrinth.`,
  };
}

export async function searchModpacks(query: string): Promise<ModpackHit[]> {
  const text = query.trim().slice(0, 80);
  const url = `https://api.modrinth.com/v2/search?limit=12&facets=${encodeURIComponent('[["project_type:modpack"]]')}&query=${encodeURIComponent(text)}`;
  const body = (await getJson(url)) as { hits?: Array<{ project_id?: string; title?: string; description?: string; downloads?: number }> };
  return (body.hits ?? []).slice(0, 12).map((hit) => ({
    projectId: hit.project_id ?? '',
    title: hit.title ?? 'Modpack',
    description: (hit.description ?? '').slice(0, 180),
    downloads: hit.downloads ?? 0,
  })).filter((hit) => hit.projectId);
}

export async function installModpack(cwd: string, projectId: string, onLine: (line: string) => void): Promise<void> {
  if (!/^[A-Za-z0-9]{1,16}$/.test(projectId)) throw new Error('modpack id is not valid');
  const versions = (await getJson(`https://api.modrinth.com/v2/project/${projectId}/version`)) as Array<{
    files?: Array<{ url?: string; filename?: string; hashes?: { sha1?: string } }>;
  }>;
  const file = versions.flatMap((version) => version.files ?? []).find((item) => item.filename?.endsWith('.mrpack') && item.hashes?.sha1 && item.url);
  if (!file?.url || !file.hashes?.sha1) throw new Error('this project has no checksummed .mrpack');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-mrpack-'));
  try {
    const archive = path.join(temp, 'pack.mrpack');
    onLine(`Downloading ${file.filename}`);
    await downloadVerified(file.url, archive, { algorithm: 'sha1', expected: file.hashes.sha1 }, 200 * 1024 * 1024);
    const extracted = path.join(temp, 'pack');
    fs.mkdirSync(extracted);
    const tar = resolveExecutable('tar');
    const result = await run([tar, '-xf', archive, '-C', extracted]);
    if (result.code !== 0) throw new Error(result.stderr.trim() || 'could not read the modpack');
    const index = JSON.parse(fs.readFileSync(path.join(extracted, 'modrinth.index.json'), 'utf8')) as { files?: ModpackFile[] };
    const files = serverPackFiles(index.files ?? []);
    onLine(`Downloading ${files.length} server files`);
    for (const item of files) {
      const dest = resolveInJail(cwd, item.path);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const hash = item.hashes?.sha1;
      if (!hash || !item.downloads?.[0]) continue;
      await downloadVerified(item.downloads[0], dest, { algorithm: 'sha1', expected: hash }, 200 * 1024 * 1024);
    }
    for (const folder of ['overrides', 'server-overrides']) {
      const source = path.join(extracted, folder);
      if (!fs.existsSync(source)) continue;
      copyTree(source, cwd, '');
      onLine(`Applied ${folder}`);
    }
    onLine('Modpack files are in place. Start the server when the loader matches this pack.');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function copyTree(source: string, cwd: string, relative: string): void {
  for (const name of fs.readdirSync(source)) {
    const next = relative ? `${relative}/${name}` : name;
    const full = path.join(source, name);
    if (fs.statSync(full).isDirectory()) {
      copyTree(full, cwd, next);
      continue;
    }
    const dest = resolveInJail(cwd, next);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(full, dest);
  }
}

async function getJson(url: string): Promise<unknown> {
  return readJson(url);
}

async function postJson(url: string, body: unknown): Promise<unknown> {
  return readJson(url, body);
}

async function readJson(url: string, body?: unknown): Promise<unknown> {
  const parsed = assertAllowedUrl(url);
  const response = await fetch(parsed, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'user-agent': 'Hotbar/0.1.0 (local)',
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  if (response.status !== 200) throw new Error(`Modrinth request failed (${response.status})`);
  return response.json() as Promise<unknown>;
}

