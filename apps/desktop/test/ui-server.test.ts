import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveUiFile, serveUi } from '../dist/ui-server.js';

test('the packaged UI serves the app and falls back to the shell for routes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-ui-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<title>Hotbar</title>');
  fs.writeFileSync(path.join(root, 'main.js'), 'console.log(1)');

  assert.equal(path.basename(resolveUiFile(root, '/').file), 'index.html');
  assert.equal(path.basename(resolveUiFile(root, '/server/abc/files').file), 'index.html');
  assert.equal(resolveUiFile(root, '/main.js').missing, false);
  assert.equal(resolveUiFile(root, '/missing.js').missing, true);
  assert.equal(resolveUiFile(root, '/../secret.txt').missing, true);

  const url = await serveUi(root);
  const page = await fetch(new URL('/create', url));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Hotbar/);
  const missing = await fetch(new URL('/missing.js', url));
  assert.equal(missing.status, 404);
});
