import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ServerView } from '@hotbar/shared';
import { checkPassword, hashPassword, pairingCode, randomToken } from './passwords.js';
import { assertEd25519PublicKey, generateEd25519, publicKeyFromPrivate, sha256 } from './sign.js';
import { randomBase32, verifyTotp } from './totp.js';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

export class PanelError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'PanelError';
  }
}

export interface PanelUser {
  id: string;
  email: string;
}

export interface StoredNode {
  id: string;
  userId: string;
  hostname: string;
  os: string;
  publicKey: string;
}

export interface OwnedServer {
  nodeId: string;
  userId: string;
  view: ServerView;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

const ACCESS_MS = 12 * 60 * 60 * 1000;
const REFRESH_MS = 30 * 24 * 60 * 60 * 1000;
const PAIR_MS = 10 * 60 * 1000;

export class PanelStore {
  readonly db: DatabaseSync;
  private readonly failures = new Map<string, { count: number; reset: number }>();
  private readonly privatePem: string;
  readonly publicKey: string;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(path.join(dataDir, 'panel.sqlite'));
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pairings (
        code_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        hostname TEXT NOT NULL,
        os TEXT NOT NULL,
        public_key TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS node_servers (
        id TEXT PRIMARY KEY,
        node_id TEXT NOT NULL,
        document TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS subusers (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        email TEXT NOT NULL,
        server_id TEXT NOT NULL,
        permissions TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS passkeys (
        credential_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        counter INTEGER NOT NULL,
        transports TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS webauthn_challenges (
        challenge TEXT PRIMARY KEY,
        user_id TEXT,
        kind TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
    for (const statement of [
      `ALTER TABLE users ADD COLUMN totp_secret TEXT`,
      `ALTER TABLE users ADD COLUMN totp_pending TEXT`,
    ]) {
      try {
        this.db.exec(statement);
      } catch {
        // The column is already there.
      }
    }
    const keyPath = path.join(dataDir, 'panel-ed25519.pem');
    if (fs.existsSync(keyPath)) {
      this.privatePem = fs.readFileSync(keyPath, 'utf8');
    } else {
      this.privatePem = generateEd25519().privateKey;
      fs.writeFileSync(keyPath, this.privatePem, { encoding: 'utf8', mode: 0o600 });
    }
    this.publicKey = publicKeyFromPrivate(this.privatePem);
  }

  close(): void {
    this.db.close();
  }

  signingKey(): string {
    return this.privatePem;
  }

  limit(key: string): void {
    const now = Date.now();
    const current = this.failures.get(key);
    if (!current || current.reset < now) {
      this.failures.set(key, { count: 1, reset: now + 15 * 60 * 1000 });
      return;
    }
    current.count += 1;
    if (current.count > 8) throw new PanelError(429, 'too many attempts, try again later');
  }

  clearLimit(key: string): void {
    this.failures.delete(key);
  }

  async register(email: string, password: string): Promise<IssuedTokens> {
    const normalized = readEmail(email);
    readPassword(password);
    const hash = await hashPassword(password);
    const id = crypto.randomUUID();
    try {
      this.db
        .prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(id, normalized, hash, new Date().toISOString());
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) throw new PanelError(409, 'an account with that email already exists');
      throw error;
    }
    return this.issue(id);
  }

  async login(email: string, password: string, limitKey: string, code = ''): Promise<IssuedTokens> {
    this.limit(limitKey);
    const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const row = this.db.prepare('SELECT id, password_hash, totp_secret FROM users WHERE email = ?').get(normalized) as
      | { id: string; password_hash: string; totp_secret: string | null }
      | undefined;
    const ok = row ? await checkPassword(typeof password === 'string' ? password : '', row.password_hash) : false;
    if (!row || !ok) throw new PanelError(401, 'email or password is wrong');
    if (row.totp_secret && !verifyTotp(row.totp_secret, code)) throw new PanelError(401, 'authenticator code is required');
    this.clearLimit(limitKey);
    return this.issue(row.id);
  }

  refresh(refreshToken: string): IssuedTokens {
    const row = this.session(refreshToken, 'refresh');
    if (!row) throw new PanelError(401, 'session expired');
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(refreshToken));
    return this.issue(row.user_id);
  }

  userFromToken(token: string): PanelUser | null {
    const session = this.session(token, 'access');
    const userId = session?.user_id ?? this.apiKeyUser(token);
    if (!userId) return null;
    const user = this.db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId) as
      | { id: string; email: string }
      | undefined;
    return user ?? null;
  }

  createPairing(userId: string): { code: string; expiresAt: string } {
    const code = pairingCode();
    const expiresAt = new Date(Date.now() + PAIR_MS).toISOString();
    this.db
      .prepare('INSERT INTO pairings (code_hash, user_id, expires_at, used_at) VALUES (?, ?, ?, NULL)')
      .run(sha256(code), userId, expiresAt);
    return { code, expiresAt };
  }

  consumePairing(input: { code: string; publicKey: string; hostname: string; os: string }): { nodeId: string; panelPublicKey: string } {
    if (typeof input.code !== 'string' || input.code.length < 8 || input.code.length > 32) throw new PanelError(400, 'pairing code is invalid');
    try {
      assertEd25519PublicKey(input.publicKey);
    } catch {
      throw new PanelError(400, 'public key is invalid');
    }
    const hostname = typeof input.hostname === 'string' ? input.hostname.trim().slice(0, 120) : '';
    const osName = typeof input.os === 'string' ? input.os.trim().slice(0, 40) : '';
    if (!hostname || !osName) throw new PanelError(400, 'hostname and os are required');
    const hash = sha256(input.code.trim().toUpperCase());
    this.db.exec('BEGIN');
    try {
      const row = this.db
        .prepare(`SELECT user_id FROM pairings WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`)
        .get(hash, new Date().toISOString()) as { user_id: string } | undefined;
      if (!row) {
        this.db.exec('ROLLBACK');
        throw new PanelError(400, 'pairing code is invalid');
      }
      this.db.prepare('UPDATE pairings SET used_at = ? WHERE code_hash = ?').run(new Date().toISOString(), hash);
      const nodeId = crypto.randomUUID();
      this.db
        .prepare('INSERT INTO nodes (id, user_id, hostname, os, public_key, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(nodeId, row.user_id, hostname, osName, input.publicKey, new Date().toISOString(), new Date().toISOString());
      this.db.exec('COMMIT');
      return { nodeId, panelPublicKey: this.publicKey };
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // The transaction already finished or was rolled back.
      }
      throw error;
    }
  }

  getNode(id: string): StoredNode | null {
    const row = this.db.prepare('SELECT id, user_id, hostname, os, public_key FROM nodes WHERE id = ?').get(id) as
      | { id: string; user_id: string; hostname: string; os: string; public_key: string }
      | undefined;
    if (!row) return null;
    return { id: row.id, userId: row.user_id, hostname: row.hostname, os: row.os, publicKey: row.public_key };
  }

  touchNode(id: string): void {
    this.db.prepare('UPDATE nodes SET last_seen = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  replaceServers(nodeId: string, servers: ServerView[]): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM node_servers WHERE node_id = ?').run(nodeId);
      const insert = this.db.prepare('INSERT INTO node_servers (id, node_id, document) VALUES (?, ?, ?)');
      for (const server of servers) insert.run(server.id, nodeId, JSON.stringify(server));
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // already closed
      }
      throw error;
    }
  }

