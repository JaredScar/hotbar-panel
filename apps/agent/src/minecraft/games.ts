import fs from 'node:fs';
import path from 'node:path';
import { resolveExecutable } from '../executable.js';
import { downloadCapped, downloadVerified, fetchJson } from './net.js';
import { findNamedFile, run } from './network.js';

/**
 * FiveM versions: https://changelogs-live.fivem.net/api/changelog/versions/win32/server
 * confirmed 2026-11-15. Cfx returns the zip URL and does not publish a file hash.
 * The URL has to match the official artifact path before it is downloaded.
 *
 * Hytale: https://support.hytale.com/hc/en-us/articles/45326769420827-Hytale-Server-Manual
 * The downloader zip is the official link. Hypixel does not publish a checksum, so the
 * bytes fetched on 2026-11-15 are pinned and a newer zip fails closed.
 */

const HYTALE_DOWNLOADER_URL = 'https://downloader.hytale.com/hytale-downloader.zip';
const HYTALE_DOWNLOADER_SHA256 = '9f6939cce346d2ad09490728bbd4b8a5bbe5cb3fd7f3934f2b52e3f2fa0b0aaf';
const FIVEM_LIMIT = 400 * 1024 * 1024;

interface FiveMChannel {
  recommended?: string;
  latest?: string;
  recommended_download?: string;
  latest_download?: string;
}

export function assertFivemUrl(url: string): void {
  if (!/^https:\/\/runtime\.fivem\.net\/artifacts\/fivem\/build_(server_windows|proot_linux)\/master\/\d+-[a-f0-9]{40}\/(server\.zip|fx\.tar\.xz)$/.test(url)) {
    throw new Error('FiveM artifact URL is not the official build path');
  }
}

export function fivemArtifact(payload: FiveMChannel, channel: 'recommended' | 'latest'): { id: string; url: string } {
  const url = channel === 'latest' ? payload.latest_download : payload.recommended_download;
  const id = channel === 'latest' ? payload.latest : payload.recommended;
  if (!url || !id) throw new Error('FiveM did not publish that channel');
  assertFivemUrl(url);
  return { id, url };
}

export async function installFiveM(
  dir: string,
  channel: 'recommended' | 'latest',
  cfg: { port: number; hostname: string; maxPlayers: number; licenseKey: string },
): Promise<string> {
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    throw new Error('FiveM publishes server builds for Windows and Linux.');
  }
  const platform = process.platform === 'win32' ? 'win32' : 'linux';
  const payload = await fetchJson<FiveMChannel>(`https://changelogs-live.fivem.net/api/changelog/versions/${platform}/server`);
  const artifact = fivemArtifact(payload, channel);
  const archive = path.join(dir, artifact.url.endsWith('.zip') ? 'server.zip' : 'fx.tar.xz');
  await downloadCapped(artifact.url, archive, FIVEM_LIMIT);
  await extract(archive, dir);
  fs.rmSync(archive, { force: true });
  const executable = process.platform === 'win32' ? findNamedFile(dir, 'FXServer.exe') : findNamedFile(dir, 'FXServer');
  if (!executable) {
    throw new Error(
      process.platform === 'linux'
        ? 'The Linux FiveM build did not contain an FXServer binary Hotbar can launch directly.'
        : 'The FiveM build did not contain FXServer.exe.',
    );
  }
  fs.writeFileSync(path.join(path.dirname(executable), 'server.cfg'), serverCfg(cfg));
  return executable;
}

export async function installHytale(dir: string, patchline: 'release' | 'pre-release', log: (line: string) => void): Promise<{ cwd: string; jar: string; assets: string }> {
  if (process.arch !== 'x64') throw new Error('The official Hytale downloader is published for 64-bit Intel and AMD processors.');
  const archive = path.join(dir, 'hytale-downloader.zip');
  try {
    await downloadVerified(HYTALE_DOWNLOADER_URL, archive, { algorithm: 'sha256', expected: HYTALE_DOWNLOADER_SHA256 }, 30 * 1024 * 1024);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'download failed';
    throw new Error(message === 'checksum did not match' ? 'hytale-downloader.zip no longer matches the checksum Hotbar pinned' : message);
  }
  await extract(archive, dir);
  fs.rmSync(archive, { force: true });
  const binaryName = process.platform === 'win32' ? 'hytale-downloader-windows-amd64.exe' : 'hytale-downloader-linux-amd64';
  const binary = findNamedFile(dir, binaryName);
  if (!binary) throw new Error('The Hytale downloader zip did not contain the expected program.');
  if (process.platform !== 'win32') fs.chmodSync(binary, 0o755);
  const args = [binary, '-download-path', 'game.zip', '-skip-update-check'];
  if (patchline === 'pre-release') args.push('-patchline', 'pre-release');
  log('Sign in when a link and code appear. The download continues after you approve it.');
  let pending = '';
  const result = await run(args, dir, {
    timeoutMs: 15 * 60 * 1000,
    onOutput: (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const text = line.trim();
        if (text) log(text);
      }
    },
  });
  if (pending.trim()) log(pending.trim());
  const gameZip = path.join(dir, 'game.zip');
  if (result.code !== 0 || !fs.existsSync(gameZip)) {
    throw new Error(lastLine(result.stderr, result.stdout) || 'Hytale downloader did not finish. Sign in and try again.');
  }
  await extract(gameZip, dir);
  fs.rmSync(gameZip, { force: true });
  const jar = findNamedFile(dir, 'HytaleServer.jar');
  const assets = findNamedFile(dir, 'Assets.zip');
  if (!jar || !assets) throw new Error('The Hytale download did not include HytaleServer.jar and Assets.zip.');
  const cwd = path.dirname(assets);
  return {
    cwd,
    jar: path.relative(cwd, jar).split('\\').join('/'),
    assets: path.relative(cwd, assets).split('\\').join('/'),
  };
}

function serverCfg(cfg: { port: number; hostname: string; maxPlayers: number; licenseKey: string }): string {
  return [
    `endpoint_add_tcp "0.0.0.0:${cfg.port}"`,
    `endpoint_add_udp "0.0.0.0:${cfg.port}"`,
    `sv_maxclients ${cfg.maxPlayers}`,
    `sv_licenseKey ${quote(cfg.licenseKey)}`,
    `sv_hostname ${quote(cfg.hostname)}`,
    `sets sv_projectName ${quote(cfg.hostname)}`,
    'sets sv_projectDesc "Hotbar"',
    'set onesync on',
    '',
    'ensure mapmanager',
    'ensure chat',
    'ensure spawnmanager',
    'ensure sessionmanager',
    'ensure basic-gamemode',
    'ensure hardcap',
    '',
  ].join('\n');
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function extract(archive: string, dest: string): Promise<void> {
  const tar = resolveExecutable('tar');
  const result = await run([tar, '-xf', archive, '-C', dest]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || 'could not extract the download');
}

function lastLine(stderr: string, stdout: string): string {
  const lines = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? '';
}
