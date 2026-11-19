import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'notify.ps1');

export function notifyDesktop(title: string, body: string): void {
  if (process.env.HOTBAR_DESKTOP === '1') return;
  const safeTitle = clip(title);
  const safeBody = clip(body);
  if (process.platform === 'win32') {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, safeTitle, safeBody], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }
  const child = spawn('notify-send', [safeTitle, safeBody], { shell: false, stdio: 'ignore' });
  child.unref();
  child.on('error', () => undefined);
}

function clip(value: string): string {
  return value.replace(/[^\w .,:;!?'()\-]/g, '').slice(0, 160) || 'Hotbar';
}
