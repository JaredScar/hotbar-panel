import { Component, inject, signal } from '@angular/core';
import type { MachineInfo } from '@hotbar/shared';
import { DataSource } from '../core/data-source';
import { formatBytes, formatUptime } from '../core/format';

@Component({
  selector: 'app-machine-page',
  templateUrl: './machine-page.html',
})
export class MachinePage {
  private readonly data = inject(DataSource);
  protected readonly machine = signal<MachineInfo | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly linkError = signal<string | null>(null);
  protected readonly linkMessage = signal<string | null>(null);
  protected readonly linking = signal(false);
  protected readonly panelUrl = signal('http://127.0.0.1:3000');
  protected readonly code = signal('');
  protected readonly webhook = signal('');
  protected readonly webhookMessage = signal<string | null>(null);
  protected readonly formatBytes = formatBytes;
  protected readonly formatUptime = formatUptime;

  constructor() {
    void this.load();
  }

  protected async link(event: Event): Promise<void> {
    event.preventDefault();
    this.linking.set(true);
    this.linkError.set(null);
    this.linkMessage.set(null);
    try {
      const machine = await this.data.linkPanel(this.panelUrl().trim(), this.code().trim());
      this.machine.set(machine);
      this.linkMessage.set('This machine is linked. Servers appear in the panel.');
      this.code.set('');
    } catch (error) {
      this.linkError.set(error instanceof Error ? error.message : 'Could not link');
    } finally {
      this.linking.set(false);
    }
  }

  protected async unlink(): Promise<void> {
    this.linkError.set(null);
    try {
      this.machine.set(await this.data.unlinkPanel());
      this.linkMessage.set('Unlinked.');
    } catch (error) {
      this.linkError.set(error instanceof Error ? error.message : 'Could not unlink');
    }
  }

  protected async saveWebhook(event: Event): Promise<void> {
    event.preventDefault();
    this.webhookMessage.set(null);
    try {
      await this.data.saveWebhook(this.webhook().trim());
      this.webhookMessage.set('Saved. Hotbar posts here when a backup fails or a server stops restarting after 5 crashes.');
      this.webhook.set('');
    } catch (error) {
      this.webhookMessage.set(error instanceof Error ? error.message : 'Could not save');
    }
  }

  private async load(): Promise<void> {
    try {
      this.machine.set(await this.data.machine());
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not read this machine');
    }
  }
}
