import 'reflect-metadata';
import { Catch, Controller, Delete, Get, HttpException, Module, Post, Req, Res, type ArgumentsHost, type DynamicModule, type ExceptionFilter } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response } from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { Hub } from './hub.js';
import { PanelError, PanelStore } from './store.js';

@Catch()
class PanelFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{ status: (code: number) => { json: (body: unknown) => void } }>();
    if (error instanceof PanelError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json({ error: httpMessage(error) });
      return;
    }
    response.status(500).json({ error: 'internal error' });
  }
}

@Controller()
class HealthController {
  @Get()
  root(@Req() request: Request, @Res() response: Response): void {
    const ui = (process.env['HOTBAR_UI_URL'] ?? 'http://127.0.0.1:4200').replace(/\/$/, '');
    const accept = request.header('accept') ?? '';
    if (accept.includes('text/html')) {
      response.redirect(302, `${ui}/panel`);
      return;
    }
    response.json({ ok: true, service: 'hotbar-panel', accounts: true, ui: `${ui}/panel` });
  }

  @Get('health')
  health(): { ok: true; service: string; accounts: true } {
    return { ok: true, service: 'hotbar-panel', accounts: true };
  }
}

function httpMessage(error: HttpException): string {
  const body = error.getResponse();
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object' && 'message' in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.map(String).join(', ');
  }
  return 'request failed';
}

@Controller('api')
class ApiController {
  constructor(
    private readonly store: PanelStore,
    private readonly hub: Hub,
  ) {}

  @Post('auth/register')
  register(@Req() request: Request): Promise<unknown> {
    const body = request.body as { email?: string; password?: string };
    return this.store.register(body?.email ?? '', body?.password ?? '');
  }

  @Post('auth/login')
  login(@Req() request: Request): Promise<unknown> {
    const body = request.body as { email?: string; password?: string; code?: string };
    return this.store.login(body?.email ?? '', body?.password ?? '', request.ip ?? 'unknown', typeof body?.code === 'string' ? body.code : '');
  }

  @Post('auth/passkey/options')
  passkeyOptions(@Req() request: Request): Promise<unknown> {
    return this.store.passkeyLoginOptions(request.ip ?? 'unknown');
  }

  @Post('auth/passkey')
  passkey(@Req() request: Request): Promise<unknown> {
    return this.store.passkeyLogin(request.body as never, request.ip ?? 'unknown');
  }

  @Post('auth/refresh')
  refresh(@Req() request: Request): unknown {
    const body = request.body as { refreshToken?: string };
    return this.store.refresh(body?.refreshToken ?? '');
  }

  @Get('auth/me')
  me(@Req() request: Request): unknown {
    return this.user(request);
  }

  @Post('pairings')
  pairings(@Req() request: Request): unknown {
    const user = this.user(request);
    return this.store.createPairing(user.id);
  }

  @Post('pair')
  pair(@Req() request: Request): unknown {
    this.store.limit(`pair:${request.ip ?? 'unknown'}`);
    const body = request.body as { code?: string; publicKey?: string; hostname?: string; os?: string };
    return this.store.consumePairing({
      code: body?.code ?? '',
      publicKey: body?.publicKey ?? '',
      hostname: body?.hostname ?? '',
      os: body?.os ?? '',
    });
  }

  @Get('servers')
  servers(@Req() request: Request): unknown {
    return this.store.listServers(this.user(request).id);
  }

  @Get('servers/:id')
  server(@Req() request: Request): unknown {
    const owned = this.store.ownedServer(this.user(request).id, param(request));
    if (!owned) throw new PanelError(404, 'server not found');
    return owned.view;
  }

  @Post('servers/:id/power')
  power(@Req() request: Request): Promise<unknown> {
    const body = request.body as { action?: string };
    return this.hub.power(this.user(request).id, param(request), body?.action ?? '');
  }

  @Post('servers/:id/stdin')
  stdin(@Req() request: Request): { ok: true } {
    const body = request.body as { line?: string };
    this.hub.stdin(this.user(request).id, param(request), body?.line ?? '');
    return { ok: true };
  }

  @Get('servers/:id/logs')
  logs(@Req() request: Request): Promise<unknown> {
    return this.hub.logs(this.user(request).id, param(request));
  }

