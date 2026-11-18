import { Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import type { McPlayer, McPlayerAction, McPlayers } from '@hotbar/shared';
import { parseOnlineList, parsePresence } from '@hotbar/shared';
import { DataSource } from '../core/data-source';

@Component({
  selector: 'app-players-panel',
  templateUrl: './players-panel.html',
})
export class PlayersPanel {
  readonly serverId = input.required<string>();

  private readonly data = inject(DataSource);
  private detach: (() => void) | null = null;
  private generation = 0;
  private since = '';

  protected readonly error = signal<string | null>(null);
  protected readonly notice = signal('');
  protected readonly busy = signal(false);
  protected readonly minecraft = signal(true);
  protected readonly running = signal(false);
  protected readonly online = signal(0);
  protected readonly max = signal<number | null>(null);
  protected readonly whitelist = signal<boolean | null>(null);
  protected readonly players = signal<McPlayer[]>([]);
  protected readonly reason = signal('');
  protected readonly menu = signal<{ x: number; y: number; player: McPlayer } | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.detach?.());
    effect(() => {
      const id = this.serverId();
      untracked(() => void this.open(id));
    });
  }

  protected async refresh(): Promise<void> {
    await this.open(this.serverId());
  }

  protected openMenu(event: MouseEvent, player: McPlayer): void {
    event.preventDefault();
    event.stopPropagation();
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - 200));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - 240));
    this.menu.set({ x, y, player });
  }

  protected closeMenu(): void {
    this.menu.set(null);
  }

  protected async act(action: McPlayerAction, player?: McPlayer): Promise<void> {
    this.closeMenu();
    this.busy.set(true);
    this.notice.set('');
    try {
      const next = await this.data.playerAction(this.serverId(), {
        action,
        name: player?.name,
        reason: this.reason().trim(),
      });
      this.apply(next);
      this.error.set(null);
      this.notice.set(actionNotice(action, player?.name));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not update that player');
    } finally {
      this.busy.set(false);
    }
  }

  private async open(id: string): Promise<void> {
    const generation = ++this.generation;
    this.detach?.();
    this.detach = null;
    if (!id) return;
    this.since = new Date().toISOString();
    try {
      const snapshot = await this.data.players(id);
      if (generation !== this.generation) return;
      this.apply(snapshot);
      this.error.set(null);
      this.detach = await this.data.attachLogs(id, (line) => {
        if (generation !== this.generation || line.at < this.since) return;
        this.onLog(line.line);
      });
    } catch (error) {
      if (generation === this.generation) this.error.set(error instanceof Error ? error.message : 'Could not load players');
    }
  }

  private onLog(line: string): void {
    const listed = parseOnlineList(line);
    if (listed) {
      this.applyLive(listed);
      return;
    }
    const presence = parsePresence(line);
    if (!presence) return;
    const key = presence.name.toLowerCase();
    const current = this.players();
    const existing = current.some((player) => player.name.toLowerCase() === key);
    const next = existing
      ? current.map((player) => (player.name.toLowerCase() === key ? { ...player, online: presence.online } : player))
      : [...current, { name: presence.name, online: presence.online, op: false, whitelisted: false, banned: false, banReason: null }];
    next.sort(byOnlineThenName);
    this.players.set(next);
    this.online.set(next.filter((player) => player.online).length);
  }

  private apply(snapshot: McPlayers): void {
    this.minecraft.set(snapshot.minecraft);
    this.running.set(snapshot.running);
    this.online.set(snapshot.online);
    this.max.set(snapshot.max);
    this.whitelist.set(snapshot.whitelist);
    this.players.set(snapshot.players);
  }

  private applyLive(live: { online: number; max: number; names: string[] }): void {
    const online = new Set(live.names.map((name) => name.toLowerCase()));
    const next = this.players().map((player) => ({ ...player, online: online.has(player.name.toLowerCase()) }));
    for (const name of live.names) {
      if (!next.some((player) => player.name.toLowerCase() === name.toLowerCase())) {
        next.push({ name, online: true, op: false, whitelisted: false, banned: false, banReason: null });
      }
    }
    next.sort(byOnlineThenName);
    this.players.set(next);
    this.online.set(live.online);
    this.max.set(live.max);
  }
}

function byOnlineThenName(a: McPlayer, b: McPlayer): number {
  return Number(b.online) - Number(a.online) || a.name.localeCompare(b.name);
}

function actionNotice(action: McPlayerAction, name: string | undefined): string {
  if (action === 'whitelist-on') return 'The whitelist is on.';
  if (action === 'whitelist-off') return 'The whitelist is off.';
  if (!name) return '';
  if (action === 'kick') return `Kicked ${name}.`;
  if (action === 'ban') return `Banned ${name}.`;
  if (action === 'pardon') return `Pardoned ${name}.`;
  if (action === 'op') return `${name} is now an operator.`;
  if (action === 'deop') return `${name} is no longer an operator.`;
  if (action === 'whitelist-add') return `Added ${name} to the whitelist.`;
  return `Removed ${name} from the whitelist.`;
}
