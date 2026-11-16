export interface ActivityEntry {
  id: number;
  at: string;
  actor: string;
  event: string;
  target: string | null;
  ip: string | null;
  properties: Record<string, unknown>;
}
