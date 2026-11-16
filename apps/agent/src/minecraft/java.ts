import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveExecutable } from '../executable.js';
import { downloadVerified, fetchJson } from './net.js';
import { run } from './network.js';

interface AdoptiumAsset {
  binary?: {
    package?: {
      link?: string;
      checksum?: string;
      name?: string;
    };
  };
}

export async function ensureJava(major: number, cacheRoot: string, log: (message: string) => void): Promise<string> {
  if (!Number.isInteger(major) || major < 8 || major > 64) throw new Error('Java version from Mojang is not usable');
  const home = path.join(cacheRoot, String(major));
  const marker = path.join(home, 'java.path');
  if (fs.existsSync(marker)) {
    const saved = fs.readFileSync(marker, 'utf8').trim();
    if (saved && fs.existsSync(saved)) {
      log(`Using cached Java ${major}`);
      return saved;
    }
  }
  fs.mkdirSync(home, { recursive: true });
  const existing = findJava(home, 0);
  if (existing) {
    fs.writeFileSync(marker, existing);
    log(`Using cached Java ${major}`);
    return existing;
  }
  const osName = adoptiumOs();
  const arch = adoptiumArch();
  log(`Downloading Temurin ${major} for ${osName}`);
  const assets = await fetchJson<AdoptiumAsset[]>(
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jdk&os=${osName}&vendor=eclipse`,
  );
  const pkg = assets[0]?.binary?.package;
  if (!pkg?.link || !pkg.checksum || !pkg.name) throw new Error('Temurin did not return a checksummed package');
  const archive = path.join(home, pkg.name);
  await downloadVerified(pkg.link, archive, { algorithm: 'sha256', expected: pkg.checksum }, 500 * 1024 * 1024);
  const tar = resolveExecutable('tar');
  const extracted = await run([tar, '-xf', archive, '-C', home]);
  fs.rmSync(archive, { force: true });
  if (extracted.code !== 0) throw new Error(extracted.stderr.trim() || 'could not extract Java');
  const binary = findJava(home, 0);
  if (!binary) throw new Error('Java archive did not contain a java binary');
  fs.writeFileSync(marker, binary);
  return binary;
}

function adoptiumOs(): string {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'linux') return 'linux';
  if (process.platform === 'darwin') return 'mac';
  throw new Error(`no Temurin build for ${os.platform()}`);
}

function adoptiumArch(): string {
  if (process.arch === 'x64') return 'x64';
  if (process.arch === 'arm64') return 'aarch64';
  throw new Error(`no Temurin build for ${process.arch}`);
}

function findJava(dir: string, depth: number): string | null {
  if (depth > 4) return null;
  const name = process.platform === 'win32' ? 'java.exe' : 'java';
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'bin') {
      const candidate = path.join(dir, 'bin', name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = findJava(path.join(dir, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}
