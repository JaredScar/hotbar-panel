import type { PowerAction, ServerState, ServerStats, ServerView } from './server.js';

export interface LogLine {
  id: number;
  serverId: string;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  at: string;
}

export interface LogSnapshot {
  lines: LogLine[];
  nextCursor: number;
}

export interface InstallProgress {
  jobId: string;
  message: string;
  serverId?: string;
  done?: boolean;
  error?: string;
}

export type AgentEvent =
  | { type: 'hello'; agentVersion: string; nodeId?: string }
  | { type: 'server.state'; serverId: string; state: ServerState; startedAt: string | null; pid: number | null }
  | { type: 'server.log'; line: LogLine }
  | { type: 'server.stats'; serverId: string; stats: ServerStats; startedAt: string | null }
  | { type: 'server.removed'; serverId: string }
  | ({ type: 'install.progress' } & InstallProgress);

/** Commands the panel sends to a paired agent. Both sides sign the JSON. */
export type PanelDownlink =
  | { type: 'server.power'; serverId: string; action: PowerAction }
  | { type: 'server.stdin'; serverId: string; line: string }
  | { type: 'logs.request'; requestId: string; serverId: string }
  | { type: 'rpc'; requestId: string; method: string; serverId: string; body: unknown };

/** Messages a paired agent sends to the panel. */
export type AgentUplink =
  | AgentEvent
  | { type: 'snapshot'; servers: ServerView[] }
  | { type: 'logs.result'; requestId: string; snapshot: LogSnapshot }
  | { type: 'command.error'; serverId: string; message: string }
  | { type: 'rpc.result'; requestId: string; ok: boolean; body?: unknown; error?: string };
