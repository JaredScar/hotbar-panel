import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const platforms = {
  win: ['--win', 'nsis'],
  mac: ['--mac', 'dmg'],
  linux: ['--linux', 'deb', 'AppImage'],
};

const platform = process.argv[2] ?? '';
const builderArgs = platforms[platform];
if (!builderArgs) {
  console.error('Usage: node scripts/package-desktop.mjs win|mac|linux');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'apps', 'desktop');
const payload = path.join(desktop, 'build', 'payload');

function run(args, cwd = root, env = process.env) {
  runCommand('pnpm', args, cwd, env);
}

function runCommand(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!process.env.CSC_LINK) process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';

run(['--filter', '@hotbar/shared', 'build']);
run(['--filter', '@hotbar/agent', 'build']);
run(['--filter', '@hotbar/ui', 'build']);
run(['--filter', '@hotbar/desktop', 'build']);

const agentPack = fs.mkdtempSync(path.join(os.tmpdir(), 'hotbar-agent-'));
const sharedVendor = path.join(agentPack, 'vendor', 'shared');
fs.mkdirSync(sharedVendor, { recursive: true });
fs.copyFileSync(path.join(root, 'packages', 'shared', 'package.json'), path.join(sharedVendor, 'package.json'));
fs.cpSync(path.join(root, 'packages', 'shared', 'dist'), path.join(sharedVendor, 'dist'), { recursive: true });
fs.cpSync(path.join(root, 'apps', 'agent', 'dist'), path.join(agentPack, 'dist'), { recursive: true });
const agentPackage = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'agent', 'package.json'), 'utf8'));
delete agentPackage.devDependencies;
delete agentPackage.scripts;
agentPackage.dependencies['@hotbar/shared'] = 'file:./vendor/shared';
fs.writeFileSync(path.join(agentPack, 'package.json'), `${JSON.stringify(agentPackage, null, 2)}\n`);
runCommand('npm', ['install', '--omit=dev', '--ignore-scripts'], agentPack, { ...process.env, CI: 'true' });
const agentOut = path.join(payload, 'agent');
fs.rmSync(agentOut, { recursive: true, force: true });
fs.cpSync(agentPack, agentOut, { recursive: true, dereference: true });
if (!fs.existsSync(path.join(agentOut, 'dist', 'index.js')) || !fs.existsSync(path.join(agentOut, 'node_modules', '@hotbar', 'shared', 'dist', 'index.js'))) {
  console.error('The packaged agent is missing its compiled files.');
  process.exit(1);
}

const uiBuild = path.join(root, 'apps', 'ui', 'dist', 'ui', 'browser');
if (!fs.existsSync(path.join(uiBuild, 'index.html'))) {
  console.error(`Angular build did not write ${uiBuild}`);
  process.exit(1);
}
const uiOut = path.join(payload, 'ui');
fs.rmSync(uiOut, { recursive: true, force: true });
fs.cpSync(uiBuild, uiOut, { recursive: true });

const tag = process.env.GITHUB_REF_NAME ?? '';
const version = tag.startsWith('v') ? tag.slice(1) : '';
if (/^\d+\.\d+\.\d+([-+.][0-9A-Za-z.-]+)?$/.test(version)) {
  builderArgs.push(`--config.extraMetadata.version=${version}`);
}

const gitignore = path.join(root, '.gitignore');
const hiddenGitignore = path.join(root, '.gitignore.pack');
fs.renameSync(gitignore, hiddenGitignore);
try {
  run(['--filter', '@hotbar/desktop', 'exec', '--', 'electron-builder', ...builderArgs]);
} finally {
  fs.renameSync(hiddenGitignore, gitignore);
}