  patchServer(id: string, patch: Partial<ServerView>): void {
    const row = this.db.prepare('SELECT document FROM node_servers WHERE id = ?').get(id) as { document: string } | undefined;
    if (!row) return;
    const view = { ...(JSON.parse(row.document) as ServerView), ...patch };
    this.db.prepare('UPDATE node_servers SET document = ? WHERE id = ?').run(JSON.stringify(view), id);
  }

  removeServer(id: string): void {
    this.db.prepare('DELETE FROM node_servers WHERE id = ?').run(id);
  }

  listServers(userId: string): ServerView[] {
    const rows = this.db
      .prepare(
        `SELECT document FROM node_servers
         JOIN nodes ON nodes.id = node_servers.node_id
         WHERE nodes.user_id = ?
         UNION
         SELECT node_servers.document FROM node_servers
         JOIN subusers ON subusers.server_id = node_servers.id
         JOIN users ON users.email = subusers.email
         WHERE users.id = ?`,
      )
      .all(userId, userId) as unknown as { document: string }[];
    return rows.map((row) => JSON.parse(row.document) as ServerView);
  }

  listNodes(userId: string): Array<{ id: string; hostname: string; os: string; lastSeen: string | null }> {
    const rows = this.db
      .prepare('SELECT id, hostname, os, last_seen FROM nodes WHERE user_id = ? ORDER BY hostname')
      .all(userId) as Array<{ id: string; hostname: string; os: string; last_seen: string | null }>;
    return rows.map((row) => ({ id: row.id, hostname: row.hostname, os: row.os, lastSeen: row.last_seen }));
  }

