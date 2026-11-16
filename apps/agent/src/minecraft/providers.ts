import fs from 'node:fs';
import path from 'node:path';
import type { McProviderId, McVersion } from '@hotbar/shared';
import { resolveExecutable } from '../executable.js';
import { jvmArgsFile } from './launch.js';
import { downloadVerified, fetchJson, fetchText } from './net.js';
import { findNamedFile, run } from './network.js';

/**
 * Provider URLs confirmed live on 2026-11-15:
 * Mojang manifest, Paper Fill v3, Purpur v2, Fabric meta, Quilt meta,
 * Forge promotions_slim, NeoForge maven-metadata, Spigot versions index + BuildTools.
 * Versions stay opaque strings. Lists that the publisher returns oldest-first are reversed
 * so the newest stays first, which is the order Paper and Mojang already use.
 */

const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const PAPER_PROJECT = 'https://fill.papermc.io/v3/projects/paper';
const JAR_LIMIT = 200 * 1024 * 1024;

interface MojangManifest {
  versions: { id: string; type: string; url: string }[];
}

interface MojangVersion {
  javaVersion?: { majorVersion?: number };
  downloads?: { server?: { sha1?: string; url?: string } };
}

interface PaperProject {
  versions: Record<string, string[]>;
}

interface PaperDownload {
  checksums?: { sha256?: string };
  url?: string;
}

interface PaperBuild {
  id: number;
  channel: string;
  downloads?: Record<string, PaperDownload>;
}

interface FabricGame {
  version: string;
  stable: boolean;
}

interface FabricComponent {
  version: string;
  stable: boolean;
  url?: string;
}

export function mojangVersions(manifest: { versions: { id: string; type: string }[] }, snapshots: boolean): McVersion[] {
  return manifest.versions
    .filter((version) => version.type === 'release' || (snapshots && version.type === 'snapshot'))
    .map((version) => ({ id: version.id, stable: version.type === 'release' }));
}

export function paperVersions(project: { versions: Record<string, string[]> }, snapshots: boolean): McVersion[] {
  const versions: McVersion[] = [];
  for (const list of Object.values(project.versions)) {
    for (const id of list) {
      const stable = !id.includes('-');
      if (stable || snapshots) versions.push({ id, stable });
    }
  }
  return versions;
}

export function fabricVersions(games: { version: string; stable: boolean }[], snapshots: boolean): McVersion[] {
  return games
    .filter((game) => game.stable || snapshots)
    .map((game) => ({ id: game.version, stable: game.stable }));
}

export function purpurVersions(versions: string[], snapshots: boolean): McVersion[] {
  return versions
    .slice()
    .reverse()
    .filter((id) => snapshots || !id.includes('-'))
    .map((id) => ({ id, stable: !id.includes('-') }));
}

export function spigotVersions(indexHtml: string): McVersion[] {
  const ids = [...indexHtml.matchAll(/href="([A-Za-z0-9._+-]+)\.json"/g)]
    .map((match) => match[1])
    .filter((id) => id !== 'latest');
  return ids
    .slice()
    .reverse()
    .map((id) => ({ id, stable: true }));
}

export function forgeVersions(promos: Record<string, string>, snapshots: boolean): McVersion[] {
  const seen = new Set<string>();
  const versions: McVersion[] = [];
  const keys = Object.keys(promos);
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const match = keys[index]?.match(/^(.*)-(recommended|latest)$/);
    if (!match) continue;
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const stable = Object.prototype.hasOwnProperty.call(promos, `${id}-recommended`);
    if (!stable && !snapshots) continue;
    versions.push({ id, stable });
  }
  return versions;
}

/** NeoForge 21.1.x is Minecraft 1.21.1. Yearly versions such as 26.3.0.x are Minecraft 26.3. */
export function neoforgeMinecraftId(build: string): string | null {
  const year = build.match(/^(\d{2}\.\d+)\.\d+\.\d+$/);
  if (year) {
    const major = Number(year[1].split('.')[0]);
    if (major >= 25) return year[1];
  }
  const classic = build.match(/^(\d+)\.(\d+)\.\d+$/);
  if (!classic) return null;
  const major = Number(classic[1]);
  if (major < 20 || major > 24) return null;
  return classic[2] === '0' ? `1.${classic[1]}` : `1.${classic[1]}.${classic[2]}`;
}

