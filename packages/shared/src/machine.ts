export interface MachineInfo {
  hostname: string;
  os: 'windows' | 'linux' | 'darwin' | 'other';
  platform: string;
  arch: string;
  cpuCount: number;
  memoryTotalBytes: number;
  memoryFreeBytes: number;
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
  runtime: 'process';
  agentVersion: string;
  pid: number;
  agentUptimeMs: number;
  mode: 'local';
  linkedPanel: string | null;
  dev: boolean;
  dataDir: string;
  serversRoot: string;
}

export interface HotbarCapabilities {
  tray: boolean;
  notifications: boolean;
  openFolder: boolean;
}