  beginTotp(userId: string): { secret: string; otpauth: string } {
    const user = this.db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined;
    if (!user) throw new PanelError(404, 'account not found');
    const secret = randomBase32();
    this.db.prepare('UPDATE users SET totp_pending = ? WHERE id = ?').run(secret, userId);
    return { secret, otpauth: `otpauth://totp/Hotbar:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Hotbar` };
  }

  confirmTotp(userId: string, code: string): void {
    const row = this.db.prepare('SELECT totp_pending FROM users WHERE id = ?').get(userId) as { totp_pending: string | null } | undefined;
    if (!row?.totp_pending || !verifyTotp(row.totp_pending, code)) throw new PanelError(400, 'authenticator code is wrong');
    this.db.prepare('UPDATE users SET totp_secret = totp_pending, totp_pending = NULL WHERE id = ?').run(userId);
  }

  disableTotp(userId: string, code: string): void {
    const row = this.db.prepare('SELECT totp_secret FROM users WHERE id = ?').get(userId) as { totp_secret: string | null } | undefined;
    if (!row?.totp_secret || !verifyTotp(row.totp_secret, code)) throw new PanelError(400, 'authenticator code is wrong');
    this.db.prepare('UPDATE users SET totp_secret = NULL WHERE id = ?').run(userId);
  }