export function neoforgeVersions(builds: string[], mojang: McVersion[]): { versions: McVersion[]; buildFor: Record<string, string> } {
  const buildFor: Record<string, string> = {};
  for (const build of builds) {
    const minecraft = neoforgeMinecraftId(build);
    if (minecraft) buildFor[minecraft] = build;
  }
  return { versions: mojang.filter((version) => buildFor[version.id]), buildFor };
}

export function mavenVersions(xml: string): string[] {
  const block = xml.match(/<versions>([\s\S]*?)<\/versions>/);
  if (!block?.[1]) return [];
  return [...block[1].matchAll(/<version>([^<]+)<\/version>/g)].map((match) => match[1]);
}

export async function listProviderVersions(provider: McProviderId, snapshots: boolean): Promise<McVersion[]> {
  if (provider === 'vanilla') return mojangVersions(await fetchJson<MojangManifest>(MOJANG_MANIFEST), snapshots);
  if (provider === 'paper') return paperVersions(await fetchJson<PaperProject>(PAPER_PROJECT), snapshots);
  if (provider === 'purpur') {
    const project = await fetchJson<{ versions: string[] }>('https://api.purpurmc.org/v2/purpur');
    return purpurVersions(project.versions, snapshots);
  }
  if (provider === 'spigot') return spigotVersions(await fetchText('https://hub.spigotmc.org/versions/'));
  if (provider === 'fabric') return fabricVersions(await fetchJson<FabricGame[]>('https://meta.fabricmc.net/v2/versions/game'), snapshots);
  if (provider === 'quilt') return fabricVersions(await fetchJson<FabricGame[]>('https://meta.quiltmc.org/v3/versions/game'), snapshots);
  if (provider === 'forge') {
    const payload = await fetchJson<{ promos?: Record<string, string> }>('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
    return forgeVersions(payload.promos ?? {}, snapshots);
  }
  const mojang = mojangVersions(await fetchJson<MojangManifest>(MOJANG_MANIFEST), snapshots);
  const xml = await fetchText('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
  return neoforgeVersions(mavenVersions(xml), mojang).versions;
}

export async function javaMajorFor(versionId: string): Promise<number> {
  const manifest = await fetchJson<MojangManifest>(MOJANG_MANIFEST);
  const entry = manifest.versions.find((version) => version.id === versionId);
  if (!entry) throw new Error(`Minecraft ${versionId} is not in Mojang's version list`);
  const detail = await fetchJson<MojangVersion>(entry.url);
  const major = detail.javaVersion?.majorVersion;
  if (!major) throw new Error(`Mojang did not say which Java ${versionId} needs`);
  return major;
}

export async function installVanilla(dir: string, versionId: string): Promise<void> {
  const manifest = await fetchJson<MojangManifest>(MOJANG_MANIFEST);
  const entry = manifest.versions.find((version) => version.id === versionId);
  if (!entry) throw new Error(`Minecraft ${versionId} is not in Mojang's version list`);
  const detail = await fetchJson<MojangVersion>(entry.url);
  const server = detail.downloads?.server;
  if (!server?.url || !server.sha1) throw new Error(`${versionId} has no server download`);
  await downloadVerified(server.url, path.join(dir, 'server.jar'), { algorithm: 'sha1', expected: server.sha1 }, JAR_LIMIT);
}

export async function installPaper(dir: string, versionId: string): Promise<void> {
  const builds = await fetchJson<PaperBuild[]>(
    `https://fill.papermc.io/v3/projects/paper/versions/${encodeURIComponent(versionId)}/builds`,
  );
  if (!Array.isArray(builds) || builds.length === 0) throw new Error(`Paper has no builds for ${versionId}`);
  const stable = builds.filter((build) => build.channel === 'STABLE');
  const pool = (stable.length > 0 ? stable : builds).slice().sort((a, b) => b.id - a.id);
  const chosen = pool[0];
  const download = chosen.downloads?.['server:default'] ?? Object.values(chosen.downloads ?? {})[0];
  if (!download?.url || !download.checksums?.sha256) throw new Error('Paper build did not include a checksummed jar');
  await downloadVerified(download.url, path.join(dir, 'server.jar'), { algorithm: 'sha256', expected: download.checksums.sha256 }, JAR_LIMIT);
}

export async function installFabric(dir: string, versionId: string, javaBin: string): Promise<string> {
  const loaders = await fetchJson<FabricComponent[]>('https://meta.fabricmc.net/v2/versions/loader');
  const installers = await fetchJson<FabricComponent[]>('https://meta.fabricmc.net/v2/versions/installer');
  const loader = loaders.find((item) => item.stable) ?? loaders[0];
  const installer = installers.find((item) => item.stable) ?? installers[0];
  if (!loader || !installer?.url) throw new Error('Fabric did not publish a loader and installer');
  const sha1 = await fetchText(`${installer.url}.sha1`);
  const installerJar = path.join(dir, 'fabric-installer.jar');
  await downloadVerified(installer.url, installerJar, { algorithm: 'sha1', expected: sha1 }, 20 * 1024 * 1024);
  const result = await run(
    [javaBin, '-jar', installerJar, 'server', '-dir', dir, '-mcversion', versionId, '-loader', loader.version, '-downloadMinecraft'],
    dir,
  );
  fs.rmSync(installerJar, { force: true });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'Fabric installer failed');
  }
  const launch = ['fabric-server-launch.jar', 'fabric-server-launcher.jar'].find((name) => fs.existsSync(path.join(dir, name)));
  if (!launch) throw new Error('Fabric installer did not write a launch jar');
  return launch;
}

