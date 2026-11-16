import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { eggToTemplate } from '../dist/eggs.js';
import { listFiles, writeFileText } from '../dist/files.js';
import { cronMatches, pruneBackupFiles } from '../dist/minecraft/backup.js';
import { addonFacets, addonSlot, pickAddonJar, safeJarName, serverPackFiles } from '../dist/modrinth.js';
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

test('an update without a signature is refused', () => {
  const keys = generateEd25519();
  const manifest = '{"version":"0.1.0"}';
  const signature = sign(null, Buffer.from(manifest), createPrivateKey(keys.privateKey)).toString('base64');
  assert.equal(acceptSignedManifest(manifest, '', keys.publicKey), false);
  assert.equal(acceptSignedManifest(manifest, signature, keys.publicKey), true);
  assert.equal(acceptSignedManifest('{"version":"9.9.9"}', signature, keys.publicKey), false);
});
