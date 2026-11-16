import path from 'node:path';

export interface ServicePlan {
  nodePath: string;
  scriptPath: string;
  dataDir: string;
  user: string;
}

/** Argument array for `schtasks`. The `/TR` value is one command line because the task scheduler stores it that way. Game servers are still spawned with an argument array by the agent. */
export function windowsLogonTaskArgs(plan: ServicePlan): string[] {
  const nodeFlags = plan.scriptPath.endsWith('.ts')
    ? '--experimental-sqlite --experimental-strip-types '
    : '--experimental-sqlite ';
  const command = `${quoteWindows(plan.nodePath)} ${nodeFlags}${quoteWindows(plan.scriptPath)} start`;
  return [
    '/Create',
    '/TN',
    'HotbarAgent',
    '/SC',
    'ONLOGON',
    '/F',
    '/RL',
    'LIMITED',
    '/TR',
    command,
  ];
}

export function systemdUnit(plan: ServicePlan): string {
  const nodeFlags = plan.scriptPath.endsWith('.ts') ? '--experimental-sqlite --experimental-strip-types ' : '--experimental-sqlite ';
  return `[Unit]
Description=Hotbar Agent
After=network.target

[Service]
Type=simple
User=${plan.user}
Environment=HOTBAR_DATA_DIR=${plan.dataDir}
ExecStart=${plan.nodePath} ${nodeFlags}${plan.scriptPath} start
Restart=on-failure
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=default.target
`;
}

export function quoteWindows(value: string): string {
  if (!/[\s"]/u.test(value)) return value;
  return `"${value.replaceAll('"', '\\"')}"`;
}

export function agentEntryPath(fromHere: string): string {
  const compiled = path.join(fromHere, '..', 'dist', 'index.js');
  return compiled;
}
