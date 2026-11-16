import assert from 'node:assert/strict';
import { test } from 'node:test';
import { minecraftCommand } from '../dist/minecraft/launch.js';
import { assertAllowedUrl, digestMatches } from '../dist/minecraft/net.js';
import { parseProperties, updateProperties } from '../dist/minecraft/properties.js';
import { assertFivemUrl, fivemArtifact } from '../dist/minecraft/games.js';
import { argfileCommand } from '../dist/minecraft/launch.js';
import {
  fabricVersions,
  forgeVersions,
  mavenVersions,
  mojangVersions,
  neoforgeMinecraftId,
  neoforgeVersions,
  paperVersions,
  purpurVersions,
  spigotVersions,
} from '../dist/minecraft/providers.js';

test('provider lists keep the upstream order and can hide unstable versions', () => {
  const paper = paperVersions({ versions: { '26.3': ['26.3', '26.3-rc-1'], '1.21': ['1.21.11'] } }, false);
  assert.deepEqual(
    paper.map((version) => version.id),
    ['26.3', '1.21.11'],
  );
  const withSnapshots = paperVersions({ versions: { '26.3': ['26.3', '26.3-rc-1'] } }, true);
  assert.equal(withSnapshots[1]?.id, '26.3-rc-1');

  const mojang = mojangVersions(
    {
      versions: [
        { id: '26.3', type: 'release' },
        { id: '26.4-snapshot-8', type: 'snapshot' },
      ],
    },
    false,
  );
  assert.deepEqual(mojang, [{ id: '26.3', stable: true }]);

  const fabric = fabricVersions(
    [
      { version: '26.3', stable: true },
      { version: '26.4-snapshot', stable: false },
    ],
    false,
  );
  assert.deepEqual(fabric, [{ id: '26.3', stable: true }]);
});

test('server.properties edits keep comments and unknown keys', () => {
  const updated = updateProperties('# comment\nfoo=1\nmotd=old\n', { motd: 'new', 'max-players': '10' });
  assert.match(updated, /^# comment\nfoo=1\nmotd=new\n/);
  assert.match(updated, /max-players=10/);
  assert.equal(parseProperties(updated).foo, '1');
  assert.equal(parseProperties(updated).motd, 'new');
  assert.throws(() => updateProperties('', { 'bad key': 'x' }));
  assert.throws(() => updateProperties('', { motd: 'line\nbreak' }));
});

test('the launch command is an argument array', () => {
  const command = minecraftCommand('C:\\Java\\bin\\java.exe', 4096, 'server.jar');
  assert.equal(command[0], 'C:\\Java\\bin\\java.exe');
  assert.equal(command.at(-1), 'nogui');
  assert.equal(command.at(-2), 'server.jar');
  assert.ok(command.includes('-Xmx3584M'));
  assert.equal(command.some((part) => part.includes(' && ')), false);
});

test('plugin and mod loaders keep the publisher order with the newest first', () => {
  assert.deepEqual(
    purpurVersions(['1.14.1', '1.21.11', '26.3'], false).map((version) => version.id),
    ['26.3', '1.21.11', '1.14.1'],
  );
  const spigot = spigotVersions('<a href="latest.json"></a><a href="1.8.json"></a><a href="26.3.json"></a>');
  assert.deepEqual(
    spigot.map((version) => version.id),
    ['26.3', '1.8'],
  );
  const forge = forgeVersions({ '1.20.1-latest': '47.0.1', '1.20.1-recommended': '47.0.0', '26.3-recommended': '66.1.8' }, false);
  assert.deepEqual(
    forge.map((version) => version.id),
    ['26.3', '1.20.1'],
  );
  assert.equal(neoforgeMinecraftId('26.3.0.103'), '26.3');
  assert.equal(neoforgeMinecraftId('21.1.266'), '1.21.1');
  assert.equal(neoforgeMinecraftId('21.0.5'), '1.21');
  assert.equal(neoforgeMinecraftId('nope'), null);
  const neo = neoforgeVersions(
    mavenVersions('<versions><version>21.1.1</version><version>21.1.266</version><version>26.3.0.103</version></versions>'),
    [
      { id: '26.3', stable: true },
      { id: '1.21.1', stable: true },
    ],
  );
  assert.equal(neo.buildFor['1.21.1'], '21.1.266');
  assert.deepEqual(
    neo.versions.map((version) => version.id),
    ['26.3', '1.21.1'],
  );
});

test('FiveM only accepts the official artifact path', () => {
  const artifact = fivemArtifact(
    {
      recommended: '38435',
      recommended_download: 'https://runtime.fivem.net/artifacts/fivem/build_server_windows/master/38435-5c3065c261fb3ba82032fee6803f247198fec221/server.zip',
    },
    'recommended',
  );
  assert.equal(artifact.id, '38435');
  assert.throws(() => assertFivemUrl('https://example.com/server.zip'));
});

test('mod loader launch stays an argument array', () => {
  const command = argfileCommand('java', 'libraries/win_args.txt');
  assert.equal(command[1], '@user_jvm_args.txt');
  assert.equal(command[2], '@libraries/win_args.txt');
  assert.equal(command.at(-1), 'nogui');
  assert.equal(command.some((part) => part.includes(' && ')), false);
});

test('downloads refuse a host that is not on the list', () => {
  assert.equal(digestMatches('AbC', 'abc'), true);
  assert.equal(digestMatches('abc', 'abd'), false);
  assert.doesNotThrow(() => assertAllowedUrl('https://fill.papermc.io/v3/projects/paper'));
  assert.doesNotThrow(() => assertAllowedUrl('https://api.purpurmc.org/v2/purpur'));
  assert.doesNotThrow(() => assertAllowedUrl('https://runtime.fivem.net/artifacts/fivem/server.zip'));
  assert.doesNotThrow(() => assertAllowedUrl('https://downloader.hytale.com/hytale-downloader.zip'));
  assert.throws(() => assertAllowedUrl('http://fill.papermc.io/v3/projects/paper'));
  assert.throws(() => assertAllowedUrl('https://evil.example/paper.jar'));
});
