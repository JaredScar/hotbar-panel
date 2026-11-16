import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { ServerView } from '@hotbar/shared';
import { RegisterDialog } from '../components/register-dialog';
import { DataSource } from '../core/data-source';
import { formatBytes, formatPercent, serverAddress, statusColor, statusLabel } from '../core/format';
import { PanelSession } from '../core/panel-session';
import { ServerSearch } from '../core/search';

@Component({
  selector: 'app-server-list',
  imports: [RouterLink, RegisterDialog],
  templateUrl: './server-list.html',
})
export class ServerListPage {
  protected readonly data = inject(DataSource);
  protected readonly search = inject(ServerSearch);
  private readonly panel = inject(PanelSession);
  private readonly router = inject(Router);
  protected readonly pairingCode = signal<string | null>(null);
  protected readonly creating = signal(false);
  protected readonly formatBytes = formatBytes;
  protected readonly formatPercent = formatPercent;
  protected readonly address = serverAddress;
  protected readonly statusColor = statusColor;
  protected readonly statusLabel = statusLabel;

  protected readonly filtered = computed(() => {
    const query = this.search.query().trim().toLowerCase();
    const servers = this.data.servers();
    if (!query) return servers;
    return servers.filter((server) => {
      const haystack = `${server.name} ${serverAddress(server)}`.toLowerCase();
      return haystack.includes(query);
    });
  });

  protected async pair(): Promise<void> {
    try {
      const code = await this.panel.createPairingCode();
      this.pairingCode.set(code);
    } catch (error) {
      this.pairingCode.set(error instanceof Error ? error.message : 'Could not create a code');
    }
  }

  protected signOut(): void {
    this.panel.clear();
    void this.router.navigateByUrl('/panel/login');
  }

  protected memoryLabel(server: ServerView): string {
    const used = formatBytes(server.stats?.memoryBytes ?? 0);
    if (!server.limits.memory) return used;
    return `${used} / ${formatBytes(server.limits.memory)}`;
  }
}
