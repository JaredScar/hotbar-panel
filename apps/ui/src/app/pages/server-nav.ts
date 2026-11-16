import { Component, computed, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-server-nav',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <nav class="flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-line px-4">
      @for (tab of tabs(); track tab.label) {
        <a
          [routerLink]="tab.path"
          routerLinkActive="border-accent text-ink"
          [routerLinkActiveOptions]="{ exact: tab.exact }"
          class="shrink-0 border-b-2 border-transparent px-3 py-2 text-sm text-faint no-underline hover:text-ink"
        >
          {{ tab.label }}
        </a>
      }
      <a [routerLink]="remote() ? '/panel' : '/'" class="shrink-0 px-3 py-2 text-sm text-faint no-underline hover:text-ink">Servers</a>
    </nav>
  `,
})
export class ServerNav {
  readonly serverId = input.required<string>();
  readonly remote = input(false);
  readonly templateId = input<string | null>(null);

  protected readonly tabs = computed(() => {
    const id = this.serverId();
    const base = this.remote() ? ['/panel', 'server', id] : ['/server', id];
    const link = (segment: string) => (segment ? [...base, segment] : base);
    const tabs = [
      { label: 'Console', path: link(''), exact: true },
      { label: 'Files', path: link('files'), exact: false },
      { label: 'Backups', path: link('backups'), exact: false },
      { label: 'Schedules', path: link('schedules'), exact: false },
      { label: 'Network', path: link('network'), exact: false },
      { label: 'Startup', path: link('startup'), exact: false },
      { label: 'Activity', path: link('activity'), exact: false },
      { label: 'Players', path: link('players'), exact: false },
      { label: 'Plugins', path: link('plugins'), exact: false },
      { label: 'World', path: link('world'), exact: false },
      { label: 'Properties', path: link('properties'), exact: false },
      { label: 'Version', path: link('version'), exact: false },
      { label: 'Users', path: link('users'), exact: false },
      { label: 'Databases', path: link('databases'), exact: false },
    ];
    if (this.templateId() === 'fivem') tabs.splice(2, 0, { label: 'Resources', path: link('resources'), exact: false });
    return tabs;
  });
}