interface PurpurBuild {
  build?: string;
  md5?: string;
}

export async function installPurpur(dir: string, versionId: string): Promise<void> {
  const latest = await fetchJson<PurpurBuild>(`https://api.purpurmc.org/v2/purpur/${encodeURIComponent(versionId)}/latest`);
  if (!latest.build || !latest.md5) throw new Error('Purpur did not publish a checksummed build');
  const url = `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(versionId)}/${encodeURIComponent(latest.build)}/download`;
  await downloadVerified(url, path.join(dir, 'server.jar'), { algorithm: 'md5', expected: latest.md5 }, JAR_LIMIT);
}

const BUILD_TOOLS_URL = 'https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar';
/** Pinned from that URL on 2026-11-15. A newer BuildTools jar fails closed until this pin is updated. */
const BUILD_TOOLS_SHA256 = '81ed06f5ce5fb705b558bf9b3cc2c5c53cdd9742406c5338c452faa13a1e1c24';

export async function installSpigot(dir: string, versionId: string, javaBin: string, cacheRoot: string): Promise<void> {
  try {
    resolveExecutable('git');
  } catch {
    throw new Error('Spigot is compiled on this machine with BuildTools, which needs Git. Install Git, or choose Paper.');
  }
  const cache = path.join(cacheRoot, 'spigot', versionId);
  fs.mkdirSync(cache, { recursive: true });
  const built = path.join(cache, `spigot-${versionId}.jar`);
  if (!fs.existsSync(built)) {
    const tools = path.join(cacheRoot, 'spigot', 'BuildTools.jar');
    fs.mkdirSync(path.dirname(tools), { recursive: true });
    if (!fs.existsSync(tools)) {
      try {
        await downloadVerified(BUILD_TOOLS_URL, tools, { algorithm: 'sha256', expected: BUILD_TOOLS_SHA256 }, 20 * 1024 * 1024);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'download failed';
        throw new Error(message === 'checksum did not match' ? 'BuildTools.jar no longer matches the checksum Hotbar pinned' : message);
      }
    }
    const result = await run([javaBin, '-jar', tools, '--rev', versionId, '--compile', 'SPIGOT'], cache, { timeoutMs: 20 * 60 * 1000 });
    if (result.code !== 0 || !fs.existsSync(built)) {
      throw new Error(lastUsefulLine(result.stderr, result.stdout) || 'BuildTools did not produce a Spigot jar');
    }
  }
  fs.copyFileSync(built, path.join(dir, 'server.jar'));
}

interface QuiltInstaller {
  version: string;
  url?: string;
  hashes?: { sha256?: string };
}

