import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  checkPropertyValue,
  GAMES,
  MC_PROVIDERS,
  type AgentEvent,
  type GameId,
  type InstallProgress,
  type McCreateRequest,
  type McDifficulty,
  type McGamemode,
  type McProviderId,
  type McVersion,
  type Reachability,
  type ServerProperties,
} from '@hotbar/shared';
import type { AgentConfig } from '../config.js';
import { insertInstall, insertSchedule, readInstall, updateInstall } from '../db.js';
import { assertDownloadAccepted, serverDownloadOffer } from '../downloads.js';
import { HttpError } from '../errors.js';
import { resolveInJail } from '../jail.js';
import type { ServerManager } from '../manager.js';
import { installFiveM, installHytale } from './games.js';
import { ensureJava } from './java.js';
import { argfileCommand, heapArgs, minecraftCommand } from './launch.js';
import { createServerBackup } from './backup.js';
import { allowFirewall, canBind, canBindUdp, displayAddress, nextFreePort, tcpOpen } from './network.js';
import { EULA_TEXT, initialProperties, parseProperties, updateProperties } from './properties.js';
import {
  installFabric,
  installForge,
  installNeoForge,
  installPaper,
  installPurpur,
  installQuilt,
  installSpigot,
  installVanilla,
  javaMajorFor,
  listProviderVersions,
} from './providers.js';

const MOTD_MAX = 256;
const GAMEMODES = new Set<McGamemode>(['survival', 'creative', 'adventure', 'spectator']);
const DIFFICULTIES = new Set<McDifficulty>(['peaceful', 'easy', 'normal', 'hard']);
export class MinecraftService {
  private readonly versionCache = new Map<string, { at: number; versions: McVersion[] }>();
  private readonly javaJobs = new Map<number, Promise<string>>();
  private readonly pendingPorts = new Set<number>();

  constructor(
    private readonly config: AgentConfig,
    private readonly manager: ServerManager,
    private readonly db: DatabaseSync,
    private readonly emit: (event: AgentEvent) => void,
  ) {}

  async versions(provider: string, snapshots: boolean): Promise<McVersion[]> {
    if (!isProvider(provider)) throw new HttpError(400, 'choose a Minecraft server type');
    const key = `${provider}:${snapshots ? 'all' : 'stable'}`;
    const cached = this.versionCache.get(key);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.versions;
    try {
      const versions = await this.loadVersions(provider, snapshots);
      this.versionCache.set(key, { at: Date.now(), versions });
      return versions;
    } catch (error) {
      throw new HttpError(502, clip(error));
    }
  }

  private async loadVersions(provider: McProviderId, snapshots: boolean): Promise<McVersion[]> {
    try {
      return await listProviderVersions(provider, snapshots);
    } catch {
      return listProviderVersions(provider, snapshots);
    }
  }

  begin(body: unknown): { jobId: string } {
    const input = readCreate(body);
    assertDownloadAccepted(body, [serverDownloadOffer(input.game, input.provider, input.version)]);
    const jobId = crypto.randomUUID();
    void this.install(jobId, input);
    return { jobId };
  }

  readProperties(id: string): ServerProperties {
    const server = this.manager.get(id);
    const file = resolveInJail(server.cwd, 'server.properties');
    if (!fs.existsSync(file)) return { values: {} };
    return { values: parseProperties(fs.readFileSync(file, 'utf8')) };
  }

