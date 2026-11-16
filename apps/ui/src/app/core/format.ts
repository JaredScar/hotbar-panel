import type { ServerState, ServerView } from '@hotbar/shared';

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatUptime(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '0%';
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

export function serverAddress(server: ServerView): string {
  if (!server.allocation) return '—';
  return `${server.allocation.ip}:${server.allocation.port}`;
}

export function statusColor(state: ServerState): string {
  if (state === 'running') return 'var(--color-running)';
  if (state === 'starting' || state === 'stopping') return 'var(--color-starting)';
  return 'var(--color-offline)';
}

export function statusLabel(state: ServerState): string {
  if (state === 'running') return 'Running';
  if (state === 'starting') return 'Starting';
  if (state === 'stopping') return 'Stopping';
  return 'Offline';
}
