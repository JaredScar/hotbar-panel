import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DataSource } from '../core/data-source';

@Component({
  selector: 'app-properties-page',
  templateUrl: './properties-page.html',
})
export class PropertiesPage {
  private readonly data = inject(DataSource);
  private readonly route = inject(ActivatedRoute);

  protected readonly serverId = signal(this.route.snapshot.paramMap.get('serverId') ?? '');
  protected readonly values = signal<Record<string, string>>({});
  protected readonly error = signal<string | null>(null);
  protected readonly saved = signal(false);
  protected readonly busy = signal(false);

  constructor() {
    void this.load();
  }

  protected value(key: string, fallback = ''): string {
    return this.values()[key] ?? fallback;
  }

  protected setValue(key: string, value: string): void {
    this.saved.set(false);
    this.values.update((current) => ({ ...current, [key]: value }));
  }

  protected async save(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.saved.set(false);
    const current = this.values();
    const payload: Record<string, string> = {
      motd: current['motd'] ?? '',
      gamemode: current['gamemode'] ?? 'survival',
      difficulty: current['difficulty'] ?? 'easy',
      'max-players': current['max-players'] ?? '20',
      'white-list': current['white-list'] ?? 'false',
      'enforce-whitelist': current['white-list'] ?? 'false',
      'online-mode': current['online-mode'] ?? 'true',
      'level-seed': current['level-seed'] ?? '',
      'server-port': current['server-port'] ?? '',
    };
    try {
      const result = await this.data.writeProperties(this.serverId(), payload);
      this.values.set(result.values);
      this.saved.set(true);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not save');
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      const result = await this.data.readProperties(this.serverId());
      this.values.set(result.values);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not read server.properties');
    }
  }
}