  @Get('servers/:id/players')
  players(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'players.list', {});
  }

  @Post('servers/:id/players')
  playerAction(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'players.action', request.body ?? {});
  }

  @Get('servers/:id/files')
  files(@Req() request: Request): Promise<unknown> {
    const query = request.query as { path?: string };
    return this.hub.rpc(this.user(request).id, param(request), 'files.list', { path: query.path ?? '' });
  }

  @Get('servers/:id/files/content')
  fileContent(@Req() request: Request): Promise<unknown> {
    const query = request.query as { path?: string };
    return this.hub.rpc(this.user(request).id, param(request), 'files.read', { path: query.path ?? '' });
  }

  @Post('servers/:id/files/content')
  writeFile(@Req() request: Request): Promise<unknown> {
    const body = request.body as { path?: string; text?: string };
    return this.hub.rpc(this.user(request).id, param(request), 'files.write', body ?? {});
  }

  @Post('servers/:id/files/mkdir')
  mkdir(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'files.mkdir', request.body ?? {});
  }

  @Post('servers/:id/files/rename')
  renameFile(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'files.rename', request.body ?? {});
  }

  @Post('servers/:id/files/upload')
  upload(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'files.upload', request.body ?? {});
  }

  @Delete('servers/:id/files')
  deleteFile(@Req() request: Request): Promise<unknown> {
    const query = request.query as { path?: string };
    return this.hub.rpc(this.user(request).id, param(request), 'files.delete', { path: query.path ?? '' });
  }

  @Get('servers/:id/backups')
  backups(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'backups.list', {});
  }

  @Post('servers/:id/backups')
  createBackup(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'backups.create', {});
  }

  @Post('servers/:id/backups/restore')
  restoreBackup(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'backups.restore', request.body ?? {});
  }

  @Delete('servers/:id/backups')
  deleteBackup(@Req() request: Request): Promise<unknown> {
    const query = request.query as { name?: string };
    return this.hub.rpc(this.user(request).id, param(request), 'backups.delete', { name: query.name ?? '' });
  }

  @Get('servers/:id/schedules')
  schedules(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'schedules.list', {});
  }

  @Post('servers/:id/schedules')
  createSchedule(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'schedules.create', request.body ?? {});
  }

  @Delete('servers/:id/schedules/:scheduleId')
  deleteSchedule(@Req() request: Request): Promise<unknown> {
    const scheduleId = request.params['scheduleId'];
    return this.hub.rpc(this.user(request).id, param(request), 'schedules.delete', { scheduleId: typeof scheduleId === 'string' ? scheduleId : '' });
  }

  @Get('modpacks')
  modpacks(@Req() request: Request): Promise<unknown> {
    const query = request.query as { q?: string };
    const servers = this.store.listServers(this.user(request).id);
    const server = servers[0];
    if (!server) throw new PanelError(404, 'no server is linked');
    return this.hub.rpc(this.user(request).id, server.id, 'modpacks.search', { q: query.q ?? '' });
  }

  @Post('servers/:id/modpack')
  modpack(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'modpack.install', request.body ?? {});
  }

  @Get('servers/:id/addons')
  addons(@Req() request: Request): Promise<unknown> {
    const query = request.query as { q?: string };
    return this.hub.rpc(this.user(request).id, param(request), 'addons.search', { q: query.q ?? '' });
  }

  @Post('servers/:id/addons')
  installAddon(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'addon.install', request.body ?? {});
  }

  @Get('servers/:id/databases/plan')
  databasePlan(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'databases.plan', {});
  }

  @Get('servers/:id/databases')
  databases(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'databases.list', {});
  }

  @Post('servers/:id/databases')
  createDatabase(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'databases.create', request.body ?? {});
  }

  @Get('servers/:id/databases/:databaseId/password')
  databasePassword(@Req() request: Request): Promise<unknown> {
    const databaseId = request.params['databaseId'];
    return this.hub.rpc(this.user(request).id, param(request), 'databases.password', {
      databaseId: typeof databaseId === 'string' ? databaseId : '',
    });
  }

  @Post('servers/:id/databases/:databaseId/password')
  rotateDatabase(@Req() request: Request): Promise<unknown> {
    const databaseId = request.params['databaseId'];
    return this.hub.rpc(this.user(request).id, param(request), 'databases.rotate', {
      databaseId: typeof databaseId === 'string' ? databaseId : '',
    });
  }

  @Delete('servers/:id/databases/:databaseId')
  deleteDatabase(@Req() request: Request): Promise<unknown> {
    const databaseId = request.params['databaseId'];
    return this.hub.rpc(this.user(request).id, param(request), 'databases.delete', {
      databaseId: typeof databaseId === 'string' ? databaseId : '',
    });
  }

  @Get('servers/:id/activity')
  serverActivity(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'activity.list', {});
  }

  @Get('servers/:id/install')
  install(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'install.read', {});
  }

  @Post('servers/:id/version')
  version(@Req() request: Request): Promise<unknown> {
    return this.hub.rpc(this.user(request).id, param(request), 'version.change', request.body ?? {});
  }

  @Get('nodes')
  nodes(@Req() request: Request): unknown {
    return this.store.listNodes(this.user(request).id);
  }

  @Post('auth/totp')
  beginTotp(@Req() request: Request): unknown {
    return this.store.beginTotp(this.user(request).id);
  }

  @Get('account/passkeys')
  passkeys(@Req() request: Request): unknown {
    return this.store.listPasskeys(this.user(request).id);
  }

  @Post('account/passkeys/options')
  passkeyRegistrationOptions(@Req() request: Request): Promise<unknown> {
    return this.store.passkeyRegistrationOptions(this.user(request).id);
  }

  @Post('account/passkeys')
  passkeyRegister(@Req() request: Request): Promise<unknown> {
    return this.store.passkeyRegister(this.user(request).id, request.body as never);
  }

  @Post('auth/totp/confirm')
  confirmTotp(@Req() request: Request): { ok: true } {
    const body = request.body as { code?: string };
    this.store.confirmTotp(this.user(request).id, body?.code ?? '');
    return { ok: true };
  }

  @Delete('auth/totp')
  disableTotp(@Req() request: Request): { ok: true } {
    const body = request.body as { code?: string };
    this.store.disableTotp(this.user(request).id, body?.code ?? '');
    return { ok: true };
  }

  @Get('account/keys')
  keys(@Req() request: Request): unknown {
    return this.store.listApiKeys(this.user(request).id);
  }

  @Post('account/keys')
  createKey(@Req() request: Request): unknown {
    const body = request.body as { name?: string };
    return this.store.createApiKey(this.user(request).id, body?.name ?? '');
  }

  @Delete('account/keys/:keyId')
  deleteKey(@Req() request: Request): { ok: true } {
    const keyId = request.params['keyId'];
    this.store.deleteApiKey(this.user(request).id, typeof keyId === 'string' ? keyId : '');
    return { ok: true };
  }

  @Get('servers/:id/users')
  users(@Req() request: Request): unknown {
    return this.store.listSubusers(this.user(request).id, param(request));
  }

  @Post('servers/:id/users')
  addUser(@Req() request: Request): { ok: true } {
    const body = request.body as { email?: string; permissions?: string[] };
    this.store.addSubuser(this.user(request).id, param(request), body?.email ?? '', Array.isArray(body?.permissions) ? body.permissions : []);
    return { ok: true };
  }

  @Delete('servers/:id/users/:userId')
  removeUser(@Req() request: Request): { ok: true } {
    const userId = request.params['userId'];
    this.store.removeSubuser(this.user(request).id, param(request), typeof userId === 'string' ? userId : '');
    return { ok: true };
  }

  private user(request: Request): { id: string; email: string } {
    const header = request.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const user = this.store.userFromToken(token);
    if (!user) throw new PanelError(401, 'unauthorized');
    return user;
  }
}

