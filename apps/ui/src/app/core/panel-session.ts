import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class PanelSession {
  readonly url = signal(readStorage('hotbar.panel.url') ?? 'http://127.0.0.1:3000');
  readonly token = signal<string | null>(readStorage('hotbar.panel.token'));

  setSession(url: string, token: string): void {
    const normalized = url.replace(/\/$/, '');
    this.url.set(normalized);
    this.token.set(token);
    writeStorage('hotbar.panel.url', normalized);
    writeStorage('hotbar.panel.token', token);
  }

  clear(): void {
    this.token.set(null);
    removeStorage('hotbar.panel.token');
  }

  async createPairingCode(): Promise<string> {
    const result = await this.request<{ code: string }>('POST', '/api/pairings');
    return result.code;
  }

  async request<T>(method: string, pathname: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.url()}${pathname}`, {
        method,
        headers: {
          ...(this.token() ? { authorization: `Bearer ${this.token()}` } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error('Can’t reach the panel.');
    }
    if (response.status === 204) return undefined as T;
    const payload = (await response.json()) as T & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? `Request failed (${response.status})`);
    return payload;
  }
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode can reject storage. The session still works until reload.
  }
}

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}
