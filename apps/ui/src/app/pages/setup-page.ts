import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { SetupStatus } from '@hotbar/shared';
import { DataSource } from '../core/data-source';

@Component({
  selector: 'app-setup-page',
  imports: [RouterLink],
  templateUrl: './setup-page.html',
})
export class SetupPage {
  private readonly data = inject(DataSource);
  private readonly router = inject(Router);
  protected readonly status = signal<SetupStatus | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.data.setup().then((status) => this.status.set(status)).catch((error: unknown) => {
      this.error.set(error instanceof Error ? error.message : 'Could not read setup');
    });
  }

  protected async finish(): Promise<void> {
    const status = await this.data.completeSetup();
    this.status.set(status);
    await this.router.navigateByUrl('/create');
  }
}
