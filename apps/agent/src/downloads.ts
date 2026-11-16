import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './errors.js';
import { resolveExecutable } from './executable.js';
import { MARIADB_IMAGE, mariadbImagePresent } from './mariadb.js';
import { downloadCapped } from './minecraft/net.js';

export interface DownloadOffer {
  id: string;
  title: string;
  detail: string;
}

/** Official Windows installer. Docker documents this host and a per-user install that does not need an administrator. */
export const DOCKER_DESKTOP_INSTALLER = 'https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe';
const DOCKER_INSTALLER_LIMIT = 700 * 1024 * 1024;

export function acceptedDownloadIds(body: unknown): Set<string> {
  if (!body || typeof body !== 'object') return new Set();
  const list = (body as { acceptDownloads?: unknown }).acceptDownloads;
  if (!Array.isArray(list)) return new Set();
  return new Set(list.filter((item): item is string => typeof item === 'string'));
}

export function assertDownloadAccepted(body: unknown, offers: DownloadOffer[]): void {
  const accepted = acceptedDownloadIds(body);
  const pending = offers.filter((offer) => !accepted.has(offer.id));
  if (pending.length > 0) throw new HttpError(409, 'Confirm the download before Hotbar starts it.', pending);
}

export function serverDownloadOffer(game: string, provider: string, version: string): DownloadOffer {
  if (game === 'fivem') {
    return {
      id: 'server',
      title: 'FiveM server',
      detail: 'The FXServer build from runtime.fivem.net. Cfx does not publish a checksum. Nothing is downloaded until you agree.',
    };
  }
  if (game === 'hytale') {
    return {
      id: 'server',
      title: 'Hytale server',
      detail: 'The official Hytale downloader. You still sign in when it asks. Nothing is downloaded until you agree.',
    };
  }
  return {
    id: 'server',
    title: `${provider} ${version}`,
    detail: 'The server files and the Java build Mojang lists for this version, if they are not already saved on this computer.',
  };
}

export async function databaseDownloadPlan(): Promise<{ downloads: DownloadOffer[]; blocked: string }> {
  if (!dockerCli()) {
    if (process.platform === 'win32' && process.arch === 'x64') {
      return {
        downloads: [
          {
            id: 'docker',
            title: 'Docker Desktop',
            detail:
              'About 600 MB from desktop.docker.com. Hotbar installs it for this Windows user. No administrator password is required. Start Docker when the installer finishes, then create the database again. MariaDB is a separate download after Docker is running.',
          },
        ],
        blocked: '',
      };
    }
    return {
      downloads: [],
      blocked: 'Docker is not installed. Install Docker Engine for this system, then create the database again.',
    };
  }
  if (!(await dockerEngineRunning())) {
    return {
      downloads: [],
      blocked: 'Docker is installed but not running. Start Docker, then create the database again.',
    };
  }
  if (!(await mariadbImagePresent())) {
    return {
      downloads: [
        {
          id: 'mariadb',
          title: `MariaDB ${MARIADB_IMAGE.split(':')[1] ?? ''}`.trim(),
          detail: `The official ${MARIADB_IMAGE} image. Docker downloads it onto this computer. The database listens only on 127.0.0.1.`,
        },
      ],
      blocked: '',
    };
  }
  return { downloads: [], blocked: '' };
}

export async function installDockerDesktop(dataDir: string): Promise<void> {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new HttpError(400, 'Hotbar downloads Docker Desktop for 64-bit Windows. Install Docker Engine for this system, then try again.');
  }
  const directory = path.join(dataDir, 'installers');
  fs.mkdirSync(directory, { recursive: true });
  const dest = path.join(directory, 'Docker Desktop Installer.exe');
  const existing = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
  if (existing < 500_000_000) await downloadCapped(DOCKER_DESKTOP_INSTALLER, dest, DOCKER_INSTALLER_LIMIT);
  const child = spawn(dest, ['install', '--user'], { shell: false, windowsHide: false, detached: true, stdio: 'ignore' });
  child.unref();
}

function dockerCli(): boolean {
  try {
    resolveExecutable('docker');
    return true;
  } catch {
    return false;
  }
}

async function dockerEngineRunning(): Promise<boolean> {
  const docker = resolveExecutable('docker');
  const result = await run(docker, ['info']);
  return result.code === 0;
}

function run(command: string, args: string[]): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1 }));
  });
}
