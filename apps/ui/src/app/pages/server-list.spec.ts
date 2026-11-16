import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ServerView } from '@hotbar/shared';
import { DataSource } from '../core/data-source';
import { ServerListPage } from './server-list';

function server(name: string): ServerView {
  return {
    id: name,
    name,
    templateId: null,
    templateVersion: null,
    command: ['server'],
    cwd: 'C:\\servers',
    env: {},
    stop: { timeoutMs: 1000 },
    allocation: { ip: '127.0.0.1', port: 25565, primary: true },
    limits: { cpu: 0, memory: 0, disk: 0 },
    autoStart: false,
    autoRestart: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    state: 'offline',
    stats: null,
    startedAt: null,
    pid: null,
  };
}

describe('ServerListPage', () => {
  const servers = signal<ServerView[]>([]);

  beforeEach(async () => {
    servers.set([]);
    await TestBed.configureTestingModule({
      imports: [ServerListPage],
      providers: [
        provideRouter([]),
        {
          provide: DataSource,
          useValue: {
            servers,
            connected: signal(true),
            connectionError: signal(null),
            dev: signal(false),
            revision: signal(0),
            remote: signal(false),
            linkedPanel: signal(null),
          },
        },
      ],
    }).compileComponents();
  });

  it('shows an empty state', async () => {
    const fixture = TestBed.createComponent(ServerListPage);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('No servers yet');
  });

  it('renders a server row with its address', async () => {
    servers.set([server('Paper')]);
    const fixture = TestBed.createComponent(ServerListPage);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Paper');
    expect(text).toContain('127.0.0.1:25565');
  });
});
