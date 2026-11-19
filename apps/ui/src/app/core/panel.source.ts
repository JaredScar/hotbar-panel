import { Injectable, inject, signal } from '@angular/core';
import type {
  ActivityEntry,
  AgentEvent,
  BackupInfo,
  CreateServerRequest,
  FileContent,
  FileEntry,
  InstallProgress,
  LogLine,
  LogSnapshot,
  MachineInfo,
  McCreateRequest,
  McProviderId,
  McVersion,
  McPlayerAction,
  McPlayers,
  AddonHit,
  AddonUpdate,
  ModpackHit,
  PowerAction,
  Reachability,
  ScheduleInfo,
  ServerProperties,
  ServerStats,
  ServerView,
  SetupStatus,
} from '@hotbar/shared';
import { DataSource, type DatabaseCreated, type DatabaseInfo, type DatabaseInstaller, type DatabasePlan } from './data-source';
import { PanelSession } from './panel-session';

@Injectable()
export class PanelDataSource extends DataSource {
  readonly servers = signal<ServerView[]>([]);
  readonly connected = signal(false);
  readonly connectionError = signal<string | null>(null);
  readonly dev = signal(false);
  readonly revision = signal(0);
  readonly remote = signal(true);
  readonly linkedPanel = signal<string | null>(null);

  private readonly session = inject(PanelSession);
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly histories = new Map<string, ServerStats[]>();
  private readonly logListeners = new Set<(line: LogLine) => void>();
  private readonly subscribed = new Set<string>();
  private stopped = false;

  override async start(): Promise<void> {
    this.linkedPanel.set(this.session.url());
    if (!this.session.token()) {
      this.connectionError.set('Sign in to the panel.');
      return;
    }
    try {
      await this.refresh();
    } catch (error) {
      this.connectionError.set(error instanceof Error ? error.message : 'Panel unreachable');
    }
    this.openSocket();
  }

  override async machine(): Promise<MachineInfo> {
    throw new Error('Open This machine on the host.');
  }

  override async createServer(_input: CreateServerRequest): Promise<ServerView> {
    throw new Error('Create the server on the host.');
  }

  override async createDemoServer(): Promise<ServerView> {
    throw new Error('Create the server on the host.');
  }

  override async deleteServer(_id: string): Promise<void> {
    throw new Error('Delete the server from Hotbar Desktop on the host.');
  }

  override async power(id: string, action: PowerAction): Promise<ServerView> {
    const view = await this.session.request<ServerView>('POST', `/api/servers/${id}/power`, { action });
    this.upsert(view);
    return view;
  }

  override players(id: string): Promise<McPlayers> {
    return this.session.request('GET', `/api/servers/${id}/players`);
  }

  override playerAction(id: string, input: { action: McPlayerAction; name?: string; reason?: string }): Promise<McPlayers> {
    return this.session.request('POST', `/api/servers/${id}/players`, input);
  }

  override async sendCommand(id: string, line: string): Promise<void> {
    await this.session.request('POST', `/api/servers/${id}/stdin`, { line });
  }

  override statsHistory(id: string): readonly ServerStats[] {
    return this.histories.get(id) ?? [];
  }

  override async attachLogs(id: string, onLine: (line: LogLine) => void): Promise<() => void> {
    this.subscribed.add(id);
    this.send({ type: 'subscribe', serverId: id });
    const pending: LogLine[] = [];
    let ready = false;
    let cursor = 0;
    const listener = (line: LogLine): void => {
      if (line.serverId !== id) return;
      if (!ready) {
        pending.push(line);
        return;
      }
      if (line.id <= cursor) return;
      cursor = line.id;
      onLine(line);
    };
    this.logListeners.add(listener);
    try {
      const snapshot = await this.session.request<LogSnapshot>('GET', `/api/servers/${id}/logs`);
      cursor = snapshot.lines.at(-1)?.id ?? 0;
      for (const line of snapshot.lines) onLine(line);
      ready = true;
      for (const line of pending) {
        if (line.id > cursor) {
          cursor = line.id;
          onLine(line);
        }
      }
    } catch (error) {
      this.logListeners.delete(listener);
      throw error;
    }
    return () => this.logListeners.delete(listener);
  }

  override async listMinecraftVersions(_provider: McProviderId, _snapshots: boolean): Promise<McVersion[]> {
    throw new Error('Create the server on the host.');
  }

  override listServerVersions(id: string, provider: McProviderId, snapshots: boolean): Promise<McVersion[]> {
    return this.session.request('GET', `/api/servers/${id}/versions?provider=${provider}&snapshots=${snapshots ? '1' : '0'}`);
  }

  override async createMinecraft(_input: McCreateRequest): Promise<{ jobId: string }> {
    throw new Error('Create the server on the host.');
  }

  override onInstall(_listener: (event: InstallProgress) => void): () => void {
    return () => undefined;
  }

  override async readProperties(_id: string): Promise<ServerProperties> {
    throw new Error('Edit properties on the host.');
  }

  override async writeProperties(_id: string, _values: Record<string, string>): Promise<ServerProperties> {
    throw new Error('Edit properties on the host.');
  }