  listApiKeys(userId: string): Array<{ id: string; name: string; createdAt: string }> {
    const rows = this.db
      .prepare('SELECT id, name, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at')
      .all(userId) as Array<{ id: string; name: string; created_at: string }>;
    return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }));
  }

  createApiKey(userId: string, name: string): { id: string; token: string } {
    const label = name.trim().slice(0, 40);
    if (!label) throw new PanelError(400, 'name is required');
    const id = crypto.randomUUID();
    const token = randomToken();
    this.db
      .prepare('INSERT INTO api_keys (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, userId, label, sha256(token), new Date().toISOString());
    return { id, token };
  }

  deleteApiKey(userId: string, id: string): void {
    this.db.prepare('DELETE FROM api_keys WHERE user_id = ? AND id = ?').run(userId, id);
  }

  listSubusers(ownerId: string, serverId: string): Array<{ id: string; email: string; permissions: string[] }> {
    if (!this.ownedServer(ownerId, serverId)) throw new PanelError(404, 'server not found');
    const rows = this.db
      .prepare('SELECT id, email, permissions FROM subusers WHERE owner_id = ? AND server_id = ?')
      .all(ownerId, serverId) as Array<{ id: string; email: string; permissions: string }>;
    return rows.map((row) => ({ id: row.id, email: row.email, permissions: JSON.parse(row.permissions) as string[] }));
  }

  addSubuser(ownerId: string, serverId: string, email: string, permissions: string[]): void {
    if (!this.ownedServer(ownerId, serverId)) throw new PanelError(404, 'server not found');
    const normalized = readEmail(email);
    const allowed = permissions.filter((permission) =>
      ['control.start', 'control.stop', 'control.restart', 'control.console', 'server.read'].includes(permission),
    );
    if (allowed.length === 0) throw new PanelError(400, 'choose at least one permission');
    const account = this.db.prepare('SELECT id FROM users WHERE email = ?').get(normalized) as { id: string } | undefined;
    if (!account) throw new PanelError(400, 'that email does not have a Hotbar account');
    if (account.id === ownerId) throw new PanelError(400, 'the owner already has access');
    this.db
      .prepare('INSERT INTO subusers (id, owner_id, email, server_id, permissions) VALUES (?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), ownerId, normalized, serverId, JSON.stringify(allowed));
  }

  removeSubuser(ownerId: string, serverId: string, id: string): void {
    this.db.prepare('DELETE FROM subusers WHERE owner_id = ? AND server_id = ? AND id = ?').run(ownerId, serverId, id);
  }

  accessServer(userId: string, serverId: string): (OwnedServer & { permissions: string[] }) | null {
    const owned = this.ownedServer(userId, serverId);
    if (owned) return { ...owned, permissions: ['*'] };
    const row = this.db
      .prepare(
        `SELECT node_servers.node_id, nodes.user_id, node_servers.document, subusers.permissions
         FROM node_servers
         JOIN nodes ON nodes.id = node_servers.node_id
         JOIN subusers ON subusers.server_id = node_servers.id
         JOIN users ON users.email = subusers.email
         WHERE node_servers.id = ? AND users.id = ?`,
      )
      .get(serverId, userId) as { node_id: string; user_id: string; document: string; permissions: string } | undefined;
    if (!row) return null;
    return {
      nodeId: row.node_id,
      userId: row.user_id,
      view: JSON.parse(row.document) as ServerView,
      permissions: JSON.parse(row.permissions) as string[],
    };
  }

  ownedServer(userId: string, serverId: string): OwnedServer | null {
    const row = this.db
      .prepare(
        `SELECT node_servers.node_id, nodes.user_id, node_servers.document
         FROM node_servers JOIN nodes ON nodes.id = node_servers.node_id
         WHERE node_servers.id = ? AND nodes.user_id = ?`,
      )
      .get(serverId, userId) as { node_id: string; user_id: string; document: string } | undefined;
    if (!row) return null;
    return { nodeId: row.node_id, userId: row.user_id, view: JSON.parse(row.document) as ServerView };
  }

  async passkeyRegistrationOptions(userId: string): Promise<unknown> {
    const user = this.userRow(userId);
    const existing = this.db.prepare('SELECT credential_id FROM passkeys WHERE user_id = ?').all(userId) as Array<{ credential_id: string }>;
    const options = await generateRegistrationOptions({
      rpName: 'Hotbar',
      rpID: relyingPartyId(),
      userName: user.email,
      userID: new TextEncoder().encode(user.id),
      userDisplayName: user.email,
      attestationType: 'none',
      excludeCredentials: existing.map((row) => ({ id: row.credential_id })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    this.rememberChallenge(options.challenge, userId, 'register');
    return options;
  }

  async passkeyRegister(userId: string, response: RegistrationResponseJSON): Promise<{ id: string }> {
    const expected = this.challengeForUser(userId, 'register');
    const verified = await verifyRegistrationResponse({
      response,
      expectedChallenge: expected,
      expectedOrigin: relyingPartyOrigins(),
      expectedRPID: relyingPartyId(),
    });
    if (!verified.verified) throw new PanelError(400, 'passkey was not accepted');
    const credential = verified.registrationInfo.credential;
    this.db
      .prepare('INSERT INTO passkeys (credential_id, user_id, public_key, counter, transports) VALUES (?, ?, ?, ?, ?)')
      .run(credential.id, userId, Buffer.from(credential.publicKey).toString('base64'), credential.counter, (credential.transports ?? []).join(','));
    return { id: credential.id };
  }

  listPasskeys(userId: string): Array<{ id: string }> {
    return (this.db.prepare('SELECT credential_id AS id FROM passkeys WHERE user_id = ?').all(userId) as Array<{ id: string }>).map((row) => ({
      id: row.id,
    }));
  }

  async passkeyLoginOptions(limitKey: string): Promise<unknown> {
    this.limit(limitKey);
    const options = await generateAuthenticationOptions({ rpID: relyingPartyId(), userVerification: 'preferred' });
    this.rememberChallenge(options.challenge, null, 'login');
    return options;
  }

  async passkeyLogin(response: AuthenticationResponseJSON, limitKey: string): Promise<IssuedTokens> {
    this.limit(limitKey);
    if (!response || typeof response.id !== 'string') throw new PanelError(400, 'passkey response is missing');
    const row = this.db.prepare('SELECT user_id, public_key, counter, transports FROM passkeys WHERE credential_id = ?').get(response.id) as
      | { user_id: string; public_key: string; counter: number; transports: string }
      | undefined;
    if (!row) throw new PanelError(401, 'passkey is not registered');
    const verified = await verifyAuthenticationResponse({
      response,
      expectedChallenge: (challenge) => this.consumeChallenge(challenge, 'login'),
      expectedOrigin: relyingPartyOrigins(),
      expectedRPID: relyingPartyId(),
      credential: {
        id: response.id,
        publicKey: new Uint8Array(Buffer.from(row.public_key, 'base64')),
        counter: row.counter,
        transports: row.transports ? row.transports.split(',') : undefined,
      },
    });
    if (!verified.verified) throw new PanelError(401, 'passkey was not accepted');
    this.db.prepare('UPDATE passkeys SET counter = ? WHERE credential_id = ?').run(verified.authenticationInfo.newCounter, response.id);
    this.clearLimit(limitKey);
    return this.issue(row.user_id);
  }

  private userRow(userId: string): { id: string; email: string } {
    const user = this.db.prepare('SELECT id, email FROM users WHERE id = ?').get(userId) as { id: string; email: string } | undefined;
    if (!user) throw new PanelError(401, 'session expired');
    return user;
  }

  private rememberChallenge(challenge: string, userId: string | null, kind: string): void {
    this.db.prepare('DELETE FROM webauthn_challenges WHERE expires_at < ? OR (user_id = ? AND kind = ?)').run(Date.now(), userId, kind);
    this.db.prepare('INSERT INTO webauthn_challenges (challenge, user_id, kind, expires_at) VALUES (?, ?, ?, ?)').run(challenge, userId, kind, Date.now() + 5 * 60 * 1000);
  }

  private challengeForUser(userId: string, kind: string): string {
    const row = this.db
      .prepare('SELECT challenge FROM webauthn_challenges WHERE user_id = ? AND kind = ? AND expires_at > ?')
      .get(userId, kind, Date.now()) as { challenge: string } | undefined;
    if (!row) throw new PanelError(400, 'passkey challenge expired');
    this.db.prepare('DELETE FROM webauthn_challenges WHERE challenge = ?').run(row.challenge);
    return row.challenge;
  }

  private consumeChallenge(challenge: string, kind: string): boolean {
    const row = this.db
      .prepare('SELECT challenge FROM webauthn_challenges WHERE challenge = ? AND kind = ? AND expires_at > ?')
      .get(challenge, kind, Date.now()) as { challenge: string } | undefined;
    if (!row) return false;
    this.db.prepare('DELETE FROM webauthn_challenges WHERE challenge = ?').run(challenge);
    return true;
  }

  private apiKeyUser(token: string): string | null {
    if (!token) return null;
    const row = this.db.prepare('SELECT user_id FROM api_keys WHERE token_hash = ?').get(sha256(token)) as { user_id: string } | undefined;
    return row?.user_id ?? null;
  }

  private issue(userId: string): IssuedTokens {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const expiresAt = new Date(Date.now() + ACCESS_MS).toISOString();
    const insert = this.db.prepare('INSERT INTO sessions (token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)');
    insert.run(sha256(accessToken), userId, 'access', expiresAt);
    insert.run(sha256(refreshToken), userId, 'refresh', new Date(Date.now() + REFRESH_MS).toISOString());
    return { accessToken, refreshToken, expiresAt };
  }

  private session(token: string, kind: string): { user_id: string } | undefined {
    if (!token) return undefined;
    return this.db
      .prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND kind = ? AND expires_at > ?')
      .get(sha256(token), kind, new Date().toISOString()) as { user_id: string } | undefined;
  }
}

function relyingPartyId(): string {
  return new URL(process.env['HOTBAR_UI_URL'] ?? 'http://127.0.0.1:4200').hostname;
}

function relyingPartyOrigins(): string[] {
  return [(process.env['HOTBAR_UI_URL'] ?? 'http://127.0.0.1:4200').replace(/\/$/, '')];
}

function readEmail(email: unknown): string {
  if (typeof email !== 'string') throw new PanelError(400, 'email is required');
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new PanelError(400, 'email is not valid');
  return normalized;
}

function readPassword(password: unknown): void {
  if (typeof password !== 'string' || password.length < 10 || password.length > 200) {
    throw new PanelError(400, 'password must be 10–200 characters');
  }
}
