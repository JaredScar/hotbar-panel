import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { DataSource } from '../core/data-source';
import { ServerNav } from './server-nav';

@Component({
  selector: 'app-server-shell',
  imports: [RouterOutlet, ServerNav],
  template: `
    <section class="flex min-h-0 flex-1 flex-col">
      <app-server-nav [serverId]="serverId()" [remote]="data.remote()" [templateId]="templateId()" />
      <router-outlet />
    </section>
  `,
})
export class ServerShell {
  protected readonly data = inject(DataSource);
  private readonly route = inject(ActivatedRoute);
  protected readonly serverId = signal(this.route.snapshot.paramMap.get('serverId') ?? '');
  protected readonly templateId = computed(() => this.data.servers().find((server) => server.id === this.serverId())?.templateId ?? null);
}