  override async updateStartup(id: string, input: { memoryMb?: number; stopStdin?: string; stopTimeoutSec?: number; autoStart?: boolean; autoRestart?: boolean }): Promise<ServerView> {
    const view = await this.session.request<ServerView>('POST', `/api/servers/${id}/startup`, input);
    this.upsert(view);
    return view;
  }

  override async reachability(_id: string): Promise<Reachability> {
    throw new Error('Check the port on the host.');
  }

  override async linkPanel(): Promise<MachineInfo> {
    throw new Error('Link the machine from This machine on the host.');
  }

  override async unlinkPanel(): Promise<MachineInfo> {
    throw new Error('Unlink the machine from This machine on the host.');
  }

  override setup(): Promise<SetupStatus> {
    return this.host();
  }
  override completeSetup(): Promise<SetupStatus> {
    return this.host();
  }
  override listFiles(id: string, filePath: string): Promise<FileEntry[]> {
    return this.session.request('GET', `/api/servers/${id}/files?path=${encodeURIComponent(filePath)}`);
  }
  override readFile(id: string, filePath: string): Promise<FileContent> {
    return this.session.request('GET', `/api/servers/${id}/files/content?path=${encodeURIComponent(filePath)}`);
  }
  override async writeFile(id: string, filePath: string, text: string): Promise<void> {
    await this.session.request('POST', `/api/servers/${id}/files/content`, { path: filePath, text });
  }
  override async makeDirectory(id: string, filePath: string): Promise<void> {
    await this.session.request('POST', `/api/servers/${id}/files/mkdir`, { path: filePath });
  }
  override async deleteFile(id: string, filePath: string): Promise<void> {
    await this.session.request('DELETE', `/api/servers/${id}/files?path=${encodeURIComponent(filePath)}`);
  }
  override async renameFile(id: string, from: string, to: string): Promise<void> {
    await this.session.request('POST', `/api/servers/${id}/files/rename`, { from, to });
  }
  override async uploadFile(id: string, directory: string, name: string, base64: string): Promise<void> {
    await this.session.request('POST', `/api/servers/${id}/files/upload`, { directory, name, base64 });
  }
  override listBackups(id: string): Promise<BackupInfo[]> {
    return this.session.request('GET', `/api/servers/${id}/backups`);
  }
  override createBackup(id: string): Promise<{ name: string }> {
    return this.session.request('POST', `/api/servers/${id}/backups`, {});
  }
  override async restoreBackup(id: string, name: string): Promise<void> {
    await this.session.request('POST', `/api/servers/${id}/backups/restore`, { name });
  }
  override async deleteBackup(id: string, name: string): Promise<void> {
    await this.session.request('DELETE', `/api/servers/${id}/backups?name=${encodeURIComponent(name)}`);
  }
  override listSchedules(id: string): Promise<ScheduleInfo[]> {
    return this.session.request('GET', `/api/servers/${id}/schedules`);
  }
  override createSchedule(id: string, input: { name: string; cron: string; task: string; payload: string }): Promise<ScheduleInfo> {
    return this.session.request('POST', `/api/servers/${id}/schedules`, input);
  }
  override async deleteSchedule(id: string, scheduleId: string): Promise<void> {
    await this.session.request('DELETE', `/api/servers/${id}/schedules/${scheduleId}`);
  }
  override searchModpacks(query: string): Promise<ModpackHit[]> {
    return this.session.request('GET', `/api/modpacks?q=${encodeURIComponent(query)}`);
  }
  override async installModpack(id: string, projectId: string, acceptDownloads: string[]): Promise<void> {
    await this.session.request('POST', `/api/servers/${id}/modpack`, { projectId, acceptDownloads });
  }
  override searchAddons(id: string, query: string): Promise<AddonHit[]> {
    return this.session.request('GET', `/api/servers/${id}/addons?q=${encodeURIComponent(query)}`);
  }
  override async installAddon(id: string, projectId: string, acceptDownloads: string[]): Promise<void> {
    await this.session.request('POST', `/api/servers/${id}/addons`, { projectId, acceptDownloads });
  }

  override checkAddonUpdates(id: string): Promise<AddonUpdate[]> {
    return this.session.request('GET', `/api/servers/${id}/addon-updates`);
  }

  override async updateAddon(id: string, filename: string, acceptDownloads: string[]): Promise<void> {
    await this.session.request('POST', `/api/servers/${id}/addon-updates`, { filename, acceptDownloads });
  }

  override async zipPath(id: string, filePath: string): Promise<void> {
    await this.session.request('POST', `/api/servers/${id}/files/zip`, { path: filePath });
  }

  override async unzipPath(id: string, filePath: string): Promise<void> {
    await this.session.request('POST', `/api/servers/${id}/files/unzip`, { path: filePath });
  }

  override worldInfo(id: string): Promise<{ folder: string }> {
    return this.session.request('GET', `/api/servers/${id}/world`);
  }

