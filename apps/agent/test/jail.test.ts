import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { isAllowedOrigin } from '../dist/app.js';
import { PathJailError, resolveInJail } from '../dist/jail.js';
import { redact, secretValues } from '../dist/redact.js';
import { quoteWindows, windowsLogonTaskArgs } from '../dist/service.js';

test('resolveInJail keeps paths inside the root and rejects traversal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-jail-'));
  fs.mkdirSync(path.join(root, 'world'));
  fs.writeFileSync(path.join(root, 'world', 'level.dat'), 'ok');
  try {
    assert.equal(resolveInJail(root, 'world/level.dat'), path.join(fs.realpathSync(root), 'world', 'level.dat'));
    assert.equal(path.basename(resolveInJail(root, 'world/new-file.txt')), 'new-file.txt');
    assert.throws(() => resolveInJail(root, '../outside.txt'), PathJailError);
    assert.throws(() => resolveInJail(root, '..\\..\\Windows'), PathJailError);
    assert.throws(() => resolveInJail(root, 'world/../../outside'), PathJailError);
    assert.throws(() => resolveInJail(root, 'bad\0name'), PathJailError);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveInJail rejects a symlink that points outside the root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-jail-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'nope');
  try {
    fs.symlinkSync(outside, path.join(root, 'link'), 'junction');
  } catch {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
    return;
  }
  try {
    assert.throws(() => resolveInJail(root, 'link/secret.txt'), PathJailError);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('console redaction hides secret-like environment values', () => {
  const secrets = secretValues({ LICENSE_KEY: 'cfx-secret-value', MAX_PLAYERS: '48', NOTE: 'hello' });
  assert.deepEqual(secrets, ['cfx-secret-value']);
  assert.equal(redact('using cfx-secret-value now', secrets), 'using ******** now');
});

test('windows service plan is an argument list and quotes paths with spaces', () => {
  const args = windowsLogonTaskArgs({
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    scriptPath: 'C:\\Hotbar\\agent\\dist\\index.js',
    dataDir: 'C:\\Hotbar Data',
    user: 'hotbar',
  });
  assert.equal(args[0], '/Create');
  assert.ok(args.includes('ONLOGON'));
  assert.equal(quoteWindows('C:\\Program Files\\nodejs\\node.exe'), '"C:\\Program Files\\nodejs\\node.exe"');
  const command = args.at(-1) ?? '';
  assert.match(command, /node\.exe/);
  assert.doesNotMatch(command, /electron/i);
});

test('browser origins are limited to loopback', () => {
  assert.equal(isAllowedOrigin('http://127.0.0.1:4200'), true);
  assert.equal(isAllowedOrigin('http://localhost:4200'), true);
  assert.equal(isAllowedOrigin('https://evil.example'), false);
  assert.equal(isAllowedOrigin('file://unsafe'), false);
});
