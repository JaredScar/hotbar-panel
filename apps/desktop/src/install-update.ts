import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WINDOWS_HELPER = `import { spawn } from 'node:child_process';
const installer = process.argv[2];
setTimeout(() => {
  const child = spawn(installer, ['/S'], { detached: true, stdio: 'ignore', windowsHide: false, shell: false });
  child.unref();
}, 2000);
`;

export function handOffInstaller(installer: string, execPath: string, tempDir: string): void {
  if (process.platform === 'win32') {
    const helper = path.join(tempDir, 'hotbar-update.mjs');
    fs.writeFileSync(helper, WINDOWS_HELPER, 'utf8');
    const child = spawn(execPath, [helper, installer], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    child.unref();
    return;
  }
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(opener, [installer], { detached: true, stdio: 'ignore', shell: false });
  child.unref();
}
