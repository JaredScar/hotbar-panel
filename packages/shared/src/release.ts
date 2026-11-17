export const RELEASE_REPOSITORY = 'JaredScar/hotbar-panel';

const FILE_NAME = /^[A-Za-z0-9._ ()+-]{1,160}$/;

export interface ReleaseFile {
  name: string;
  url: string;
  sha256: string;
}

export function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewer(latest: string, current: string): boolean {
  const next = parseVersion(latest);
  const have = parseVersion(current);
  if (!next || !have) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== have[index]) return next[index] > have[index];
  }
  return false;
}

export function chooseReleaseFile(
  assets: Array<{ name?: string; browser_download_url?: string; digest?: string | null }>,
  platform: string,
  arch: string,
  version: string,
): ReleaseFile | null {
  const files = assets.flatMap((asset) => {
    const name = asset.name ?? '';
    const url = asset.browser_download_url ?? '';
    const sha256 = readDigest(asset.digest);
    if (!FILE_NAME.test(name) || !sha256) return [];
    if (!name.includes(version)) return [];
    if (!isOfficialDownload(url, version, name)) return [];
    return [{ name, url, sha256 }];
  });
  if (platform === 'win32') return files.find((file) => /\.exe$/i.test(file.name) && /setup/i.test(file.name)) ?? null;
  if (platform === 'darwin') {
    const marker = arch === 'arm64' ? 'arm64' : 'x64';
    return files.find((file) => file.name.endsWith('.dmg') && file.name.includes(marker)) ?? null;
  }
  if (platform === 'linux') {
    const debArch = arch === 'arm64' ? 'arm64' : 'amd64';
    return files.find((file) => file.name.endsWith('.deb') && file.name.includes(debArch))
      ?? files.find((file) => file.name.endsWith('.AppImage'))
      ?? null;
  }
  return null;
}

export function isOfficialDownload(url: string, version: string, filename: string): boolean {
  if (!parseVersion(version) || !FILE_NAME.test(filename)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return false;
  if (parsed.hostname !== 'github.com') return false;
  return decodeURIComponent(parsed.pathname) === `/JaredScar/hotbar-panel/releases/download/v${version}/${filename}`;
}

export function isReleaseRedirect(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
  return parsed.hostname === 'github.com'
    || parsed.hostname === 'release-assets.githubusercontent.com'
    || parsed.hostname === 'objects.githubusercontent.com';
}

function readDigest(digest: string | null | undefined): string | null {
  const match = /^sha256:([a-f0-9]{64})$/i.exec(digest?.trim() ?? '');
  return match ? match[1].toLowerCase() : null;
}