  writeProperties(id: string, body: unknown): ServerProperties {
    const server = this.manager.get(id);
    const updates = readPropertyUpdates(body);
    const file = resolveInJail(server.cwd, 'server.properties');
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '#Minecraft server properties\n';
    const nextPort = updates['server-port'] ? Number(updates['server-port']) : null;
    const filePort = Number(parseProperties(current)['server-port']);
    const knownPort = server.allocation?.port ?? (Number.isInteger(filePort) ? filePort : null);
    if (nextPort !== null && nextPort !== knownPort) {
      this.manager.setPort(id, nextPort);
    }
    let next: string;
    try {
      next = updateProperties(current, updates);
    } catch (error) {
      throw new HttpError(400, clip(error));
    }
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, next);
      try {
        fs.renameSync(temporary, file);
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
        if (code !== 'EPERM' && code !== 'EEXIST' && code !== 'EBUSY') throw error;
        fs.copyFileSync(temporary, file);
        fs.rmSync(temporary, { force: true });
      }
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
        throw new HttpError(409, 'server.properties is in use. Stop the server, then save again.');
      }
      if (error instanceof HttpError) throw error;
      throw new HttpError(500, 'could not write server.properties');
    }
    return { values: parseProperties(next) };
  }

  currentInstall(id: string): { provider: string; version: string; javaMajor: number } | null {
    this.manager.get(id);
    return readInstall(this.db, id);
  }

  async changeVersion(id: string, provider: McProviderId, version: string): Promise<{ provider: string; version: string }> {
    if (!MC_PROVIDERS.includes(provider)) throw new HttpError(400, 'choose a Minecraft server type');
    if (!/^[A-Za-z0-9._+-]{1,64}$/.test(version)) throw new HttpError(400, 'version is not valid');
    const server = this.manager.get(id);
    if (server.state !== 'offline') throw new HttpError(409, 'stop the server before changing its version');
    const backup = await createServerBackup(this.config.dataDir, server.id, server.cwd);
    this.manager.note(server.id, `backup ${backup} written before the version change`);
    const memoryMb = Math.max(512, Math.round((server.limits.memory || 2 * 1024 * 1024 * 1024) / (1024 * 1024)));
    const major = provider === 'vanilla' || provider === 'paper' || provider === 'purpur' || provider === 'spigot' || provider === 'fabric' || provider === 'quilt' || provider === 'forge' || provider === 'neoforge'
      ? await javaMajorFor(version.split('-')[0] || version)
      : 21;
    const java = await ensureJava(major, path.join(this.config.dataDir, 'java'), () => undefined);
    const command = await this.minecraftLaunch(
      {
        name: server.name,
        game: 'minecraft',
        provider,
        version,
        memoryMb,
        eulaAccepted: true,
        gamemode: 'survival',
        difficulty: 'easy',
        maxPlayers: 20,
        motd: '',
        whitelist: false,
        onlineMode: true,
        seed: '',
        licenseKey: '',
      },
      server.cwd,
      java,
    );
    this.manager.replaceCommand(server.id, command);
    if (readInstall(this.db, server.id)) updateInstall(this.db, server.id, provider, version, major);
    else insertInstall(this.db, { serverId: server.id, provider, version, javaMajor: major });
    this.manager.note(server.id, `version is now ${provider} ${version}`);
    return { provider, version };
  }

  async reachability(id: string): Promise<Reachability> {
    const server = this.manager.get(id);
    const port = server.allocation?.port;
    if (!port) return { local: false, addresses: [] };
    const local = await tcpOpen('127.0.0.1', port);
    const host = server.allocation?.ip ?? '127.0.0.1';
    return { local, addresses: [`127.0.0.1:${port}`, `${host}:${port}`] };
  }

  private async install(jobId: string, input: McCreateRequest): Promise<void> {
    let root: string | null = null;
    let registered: string | null = null;
    let port: number | null = null;
    const progress = (message: string, extra: Partial<InstallProgress> = {}) => {
      const event: AgentEvent = { type: 'install.progress', jobId, message, ...extra };
      this.emit(event);
    };
    try {
      progress(`Preparing ${input.game} ${input.game === 'minecraft' ? input.provider : input.version}`);
      root = this.reserveDirectory(input.name);
      const prepared = await this.prepare(input, root, progress);
      port = prepared.port;
      progress(await allowFirewall(port));
      const address = displayAddress();
      const view = this.manager.create({
        name: input.name,
        command: prepared.command,
        cwd: prepared.cwd,
        env: prepared.env,
        stop: prepared.stop,
        allocation: { ip: address, port, primary: true },
        limits: { cpu: 0, memory: input.memoryMb * 1024 * 1024, disk: 0 },
        autoStart: true,
        autoRestart: true,
        templateId: prepared.templateId,
        templateVersion: 1,
      });
      registered = view.id;
      insertInstall(this.db, { serverId: view.id, provider: prepared.record, version: input.version, javaMajor: prepared.javaMajor });
      insertSchedule(this.db, {
        id: crypto.randomUUID(),
        serverId: view.id,
        name: 'Daily backup',
        cron: '0 4 * * *',
        task: 'backup',
      });
      progress(`${prepared.ready} ${address}:${port}. A backup runs daily at 04:00 while the agent is running.`);
      await this.manager.power(view.id, 'start');
      progress('Server is starting', { serverId: view.id, done: true });
    } catch (error) {
      if (root && !registered) fs.rmSync(root, { recursive: true, force: true });
      progress(clip(error), { serverId: registered ?? undefined, done: true, error: clip(error) });
    } finally {
      if (port !== null) this.pendingPorts.delete(port);
    }
  }

  private async java(major: number, progress: (message: string) => void): Promise<string> {
    const existing = this.javaJobs.get(major);
    if (existing) return existing;
    const job = ensureJava(major, path.join(this.config.dataDir, 'java'), progress).finally(() => {
      this.javaJobs.delete(major);
    });
    this.javaJobs.set(major, job);
    return job;
  }

  private reserveDirectory(name: string): string {
    const base = slug(name);
    let dir = path.join(this.config.serversRoot, base);
    if (fs.existsSync(dir)) dir = path.join(this.config.serversRoot, `${base}-${crypto.randomUUID().slice(0, 8)}`);
    fs.mkdirSync(dir, { recursive: false });
    return dir;
  }

  private async reservePort(start: number, probe?: (port: number) => Promise<boolean>): Promise<number> {
    const used = new Set(this.pendingPorts);
    for (const server of this.manager.list()) {
      if (server.allocation) used.add(server.allocation.port);
    }
    const port = await nextFreePort(start, 50, used, probe);
    this.pendingPorts.add(port);
    return port;
  }

  private async prepare(
    input: McCreateRequest,
    root: string,
    progress: (message: string) => void,
  ): Promise<{
    command: string[];
    cwd: string;
    env: Record<string, string>;
    stop: { stdin: string; timeoutMs: number };
    templateId: string;
    record: string;
    javaMajor: number;
    port: number;
    ready: string;
  }> {
    if (input.game === 'fivem') {
      const port = await this.reservePort(30120, bothProtocols);
      progress('Downloading the FiveM server build. Cfx does not publish a file checksum; the URL comes from their version list.');
      const executable = await installFiveM(root, input.version as 'recommended' | 'latest', {
        port,
        hostname: input.name,
        maxPlayers: input.maxPlayers,
        licenseKey: input.licenseKey,
      });
      return {
        command: [executable, '+exec', 'server.cfg'],
        cwd: path.dirname(executable),
        env: { LICENSE_KEY: input.licenseKey },
        stop: { stdin: 'quit', timeoutMs: 30_000 },
        templateId: 'fivem',
        record: 'fivem',
        javaMajor: 0,
        port,
        ready: 'Connect at',
      };
    }
    if (input.game === 'hytale') {
      const port = await this.reservePort(5520, canBindUdp);
      progress('Downloading the Hytale server. Java 25 is fetched once and reused.');
      const java = await this.java(25, progress);
      const installed = await installHytale(root, input.version as 'release' | 'pre-release', progress);
      const command = [...hytaleCommand(java, input.memoryMb, installed.jar, installed.assets, port)];
      const aot = path.join(installed.cwd, path.dirname(installed.jar), 'HytaleServer.aot');
      if (fs.existsSync(aot)) command.splice(1, 0, `-XX:AOTCache=${path.relative(installed.cwd, aot).split('\\').join('/')}`);
      return {
        command,
        cwd: installed.cwd,
        env: {},
        stop: { stdin: 'stop', timeoutMs: 60_000 },
        templateId: 'hytale',
        record: 'hytale',
        javaMajor: 25,
        port,
        ready: 'Join over UDP at',
      };
    }
    const port = await this.reservePort(25565);
    const major = await javaMajorFor(input.version);
    const java = await this.java(major, progress);
    progress(input.provider === 'spigot' ? 'Building Spigot. The first time compiles on this machine and can take several minutes.' : `Downloading ${input.provider} ${input.version}`);
    const launch = await this.minecraftLaunch(input, root, java);
    fs.writeFileSync(path.join(root, 'eula.txt'), EULA_TEXT);
    fs.writeFileSync(
      path.join(root, 'server.properties'),
      initialProperties({
        port,
        gamemode: input.gamemode,
        difficulty: input.difficulty,
        maxPlayers: input.maxPlayers,
        motd: input.motd,
        whitelist: input.whitelist,
        onlineMode: input.onlineMode,
        seed: input.seed,
      }),
    );
    return {
      command: launch,
      cwd: root,
      env: {},
      stop: { stdin: 'stop', timeoutMs: 60_000 },
      templateId: `minecraft-${input.provider}`,
      record: input.provider,
      javaMajor: major,
      port,
      ready: 'Join at',
    };
  }

  private async minecraftLaunch(input: McCreateRequest, cwd: string, java: string): Promise<string[]> {
    if (input.provider === 'vanilla') {
      await installVanilla(cwd, input.version);
      return minecraftCommand(java, input.memoryMb, 'server.jar');
    }
    if (input.provider === 'paper') {
      await installPaper(cwd, input.version);
      return minecraftCommand(java, input.memoryMb, 'server.jar');
    }
    if (input.provider === 'purpur') {
      await installPurpur(cwd, input.version);
      return minecraftCommand(java, input.memoryMb, 'server.jar');
    }
    if (input.provider === 'spigot') {
      await installSpigot(cwd, input.version, java, this.config.dataDir);
      return minecraftCommand(java, input.memoryMb, 'server.jar');
    }
    if (input.provider === 'fabric') {
      return minecraftCommand(java, input.memoryMb, await installFabric(cwd, input.version, java));
    }
    if (input.provider === 'quilt') {
      return minecraftCommand(java, input.memoryMb, await installQuilt(cwd, input.version, java));
    }
    if (input.provider === 'forge') {
      return argfileCommand(java, await installForge(cwd, input.version, java, input.memoryMb));
    }
    return argfileCommand(java, await installNeoForge(cwd, input.version, java, input.memoryMb));
  }
}