export async function installQuilt(dir: string, versionId: string, javaBin: string): Promise<string> {
  const installers = await fetchJson<QuiltInstaller[]>('https://meta.quiltmc.org/v3/versions/installer');
  const installer = installers[0];
  if (!installer?.url || !installer.hashes?.sha256) throw new Error('Quilt did not publish a checksummed installer');
  const installerJar = path.join(dir, 'quilt-installer.jar');
  await downloadVerified(installer.url, installerJar, { algorithm: 'sha256', expected: installer.hashes.sha256 }, 20 * 1024 * 1024);
  const result = await run(
    [javaBin, '-jar', installerJar, 'install', 'server', versionId, '--download-server', `--install-dir=${dir}`],
    dir,
    { timeoutMs: 10 * 60 * 1000 },
  );
  fs.rmSync(installerJar, { force: true });
  if (result.code !== 0) throw new Error(lastUsefulLine(result.stderr, result.stdout) || 'Quilt installer failed');
  const launch = findNamedFile(dir, 'quilt-server-launch.jar');
  if (!launch) throw new Error('Quilt installer did not write a launch jar');
  return path.relative(dir, launch).split('\\').join('/');
}

export async function installForge(dir: string, versionId: string, javaBin: string, memoryMb: number): Promise<string> {
  const payload = await fetchJson<{ promos?: Record<string, string> }>('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
  const promos = payload.promos ?? {};
  const forgeVersion = promos[`${versionId}-recommended`] ?? promos[`${versionId}-latest`];
  if (!forgeVersion) throw new Error(`Forge has no build for ${versionId}`);
  return installLoader(dir, javaBin, memoryMb, forgeInstaller(versionId, forgeVersion), 'Forge');
}

export async function installNeoForge(dir: string, versionId: string, javaBin: string, memoryMb: number): Promise<string> {
  const xml = await fetchText('https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml');
  const mojang = mojangVersions(await fetchJson<MojangManifest>(MOJANG_MANIFEST), true);
  const build = neoforgeVersions(mavenVersions(xml), mojang).buildFor[versionId];
  if (!build) throw new Error(`NeoForge has no build for ${versionId}`);
  const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${encodeURIComponent(build)}/neoforge-${encodeURIComponent(build)}-installer.jar`;
  return installLoader(dir, javaBin, memoryMb, url, 'NeoForge');
}

function forgeInstaller(minecraft: string, forge: string): string {
  const version = `${minecraft}-${forge}`;
  return `https://maven.minecraftforge.net/net/minecraftforge/forge/${encodeURIComponent(version)}/forge-${encodeURIComponent(version)}-installer.jar`;
}

async function installLoader(dir: string, javaBin: string, memoryMb: number, installerUrl: string, label: string): Promise<string> {
  const sha1 = firstToken(await fetchText(`${installerUrl}.sha1`));
  const installerJar = path.join(dir, 'installer.jar');
  await downloadVerified(installerUrl, installerJar, { algorithm: 'sha1', expected: sha1 }, 40 * 1024 * 1024);
  const result = await run([javaBin, '-jar', installerJar, '--installServer'], dir, { timeoutMs: 10 * 60 * 1000 });
  fs.rmSync(installerJar, { force: true });
  if (result.code !== 0) throw new Error(lastUsefulLine(result.stderr, result.stdout) || `${label} installer failed`);
  const args = findLaunchArgs(dir);
  if (!args) throw new Error(`${label} did not write a launch file. Hotbar will not run the generated script.`);
  fs.writeFileSync(path.join(dir, 'user_jvm_args.txt'), jvmArgsFile(memoryMb));
  return path.relative(dir, args).split('\\').join('/');
}

function findLaunchArgs(dir: string): string | null {
  const preferred = process.platform === 'win32' ? 'win_args.txt' : 'unix_args.txt';
  const fallback = preferred === 'win_args.txt' ? 'unix_args.txt' : 'win_args.txt';
  return findNamedFile(dir, preferred) ?? findNamedFile(dir, fallback);
}

function firstToken(value: string): string {
  const token = value.trim().split(/\s+/)[0];
  if (!token) throw new Error('checksum file was empty');
  return token;
}

function lastUsefulLine(stderr: string, stdout: string): string {
  const lines = `${stderr}\n${stdout}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? '';
}
