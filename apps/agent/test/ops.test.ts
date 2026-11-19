import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { eggToTemplate } from '../dist/eggs.js';
import { listFiles, writeFileText } from '../dist/files.js';
import { cronMatches, pruneBackupFiles } from '../dist/minecraft/backup.js';
import { parseTarListLine, replaceWorldFolder, worldFolderName, worldRootIn, zipFolder, unzipFile } from '../dist/archive.js';
import { addonFacets, addonSlot, chooseAddonUpdates, pickAddonJar, safeJarName, serverPackFiles } from '../dist/modrinth.js';
import { acceptSignedManifest } from '../dist/updates.js';
import { generateEd25519 } from '../dist/sign.js';
import { createPrivateKey, sign } from 'node:crypto';

test('cron matches minute and hour and ignores other fields when starred', () => {
  const date = new Date(2026, 10, 15, 4, 0, 30);
  assert.equal(cronMatches('0 4 * * *', date), true);
  assert.equal(cronMatches('15 4 * * *', date), false);
});

test('backup prune keeps the newest seven names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-backups-'));
  for (let index = 0; index < 9; index += 1) fs.writeFileSync(path.join(dir, `2026-01-0${index}.zip`), 'x');
  const removed = pruneBackupFiles(dir, 7);
  assert.equal(removed.length, 2);
  assert.equal(fs.readdirSync(dir).length, 7);
});

test('file listing stays inside the server folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-files-'));
  writeFileText(root, 'hello.txt', 'hi');
  const listed = listFiles(root, '');
  assert.equal(listed[0]?.name, 'hello.txt');
  assert.throws(() => listFiles(root, '../'));
});

test('modpack filter drops client-only files and paths that escape', () => {
  const kept = serverPackFiles([
    { path: 'mods/a.jar', hashes: { sha1: 'abc' }, downloads: ['https://cdn.modrinth.com/a.jar'], env: { server: 'required' } },
    { path: 'mods/b.jar', hashes: { sha1: 'def' }, downloads: ['https://cdn.modrinth.com/b.jar'], env: { server: 'unsupported' } },
    { path: '../secret.jar', hashes: { sha1: 'fff' }, downloads: ['https://cdn.modrinth.com/c.jar'] },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.path, 'mods/a.jar');
});

test('addon install picks a checksummed jar for the server loader', () => {
  assert.equal(addonSlot('vanilla'), null);
  assert.equal(addonSlot('paper')?.folder, 'plugins');
  assert.equal(addonSlot('fabric')?.folder, 'mods');
  assert.deepEqual(addonFacets(addonSlot('paper')!, '26.3')[0], ['project_type:plugin']);
  assert.equal(safeJarName('LuckPerms.jar'), 'LuckPerms.jar');
  assert.equal(safeJarName('../LuckPerms.jar'), null);
  const chosen = pickAddonJar([
    { files: [{ url: 'https://example.com/evil.jar', filename: 'evil.jar', hashes: { sha1: 'bad' }, primary: true }] },
    { files: [{ url: 'https://cdn.modrinth.com/data/abc/versions/def/LuckPerms.jar', filename: 'LuckPerms.jar', hashes: { sha1: 'abc' } }] },
  ]);
  assert.equal(chosen?.filename, 'LuckPerms.jar');
  assert.equal(chosen?.sha1, 'abc');
});

test('egg conversion refuses to run a shell startup', () => {
  const converted = eggToTemplate({
    name: 'Example',
    startup: 'java -jar server.jar && rm -rf /',
    docker_images: { Java: 'ghcr.io/example/java:25' },
    variables: [{ env_variable: 'SERVER_JARFILE', name: 'Jar', default_value: 'server.jar' }],
  });
  assert.equal(converted.template.startup.command[0], 'echo');
  assert.equal(converted.template.variables?.[0]?.key, 'SERVER_JARFILE');
  assert.ok(converted.notes.some((note) => note.includes('shell')));
});

test('addon update check keeps jars that are behind Modrinth', () => {
  const updates = chooseAddonUpdates(
    [{ filename: 'LuckPerms.jar', hash: 'abc' }],
    { abc: { id: 'old', project_id: 'luck', version_number: '5.4' } },
    { abc: { id: 'new', project_id: 'luck', version_number: '5.5' } },
  );
  assert.equal(updates.length, 1);
  assert.equal(updates[0]?.latestVersion, '5.5');
  assert.equal(chooseAddonUpdates(
    [{ filename: 'LuckPerms.jar', hash: 'abc' }],
    { abc: { id: 'same', version_number: '5.5' } },
    { abc: { id: 'same', project_id: 'luck', version_number: '5.5' } },
  ).length, 0);
});

test('a world zip is recognized and can replace the world folder', async () => {
  assert.equal(worldRootIn(['level.dat', 'region/r.0.0.mca']), '');
  assert.equal(worldRootIn(['world/level.dat', 'world/region/r.0.0.mca']), 'world');
  assert.equal(worldRootIn(['notes.txt']), null);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-world-'));
  fs.writeFileSync(path.join(root, 'server.properties'), 'level-name=earth\n');
  assert.equal(worldFolderName(root), 'earth');
  const world = path.join(root, 'earth');
  fs.mkdirSync(world);
  fs.writeFileSync(path.join(world, 'level.dat'), 'old');
  const packed = path.join(root, 'earth.zip');
  const listed = parseTarListLine('-rw-rw-rw-  0 0      0           4 Nov 19 01:00 level.dat');
  assert.equal(listed?.name, 'level.dat');
  assert.equal(listed?.uncompressedBytes, 4);
  const zipped = await zipFolder(root, 'earth');
  assert.equal(zipped, 'earth.zip');
  fs.rmSync(world, { recursive: true });
  await unzipFile(root, 'earth.zip');
  assert.equal(fs.readFileSync(path.join(root, 'earth', 'level.dat'), 'utf8'), 'old');
  const replacement = fs.readFileSync(packed);
  fs.writeFileSync(path.join(root, 'incoming.zip'), replacement);
  await replaceWorldFolder(root, 'earth', fs.readFileSync(path.join(root, 'incoming.zip')));
  assert.equal(fs.existsSync(path.join(root, 'earth', 'level.dat')), true);
});

test('an update without a signature is refused', () => {
  const keys = generateEd25519();
  const manifest = '{"version":"0.1.0"}';
  const signature = sign(null, Buffer.from(manifest), createPrivateKey(keys.privateKey)).toString('base64');
  assert.equal(acceptSignedManifest(manifest, '', keys.publicKey), false);
  assert.equal(acceptSignedManifest(manifest, signature, keys.publicKey), true);
  assert.equal(acceptSignedManifest('{"version":"9.9.9"}', signature, keys.publicKey), false);
});
