import { Injectable, type Signal } from '@angular/core';
import type {
  CreateServerRequest,
  InstallProgress,
  LogLine,
  ActivityEntry,
  BackupInfo,
  FileContent,
  FileEntry,
  MachineInfo,
  McCreateRequest,
  McProviderId,
  McVersion,
  McPlayerAction,
  McPlayers,
  AddonHit,
  ModpackHit,
  PowerAction,
  Reachability,
  ScheduleInfo,
  ServerProperties,
  ServerStats,
  ServerView,
  SetupStatus,
} from '@hotbar/shared';

export interface DatabaseCreated extends DatabaseInfo {
  status: 'created';
  password: string;
}

export interface DatabaseInstaller {
  status: 'installer';
  message: string;
}

export interface DownloadOffer {
  id: string;
  title: string;
  detail: string;
}

export interface DatabasePlan {
  downloads: DownloadOffer[];
  blocked: string;
}

export interface DatabaseInfo {
  id: string;
  name: string;
  kind: string;
  target: string;
  host: string;
  port: number;
  username: string;
  dbName: string;
}

@Injectable()
export abstract class DataSource {
  abstract readonly servers: Signal<ServerView[]>;
  abstract readonly connected: Signal<boolean>;
  abstract readonly connectionError: Signal<string | null>;
  abstract readonly dev: Signal<boolean>;
  abstract readonly revision: Signal<number>;
  abstract readonly remote: Signal<boolean>;
  abstract readonly linkedPanel: Signal<string | null>;
  abstract start(): Promise<void>;
  abstract machine(): Promise<MachineInfo>;
  abstract createServer(input: CreateServerRequest): Promise<ServerView>;
  abstract createDemoServer(): Promise<ServerView>;
  abstract deleteServer(id: string): Promise<void>;
  abstract power(id: string, action: PowerAction): Promise<ServerView>;
  abstract sendCommand(id: string, line: string): Promise<void>;
  abstract players(id: string): Promise<McPlayers>;
  abstract playerAction(id: string, input: { action: McPlayerAction; name?: string; reason?: string }): Promise<McPlayers>;
  abstract statsHistory(id: string): readonly ServerStats[];
  abstract attachLogs(id: string, onLine: (line: LogLine) => void): Promise<() => void>;
  abstract listMinecraftVersions(provider: McProviderId, snapshots: boolean): Promise<McVersion[]>;
  abstract listServerVersions(id: string, provider: McProviderId, snapshots: boolean): Promise<McVersion[]>;
  abstract createMinecraft(input: McCreateRequest): Promise<{ jobId: string }>;
  abstract onInstall(listener: (event: InstallProgress) => void): () => void;
  abstract readProperties(id: string): Promise<ServerProperties>;
  abstract writeProperties(id: string, values: Record<string, string>): Promise<ServerProperties>;
  abstract updateStartup(id: string, input: { memoryMb?: number; stopStdin?: string; stopTimeoutSec?: number; autoStart?: boolean; autoRestart?: boolean }): Promise<ServerView>;
  abstract reachability(id: string): Promise<Reachability>;
  abstract linkPanel(url: string, code: string): Promise<MachineInfo>;
  abstract unlinkPanel(): Promise<MachineInfo>;
  abstract setup(): Promise<SetupStatus>;
  abstract completeSetup(): Promise<SetupStatus>;
  abstract listFiles(id: string, path: string): Promise<FileEntry[]>;
  abstract readFile(id: string, path: string): Promise<FileContent>;
  abstract writeFile(id: string, path: string, text: string): Promise<void>;
  abstract makeDirectory(id: string, path: string): Promise<void>;
  abstract deleteFile(id: string, path: string): Promise<void>;
  abstract renameFile(id: string, from: string, to: string): Promise<void>;
  abstract uploadFile(id: string, directory: string, name: string, base64: string): Promise<void>;
  abstract listBackups(id: string): Promise<BackupInfo[]>;
  abstract createBackup(id: string): Promise<{ name: string }>;
  abstract restoreBackup(id: string, name: string): Promise<void>;
  abstract deleteBackup(id: string, name: string): Promise<void>;
  abstract listSchedules(id: string): Promise<ScheduleInfo[]>;
  abstract createSchedule(id: string, input: { name: string; cron: string; task: string; payload: string }): Promise<ScheduleInfo>;
  abstract deleteSchedule(id: string, scheduleId: string): Promise<void>;
  abstract searchModpacks(query: string): Promise<ModpackHit[]>;
  abstract installModpack(id: string, projectId: string, acceptDownloads: string[]): Promise<void>;
  abstract searchAddons(id: string, query: string): Promise<AddonHit[]>;
  abstract installAddon(id: string, projectId: string, acceptDownloads: string[]): Promise<void>;
  abstract activity(serverId: string): Promise<ActivityEntry[]>;
  abstract currentInstall(id: string): Promise<{ provider: string; version: string; javaMajor: number } | null>;
  abstract changeVersion(id: string, provider: string, version: string, acceptDownloads: string[]): Promise<{ provider: string; version: string }>;
  abstract sftpInfo(id: string): Promise<{ host: string; port: number; username: string; password: string }>;
  abstract databasePlan(id: string): Promise<DatabasePlan>;
  abstract listDatabases(id: string): Promise<DatabaseInfo[]>;
  abstract createDatabase(id: string, name: string, acceptDownloads: string[]): Promise<DatabaseCreated | DatabaseInstaller>;
  abstract databasePassword(id: string, databaseId: string): Promise<{ password: string }>;
  abstract rotateDatabasePassword(id: string, databaseId: string): Promise<{ password: string }>;
  abstract deleteDatabase(id: string, databaseId: string): Promise<void>;
  abstract saveWebhook(url: string): Promise<void>;
  abstract importEgg(egg: unknown): Promise<{ notes: string[] }>;
}
