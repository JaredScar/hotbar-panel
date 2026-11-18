import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { ActivityEntry, AddonHit, BackupInfo, FileContent, FileEntry, ModpackHit, ScheduleInfo, ServerView } from '@hotbar/shared';
import { CodeEditor, languageLabel } from '../components/code-editor';
import { DownloadPrompt } from '../components/download-prompt';
import { DataSource, type DatabaseInfo, type DownloadOffer } from '../core/data-source';
import { formatBytes } from '../core/format';

@Component({
  selector: 'app-server-tools',
  imports: [RouterLink, DownloadPrompt, CodeEditor],
  templateUrl: './server-tools.html',
})
export class ServerToolsPage {
  private readonly data = inject(DataSource);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly tool = signal('files');
  protected readonly serverId = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly files = signal<FileEntry[]>([]);
  protected readonly folder = signal('');
  protected readonly content = signal<FileContent | null>(null);
  protected readonly draft = signal('');
  protected readonly backups = signal<BackupInfo[]>([]);
  protected readonly schedules = signal<ScheduleInfo[]>([]);
  protected readonly activityRows = signal<ActivityEntry[]>([]);
  protected readonly packs = signal<ModpackHit[]>([]);
  protected readonly addons = signal<AddonHit[]>([]);
  protected readonly query = signal('');
  protected readonly addonQuery = signal('');
  protected readonly cron = signal('0 4 * * *');
  protected readonly task = signal('backup');
  protected readonly payload = signal('');
  protected readonly scheduleName = signal('Daily backup');
  protected readonly folderName = signal('');
  protected readonly fileName = signal('');
  protected readonly menu = signal<{ x: number; y: number; entry: FileEntry } | null>(null);
  protected readonly renaming = signal('');
  protected readonly renameValue = signal('');
  protected readonly confirming = signal<FileEntry | null>(null);
  protected readonly leaving = signal(false);
  private leaveAction: (() => Promise<void>) | null = null;
  protected readonly languageLabel = languageLabel;
  protected readonly command = signal('list');
  protected readonly nextVersion = signal('');
  protected readonly nextProvider = signal('paper');
  protected readonly installed = signal<{ provider: string; version: string; javaMajor: number } | null>(null);
  protected readonly sftp = signal<{ host: string; port: number; username: string; password: string } | null>(null);
  protected readonly databases = signal<DatabaseInfo[]>([]);
  protected readonly databaseName = signal('game');
  protected readonly shownPasswordId = signal('');
  protected readonly shownPassword = signal('');
  protected readonly notice = signal('');
  protected readonly promptItems = signal<DownloadOffer[] | null>(null);
  private promptAction: (() => Promise<void>) | null = null;
  protected readonly formatBytes = formatBytes;

  protected readonly server = () => this.data.servers().find((item) => item.id === this.serverId()) ?? null;

