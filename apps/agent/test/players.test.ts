import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { playerCommand, readSavedPlayers } from '../dist/minecraft/players.js';

test('saved player files mark operators, the whitelist, and bans', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-players-'));
  fs.writeFileSync(path.join(root, 'server.properties'), 'white-list=true\nmax-players=20\n');
  fs.writeFileSync(path.join(root, 'ops.json'), JSON.stringify([{ name: 'Steve', level: 4 }]));
  fs.writeFileSync(path.join(root, 'whitelist.json'), JSON.stringify([{ name: 'Alex' }]));
  fs.writeFileSync(path.join(root, 'banned-players.json'), JSON.stringify([{ name: 'Notch', reason: 'griefing' }]));
  fs.writeFileSync(path.join(root, 'usercache.json'), JSON.stringify([{ name: 'Alex' }, { name: 'Steve\nkick' }]));
  const saved = readSavedPlayers(root);
  assert.equal(saved.whitelist, true);
  assert.equal(saved.max, 20);
  assert.deepEqual(saved.ops, ['Steve']);
  assert.deepEqual(saved.whitelisted, ['Alex']);
  assert.deepEqual(saved.banned, [{ name: 'Notch', reason: 'griefing' }]);
  assert.deepEqual(saved.known, ['Alex']);
});

test('a player action cannot smuggle a second command', () => {
  assert.equal(playerCommand('kick', 'Steve', 'camping the portal'), 'kick Steve camping the portal');
  assert.equal(playerCommand('whitelist-on', '', ''), 'whitelist on');
  assert.throws(() => playerCommand('kick', 'Steve\npardon Notch', ''));
  assert.throws(() => playerCommand('op', 'Steve Ban', ''));
  assert.throws(() => playerCommand('explode', 'Steve', ''));
});
