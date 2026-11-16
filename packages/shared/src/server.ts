export type ServerState = 'offline' | 'starting' | 'running' | 'stopping';

export type PowerAction = 'start' | 'stop' | 'restart' | 'kill';

export interface ServerLimits {
  /** 0 means unlimited. Percent of one core is not used; this is a percent of the machine. */
  cpu: number;
  /** Bytes. 0 means unlimited. */
  memory: number;
  /** Bytes. 0 means unlimited. */
  disk: number;
}

export interface ServerAllocation {
  ip: string;
  port: number;
  primary: boolean;
  notes?: string;
}

export interface ServerStop {
  stdin?: string;
  timeoutMs: number;
}

export interface ServerDefinition {
  id: string;
  name: string;
  templateId: string | null;
  templateVersion: number | null;
  command: string[];
  cwd: string;
  env: Record<string, string>;
  stop: ServerStop;
  allocation: ServerAllocation | null;
  limits: ServerLimits;
  autoStart: boolean;
  autoRestart: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ServerStats {
  cpuPercent: number;
  memoryBytes: number;
  diskBytes: number;
  networkRxBytes: number | null;
  networkTxBytes: number | null;
  sampledAt: string;
}

export interface ServerView extends ServerDefinition {
  state: ServerState;
  stats: ServerStats | null;
  startedAt: string | null;
  pid: number | null;
}

export interface CreateServerRequest {
  name: string;
  command: string[];
  cwd: string;
  env?: Record<string, string>;
  stop?: Partial<ServerStop>;
  allocation?: ServerAllocation | null;
  limits?: Partial<ServerLimits>;
  autoStart?: boolean;
  autoRestart?: boolean;
  templateId?: string | null;
  templateVersion?: number | null;
}