  constructor() {
    this.route.data.pipe(takeUntilDestroyed()).subscribe((data) => {
      this.tool.set(String(data['tool'] ?? 'files'));
      this.load();
    });
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      this.serverId.set(params.get('serverId') ?? '');
      this.load();
    });
  }

  protected async load(): Promise<void> {
    const id = this.serverId();
    if (!id) return;
    this.error.set(null);
    try {
      if (this.tool() === 'plugins') {
        this.installed.set(await this.data.currentInstall(id));
        const folder = folderForProvider(this.installed()?.provider);
        this.folder.set(folder ?? '');
        if (!folder) {
          this.files.set([]);
          this.addons.set([]);
          return;
        }
        try {
          this.files.set(await this.data.listFiles(id, folder));
        } catch {
          this.files.set([]);
        }
        this.addons.set(await this.data.searchAddons(id, this.addonQuery()));
        return;
      } else if (this.tool() === 'files' || this.tool() === 'world') {
        const root = this.tool() === 'world' ? 'world' : this.folder();
        if (this.tool() !== 'files') this.folder.set(root);
        this.files.set(await this.data.listFiles(id, this.tool() === 'files' ? this.folder() : root));
      } else if (this.tool() === 'backups') {
        this.backups.set(await this.data.listBackups(id));
      } else if (this.tool() === 'schedules') {
        this.schedules.set(await this.data.listSchedules(id));
      } else if (this.tool() === 'activity') {
        const rows = await this.data.activity(id);
        this.activityRows.set(rows.filter((row) => !row.target || row.target === id));
      } else if (this.tool() === 'resources') {
        const file = await this.data.readFile(id, 'server.cfg');
        this.content.set(file);
        this.draft.set(file.text ?? '');
      } else if (this.tool() === 'version') {
        this.installed.set(await this.data.currentInstall(id));
      } else if (this.tool() === 'network') {
        this.sftp.set(await this.data.sftpInfo(id));
      } else if (this.tool() === 'databases') {
        this.databases.set(await this.data.listDatabases(id));
      }
    } catch (error) {
      if (this.tool() === 'world') {
        this.files.set([]);
        return;
      }
      this.error.set(error instanceof Error ? error.message : 'Could not load this tab');
    }
  }

  protected dirty(): boolean {
    const file = this.content();
    if (!file || file.binary) return false;
    return this.draft() !== (file.text ?? '');
  }

  protected openMenu(event: MouseEvent, entry: FileEntry): void {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 176;
    const menuHeight = entry.directory ? 168 : 232;
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8));
    this.menu.set({ x, y, entry });
  }

  protected closeMenu(): void {
    this.menu.set(null);
  }

  protected async openEntry(entry: FileEntry): Promise<void> {
    this.closeMenu();
    if (entry.directory) {
      this.guardLeave(async () => {
        this.folder.set(entry.path);
        this.content.set(null);
        await this.load();
      });
      return;
    }
    if (this.content()?.path === entry.path) return;
    this.guardLeave(async () => {
      try {
        const file = await this.data.readFile(this.serverId(), entry.path);
        this.content.set(file);
        this.draft.set(file.text ?? '');
        this.error.set(null);
      } catch (error) {
        this.error.set(error instanceof Error ? error.message : 'Could not open this file');
      }
    });
  }

  protected up(): void {
    this.guardLeave(async () => {
      const parts = this.folder().split('/').filter(Boolean);
      parts.pop();
      this.folder.set(parts.join('/'));
      this.content.set(null);
      await this.load();
    });
  }

  protected closeEditor(): void {
    this.guardLeave(async () => {
      this.content.set(null);
    });
  }

  private guardLeave(action: () => Promise<void>): void {
    if (!this.dirty()) {
      void action();
      return;
    }
    this.leaveAction = action;
    this.leaving.set(true);
  }

  protected discardAndLeave(): void {
    const action = this.leaveAction;
    this.leaving.set(false);
    this.leaveAction = null;
    if (action) void action();
  }

  protected keepEditing(): void {
    this.leaving.set(false);
    this.leaveAction = null;
  }

  protected async saveText(): Promise<void> {
    const path = this.tool() === 'resources' ? 'server.cfg' : this.content()?.path;
    if (!path) return;
    this.busy.set(true);
    try {
      await this.data.writeFile(this.serverId(), path, this.draft());
      const current = this.content();
      if (current && current.path === path) this.content.set({ ...current, text: this.draft(), binary: false });
      this.error.set(null);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not save');
    } finally {
      this.busy.set(false);
    }
  }

  protected startRename(entry: FileEntry): void {
    this.closeMenu();
    this.confirming.set(null);
    this.renaming.set(entry.path);
    this.renameValue.set(entry.name);
  }

  protected async commitRename(entry: FileEntry, event: Event): Promise<void> {
    event.preventDefault();
    const name = this.renameValue().trim();
    if (!plainName(name)) {
      this.error.set('Use a file name without folders.');
      return;
    }
    const to = joinPath(parentPath(entry.path), name);
    if (to === entry.path) {
      this.renaming.set('');
      return;
    }
    try {
      await this.data.renameFile(this.serverId(), entry.path, to);
      const current = this.content();
      if (current?.path === entry.path) this.content.set({ ...current, path: to });
      this.renaming.set('');
      this.error.set(null);
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not rename');
    }
  }

  protected async copyPath(entry: FileEntry): Promise<void> {
    this.closeMenu();
    const shown = `/${entry.path}`;
    try {
      await navigator.clipboard.writeText(shown);
      this.notice.set(`Copied ${shown}`);
      this.error.set(null);
    } catch {
      this.error.set('Could not copy the path');
    }
  }

  protected async download(entry: FileEntry): Promise<void> {
    this.closeMenu();
    try {
      const file = await this.data.readFile(this.serverId(), entry.path);
      if (file.binary || file.text === null) {
        this.error.set('This file is binary or larger than 256 KB. Use SFTP on the Network tab to download it.');
        return;
      }
      const url = URL.createObjectURL(new Blob([file.text], { type: 'text/plain' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = entry.name;
      link.click();
      URL.revokeObjectURL(url);
      this.error.set(null);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not download');
    }
  }

  protected async duplicate(entry: FileEntry): Promise<void> {
    this.closeMenu();
    try {
      const file = await this.data.readFile(this.serverId(), entry.path);
      if (file.binary || file.text === null) {
        this.error.set('Binary files cannot be duplicated here.');
        return;
      }
      const name = unusedCopyName(entry.name, this.files().map((item) => item.name));
      await this.data.writeFile(this.serverId(), joinPath(parentPath(entry.path), name), file.text);
      this.error.set(null);
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not duplicate');
    }
  }

  protected askRemove(entry: FileEntry): void {
    this.closeMenu();
    this.confirming.set(entry);
  }

  protected async confirmRemove(): Promise<void> {
    const entry = this.confirming();
    if (!entry) return;
    this.confirming.set(null);
    try {
      await this.data.deleteFile(this.serverId(), entry.path);
      if (this.content()?.path === entry.path) this.content.set(null);
      if (this.renaming() === entry.path) this.renaming.set('');
      this.error.set(null);
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not delete');
    }
  }

  protected async createFile(): Promise<void> {
    const name = this.fileName().trim();
    if (!plainName(name)) {
      this.error.set('Use a file name without folders.');
      return;
    }
    const path = joinPath(this.folder(), name);
    try {
      await this.data.writeFile(this.serverId(), path, '');
      this.fileName.set('');
      this.error.set(null);
      await this.load();
      const created = this.files().find((entry) => entry.path === path);
      if (created) await this.openEntry(created);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not create the file');
    }
  }

  protected async createFolder(): Promise<void> {
    const name = this.folderName().trim();
    if (!name) return;
    const path = this.folder() ? `${this.folder()}/${name}` : name;
    await this.data.makeDirectory(this.serverId(), path);
    this.folderName.set('');
    await this.load();
  }

  protected async onUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    await this.data.uploadFile(this.serverId(), this.folder(), file.name, btoa(binary));
    input.value = '';
    await this.load();
  }

  protected async backupNow(): Promise<void> {
    this.busy.set(true);
    try {
      await this.data.createBackup(this.serverId());
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Backup failed');
    } finally {
      this.busy.set(false);
    }
  }

  protected async restore(name: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.data.restoreBackup(this.serverId(), name);
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Restore failed');
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeBackup(name: string): Promise<void> {
    await this.data.deleteBackup(this.serverId(), name);
    await this.load();
  }

  protected async addSchedule(event: Event): Promise<void> {
    event.preventDefault();
    await this.data.createSchedule(this.serverId(), {
      name: this.scheduleName(),
      cron: this.cron(),
      task: this.task(),
      payload: this.payload(),
    });
    await this.load();
  }

  protected async removeSchedule(id: string): Promise<void> {
    await this.data.deleteSchedule(this.serverId(), id);
    await this.load();
  }

  protected async findPacks(): Promise<void> {
    this.busy.set(true);
    try {
      this.packs.set(await this.data.searchModpacks(this.query()));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Search failed');
    } finally {
      this.busy.set(false);
    }
  }

  protected addonFolder(): 'plugins' | 'mods' | null {
    return folderForProvider(this.installed()?.provider);
  }

  protected async findAddons(): Promise<void> {
    if (!this.addonFolder()) return;
    this.busy.set(true);
    try {
      this.addons.set(await this.data.searchAddons(this.serverId(), this.addonQuery()));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Search failed');
    } finally {
      this.busy.set(false);
    }
  }

  protected installAddon(projectId: string): void {
    const install = this.installed();
    const label = this.addonFolder() === 'mods' ? 'mod' : 'plugin';
    this.askDownload(
      [
        {
          id: 'addon',
          title: `Modrinth ${label}`,
          detail: `One ${label} jar for ${install?.provider ?? 'this server'} ${install?.version ?? ''}, from Modrinth.`,
        },
      ],
      () => this.runInstallAddon(projectId),
    );
  }

  private async runInstallAddon(projectId: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.data.installAddon(this.serverId(), projectId, ['addon']);
      const folder = this.addonFolder() ?? 'plugins';
      this.notice.set(`Installed. Start the server to load the ${folder === 'mods' ? 'mod' : 'plugin'}.`);
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Install failed');
    } finally {
      this.busy.set(false);
    }
  }

  protected installPack(projectId: string): void {
    this.askDownload(
      [
        {
          id: 'modpack',
          title: 'Modrinth pack',
          detail: 'The pack and the server files it lists, from Modrinth.',
        },
      ],
      () => this.runInstallPack(projectId),
    );
  }

  private async runInstallPack(projectId: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.data.installModpack(this.serverId(), projectId, ['modpack']);
      this.notice.set('Modpack files are in the server folder.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Install failed');
    } finally {
      this.busy.set(false);
    }
  }

  protected async send(line: string): Promise<void> {
    try {
      await this.data.sendCommand(this.serverId(), line);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Command failed');
    }
  }

  protected async togglePlugin(entry: FileEntry): Promise<void> {
    const next = entry.name.endsWith('.disabled') ? entry.path.replace(/\.disabled$/, '') : `${entry.path}.disabled`;
    await this.data.renameFile(this.serverId(), entry.path, next);
    await this.load();
  }

  protected applyVersion(event: Event): void {
    event.preventDefault();
    const version = this.nextVersion().trim();
    this.askDownload(
      [
        {
          id: 'server',
          title: `${this.nextProvider()} ${version}`,
          detail: 'The server files for this version, if they are not already saved on this computer.',
        },
      ],
      () => this.runVersion(version),
    );
  }

  private async runVersion(version: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.data.changeVersion(this.serverId(), this.nextProvider(), version, ['server']);
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not change the version');
    } finally {
      this.busy.set(false);
    }
  }

  protected async resetWorld(): Promise<void> {
    this.busy.set(true);
    try {
      await this.data.createBackup(this.serverId());
      await this.data.deleteFile(this.serverId(), 'world');
      this.error.set('The world folder was removed after a backup. Start the server to create a new world.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not reset the world');
    } finally {
      this.busy.set(false);
    }
  }

  protected moveEnsure(index: number, delta: number): void {
    const names = this.ensureNames();
    const next = index + delta;
    if (next < 0 || next >= names.length) return;
    const swapped = [...names];
    const current = swapped[index];
    swapped[index] = swapped[next] ?? current;
    swapped[next] = current;
    let cursor = 0;
    const lines = this.draft().split(/\r?\n/).map((line) => {
      if (!/^\s*ensure\s+\S+/.test(line)) return line;
      const name = swapped[cursor++] ?? '';
      return `ensure ${name}`;
    });
    this.draft.set(lines.join('\n'));
  }

  protected ensureNames(): string[] {
    return this.draft()
      .split(/\r?\n/)
      .filter((line) => /^\s*ensure\s+\S+/.test(line))
      .map((line) => line.trim().split(/\s+/)[1] ?? '');
  }

  protected async addDatabase(event: Event): Promise<void> {
    event.preventDefault();
    this.busy.set(true);
    this.error.set(null);
    this.notice.set('');
    try {
      const plan = await this.data.databasePlan(this.serverId());
      if (plan.blocked) {
        this.error.set(plan.blocked);
        return;
      }
      if (plan.downloads.length > 0) {
        this.askDownload(plan.downloads, () => this.runDatabase(plan.downloads.map((item) => item.id)));
        return;
      }
      await this.runDatabase([]);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not create the database');
    } finally {
      this.busy.set(false);
    }
  }

  private async runDatabase(acceptDownloads: string[]): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const created = await this.data.createDatabase(this.serverId(), this.databaseName().trim(), acceptDownloads);
      if (created.status === 'installer') {
        this.notice.set(created.message);
        return;
      }
      this.shownPasswordId.set(created.id);
      this.shownPassword.set(created.password);
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not create the database');
    } finally {
      this.busy.set(false);
    }
  }

  protected cancelDownload(): void {
    this.promptItems.set(null);
    this.promptAction = null;
  }

  protected async agreeDownload(): Promise<void> {
    const action = this.promptAction;
    this.promptItems.set(null);
    this.promptAction = null;
    if (action) await action();
  }

  private askDownload(items: DownloadOffer[], action: () => Promise<void>): void {
    this.promptItems.set(items);
    this.promptAction = action;
  }

  protected async showDatabasePassword(id: string): Promise<void> {
    if (this.shownPasswordId() === id) {
      this.shownPasswordId.set('');
      this.shownPassword.set('');
      return;
    }
    this.error.set(null);
    try {
      const result = await this.data.databasePassword(this.serverId(), id);
      this.shownPasswordId.set(id);
      this.shownPassword.set(result.password);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not read the password');
    }
  }

  protected async rotateDatabase(id: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.data.rotateDatabasePassword(this.serverId(), id);
      this.shownPasswordId.set(id);
      this.shownPassword.set(result.password);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not change the password');
    } finally {
      this.busy.set(false);
    }
  }

  protected async removeDatabase(id: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.data.deleteDatabase(this.serverId(), id);
      if (this.shownPasswordId() === id) {
        this.shownPasswordId.set('');
        this.shownPassword.set('');
      }
      await this.load();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not delete the database');
    } finally {
      this.busy.set(false);
    }
  }

  protected address(server: ServerView): string {
    return server.allocation ? `${server.allocation.ip}:${server.allocation.port}` : 'No port reserved';
  }

  protected startup(server: ServerView): string {
    return server.command.join(' ');
  }
}

function plainName(name: string): boolean {
  return name.length > 0 && name.length <= 120 && name !== '.' && name !== '..' && !/[\\/\0]/.test(name);
}

function parentPath(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? '' : filePath.slice(0, index);
}

function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

function unusedCopyName(name: string, takenNames: string[]): string {
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const taken = new Set(takenNames);
  let candidate = `${stem} copy${ext}`;
  let count = 2;
  while (taken.has(candidate)) {
    candidate = `${stem} copy ${count}${ext}`;
    count += 1;
  }
  return candidate;
}

function folderForProvider(provider: string | undefined): 'plugins' | 'mods' | null {
  if (provider === 'fabric' || provider === 'quilt' || provider === 'forge' || provider === 'neoforge') return 'mods';
  if (provider === 'paper' || provider === 'purpur' || provider === 'spigot') return 'plugins';
  return null;
}
