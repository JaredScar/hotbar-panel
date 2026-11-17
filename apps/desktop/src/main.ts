import crypto from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, Tray, ipcMain, session, type WebContents } from 'electron';
import { defaultDataDir } from '@hotbar/shared/node';
import { appIcon, trayIcon } from './icon.js';
import { handOffInstaller } from './install-update.js';
import { downloadRelease, fetchLatestRelease, type UpdateOffer } from './release-download.js';
import { serveUi } from './ui-server.js';

let uiUrl = process.env.HOTBAR_UI_URL ?? '';
const port = process.env.HOTBAR_PORT ?? '7878';
const agentUrl = `http://127.0.0.1:${port}`;
const dataDir = path.resolve(process.env.HOTBAR_DATA_DIR ?? defaultDataDir());
const token = readToken(dataDir);

let windowRef: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let agentChild: ChildProcess | null = null;
let agentRestarts = 0;
let agentStartedAt = 0;
let updateOffer: UpdateOffer | null = null;
let updateRunning = false;

if (process.env.HOTBAR_ELECTRON_USER_DATA) {
  app.setPath('userData', process.env.HOTBAR_ELECTRON_USER_DATA);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    windowRef?.show();
    windowRef?.focus();
  });
  app.whenReady().then(() => {
    void boot();
  });
}

app.on('before-quit', () => {
  quitting = true;
});

app.on('window-all-closed', () => {
  // The tray process can outlive the window. The agent is a different process.
});

async function boot(): Promise<void> {
  if (process.env.HOTBAR_DESKTOP_QUIT === '1') {
    app.quit();
    return;
  }
  if (!uiUrl) uiUrl = app.isPackaged ? await serveUi(packagedUiRoot()) : 'http://127.0.0.1:4200';
  installCsp();
  ipcMain.handle('bootstrap', () => ({
    agentUrl,
    token,
    capabilities: { tray: true, notifications: false, openFolder: false },
  }));
  ipcMain.handle('update:check', () => checkForUpdate());
  ipcMain.handle('update:install', (event) => installUpdate(event.sender));
  if (!(await agentIsUp())) ensureAgent();
  await waitForUrl(uiUrl, 60_000);
  createWindow();
  void refreshTray();
  setInterval(() => {
    void refreshTray();
    if (quitting) return;
    void agentIsUp().then((up) => {
      if (!up) ensureAgent();
    });
  }, 2000);
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1c232e',
    title: 'Hotbar',
    icon: appIcon(),
    webPreferences: {
      preload: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windowRef = win;
  win.once('ready-to-show', () => win.show());
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  void win.loadURL(uiUrl);
}

function installCsp(): void {
  const origin = new URL(uiUrl).origin;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        `default-src 'self' ${origin}; script-src 'self' 'unsafe-inline' 'unsafe-eval' ${origin}; style-src 'self' 'unsafe-inline' ${origin}; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*; img-src 'self' data: ${origin}; font-src 'self' data:`,
      ],
    };
    callback({ responseHeaders });
  });
}

async function checkForUpdate(): Promise<{ current: string; latest: string; available: boolean; releaseUrl: string | null; packaged: boolean }> {
  const current = app.getVersion();
  const offer = await fetchLatestRelease(current, process.platform, process.arch);
  updateOffer = offer;
  return {
    current,
    latest: offer.latest || current,
    available: offer.available,
    releaseUrl: offer.releaseUrl,
    packaged: app.isPackaged,
  };
}

async function installUpdate(sender: WebContents): Promise<{ replacing: boolean }> {
  if (!app.isPackaged) throw new Error('Install the Hotbar setup program to update from here.');
  if (updateRunning) throw new Error('An update is already downloading.');
  updateRunning = true;
  try {
    const offer = updateOffer?.file ? updateOffer : await fetchLatestRelease(app.getVersion(), process.platform, process.arch);
    if (!offer.file) throw new Error('Hotbar is already up to date.');
    const destination = path.join(app.getPath('temp'), offer.file.name);
    await downloadRelease(offer.file, destination, (received, total) => {
      if (!sender.isDestroyed()) sender.send('update:progress', { received, total });
    });
    handOffInstaller(destination, process.execPath, app.getPath('temp'));
    const replacing = process.platform === 'win32';
    if (replacing) {
      quitting = true;
      app.quit();
    }
    return { replacing };
  } finally {
    updateRunning = false;
  }
}

