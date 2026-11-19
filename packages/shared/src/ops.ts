export interface FileEntry {
  name: string;
  path: string;
  directory: boolean;
  size: number;
  modifiedAt: string;
}

export interface FileContent {
  path: string;
  text: string | null;
  binary: boolean;
  size: number;
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
}

export interface ScheduleInfo {
  id: string;
  serverId: string;
  name: string;
  cron: string;
  task: string;
  payload: string;
}

export interface ModpackHit {
  projectId: string;
  title: string;
  description: string;
  downloads: number;
}

export interface AddonHit {
  projectId: string;
  title: string;
  description: string;
  downloads: number;
}

export interface AddonUpdate {
  filename: string;
  projectId: string;
  installedVersion: string;
  latestVersion: string;
}

export interface SetupStatus {
  completed: boolean;
  serversRoot: string;
  docker: boolean;
  steamcmd: boolean;
}