function hytaleCommand(java: string, memoryMb: number, jar: string, assets: string, port: number): string[] {
  return [java, ...heapArgs(memoryMb), '-jar', jar, '--assets', assets, '--bind', `0.0.0.0:${port}`];
}

async function bothProtocols(port: number): Promise<boolean> {
  return (await canBind(port)) && (await canBindUdp(port));
}

function isProvider(value: string): value is McProviderId {
  return (MC_PROVIDERS as readonly string[]).includes(value);
}

function isGame(value: string): value is GameId {
  return (GAMES as readonly string[]).includes(value);
}

function readCreate(body: unknown): McCreateRequest {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'expected a JSON object');
  const record = body as Record<string, unknown>;
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  if (name.length < 1 || name.length > 64) throw new HttpError(400, 'name must be 1–64 characters');
  const game = record.game === undefined ? 'minecraft' : record.game;
  if (typeof game !== 'string' || !isGame(game)) throw new HttpError(400, 'game must be minecraft, fivem, or hytale');
  const provider = typeof record.provider === 'string' ? record.provider : 'vanilla';
  if (game === 'minecraft' && !isProvider(provider)) throw new HttpError(400, 'choose a Minecraft server type');
  const version = typeof record.version === 'string' ? record.version.trim() : '';
  if (game === 'fivem' && version !== 'recommended' && version !== 'latest') throw new HttpError(400, 'FiveM channel must be recommended or latest');
  if (game === 'hytale' && version !== 'release' && version !== 'pre-release') throw new HttpError(400, 'Hytale channel must be release or pre-release');
  if (game === 'minecraft' && !/^[A-Za-z0-9._+-]{1,64}$/.test(version)) throw new HttpError(400, 'version is not valid');
  const memoryMb = record.memoryMb;
  if (typeof memoryMb !== 'number' || !Number.isInteger(memoryMb) || memoryMb < 512 || memoryMb > 32768) {
    throw new HttpError(400, 'memory must be 512–32768 MB');
  }
  if (game !== 'fivem' && record.eulaAccepted !== true) {
    throw new HttpError(400, game === 'hytale' ? 'confirm that you will sign in with a Hytale account' : 'the Minecraft EULA has to be accepted');
  }
  const licenseKey = typeof record.licenseKey === 'string' ? record.licenseKey.trim() : '';
  if (game === 'fivem' && !/^[A-Za-z0-9_-]{8,128}$/.test(licenseKey)) {
    throw new HttpError(400, 'the Cfx.re license key is not valid');
  }
  const gamemode = record.gamemode;
  if (typeof gamemode !== 'string' || !GAMEMODES.has(gamemode as McGamemode)) throw new HttpError(400, 'gamemode is not valid');
  const difficulty = record.difficulty;
  if (typeof difficulty !== 'string' || !DIFFICULTIES.has(difficulty as McDifficulty)) throw new HttpError(400, 'difficulty is not valid');
  const maxPlayers = record.maxPlayers;
  if (typeof maxPlayers !== 'number' || !Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 1000) {
    throw new HttpError(400, 'max players must be 1–1000');
  }
  const motd = typeof record.motd === 'string' ? record.motd : 'A Minecraft Server';
  if (motd.length > MOTD_MAX || /[\r\n\0]/.test(motd)) throw new HttpError(400, `motd must be ${MOTD_MAX} characters or less`);
  const seed = typeof record.seed === 'string' ? record.seed : '';
  if (seed.length > 64 || /[\r\n\0]/.test(seed)) throw new HttpError(400, 'seed is too long');
  if (typeof record.whitelist !== 'boolean' || typeof record.onlineMode !== 'boolean') {
    throw new HttpError(400, 'whitelist and online mode must be booleans');
  }
  return {
    name,
    game,
    provider: isProvider(provider) ? provider : 'vanilla',
    version,
    licenseKey,
    memoryMb,
    eulaAccepted: true,
    gamemode: gamemode as McGamemode,
    difficulty: difficulty as McDifficulty,
    maxPlayers,
    motd,
    whitelist: record.whitelist,
    onlineMode: record.onlineMode,
    seed,
  };
}

function readPropertyUpdates(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'expected a JSON object');
  const values = (body as { values?: unknown }).values;
  if (!values || typeof values !== 'object') throw new HttpError(400, 'values are required');
  const entries = Object.entries(values);
  if (entries.length > 120) throw new HttpError(400, 'too many settings');
  const updates: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (typeof value !== 'string') throw new HttpError(400, `${key} must be a string`);
    const problem = checkPropertyValue(key, value);
    if (problem) throw new HttpError(400, problem);
    updates[key] = value;
  }
  return updates;
}

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return base || 'server';
}

function clip(error: unknown): string {
  const message = error instanceof Error ? error.message : 'install failed';
  return message.length > 240 ? `${message.slice(0, 240)}…` : message;
}
