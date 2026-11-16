import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModpackHit } from '@hotbar/shared';
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
  const parsed = assertAllowedUrl(url);
  const response = await fetch(parsed, {
    headers: { 'user-agent': 'Hotbar/0.1.0 (local)', accept: 'application/json' },
    redirect: 'manual',
  });
  if (response.status !== 200) throw new Error(`Modrinth request failed (${response.status})`);
  return response.json() as Promise<unknown>;
}

