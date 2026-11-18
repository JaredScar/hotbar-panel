import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PROPERTY_FIELDS, checkPropertyValue } from '../src/server-properties.ts';

test('the properties form covers the usual server settings', () => {
  const keys = new Set(PROPERTY_FIELDS.map((field) => field.key));
  for (const key of ['motd', 'view-distance', 'simulation-distance', 'pvp', 'enable-rcon', 'rcon.password', 'white-list', 'resource-pack', 'hardcore']) {
    assert.equal(keys.has(key), true, key);
  }
  assert.ok(PROPERTY_FIELDS.length >= 40);
});

test('a property value is checked before it is written', () => {
  assert.equal(checkPropertyValue('view-distance', '12'), null);
  assert.match(checkPropertyValue('gamemode', 'potato') ?? '', /Gamemode/);
  assert.match(checkPropertyValue('motd', 'line\n2') ?? '', /one line/);
  assert.match(checkPropertyValue('not a key', 'x') ?? '', /not valid/);
});
