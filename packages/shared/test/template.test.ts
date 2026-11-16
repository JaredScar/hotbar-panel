import assert from 'node:assert/strict';
import { test } from 'node:test';
import { substituteCommand } from '../src/args.ts';
import { validateTemplate } from '../src/template.ts';
import { assessZipEntries } from '../src/zip-guard.ts';
import { hasPermission } from '../src/permissions.ts';

const fivem = {
  id: 'fivem',
  version: 1,
  group: 'gta',
  name: 'FiveM',
  runtimes: {
    docker: { image: 'hotbar/fxserver:latest' },
    process: { os: ['windows', 'linux'] },
  },
  variables: [
    { key: 'LICENSE_KEY', label: 'Cfx.re license key', secret: true, required: true },
    { key: 'MAX_PLAYERS', label: 'Max players', type: 'int', default: 48 },
  ],
  ports: [{ name: 'game', default: 30120, protocols: ['tcp', 'udp'] }],
  install: [
    { step: 'download-fxserver-artifact', channel: 'recommended' },
    { step: 'write-file', path: 'server.cfg', from: 'templates/server.cfg.hbs' },
  ],
  startup: {
    command: ['FXServer', '+exec', 'server.cfg', '+set', 'sv_licenseKey', '${LICENSE_KEY}'],
    ready_when: { log_matches: 'server license key authentication succeeded' },
  },
  stop: { stdin: 'quit', timeout_s: 30, then: 'kill' },
  ui_plugins: ['fivem-resources'],
};

test('accepts the FiveM template shape', () => {
  const result = validateTemplate(fivem);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.usesShell, false);
});

test('rejects shell steps unless the template is explicitly marked', () => {
  const rejected = validateTemplate({
    ...fivem,
    install: [{ step: 'shell', script: 'echo hi' }],
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.usesShell, true);

  const allowed = validateTemplate({
    ...fivem,
    id: 'custom-shell',
    allow_shell: true,
    install: [{ step: 'shell', script: 'echo hi' }],
  });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.usesShell, true);
});

test('rejects unknown install steps', () => {
  const result = validateTemplate({
    ...fivem,
    install: [{ step: 'rm-rf' }],
  });
  assert.equal(result.ok, false);
});

test('substitutes variables inside a single argument', () => {
  const command = substituteCommand(['java', '-jar', '${JAR}', '${NOTE}'], {
    JAR: 'server.jar',
    NOTE: 'hello; rm -rf /',
  });
  assert.deepEqual(command, ['java', '-jar', 'server.jar', 'hello; rm -rf /']);
  assert.equal(command.length, 4);
});

test('permission check is exact, with a full-access principal', () => {
  assert.equal(hasPermission({ id: 'local', permissions: '*' }, 'control.start'), true);
  assert.equal(
    hasPermission({ id: 'limited', permissions: ['server.read'] }, 'control.start'),
    false,
  );
  assert.equal(hasPermission({ id: 'limited', permissions: ['server.read'] }, 'server.read'), true);
});

test('zip guard rejects traversal, too many entries, and huge uncompressed sizes', () => {
  assert.equal(assessZipEntries([{ name: 'plugins/foo.jar', uncompressedBytes: 100 }]).ok, true);
  assert.equal(assessZipEntries([{ name: '../secret.txt', uncompressedBytes: 10 }]).ok, false);
  assert.equal(assessZipEntries([{ name: 'C:/Windows/system.ini', uncompressedBytes: 10 }]).ok, false);
  const many = Array.from({ length: 10_001 }, (_, index) => ({ name: `${index}.txt`, uncompressedBytes: 1 }));
  assert.equal(assessZipEntries(many).ok, false);
  assert.equal(
    assessZipEntries([{ name: 'big.bin', uncompressedBytes: 3 * 1024 * 1024 * 1024 }]).ok,
    false,
  );
});
