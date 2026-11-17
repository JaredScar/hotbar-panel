import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { startAgent } from './app.js';
import { PanelLink } from './panel-link.js';
import { systemdUnit, windowsLogonTaskArgs, quoteWindows, type ServicePlan } from './service.js';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'start';
  if (command === 'service') {
    serviceInstall(process.argv[3] ?? 'plan');
    return;
  }
  if (command === 'link') {
    await linkPanel(process.argv[3] ?? '', process.argv[4] ?? '');
    return;
  }
  if (command !== 'start') {
    console.error('Usage: hotbar-agent start | service plan | service install | link <url> <code>');
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const running = await startAgent(config);
  console.log(`HOTBAR_READY port=${running.port}`);
  process.on('uncaughtException', (error) => {
    console.error('agent kept running after an unexpected error', error instanceof Error ? error.message : 'unknown error');
  });
  process.on('unhandledRejection', (error) => {
    console.error('agent kept running after an unexpected rejection', error instanceof Error ? error.message : 'unknown error');
  });
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    void running.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function serviceInstall(action: string): void {
  const config = loadConfig();
  const scriptPath = fileFromArgv();
  const plan: ServicePlan = {
    nodePath: process.execPath,
    scriptPath,
    dataDir: config.dataDir,
    user: os.userInfo().username,
  };
  if (action === 'install') {
    installService(plan, config.dataDir);
    return;
  }
  if (action !== 'plan') {
    console.error('Usage: hotbar-agent service plan | service install');
    process.exitCode = 1;
    return;
  }
  if (process.platform === 'win32') {
    console.log(['schtasks', ...windowsLogonTaskArgs(plan)].map(quoteIfNeeded).join(' '));
    return;
  }
  const unit = systemdUnit(plan);
  const target = path.join(config.dataDir, 'hotbar-agent.service');
  fs.writeFileSync(target, unit, 'utf8');
  console.log(`Wrote ${target}`);
  console.log('Install it as a user service: systemctl --user enable --now hotbar-agent');
}

function installService(plan: ServicePlan, dataDir: string): void {
  if (process.platform === 'win32') {
    const result = spawnSync('schtasks', windowsLogonTaskArgs(plan), { shell: false, windowsHide: true, encoding: 'utf8' });
    if (result.status === 0) {
      console.log('Hotbar Agent is scheduled to start at logon. Game servers stay up when the window closes.');
      return;
    }
    const startup = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    fs.mkdirSync(startup, { recursive: true });
    const link = path.join(startup, 'Hotbar Agent.lnk');
    const nodeFlags = plan.scriptPath.endsWith('.ts') ? '--experimental-sqlite --experimental-strip-types' : '--experimental-sqlite';
    const script = `
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut(${JSON.stringify(link)})
$shortcut.TargetPath = ${JSON.stringify(plan.nodePath)}
$shortcut.Arguments = ${JSON.stringify(`${nodeFlags} ${quoteWindows(plan.scriptPath)} start`)}
$shortcut.WorkingDirectory = ${JSON.stringify(path.dirname(plan.scriptPath))}
$shortcut.Save()
`;
    const fallback = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { shell: false, windowsHide: true, encoding: 'utf8' });
    if (fallback.status !== 0 || !fs.existsSync(link)) {
      console.error(result.stderr || result.stdout || 'schtasks failed');
      console.error(fallback.stderr || fallback.stdout || 'startup shortcut was not created');
      process.exitCode = 1;
      return;
    }
    console.log(`schtasks could not register HotbarAgent (${(result.stderr || '').trim() || 'access denied'}).`);
    console.log(`The agent starts at logon from ${link}. Game servers stay up when the window closes.`);
    return;
  }
  const unit = systemdUnit(plan);
  const target = path.join(dataDir, 'hotbar-agent.service');
  fs.writeFileSync(target, unit, 'utf8');
  const result = spawnSync('systemctl', ['--user', 'enable', '--now', 'hotbar-agent'], { shell: false, encoding: 'utf8' });
  if (result.status !== 0) {
    console.log(`Wrote ${target}`);
    console.error(result.stderr || 'systemctl could not enable the unit. Copy the file into ~/.config/systemd/user/ and run systemctl --user enable --now hotbar-agent');
    process.exitCode = 1;
    return;
  }
  console.log('Hotbar Agent is enabled as a user service.');
}

async function linkPanel(url: string, code: string): Promise<void> {
  if (!url || !code) {
    console.error('Usage: hotbar-agent link <panel url> <pairing code>');
    process.exitCode = 1;
    return;
  }
  const config = loadConfig();
  const link = new PanelLink(config.dataDir, config.version);
  await link.pair(url, code);
  link.stop();
  console.log(`Linked ${url}`);
}

function fileFromArgv(): string {
  const entry = process.argv[1];
  if (!entry) throw new Error('cannot locate agent entry');
  return path.resolve(entry);
}

function quoteIfNeeded(value: string): string {
  return /[\s"]/u.test(value) ? `"${value}"` : value;
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invoked === import.meta.url) {
  void main();
}