function packagedUiRoot(): string {
  return path.join(process.resourcesPath, 'ui');
}

async function refreshTray(): Promise<void> {
  const servers = await listServers();
  const icon = trayIcon();
  if (!tray) {
    tray = new Tray(icon);
    tray.setToolTip('Hotbar');
    tray.on('click', () => {
      windowRef?.show();
      windowRef?.focus();
    });
  } else {
    tray.setImage(icon);
  }
  const serverItems = servers.map((server) => ({
    label: `${server.name} (${server.state})`,
    submenu: [
      {
        label: 'Start',
        enabled: server.state === 'offline',
        click: () => {
          void power(server.id, 'start');
        },
      },
      {
        label: 'Stop',
        enabled: server.state !== 'offline',
        click: () => {
          void power(server.id, 'stop');
        },
      },
    ],
  }));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open Hotbar',
        click: () => {
          windowRef?.show();
          windowRef?.focus();
        },
      },
      { type: 'separator' },
      ...(serverItems.length > 0 ? serverItems : [{ label: 'No servers', enabled: false }]),
      { type: 'separator' },
      {
        label: 'Quit window (servers keep running)',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function ensureAgent(): void {
  if (quitting) return;
  if (agentChild && agentChild.exitCode === null) return;
  const now = Date.now();
  if (now - agentStartedAt < 2000) agentRestarts += 1;
  else agentRestarts = 0;
  if (agentRestarts > 5) return;
  agentStartedAt = now;
  const entry = agentLaunch();
  const child = spawn(entry.command, entry.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
    env: entry.env,
  });
  agentChild = child;
  child.on('exit', () => {
    if (agentChild === child) agentChild = null;
    if (quitting) return;
    setTimeout(() => {
      void agentIsUp().then((up) => {
        if (!up) ensureAgent();
      });
    }, 500);
  });
  child.unref();
}

function agentLaunch(): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const agentRoot = app.isPackaged ? path.join(process.resourcesPath, 'agent') : path.resolve(here, '../../agent');
  const compiled = path.join(agentRoot, 'dist', 'index.js');
  const source = path.join(agentRoot, 'src', 'index.ts');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOTBAR_HOST: '127.0.0.1',
    HOTBAR_PORT: port,
    HOTBAR_DATA_DIR: dataDir,
    HOTBAR_TOKEN: token,
  };
  if (app.isPackaged) delete env.HOTBAR_DEV;
  else if (env.HOTBAR_DEV === undefined) env.HOTBAR_DEV = '1';
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  const command = process.execPath;
  if (fs.existsSync(compiled)) return { command, args: ['--experimental-sqlite', compiled, 'start'], env };
  if (app.isPackaged) throw new Error('The Hotbar agent is missing from this installation.');
  return { command, args: ['--experimental-sqlite', '--experimental-strip-types', source, 'start'], env };
}

async function agentIsUp(): Promise<boolean> {
  try {
    const response = await fetch(`${agentUrl}/api/health`, { headers: { authorization: `Bearer ${token}` } });
    return response.ok;
  } catch {
    return false;
  }
}

async function listServers(): Promise<Array<{ id: string; name: string; state: string }>> {
  try {
    const response = await fetch(`${agentUrl}/api/servers`, { headers: { authorization: `Bearer ${token}` } });
    if (!response.ok) return [];
    return (await response.json()) as Array<{ id: string; name: string; state: string }>;
  } catch {
    return [];
  }
}

async function power(id: string, action: 'start' | 'stop'): Promise<void> {
  await fetch(`${agentUrl}/api/servers/${id}/power`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
  await refreshTray();
}

function readToken(dir: string): string {
  if (process.env.HOTBAR_TOKEN) return process.env.HOTBAR_TOKEN;
  const tokenPath = path.join(dir, 'agent.token');
  if (fs.existsSync(tokenPath)) return fs.readFileSync(tokenPath, 'utf8').trim();
  if (!app.isPackaged) return 'dev-local-token';
  fs.mkdirSync(dir, { recursive: true });
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(tokenPath, `${generated}\n`, { encoding: 'utf8', mode: 0o600 });
  return generated;
}

async function waitForUrl(target: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(target);
      if (response.ok) return;
    } catch {
      // the dev server is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Timed out waiting for ${target}`);
}
