import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  substituteCommand,
  type CreateServerRequest,
  type LogLine,
  type PowerAction,
  type ServerDefinition,
  type ServerState,
  type ServerStats,
  type ServerView,
} from '@hotbar/shared';
import { deleteServerRow, insertServer, listServerRows, updateAllocation, updateServerCommand, updateServerFlags, updateServerStop } from './db.js';
import { applyHeap } from './minecraft/launch.js';
import { HttpError } from './errors.js';
import { buildChildEnv, resolveExecutable } from './executable.js';
import { redact, secretValues } from './redact.js';
import pidusage from 'pidusage';

const LOG_LIMIT = 2000;
const MAX_CRASHES = 5;

interface LiveServer {
  def: ServerDefinition;
  state: ServerState;
  child: ChildProcess | null;
  startedAt: string | null;
  pid: number | null;
  stats: ServerStats | null;
  logs: LogLine[];
  nextLogId: number;
  partial: { stdout: string; stderr: string };
  stopRequested: boolean;
  crashCount: number;
  diskBytes: number;
  diskCheckedAt: number;
  secrets: string[];
}

export type ManagerListener = (event: ManagerEvent) => void;

export type ManagerEvent =
  | { type: 'state'; server: LiveServer }
  | { type: 'log'; serverId: string; line: LogLine }
  | { type: 'stats'; server: LiveServer }
  | { type: 'removed'; serverId: string };

export class ServerManager {
  private readonly servers = new Map<string, LiveServer>();
  private readonly waiters: Array<(line: LogLine) => void> = [];
  private timer: NodeJS.Timeout | null = null;
  private sampleTick = 0;

  constructor(
    private readonly db: DatabaseSync,
    private readonly listener: ManagerListener,
    private readonly onAlert?: (message: string) => void,
  ) {}

