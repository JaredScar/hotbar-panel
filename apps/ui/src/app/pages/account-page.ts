import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { startRegistration } from '@simplewebauthn/browser';
import type { ServerView } from '@hotbar/shared';
import { PanelSession } from '../core/panel-session';

@Component({
  selector: 'app-account-page',
  imports: [RouterLink],
  templateUrl: './account-page.html',
})
export class AccountPage {
  private readonly session = inject(PanelSession);
  protected readonly error = signal<string | null>(null);
  protected readonly secret = signal('');
  protected readonly code = signal('');
  protected readonly keyName = signal('script');
  protected readonly newKey = signal('');
  protected readonly keys = signal<Array<{ id: string; name: string }>>([]);
  protected readonly nodes = signal<Array<{ id: string; hostname: string; os: string }>>([]);
  protected readonly servers = signal<ServerView[]>([]);
  protected readonly email = signal('');
  protected readonly serverId = signal('');
  protected readonly passkeys = signal<Array<{ id: string }>>([]);
  protected readonly message = signal('');

  constructor() {
    void this.reload();
  }

  protected async reload(): Promise<void> {
    try {
      const [keys, nodes, servers, passkeys] = await Promise.all([
        this.session.request<Array<{ id: string; name: string }>>('GET', '/api/account/keys'),
        this.session.request<Array<{ id: string; hostname: string; os: string }>>('GET', '/api/nodes'),
        this.session.request<ServerView[]>('GET', '/api/servers'),
        this.session.request<Array<{ id: string }>>('GET', '/api/account/passkeys'),
      ]);
      this.keys.set(keys);
      this.nodes.set(nodes);
      this.servers.set(servers);
      this.passkeys.set(passkeys);
      if (!this.serverId() && servers[0]) this.serverId.set(servers[0].id);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not load the account');
    }
  }

  protected async startTotp(): Promise<void> {
    const result = await this.session.request<{ secret: string }>('POST', '/api/auth/totp', {});
    this.secret.set(result.secret);
  }

  protected async confirmTotp(): Promise<void> {
    await this.session.request('POST', '/api/auth/totp/confirm', { code: this.code() });
    this.message.set('Authenticator is on. The next sign-in asks for a code.');
    this.secret.set('');
  }

  protected async makeKey(): Promise<void> {
    const result = await this.session.request<{ token: string }>('POST', '/api/account/keys', { name: this.keyName() });
    this.newKey.set(result.token);
    await this.reload();
  }

  protected async addPasskey(): Promise<void> {
    this.error.set(null);
    try {
      const options = await this.session.request<Parameters<typeof startRegistration>[0]['optionsJSON']>('POST', '/api/account/passkeys/options', {});
      const credential = await startRegistration({ optionsJSON: options });
      await this.session.request('POST', '/api/account/passkeys', credential);
      this.message.set('Passkey saved. The sign-in page can use it.');
      await this.reload();
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not add the passkey');
    }
  }

  protected async addUser(): Promise<void> {
    await this.session.request('POST', `/api/servers/${this.serverId()}/users`, {
      email: this.email(),
      permissions: ['server.read', 'control.start', 'control.stop', 'control.console'],
    });
    this.message.set('Sub-user added.');
    this.email.set('');
  }
}
