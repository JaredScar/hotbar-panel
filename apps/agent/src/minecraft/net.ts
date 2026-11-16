import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const USER_AGENT = 'Hotbar/0.1.0 (local)';

const ALLOWED_HOSTS = new Set([
  'piston-meta.mojang.com',
  'piston-data.mojang.com',
  'launchermeta.mojang.com',
  'launcher.mojang.com',
  'fill.papermc.io',
  'fill-data.papermc.io',
  'meta.fabricmc.net',
  'maven.fabricmc.net',
  'api.purpurmc.org',
  'files.minecraftforge.net',
  'maven.minecraftforge.net',
  'maven.neoforged.net',
  'meta.quiltmc.org',
  'maven.quiltmc.org',
  'hub.spigotmc.org',
  'changelogs-live.fivem.net',
  'runtime.fivem.net',
  'downloader.hytale.com',
  'api.adoptium.net',
  'api.modrinth.com',
  'cdn.modrinth.com',
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'desktop.docker.com',
]);

export function assertAllowedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('download URL is invalid');
  }
  if (url.protocol !== 'https:') throw new Error('downloads must use https');
  if (url.username || url.password) throw new Error('download URL must not include credentials');
  if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error(`download host is not allowed: ${url.hostname}`);
  return url;
}

export function digestMatches(actual: string, expected: string): boolean {
  const left = actual.trim().toLowerCase();
  const right = expected.trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(left) || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export async function fetchChecked(url: string, headers: Record<string, string> = {}): Promise<Response> {
  let current = url;
  for (let hop = 0; hop < 5; hop += 1) {
    assertAllowedUrl(current);
    const response = await fetch(current, {
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT, accept: '*/*', ...headers },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('redirect missing location');
      current = new URL(location, current).toString();
      await response.body?.cancel();
      continue;
    }
    return response;
  }
  throw new Error('too many redirects');
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetchChecked(url, { accept: 'application/json' });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export async function fetchText(url: string): Promise<string> {
  const response = await fetchChecked(url);
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`request failed (${response.status})`);
  }
  return (await response.text()).trim();
}

export async function downloadVerified(
  url: string,
  dest: string,
  check: { algorithm: 'sha1' | 'sha256' | 'md5'; expected: string },
  maxBytes: number,
): Promise<void> {
  await saveDownload(url, dest, check, maxBytes);
}

/** Size-capped download for a publisher that does not provide a file hash. The caller checks the URL first. */
export async function downloadCapped(url: string, dest: string, maxBytes: number): Promise<void> {
  await saveDownload(url, dest, null, maxBytes);
}

async function saveDownload(
  url: string,
  dest: string,
  check: { algorithm: 'sha1' | 'sha256' | 'md5'; expected: string } | null,
  maxBytes: number,
): Promise<void> {
  const response = await fetchChecked(url);
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`download failed (${response.status})`);
  }
  const hash = check ? createHash(check.algorithm) : null;
  let size = 0;
  const partial = `${dest}.partial`;
  const web = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>);
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        size += chunk.length;
        if (size > maxBytes) throw new Error('download exceeds the size limit');
        hash?.update(chunk);
        callback(null, chunk);
      } catch (error) {
        callback(error instanceof Error ? error : new Error('download failed'));
      }
    },
  });
  try {
    await pipeline(web, counter, fs.createWriteStream(partial));
    if (check && hash && !digestMatches(hash.digest('hex'), check.expected)) {
      throw new Error('checksum did not match');
    }
    fs.renameSync(partial, dest);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  }
}
