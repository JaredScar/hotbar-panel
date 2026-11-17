import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chooseReleaseFile, isNewer, isOfficialDownload, isReleaseRedirect } from '../src/release.ts';

const version = '0.1.5';
const sha = 'a'.repeat(64);

function asset(name: string, host = 'github.com'): { name: string; browser_download_url: string; digest: string } {
  return {
    name,
    browser_download_url: `https://${host}/JaredScar/hotbar-panel/releases/download/v${version}/${name}`,
    digest: `sha256:${sha}`,
  };
}

test('a newer three-part version is an update', () => {
  assert.equal(isNewer('0.1.5', '0.1.4'), true);
  assert.equal(isNewer('0.2.0', '0.1.9'), true);
  assert.equal(isNewer('v0.1.5', '0.1.5'), false);
  assert.equal(isNewer('0.1.4', '0.1.5'), false);
  assert.equal(isNewer('latest', '0.1.5'), false);
});

test('the windows installer is chosen from the official release', () => {
  const chosen = chooseReleaseFile([
    asset('Hotbar-0.1.5-arm64.dmg'),
    asset('Hotbar.Setup.0.1.5.exe'),
    asset('hotbar-0.1.5-amd64.deb'),
  ], 'win32', 'x64', version);
  assert.equal(chosen?.name, 'Hotbar.Setup.0.1.5.exe');
  assert.equal(chosen?.sha256, sha);
});

test('a release file from another site is ignored', () => {
  assert.equal(isOfficialDownload('https://example.com/Hotbar.Setup.0.1.5.exe', version, 'Hotbar.Setup.0.1.5.exe'), false);
  assert.equal(isOfficialDownload('http://github.com/JaredScar/hotbar-panel/releases/download/v0.1.5/Hotbar.Setup.0.1.5.exe', version, 'Hotbar.Setup.0.1.5.exe'), false);
  assert.equal(chooseReleaseFile([asset('Hotbar.Setup.0.1.5.exe', 'example.com')], 'win32', 'x64', version), null);
  assert.equal(chooseReleaseFile([{ name: '../Hotbar.Setup.0.1.5.exe', browser_download_url: 'https://github.com/JaredScar/hotbar-panel/releases/download/v0.1.5/Hotbar.Setup.0.1.5.exe', digest: `sha256:${sha}` }], 'win32', 'x64', version), null);
});

test('a download may only be redirected to GitHub', () => {
  assert.equal(isReleaseRedirect('https://release-assets.githubusercontent.com/github-production-release-asset/file'), true);
  assert.equal(isReleaseRedirect('https://objects.githubusercontent.com/file'), true);
  assert.equal(isReleaseRedirect('https://evil.example/file'), false);
  assert.equal(isReleaseRedirect('http://github.com/file'), false);
});
