import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps', 'desktop', 'package.json'));
const electron = require('electron');
const env = {
  ...process.env,
  HOTBAR_DEV: '1',
  HOTBAR_HOST: '127.0.0.1',
  HOTBAR_PORT: '7878',
  HOTBAR_TOKEN: 'dev-local-token',
  HOTBAR_DATA_DIR: path.join(root, '.hotbar-dev'),
  HOTBAR_UI_URL: 'http://127.0.0.1:4200',
};

const children = [];

function prefix(name, chunk) {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (line.trim()) process.stdout.write(`[${name}] ${line}\n`);
  }
}

function start(name, command, args, cwd, childEnv = env) {
  const child = spawn(command, args, { cwd, env: childEnv, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (chunk) => prefix(name, chunk));
  child.stderr?.on('data', (chunk) => prefix(name, chunk));
  child.on('exit', (code) => {
    if (code) process.stdout.write(`[${name}] exited ${code}\n`);
  });
  children.push(child);
  return child;
}

function exec(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, { cwd: root, env, shell: true, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${args.join(' ')} failed`));
    });
  });
}

function stop() {
  for (const child of children) {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  }
}

await exec(['--filter', '@hotbar/shared', 'build']);
await exec(['--filter', '@hotbar/agent', 'build']);
await exec(['--filter', '@hotbar/panel-api', 'build']);
await exec(['--filter', '@hotbar/desktop', 'exec', 'tsc', '-p', 'tsconfig.json']);

const agentDir = path.join(root, 'apps', 'agent');
const uiDir = path.join(root, 'apps', 'ui');
const desktopDir = path.join(root, 'apps', 'desktop');
const panelDir = path.join(root, 'apps', 'panel-api');
start('agent', process.execPath, ['--experimental-sqlite', '--watch', path.join(agentDir, 'dist', 'index.js')], agentDir);
start(
  'agent-build',
  process.execPath,
  [path.join(agentDir, 'node_modules', 'typescript', 'lib', 'tsc.js'), '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'],
  agentDir,
);
start(
  'ui',
  process.execPath,
  [path.join(uiDir, 'node_modules', '@angular', 'cli', 'bin', 'ng.js'), 'serve', '--host', '127.0.0.1', '--port', '4200'],
  uiDir,
);
start('desktop', electron, ['.'], desktopDir);
start(
  'panel',
  process.execPath,
  ['--experimental-sqlite', '--watch', path.join(panelDir, 'dist', 'main.js')],
  panelDir,
  { ...env, PORT: '3000', HOTBAR_PANEL_DATA: path.join(root, '.hotbar-panel') },
);
start(
  'panel-build',
  process.execPath,
  [path.join(panelDir, 'node_modules', 'typescript', 'lib', 'tsc.js'), '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'],
  panelDir,
);

process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});
