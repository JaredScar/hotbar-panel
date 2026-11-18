import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isPlayerName, parseOnlineList, parsePresence } from '../src/players.ts';

test('the list reply names the players who are online', () => {
  const paper = parseOnlineList('[12:00:00 INFO]: There are 2 of a max of 20 players online: Steve, Alex');
  assert.deepEqual(paper, { online: 2, max: 20, names: ['Steve', 'Alex'] });
  const vanilla = parseOnlineList('[12:00:00] [Server thread/INFO]: There are 1 of a max of 20 players online: Notch');
  assert.deepEqual(vanilla?.names, ['Notch']);
  const colored = parseOnlineList('§eThere are §a0§e of a max of §a20§e players online:');
  assert.deepEqual(colored, { online: 0, max: 20, names: [] });
  const older = parseOnlineList('There are 1/20 players online: .Steve');
  assert.deepEqual(older?.names, ['.Steve']);
  assert.equal(parseOnlineList('Steve joined the game'), null);
});

test('join and leave lines identify one player', () => {
  assert.deepEqual(parsePresence('[12:00:00 INFO]: Steve joined the game'), { name: 'Steve', online: true });
  assert.deepEqual(parsePresence('Alex left the game'), { name: 'Alex', online: false });
  assert.equal(parsePresence('There are 1 of a max of 20 players online: Steve'), null);
});

test('a player name cannot carry a second command', () => {
  assert.equal(isPlayerName('Steve'), true);
  assert.equal(isPlayerName('.Steve'), true);
  assert.equal(isPlayerName('Steve\nkick Alex'), false);
  assert.equal(isPlayerName('Steve Ban'), false);
});
