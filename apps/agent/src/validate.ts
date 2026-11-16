import fs from 'node:fs';
import path from 'node:path';
import type { CreateServerRequest, ServerAllocation, ServerLimits, ServerStop } from '@hotbar/shared';
import { HttpError } from './errors.js';

export function parseCreateServer(body: unknown): CreateServerRequest {
  if (!isRecord(body)) throw new HttpError(400, 'body must be an object');
  const name = readName(body['name']);
  const command = readCommand(body['command']);
  const cwdInput = body['cwd'];
  if (typeof cwdInput !== 'string' || cwdInput.trim() === '' || cwdInput.includes('\0')) {
    throw new HttpError(400, 'cwd is required');
  }
  const cwd = path.resolve(cwdInput);
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    throw new HttpError(400, 'working directory does not exist');
  }
  return {
    name,
    command,
    cwd,
    env: readEnv(body['env']),
    stop: readStop(body['stop']),
    allocation: readAllocation(body['allocation']),
    limits: readLimits(body['limits']),
    autoStart: body['autoStart'] === true,
    autoRestart: body['autoRestart'] === true,
    templateId: typeof body['templateId'] === 'string' ? body['templateId'] : null,
    templateVersion: typeof body['templateVersion'] === 'number' ? body['templateVersion'] : null,
  };
}

export function readPowerAction(body: unknown): 'start' | 'stop' | 'restart' | 'kill' {
  if (!isRecord(body) || typeof body['action'] !== 'string') {
    throw new HttpError(400, 'action is required');
  }
  if (body['action'] === 'start' || body['action'] === 'stop' || body['action'] === 'restart' || body['action'] === 'kill') {
    return body['action'];
  }
  throw new HttpError(400, 'action must be start, stop, restart, or kill');
}

export function readStdin(body: unknown): string {
  if (!isRecord(body) || typeof body['line'] !== 'string') {
    throw new HttpError(400, 'line is required');
  }
  if (body['line'].length > 8000 || body['line'].includes('\0')) {
    throw new HttpError(400, 'command is empty or too long');
  }
  if (body['line'].trim() === '') throw new HttpError(400, 'command is empty');
  return body['line'].replace(/\r?\n$/, '');
}

function readName(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'name is required');
  const name = value.trim();
  if (name.length < 1 || name.length > 64) throw new HttpError(400, 'name must be 1–64 characters');
  return name;
}

function readCommand(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) {
    throw new HttpError(400, 'command must be a non-empty argument array');
  }
  const command: string[] = [];
  for (const part of value) {
    if (typeof part !== 'string' || part.length === 0 || part.length > 32_000 || part.includes('\0')) {
      throw new HttpError(400, 'command arguments must be non-empty strings');
    }
    command.push(part);
  }
  return command;
}

function readEnv(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new HttpError(400, 'env must be an object');
  const env: Record<string, string> = {};
  const entries = Object.entries(value);
  if (entries.length > 50) throw new HttpError(400, 'too many environment variables');
  for (const [key, raw] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new HttpError(400, `invalid env key: ${key}`);
    if (typeof raw !== 'string' || raw.includes('\0')) throw new HttpError(400, `invalid env value: ${key}`);
    env[key] = raw;
  }
  return env;
}

function readStop(value: unknown): Partial<ServerStop> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new HttpError(400, 'stop must be an object');
  const stop: Partial<ServerStop> = {};
  if (value['stdin'] !== undefined) {
    if (typeof value['stdin'] !== 'string' || value['stdin'].includes('\0') || value['stdin'].length > 200) {
      throw new HttpError(400, 'stop.stdin is invalid');
    }
    stop.stdin = value['stdin'];
  }
  if (value['timeoutMs'] !== undefined) {
    if (typeof value['timeoutMs'] !== 'number' || value['timeoutMs'] < 1000 || value['timeoutMs'] > 300_000) {
      throw new HttpError(400, 'stop.timeoutMs must be between 1000 and 300000');
    }
    stop.timeoutMs = value['timeoutMs'];
  }
  return stop;
}

function readAllocation(value: unknown): ServerAllocation | null {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) throw new HttpError(400, 'allocation must be an object');
  const ip = value['ip'];
  const port = value['port'];
  if (typeof ip !== 'string' || !isHost(ip)) throw new HttpError(400, 'allocation.ip is invalid');
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new HttpError(400, 'allocation.port is invalid');
  }
  const notes = value['notes'];
  if (notes !== undefined && (typeof notes !== 'string' || notes.length > 200)) {
    throw new HttpError(400, 'allocation.notes is invalid');
  }
  return { ip, port, primary: true, notes: typeof notes === 'string' ? notes : undefined };
}

function readLimits(value: unknown): Partial<ServerLimits> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new HttpError(400, 'limits must be an object');
  const limits: Partial<ServerLimits> = {};
  for (const key of ['cpu', 'memory', 'disk'] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'number' || value[key] < 0 || !Number.isFinite(value[key])) {
      throw new HttpError(400, `limits.${key} must be a non-negative number`);
    }
    limits[key] = value[key];
  }
  return limits;
}

function isHost(value: string): boolean {
  if (value === '0.0.0.0' || value === '127.0.0.1' || value === 'localhost') return true;
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
