import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chooseReleaseFile, isNewer, isOfficialDownload, isReleaseRedirect, RELEASE_REPOSITORY, type ReleaseFile } from '@hotbar/shared';

const RELEASE_API = `https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`;

export interface UpdateOffer {
  current: string;
  latest: string;
  available: boolean;
  releaseUrl: string | null;
  file: ReleaseFile | null;
}

export async function fetchLatestRelease(current: string, platform: NodeJS.Platform, arch: string): Promise<UpdateOffer> {
  const response = await fetch(RELEASE_API, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'Hotbar' },
  });
  if (!response.ok) throw new Error('Could not reach GitHub to check for an update');
  const body = (await response.json()) as { tag_name?: string; assets?: Array<{ name?: string; browser_download_url?: string; digest?: string | null }> };
  const latest = (body.tag_name ?? '').replace(/^v/, '');
  const releaseUrl = latest ? `https://github.com/${RELEASE_REPOSITORY}/releases/tag/v${latest}` : null;
  const file = chooseReleaseFile(body.assets ?? [], platform, arch, latest);
  const available = file !== null && isNewer(latest, current);
  return { current, latest, available, releaseUrl, file: available ? file : null };
}

export async function downloadRelease(
  file: ReleaseFile,
  destination: string,
  onProgress: (received: number, total: number) => void,
): Promise<void> {
  if (!isOfficialDownload(file.url, versionFrom(file), file.name)) throw new Error('The installer is not from the Hotbar release');
  const response = await followRelease(file.url);
  if (!response.ok || !response.body) throw new Error('Could not download the installer');
  const partial = `${destination}.partial`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const hash = crypto.createHash('sha256');
  const output = fs.createWriteStream(partial);
  let received = 0;
  const total = Number(response.headers.get('content-length') ?? 0);
  try {
    const reader = response.body.getReader();
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const bytes = Buffer.from(chunk.value);
      hash.update(bytes);
      if (!output.write(bytes)) await new Promise<void>((resolve) => output.once('drain', () => resolve()));
      received += bytes.length;
      onProgress(received, total);
    }
    await new Promise<void>((resolve, reject) => {
      output.on('error', reject);
      output.end(() => resolve());
    });
  } catch (error) {
    output.destroy();
    fs.rmSync(partial, { force: true });
    throw error;
  }
  const actual = hash.digest('hex');
  if (actual !== file.sha256 || received < 1_000_000) {
    fs.rmSync(partial, { force: true });
    throw new Error('The downloaded installer did not match the GitHub release');
  }
  fs.rmSync(destination, { force: true });
  fs.renameSync(partial, destination);
}

async function followRelease(start: string): Promise<Response> {
  let current = start;
  for (let hop = 0; hop < 5; hop += 1) {
    assertHop(current, hop === 0);
    const response = await fetch(current, { redirect: 'manual', headers: { 'user-agent': 'Hotbar' } });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error('The download redirect was empty');
    current = new URL(location, current).href;
  }
  throw new Error('The installer download was redirected too many times');
}

function assertHop(url: string, first: boolean): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('The installer download left GitHub');
  if (parsed.hostname === 'github.com') {
    if (!first && !parsed.pathname.startsWith(`/${RELEASE_REPOSITORY}/releases/download/`)) {
      throw new Error('The installer download left GitHub');
    }
    if (first && !parsed.pathname.startsWith(`/${RELEASE_REPOSITORY}/releases/download/`)) {
      throw new Error('The installer is not from the Hotbar release');
    }
    return;
  }
  if (!first && isReleaseRedirect(url) && parsed.hostname !== 'github.com') return;
  throw new Error('The installer download left GitHub');
}

function versionFrom(file: ReleaseFile): string {
  const match = file.url.match(/\/releases\/download\/v(\d+\.\d+\.\d+)\//);
  return match?.[1] ?? '';
}