  init(): void {
    for (const def of listServerRows(this.db)) {
      this.servers.set(def.id, this.blank(def));
    }
    this.timer = setInterval(() => {
      void this.sample().catch(() => undefined);
    }, 5000);
    this.timer.unref();
    for (const server of this.servers.values()) {
      if (server.def.autoStart) {
        void this.power(server.def.id, 'start').catch((error: unknown) => {
          this.system(server, `auto start failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        });
      }
    }
  }

  list(): ServerView[] {
    return [...this.servers.values()].map((server) => this.view(server));
  }

  get(id: string): ServerView {
    return this.view(this.must(id));
  }

  logs(id: string): { lines: LogLine[]; nextCursor: number } {
    const server = this.must(id);
    return { lines: [...server.logs], nextCursor: server.nextLogId };
  }

  create(input: CreateServerRequest): ServerView {
    const command = substituteCommand(input.command, input.env ?? {});
    const executable = resolveExecutable(command[0]);
    const resolved = [executable, ...command.slice(1)];
    this.assertAllocationFree(input.allocation ?? null, null);
    const now = new Date().toISOString();
    const def: ServerDefinition = {
      id: crypto.randomUUID(),
      name: input.name,
      templateId: input.templateId ?? null,
      templateVersion: input.templateVersion ?? null,
      command: resolved,
      cwd: input.cwd,
      env: input.env ?? {},
      stop: {
        stdin: input.stop?.stdin,
        timeoutMs: input.stop?.timeoutMs ?? 30_000,
      },
      allocation: input.allocation ?? null,
      limits: {
        cpu: input.limits?.cpu ?? 0,
        memory: input.limits?.memory ?? 0,
        disk: input.limits?.disk ?? 0,
      },
      autoStart: input.autoStart ?? false,
      autoRestart: input.autoRestart ?? false,
      createdAt: now,
      updatedAt: now,
    };
    insertServer(this.db, def);
    const live = this.blank(def);
    this.servers.set(def.id, live);
    this.system(live, 'server registered');
    return this.view(live);
  }

  note(id: string, line: string): void {
    this.system(this.must(id), line);
  }

  alert(id: string, message: string): void {
    const text = message.replace(/\s+/g, ' ').slice(0, 180);
    this.onAlert?.(text);
    const server = this.servers.get(id);
    if (server) this.system(server, `Hotbar alert: ${text}`);
  }

  setPort(id: string, port: number): void {
    const server = this.must(id);
    if (server.state !== 'offline') throw new HttpError(409, 'stop the server before changing its port');
    const allocation = { ...(server.def.allocation ?? { ip: '127.0.0.1', primary: true }), port, primary: true };
    this.assertAllocationFree(allocation, id);
    server.def.allocation = allocation;
    server.def.updatedAt = new Date().toISOString();
    updateAllocation(this.db, id, allocation, server.def.updatedAt);
  }

  remove(id: string): void {
    const server = this.must(id);
    if (server.state !== 'offline') {
      throw new HttpError(409, 'stop the server before deleting it');
    }
    deleteServerRow(this.db, id);
    this.servers.delete(id);
    this.listener({ type: 'removed', serverId: id });
  }

  async power(id: string, action: PowerAction): Promise<ServerView> {
    const server = this.must(id);
    if (action === 'start') await this.start(server);
    else if (action === 'stop') await this.stop(server, false);
    else if (action === 'kill') await this.stop(server, true);
    else await this.restart(server);
    return this.view(this.must(id));
  }

  replaceCommand(id: string, command: string[]): ServerView {
    const server = this.must(id);
    if (server.state !== 'offline') throw new HttpError(409, 'stop the server before changing its startup');
    if (command.length === 0 || command.some((part) => typeof part !== 'string' || part.includes('\0'))) {
      throw new HttpError(400, 'command is not valid');
    }
    const executable = resolveExecutable(command[0] ?? '');
    const resolved = [executable, ...command.slice(1)];
    server.def.command = resolved;
    server.def.updatedAt = new Date().toISOString();
    updateServerCommand(this.db, id, resolved, server.def.updatedAt);
    return this.view(server);
  }

  updateLaunch(
    id: string,
    input: { memoryMb?: number; stopStdin?: string; stopTimeoutMs?: number; autoStart?: boolean; autoRestart?: boolean },
  ): ServerView {
    const server = this.must(id);
    if (input.memoryMb !== undefined) {
      let next: string[];
      try {
        next = applyHeap(server.def.command, input.memoryMb);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : 'memory is not valid');
      }
      this.replaceCommand(id, next);
    }
    const current = this.must(id);
    let changed = false;
    if (input.stopStdin !== undefined || input.stopTimeoutMs !== undefined) {
      const stdin = input.stopStdin !== undefined ? input.stopStdin : current.def.stop.stdin;
      const timeoutMs = input.stopTimeoutMs ?? current.def.stop.timeoutMs;
      if (stdin !== undefined && (stdin.includes('\0') || stdin.length > 200)) throw new HttpError(400, 'stop command is not valid');
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 600_000) throw new HttpError(400, 'stop timeout must be from 1 to 600 seconds');
      current.def.stop = { ...current.def.stop, ...(stdin !== undefined ? { stdin } : {}), timeoutMs };
      current.def.updatedAt = new Date().toISOString();
      updateServerStop(this.db, id, current.def.stop, current.def.updatedAt);
      changed = true;
    }
    if (input.autoStart !== undefined || input.autoRestart !== undefined) {
      if (input.autoStart !== undefined) current.def.autoStart = input.autoStart;
      if (input.autoRestart !== undefined) current.def.autoRestart = input.autoRestart;
      current.def.updatedAt = new Date().toISOString();
      updateServerFlags(this.db, id, current.def.autoStart, current.def.autoRestart, current.def.updatedAt);
      changed = true;
    }
    return changed ? this.view(current) : this.view(this.must(id));
  }

  /** Resolves with the first stdout or stderr line that `match` accepts. */
  expect<T>(serverId: string, match: (line: string) => T | null, timeoutMs: number): { promise: Promise<T | null>; cancel: () => void } {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let resolvePromise: (value: T | null) => void = () => undefined;
    const promise = new Promise<T | null>((resolve) => {
      resolvePromise = resolve;
    });
    const finish = (value: T | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const index = this.waiters.indexOf(onLine);
      if (index >= 0) this.waiters.splice(index, 1);
      resolvePromise(value);
    };
    const onLine = (line: LogLine): void => {
      if (line.serverId !== serverId || line.stream === 'system') return;
      try {
        const value = match(line.line);
        if (value !== null) finish(value);
      } catch {
        // A matcher failure must not stop the log stream.
      }
    };
    timer = setTimeout(() => finish(null), timeoutMs);
    this.waiters.push(onLine);
    return { promise, cancel: () => finish(null) };
  }

  send(id: string, line: string): void {
    const server = this.must(id);
    if (!server.child?.stdin || server.state === 'offline') {
      throw new HttpError(409, 'server is not running');
    }
    const shown = redact(line, server.secrets);
    this.system(server, `> ${shown}`);
    server.child.stdin.write(`${line}\n`);
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const running = [...this.servers.values()].filter((server) => server.child);
    await Promise.all(running.map((server) => this.stop(server, false).catch(() => this.stop(server, true))));
  }

  private async restart(server: LiveServer): Promise<void> {
    if (server.state !== 'offline') await this.stop(server, false);
    await this.start(server);
  }

  private async start(server: LiveServer): Promise<void> {
    if (server.state === 'running' || server.state === 'starting') return;
    if (server.child) return;
    const command = substituteCommand(server.def.command, server.def.env);
    const executable = resolveExecutable(command[0]);
    this.setState(server, 'starting');
    const child = spawn(executable, command.slice(1), {
      cwd: server.def.cwd,
      env: buildChildEnv(process.env, server.def.env),
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    server.child = child;
    server.pid = child.pid ?? null;
    server.startedAt = new Date().toISOString();
    server.stopRequested = false;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.consume(server, 'stdout', chunk));
    child.stderr?.on('data', (chunk: string) => this.consume(server, 'stderr', chunk));
    child.on('error', (error) => {
      this.system(server, `process error: ${error.message}`);
    });
    child.on('exit', (code) => {
      if (server.child !== child) return;
      this.finishExit(server, code ?? 0);
    });
    this.setState(server, 'running');
    this.system(server, `process started (${server.pid ?? 'no pid'})`);
  }

  private async stop(server: LiveServer, force: boolean): Promise<void> {
    const child = server.child;
    if (!child || server.state === 'offline') {
      this.setState(server, 'offline');
      return;
    }
    this.setState(server, 'stopping');
    server.stopRequested = true;
    const exited = new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    });
    if (force || !server.def.stop.stdin) {
      this.system(server, force ? 'killing process' : 'stopping process');
      killTree(child.pid);
    } else {
      this.system(server, `sending stop command "${server.def.stop.stdin}"`);
      child.stdin?.write(`${server.def.stop.stdin}\n`);
      const timer = setTimeout(() => killTree(child.pid), server.def.stop.timeoutMs);
      child.once('exit', () => clearTimeout(timer));
    }
    await exited;
  }

  private finishExit(server: LiveServer, code: number): void {
    if (server.child === null && server.state === 'offline') return;
    const started = server.startedAt ? Date.parse(server.startedAt) : 0;
    const lived = Date.now() - started;
    server.child = null;
    server.pid = null;
    server.startedAt = null;
    this.flush(server, 'stdout');
    this.flush(server, 'stderr');
    this.setState(server, 'offline');
    this.system(server, `process exited (${code})`);
    if (server.stopRequested) {
      server.stopRequested = false;
      server.crashCount = 0;
      return;
    }
    if (!server.def.autoRestart) return;
    if (lived > 10_000) server.crashCount = 0;
    server.crashCount += 1;
    if (server.crashCount > MAX_CRASHES) {
      this.alert(server.def.id, `${server.def.name} stopped restarting after ${MAX_CRASHES} crashes`);
      return;
    }
    this.alert(server.def.id, `${server.def.name} crashed and is restarting (${server.crashCount} of ${MAX_CRASHES})`);
    setTimeout(() => {
      void this.start(server).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.alert(server.def.id, `${server.def.name} could not restart: ${message}`);
      });
    }, 2000);
  }

  private consume(server: LiveServer, stream: 'stdout' | 'stderr', chunk: string): void {
    server.partial[stream] += chunk;
    let index = server.partial[stream].indexOf('\n');
    while (index >= 0) {
      const line = server.partial[stream].slice(0, index).replace(/\r$/, '');
      server.partial[stream] = server.partial[stream].slice(index + 1);
      this.append(server, stream, line);
      index = server.partial[stream].indexOf('\n');
    }
    if (server.partial[stream].length > 8192) this.flush(server, stream);
  }

  private flush(server: LiveServer, stream: 'stdout' | 'stderr'): void {
    if (!server.partial[stream]) return;
    this.append(server, stream, server.partial[stream]);
    server.partial[stream] = '';
  }

  private system(server: LiveServer, line: string): void {
    this.append(server, 'system', line);
  }

  private append(server: LiveServer, stream: LogLine['stream'], line: string): void {
    const entry: LogLine = {
      id: server.nextLogId++,
      serverId: server.def.id,
      stream,
      line: redact(line, server.secrets),
      at: new Date().toISOString(),
    };
    server.logs.push(entry);
    if (server.logs.length > LOG_LIMIT) server.logs.splice(0, server.logs.length - LOG_LIMIT);
    for (const waiter of [...this.waiters]) waiter(entry);
    this.listener({ type: 'log', serverId: server.def.id, line: entry });
  }

  private setState(server: LiveServer, state: ServerState): void {
    server.state = state;
    this.listener({ type: 'state', server });
  }

  private async sample(): Promise<void> {
    this.sampleTick += 1;
    const checkDisk = this.sampleTick % 6 === 1;
    await Promise.all(
      [...this.servers.values()].map(async (server) => {
        if (checkDisk || server.diskCheckedAt === 0) {
          server.diskBytes = await directorySize(server.def.cwd);
          server.diskCheckedAt = Date.now();
        }
        let cpuPercent = 0;
        let memoryBytes = 0;
        if (server.pid && server.state === 'running') {
          try {
            const usage = await pidusage(server.pid);
            cpuPercent = round(usage.cpu);
            memoryBytes = usage.memory;
          } catch {
            cpuPercent = server.stats?.cpuPercent ?? 0;
            memoryBytes = server.stats?.memoryBytes ?? 0;
          }
        }
        server.stats = {
          cpuPercent,
          memoryBytes,
          diskBytes: server.diskBytes,
          networkRxBytes: null,
          networkTxBytes: null,
          sampledAt: new Date().toISOString(),
        };
        this.listener({ type: 'stats', server });
      }),
    );
  }

  private assertAllocationFree(allocation: ServerDefinition['allocation'], ignoreId: string | null): void {
    if (!allocation) return;
    for (const server of this.servers.values()) {
      if (server.def.id === ignoreId) continue;
      const current = server.def.allocation;
      if (current && current.ip === allocation.ip && current.port === allocation.port) {
        throw new HttpError(409, 'that address is already used by another server');
      }
    }
  }

  private must(id: string): LiveServer {
    const server = this.servers.get(id);
    if (!server) throw new HttpError(404, 'server not found');
    return server;
  }

  private blank(def: ServerDefinition): LiveServer {
    return {
      def,
      state: 'offline',
      child: null,
      startedAt: null,
      pid: null,
      stats: null,
      logs: [],
      nextLogId: 1,
      partial: { stdout: '', stderr: '' },
      stopRequested: false,
      crashCount: 0,
      diskBytes: 0,
      diskCheckedAt: 0,
      secrets: secretValues(def.env),
    };
  }

  private view(server: LiveServer): ServerView {
    return {
      ...server.def,
      state: server.state,
      stats: server.stats,
      startedAt: server.startedAt,
      pid: server.pid,
    };
  }
}

function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', () => {
      try {
        process.kill(pid);
      } catch {
        // already gone
      }
    });
    return;
  }
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

async function directorySize(root: string): Promise<number> {
  let total = 0;
  let seen = 0;
  const stack = [root];
  while (stack.length > 0 && seen < 8000) {
    const current = stack.pop();
    if (!current) break;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      const full = path.join(current, entry.name);
      try {
        if (entry.isSymbolicLink()) {
          total += (await fs.promises.lstat(full)).size;
          continue;
        }
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (entry.isFile()) total += (await fs.promises.stat(full)).size;
      } catch {
        // unreadable entries are skipped
      }
    }
  }
  return total;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
