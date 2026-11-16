import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { startAuthentication } from '@simplewebauthn/browser';
import { PanelSession } from '../core/panel-session';

@Component({
  selector: 'app-panel-login',
  imports: [RouterLink],
  templateUrl: './panel-login.html',
})
export class PanelLoginPage {
  private readonly session = inject(PanelSession);
  private readonly router = inject(Router);

  protected readonly url = signal(this.session.url());
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly code = signal('');
  protected readonly creating = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.busy.set(true);
    this.error.set(null);
    const path = this.creating() ? '/api/auth/register' : '/api/auth/login';
    this.session.url.set(this.url().replace(/\/$/, ''));
    try {
      const result = await this.session.request<{ accessToken: string }>(
        'POST',
        path,
        { email: this.email().trim(), password: this.password(), code: this.code().trim() },
      );
      this.session.setSession(this.url(), result.accessToken);
      await this.router.navigateByUrl('/panel');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not sign in');
    } finally {
      this.busy.set(false);
    }
  }

  protected async usePasskey(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    this.session.url.set(this.url().replace(/\/$/, ''));
    try {
      const options = await this.session.request<Parameters<typeof startAuthentication>[0]['optionsJSON']>('POST', '/api/auth/passkey/options', {});
      const credential = await startAuthentication({ optionsJSON: options });
      const result = await this.session.request<{ accessToken: string }>('POST', '/api/auth/passkey', credential);
      this.session.setSession(this.url(), result.accessToken);
      await this.router.navigateByUrl('/panel');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not use the passkey');
    } finally {
      this.busy.set(false);
    }
  }
}
