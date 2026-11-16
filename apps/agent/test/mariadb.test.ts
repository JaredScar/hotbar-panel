import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabaseSql, dropDatabaseSql, rotatePasswordSql, serverDatabaseName } from '../dist/mariadb.js';

const password = 'abcDEF123_-xyzUVW4567';

test('server database names stay inside letters, numbers, and underscores', () => {
  assert.equal(serverDatabaseName('ac42f7a0-096b-45b1-8223-f7d7c970271f', 'game'), 'hb_ac42f7a0_game');
  assert.throws(() => serverDatabaseName('ac42f7a0-096b-45b1-8223-f7d7c970271f', 'game;drop'));
  assert.throws(() => serverDatabaseName('short', 'game'));
});

test('database sql quotes identifiers and rejects a password with a quote', () => {
  const created = createDatabaseSql('hb_ac42f7a0_game', password);
  assert.match(created, /CREATE DATABASE IF NOT EXISTS `hb_ac42f7a0_game`/);
  assert.match(created, /IDENTIFIED BY 'abcDEF123_-xyzUVW4567'/);
  assert.match(rotatePasswordSql('hb_ac42f7a0_game', password), /ALTER USER 'hb_ac42f7a0_game'@'%'/);
  assert.match(dropDatabaseSql('hb_ac42f7a0_game'), /DROP DATABASE IF EXISTS `hb_ac42f7a0_game`/);
  assert.throws(() => createDatabaseSql('hb_ac42f7a0_game', "quote'break"));
  assert.throws(() => createDatabaseSql('bad-name', password));
});
