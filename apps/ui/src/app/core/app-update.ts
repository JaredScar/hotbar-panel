import { Injectable, signal } from '@angular/core';
import { HOTBAR_VERSION, RELEASE_REPOSITORY, isNewer } from '@hotbar/shared';

@Injectable({ providedIn: 'root' })
export class AppUpdate {
  readonly current = signal<string | null>(null);
  readonly latest = signal<string | null>(null);
  readonly available = signal(false);
  readonly releaseUrl = signal<string | null>(null);
  readonly canInstall = signal(false);
  readonly busy = signal(false);
  readonly progress = signal<number | null>(null);
  readonly error = signal<string | null>(null);
  readonly message = signal<string | null>(null);

  constructor() {
    window.hotbar?.onUpdateProgress?.((progress) => {
      if (progress.total > 0) this.progress.set(Math.min(100, Math.round((progress.received / progress.total) * 100)));
    });
    void this.check(false);
    setInterval(() => void this.check(false), 6 * 60 * 60 * 1000);
  }

  async check(reportError: boolean): Promise<void> {
    this.error.set(null);
    try {
      if (window.hotbar?.checkForUpdate) {
        const status = await window.hotbar.checkForUpdate();
        this.current.set(status.current);
        this.latest.set(status.latest);
        this.available.set(status.available);
        this.releaseUrl.set(status.releaseUrl);
        this.canInstall.set(status.packaged);
        return;
      }
      const response = await fetch(`https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'Hotbar' },
      });
      if (!response.ok) throw new Error('Could not reach GitHub to check for an update');
      const body = (await response.json()) as { tag_name?: string };
      const latest = (body.tag_name ?? '').replace(/^v/, '');
      this.current.set(HOTBAR_VERSION);
      this.latest.set(latest || null);
      this.available.set(isNewer(latest, HOTBAR_VERSION));
      this.releaseUrl.set(latest ? `https://github.com/${RELEASE_REPOSITORY}/releases/tag/v${latest}` : null);
      this.canInstall.set(false);
    } catch (error) {
      if (reportError) this.error.set(error instanceof Error ? error.message : 'Could not check for an update');
    }
  }

  async install(): Promise<void> {
    if (!window.hotbar?.installUpdate) return;
    this.busy.set(true);
    this.error.set(null);
    this.message.set(null);
    this.progress.set(0);
    try {
      const result = await window.hotbar.installUpdate();
      if (!result.replacing) this.message.set('The installer is open. Finish it, then reopen Hotbar. Game servers keep running.');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not install the update');
      this.busy.set(false);
      this.progress.set(null);
    }
  }
}
