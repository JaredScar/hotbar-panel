import { Component, DestroyRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { LogLine, PowerAction, ServerView } from '@hotbar/shared';
import { ServerTerminal } from '../components/server-terminal';
import { UsageChart } from '../components/usage-chart';
import { DataSource } from '../core/data-source';
import { formatBytes, formatPercent, formatUptime, serverAddress, statusLabel } from '../core/format';
import { interval } from 'rxjs';

@Component({
  selector: 'app-console-page',
  imports: [RouterLink, ServerTerminal, UsageChart],
  templateUrl: './console-page.html',
})
export class ConsolePage {
  protected readonly data = inject(DataSource);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly terminal = viewChild(ServerTerminal);

  protected readonly serverId = signal(this.route.snapshot.paramMap.get('serverId') ?? '');
  protected readonly command = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly confirmDelete = signal(false);
  protected readonly reach = signal<string | null>(null);
  protected readonly busy = signal(false);
  private readonly now = signal(Date.now());
  private detachLogs: (() => void) | null = null;
  private readonly buffered: LogLine[] = [];

  protected readonly server = computed(() => this.data.servers().find((item) => item.id === this.serverId()) ?? null);
  protected readonly cpuSeries = computed(() => {
    this.data.revision();
    return this.data.statsHistory(this.serverId()).map((sample) => sample.cpuPercent);
  });
  protected readonly memorySeries = computed(() => {
    this.data.revision();
    return this.data.statsHistory(this.serverId()).map((sample) => sample.memoryBytes / (1024 * 1024));
  });

  protected readonly address = serverAddress;
  protected readonly statusLabel = statusLabel;
  protected readonly formatBytes = formatBytes;
  protected readonly formatPercent = formatPercent;

  constructor() {
    effect(() => {
      const term = this.terminal();
      if (!term || this.buffered.length === 0) return;
      for (const line of this.buffered.splice(0)) term.write(line);
    });
    interval(1000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));
    void this.openLogs();
    this.destroyRef.onDestroy(() => this.detachLogs?.());
  }

  protected uptime(server: ServerView): string {
    this.now();
    if (!server.startedAt || server.state === 'offline') return '—';
    return formatUptime(Date.now() - Date.parse(server.startedAt));
  }

  protected async power(action: PowerAction): Promise<void> {
    this.error.set(null);
    this.busy.set(true);
    try {
      await this.data.power(this.serverId(), action);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Power action failed');
    } finally {
      this.busy.set(false);
    }
  }

  protected async send(event: Event): Promise<void> {
    event.preventDefault();
    const line = this.command().trim();
    if (!line) return;
    this.command.set('');
    try {
      await this.data.sendCommand(this.serverId(), line);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not send command');
    }
  }

  protected async checkReach(): Promise<void> {
    try {
      const result = await this.data.reachability(this.serverId());
      const share = result.addresses.at(-1) ?? 'the server address';
      this.reach.set(
        result.local
          ? `Open on this computer. Share ${share}.`
          : 'Nothing is accepting connections yet. The server may still be starting.',
      );
    } catch (error) {
      this.reach.set(error instanceof Error ? error.message : 'Could not check the port');
    }
  }

  protected async remove(): Promise<void> {
    this.error.set(null);
    try {
      await this.data.deleteServer(this.serverId());
      await this.router.navigateByUrl(this.data.remote() ? '/panel' : '/');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not delete the server');
    }
  }

  private writeLine(line: LogLine): void {
    const term = this.terminal();
    if (!term) {
      this.buffered.push(line);
      return;
    }
    term.write(line);
  }

  private async openLogs(): Promise<void> {
    const id = this.serverId();
    if (!id) return;
    try {
      this.detachLogs = await this.data.attachLogs(id, (line) => this.writeLine(line));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not open the console');
    }
  }
}
