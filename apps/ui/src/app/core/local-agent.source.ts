import { Injectable, signal } from '@angular/core';
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
import './window';

@Injectable({ providedIn: 'root' })
export class LocalAgentDataSource extends DataSource {
  readonly servers = signal<ServerView[]>([]);
  readonly connected = signal(false);
  readonly connectionError = signal<string | null>(null);
  readonly dev = signal(false);
  readonly revision = signal(0);
  readonly remote = signal(false);
  readonly linkedPanel = signal<string | null>(null);

  private agentUrl = 'http://127.0.0.1:7878';
  private token = 'dev-local-token';
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly histories = new Map<string, ServerStats[]>();
  private readonly logListeners = new Set<(line: LogLine) => void>();
  private readonly installListeners = new Set<(event: InstallProgress) => void>();
  private stopped = false;

  override async start(): Promise<void> {
    if (window.hotbar) {
      const boot = await window.hotbar.getBootstrap();
      this.agentUrl = boot.agentUrl.replace(/\/$/, '');
      this.token = boot.token;
    }
    try {
      await this.refresh();
    } catch (error) {
      this.connected.set(false);
      this.connectionError.set(error instanceof Error ? error.message : 'Agent unreachable');
    }
    this.openSocket();
  }

  override async machine(): Promise<MachineInfo> {
    return this.request<MachineInfo>('GET', '/api/machine');
  }

  override async createServer(input: CreateServerRequest): Promise<ServerView> {
    const created = await this.request<ServerView>('POST', '/api/servers', input);
    this.upsert(created);
    return created;
  }

  override async createDemoServer(): Promise<ServerView> {
    const created = await this.request<ServerView>('POST', '/api/servers/demo');
    this.upsert(created);
    return created;
  }

  override async deleteServer(id: string): Promise<void> {
    await this.request<void>('DELETE', `/api/servers/${id}`);
    this.servers.update((list) => list.filter((server) => server.id !== id));
    this.histories.delete(id);
  }

  override async power(id: string, action: PowerAction): Promise<ServerView> {
    const view = await this.request<ServerView>('POST', `/api/servers/${id}/power`, { action });
    this.upsert(view);
    return view;
  }

  override async sendCommand(id: string, line: string): Promise<void> {
    await this.request<void>('POST', `/api/servers/${id}/stdin`, { line });
  }

  override players(id: string): Promise<McPlayers> {
    return this.request<McPlayers>('GET', `/api/servers/${id}/players`);
  }

  override playerAction(id: string, input: { action: McPlayerAction; name?: string; reason?: string }): Promise<McPlayers> {
    return this.request<McPlayers>('POST', `/api/servers/${id}/players`, input);
  }

  override statsHistory(id: string): readonly ServerStats[] {
    return this.histories.get(id) ?? [];
  }