function param(request: Request): string {
  const value = request.params['id'];
  return typeof value === 'string' ? value : '';
}

export interface RunningPanel {
  port: number;
  close: () => Promise<void>;
}

@Module({})
class PanelModule {
  static forRoot(store: PanelStore, hub: Hub): DynamicModule {
    return {
      module: PanelModule,
      controllers: [HealthController, ApiController],
      providers: [
        { provide: PanelStore, useValue: store },
        { provide: Hub, useValue: hub },
      ],
    };
  }
}

export async function createPanel(options: { dataDir: string; host: string; port: number }): Promise<RunningPanel> {
  const store = new PanelStore(options.dataDir);
  const hub = new Hub(store);
  const app = await NestFactory.create(PanelModule.forRoot(store, hub), { logger: false });
  app.useGlobalFilters(new PanelFilter());
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin || loopbackOrigin(origin)) callback(null, true);
      else callback(null, false);
    },
    allowedHeaders: ['authorization', 'content-type'],
  });
  await app.listen(options.port, options.host);
  const server = app.getHttpServer() as ReturnType<typeof createServer>;
  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/api/agents') {
      sockets.handleUpgrade(request, socket, head, (ws) => hub.acceptAgent(ws));
      return;
    }
    if (url.pathname === '/api/console') {
      const origin = request.headers.origin;
      if (origin && !loopbackOrigin(origin)) {
        socket.destroy();
        return;
      }
      const user = store.userFromToken(url.searchParams.get('access_token') ?? '');
      if (!user) {
        socket.destroy();
        return;
      }
      sockets.handleUpgrade(request, socket, head, (ws) => hub.acceptBrowser(ws, user.id));
      return;
    }
    socket.destroy();
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    port,
    close: async () => {
      hub.close();
      sockets.close();
      await app.close();
      store.close();
    },
  };
}

function loopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const host = process.env['HOST'] ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '0.0.0.0') throw new Error('HOST must be 127.0.0.1 or 0.0.0.0');
  const dataDir = path.resolve(process.env['HOTBAR_PANEL_DATA'] ?? path.join(process.cwd(), '.hotbar-panel'));
  const port = Number(process.env['PORT'] ?? 3000);
  const running = await createPanel({ dataDir, host, port });
  process.stdout.write(`HOTBAR_PANEL_READY port=${running.port}\n`);
}

if (require.main === module) {
  void main();
}