  override async downloadWorld(id: string): Promise<{ name: string; bytes: Uint8Array }> {
    const packed = await this.session.request<{ name?: string; base64?: string }>('GET', `/api/servers/${id}/world/archive`);
    if (!packed.base64) throw new Error('The world zip was empty.');
    return { name: packed.name || 'world.zip', bytes: decodeBase64(packed.base64) };
  }

  override async replaceWorld(id: string, bytes: Uint8Array): Promise<void> {
    if (bytes.byteLength > 32 * 1024 * 1024) throw new Error('This world zip is over 32 MB. Replace it on the machine, or use SFTP.');
    await this.session.request('POST', `/api/servers/${id}/world`, { base64: encodeBase64(bytes) });
  }
  override activity(serverId: string): Promise<ActivityEntry[]> {
    return this.session.request('GET', `/api/servers/${serverId}/activity`);
  }
  override currentInstall(id: string): Promise<{ provider: string; version: string; javaMajor: number } | null> {
    return this.session.request('GET', `/api/servers/${id}/install`);
  }
  override changeVersion(id: string, provider: string, version: string, acceptDownloads: string[]): Promise<{ provider: string; version: string }> {
    return this.session.request('POST', `/api/servers/${id}/version`, { provider, version, acceptDownloads });
  }
  override sftpInfo(_id: string): Promise<{ host: string; port: number; username: string; password: string }> {
    return this.host();
  }
  override databasePlan(id: string): Promise<DatabasePlan> {
    return this.session.request('GET', `/api/servers/${id}/databases/plan`);
  }
  override listDatabases(id: string): Promise<DatabaseInfo[]> {
    return this.session.request('GET', `/api/servers/${id}/databases`);
  }
  override createDatabase(id: string, name: string, acceptDownloads: string[]): Promise<DatabaseCreated | DatabaseInstaller> {
    return this.session.request('POST', `/api/servers/${id}/databases`, { name, acceptDownloads });
  }
  override databasePassword(id: string, databaseId: string): Promise<{ password: string }> {
    return this.session.request('GET', `/api/servers/${id}/databases/${databaseId}/password`);
  }
  override rotateDatabasePassword(id: string, databaseId: string): Promise<{ password: string }> {
    return this.session.request('POST', `/api/servers/${id}/databases/${databaseId}/password`, {});
  }
  override async deleteDatabase(id: string, databaseId: string): Promise<void> {
    await this.session.request('DELETE', `/api/servers/${id}/databases/${databaseId}`);
  }
  override saveWebhook(): Promise<void> {
    return this.host();
  }
  override importEgg(): Promise<{ notes: string[] }> {
    return this.host();
  }

  private host<T>(): Promise<T> {
    return Promise.reject(new Error('This action runs on the host. Open Hotbar on that machine.'));
  }

  private async refresh(): Promise<void> {
    const servers = await this.session.request<ServerView[]>('GET', '/api/servers');
    this.servers.set(servers);
    this.connected.set(true);
    this.connectionError.set(null);
  }

  private openSocket(): void {
    if (this.stopped || !this.session.token()) return;
    const wsBase = this.session.url().replace(/^http/i, 'ws');
    const socket = new WebSocket(`${wsBase}/api/console?access_token=${encodeURIComponent(this.session.token() ?? '')}`);
    this.socket = socket;
    socket.onopen = () => {
      this.connected.set(true);
      this.connectionError.set(null);
      for (const id of this.subscribed) this.send({ type: 'subscribe', serverId: id });
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as AgentEvent | { type: 'servers.changed' };
      if (message.type === 'servers.changed') {
        void this.refresh().catch(() => undefined);
        return;
      }
      this.apply(message);
    };
    socket.onclose = () => {
      this.connected.set(false);
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      this.reconnectTimer = setTimeout(() => this.openSocket(), 1500);
    };
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private apply(event: AgentEvent): void {
    if (event.type === 'server.state') {
      this.servers.update((list) =>
        list.map((server) =>
          server.id === event.serverId ? { ...server, state: event.state, startedAt: event.startedAt, pid: event.pid } : server,
        ),
      );
      return;
    }
    if (event.type === 'server.stats' && event.stats) {
      const history = this.histories.get(event.serverId) ?? [];
      history.push(event.stats);
      if (history.length > 60) history.splice(0, history.length - 60);
      this.histories.set(event.serverId, history);
      this.servers.update((list) =>
        list.map((server) => (server.id === event.serverId ? { ...server, stats: event.stats, startedAt: event.startedAt } : server)),
      );
      this.revision.update((value) => value + 1);
      return;
    }
    if (event.type === 'server.log') {
      for (const listener of this.logListeners) listener(event.line);
      return;
    }
    if (event.type === 'server.removed') {
      this.servers.update((list) => list.filter((server) => server.id !== event.serverId));
    }
  }

  private upsert(view: ServerView): void {
    this.servers.update((list) => {
      const index = list.findIndex((server) => server.id === view.id);
      if (index === -1) return [...list, view];
      const next = [...list];
      next[index] = view;
      return next;
    });
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const size = 0x8000;
  for (let index = 0; index < bytes.length; index += size) {
    binary += String.fromCharCode(...bytes.subarray(index, index + size));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