  override async attachLogs(id: string, onLine: (line: LogLine) => void): Promise<() => void> {
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
      const snapshot = await this.request<LogSnapshot>('GET', `/api/servers/${id}/logs`);
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

  private async refresh(): Promise<void> {
    const [servers, machine] = await Promise.all([
      this.request<ServerView[]>('GET', '/api/servers'),
      this.request<MachineInfo>('GET', '/api/machine'),
    ]);
    this.servers.set(servers);
    this.dev.set(machine.dev);
    this.linkedPanel.set(machine.linkedPanel);
    this.connected.set(true);
    this.connectionError.set(null);
  }

  private openSocket(): void {
    if (this.stopped) return;
    const wsBase = this.agentUrl.replace(/^http/i, 'ws');
    const socket = new WebSocket(`${wsBase}/api/ws?access_token=${encodeURIComponent(this.token)}`);
    this.socket = socket;
    socket.onopen = () => {
      this.connected.set(true);
      this.connectionError.set(null);
    };
    socket.onmessage = (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as AgentEvent;
      this.apply(message);
    };
    socket.onclose = () => {
      this.connected.set(false);
      if (this.socket === socket) this.socket = null;
      if (this.stopped) return;
      this.reconnectTimer = setTimeout(() => {
        void this.refresh().catch((error: unknown) => {
          this.connectionError.set(error instanceof Error ? error.message : 'Agent unreachable');
        });
        this.openSocket();
      }, 1500);
    };
  }

  private apply(event: AgentEvent): void {
    if (event.type === 'server.state') {
      this.servers.update((list) =>
        list.map((server) =>
          server.id === event.serverId
            ? { ...server, state: event.state, startedAt: event.startedAt, pid: event.pid }
            : server,
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
      return;
    }
    if (event.type === 'install.progress') {
      for (const listener of this.installListeners) listener(event);
      if (event.done && event.serverId) void this.refresh();
    }
  }

  override async listMinecraftVersions(provider: McProviderId, snapshots: boolean): Promise<McVersion[]> {
    return this.request<McVersion[]>('GET', `/api/minecraft/versions?provider=${provider}&snapshots=${snapshots ? '1' : '0'}`);
  }

  override async createMinecraft(input: McCreateRequest): Promise<{ jobId: string }> {
    return this.request<{ jobId: string }>('POST', '/api/minecraft', input);
  }

  override onInstall(listener: (event: InstallProgress) => void): () => void {
    this.installListeners.add(listener);
    return () => this.installListeners.delete(listener);
  }

  override async readProperties(id: string): Promise<ServerProperties> {
    return this.request<ServerProperties>('GET', `/api/servers/${id}/properties`);
  }

  override async writeProperties(id: string, values: Record<string, string>): Promise<ServerProperties> {
    return this.request<ServerProperties>('PUT', `/api/servers/${id}/properties`, { values });
  }

  override async updateStartup(id: string, input: { memoryMb?: number; stopStdin?: string; stopTimeoutSec?: number; autoStart?: boolean; autoRestart?: boolean }): Promise<ServerView> {
    const view = await this.request<ServerView>('POST', `/api/servers/${id}/startup`, input);
    this.upsert(view);
    return view;
  }

  override async reachability(id: string): Promise<Reachability> {
    return this.request<Reachability>('GET', `/api/servers/${id}/reachability`);
  }

  override async linkPanel(url: string, code: string): Promise<MachineInfo> {
    const machine = await this.request<MachineInfo>('POST', '/api/link', { url, code });
    this.linkedPanel.set(machine.linkedPanel);
    return machine;
  }

  override async unlinkPanel(): Promise<MachineInfo> {
    const machine = await this.request<MachineInfo>('DELETE', '/api/link');
    this.linkedPanel.set(null);
    return machine;
  }

  override setup(): Promise<SetupStatus> {
    return this.request<SetupStatus>('GET', '/api/setup');
  }

  override completeSetup(): Promise<SetupStatus> {
    return this.request<SetupStatus>('POST', '/api/setup', {});
  }

  override listFiles(id: string, filePath: string): Promise<FileEntry[]> {
    return this.request<FileEntry[]>('GET', `/api/servers/${id}/files?path=${encodeURIComponent(filePath)}`);
  }

  override readFile(id: string, filePath: string): Promise<FileContent> {
    return this.request<FileContent>('GET', `/api/servers/${id}/files/content?path=${encodeURIComponent(filePath)}`);
  }

  override async writeFile(id: string, filePath: string, text: string): Promise<void> {
    await this.request('PUT', `/api/servers/${id}/files/content`, { path: filePath, text });
  }

  override async makeDirectory(id: string, filePath: string): Promise<void> {
    await this.request('POST', `/api/servers/${id}/files/mkdir`, { path: filePath });
  }

  override async deleteFile(id: string, filePath: string): Promise<void> {
    await this.request('DELETE', `/api/servers/${id}/files?path=${encodeURIComponent(filePath)}`);
  }

  override async renameFile(id: string, from: string, to: string): Promise<void> {
    await this.request('POST', `/api/servers/${id}/files/rename`, { from, to });
  }

  override async uploadFile(id: string, directory: string, name: string, base64: string): Promise<void> {
    await this.request('POST', `/api/servers/${id}/files/upload`, { directory, name, base64 });
  }

  override listBackups(id: string): Promise<BackupInfo[]> {
    return this.request<BackupInfo[]>('GET', `/api/servers/${id}/backups`);
  }

  override createBackup(id: string): Promise<{ name: string }> {
    return this.request<{ name: string }>('POST', `/api/servers/${id}/backups`, {});
  }

  override async restoreBackup(id: string, name: string): Promise<void> {
    await this.request('POST', `/api/servers/${id}/backups/restore`, { name });
  }

  override async deleteBackup(id: string, name: string): Promise<void> {
    await this.request('DELETE', `/api/servers/${id}/backups?name=${encodeURIComponent(name)}`);
  }

  override listSchedules(id: string): Promise<ScheduleInfo[]> {
    return this.request<ScheduleInfo[]>('GET', `/api/servers/${id}/schedules`);
  }

  override createSchedule(id: string, input: { name: string; cron: string; task: string; payload: string }): Promise<ScheduleInfo> {
    return this.request<ScheduleInfo>('POST', `/api/servers/${id}/schedules`, input);
  }

  override async deleteSchedule(id: string, scheduleId: string): Promise<void> {
    await this.request('DELETE', `/api/servers/${id}/schedules/${scheduleId}`);
  }

  override searchModpacks(query: string): Promise<ModpackHit[]> {
    return this.request<ModpackHit[]>('GET', `/api/modpacks?q=${encodeURIComponent(query)}`);
  }

  override async installModpack(id: string, projectId: string, acceptDownloads: string[]): Promise<void> {
    await this.request('POST', `/api/servers/${id}/modpack`, { projectId, acceptDownloads });
  }

  override searchAddons(id: string, query: string): Promise<AddonHit[]> {
    return this.request<AddonHit[]>('GET', `/api/servers/${id}/addons?q=${encodeURIComponent(query)}`);
  }

  override async installAddon(id: string, projectId: string, acceptDownloads: string[]): Promise<void> {
    await this.request('POST', `/api/servers/${id}/addons`, { projectId, acceptDownloads });
  }

  override activity(_serverId: string): Promise<ActivityEntry[]> {
    return this.request<ActivityEntry[]>('GET', '/api/activity');
  }

  override currentInstall(id: string): Promise<{ provider: string; version: string; javaMajor: number } | null> {
    return this.request('GET', `/api/servers/${id}/install`);
  }

  override changeVersion(id: string, provider: string, version: string, acceptDownloads: string[]): Promise<{ provider: string; version: string }> {
    return this.request('POST', `/api/servers/${id}/version`, { provider, version, acceptDownloads });
  }

  override sftpInfo(id: string): Promise<{ host: string; port: number; username: string; password: string }> {
    return this.request('GET', `/api/servers/${id}/sftp`);
  }

  override databasePlan(id: string): Promise<DatabasePlan> {
    return this.request('GET', `/api/servers/${id}/databases/plan`);
  }

  override listDatabases(id: string): Promise<DatabaseInfo[]> {
    return this.request('GET', `/api/servers/${id}/databases`);
  }

  override createDatabase(id: string, name: string, acceptDownloads: string[]): Promise<DatabaseCreated | DatabaseInstaller> {
    return this.request('POST', `/api/servers/${id}/databases`, { name, acceptDownloads });
  }

  override databasePassword(id: string, databaseId: string): Promise<{ password: string }> {
    return this.request('GET', `/api/servers/${id}/databases/${databaseId}/password`);
  }

  override rotateDatabasePassword(id: string, databaseId: string): Promise<{ password: string }> {
    return this.request('POST', `/api/servers/${id}/databases/${databaseId}/password`, {});
  }

  override async deleteDatabase(id: string, databaseId: string): Promise<void> {
    await this.request('DELETE', `/api/servers/${id}/databases/${databaseId}`);
  }

  override async saveWebhook(url: string): Promise<void> {
    await this.request('PUT', '/api/settings', { discordWebhook: url });
  }

  override importEgg(egg: unknown): Promise<{ notes: string[] }> {
    return this.request<{ notes: string[] }>('POST', '/api/eggs', egg);
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

  private async request<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.agentUrl}${pathname}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      const live = this.socket?.readyState === WebSocket.OPEN;
      if (!live) {
        this.connected.set(false);
        this.connectionError.set('Can’t reach the Hotbar agent on this machine.');
      }
      throw new Error(live ? 'The agent did not answer. Try again.' : 'Can’t reach the Hotbar agent on this machine.');
    }
    if (response.status === 204) return undefined as T;
    let payload: T & { error?: string };
    try {
      payload = (await response.json()) as T & { error?: string };
    } catch {
      throw new Error('The agent returned an incomplete response. Try again.');
    }
    if (!response.ok) {
      throw new Error(payload.error ?? `Request failed (${response.status})`);
    }
    return payload;
  }
}
