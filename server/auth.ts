import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/**
 * Who is who. Every browser gets a session token that proves it owns its player id
 * (guests included), and a player can add a username + password to carry their
 * village to another device. Tokens and passwords are only ever stored hashed.
 *
 * Small and file-backed for now; the store sits behind an interface so a database
 * can take over with the rest of milestone 4's infrastructure.
 */

export interface Account {
  username: string;
  displayName: string;
  playerId: string;
  salt: string;
  hash: string;
  createdAt: number;
}

export interface Session {
  playerId: string;
  username: string | null;
  createdAt: number;
}

export interface AuthData {
  accounts: Record<string, Account>;
  /** By sha-256 of the token. */
  sessions: Record<string, Session>;
  /** Player ids that belong to someone (a guest session or an account). */
  owned: Record<string, { username: string | null }>;
}

export interface AuthStore {
  load(): Promise<AuthData | null>;
  save(data: AuthData): Promise<void>;
}

export class MemoryAuthStore implements AuthStore {
  private data: string | null = null;
  async load(): Promise<AuthData | null> {
    return this.data ? (JSON.parse(this.data) as AuthData) : null;
  }
  async save(data: AuthData): Promise<void> {
    this.data = JSON.stringify(data);
  }
}

export class FileAuthStore implements AuthStore {
  constructor(private readonly file: string) {}
  async load(): Promise<AuthData | null> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8')) as AuthData;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }
  async save(data: AuthData): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, this.file);
  }
}

export interface Identity {
  playerId: string;
  username: string | null;
  displayName: string | null;
}

export type AuthResult = { ok: true; playerId: string; token: string; account: { username: string; displayName: string } | null } | { ok: false; status: number; error: string };

const USERNAME = /^[a-z0-9_]{3,20}$/;
const PLAYER_ID = /^[a-z0-9-]{8,64}$/;
const MAX_FAILURES = 5;
const LOCKOUT_MS = 60_000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('hex');
const newPlayerId = () => `p-${randomBytes(12).toString('hex')}`;

export class AuthService {
  private data: AuthData | null = null;
  private loading: Promise<AuthData> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private readonly failures = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly store: AuthStore,
    private readonly clock: () => number = Date.now,
  ) {}

  private async db(): Promise<AuthData> {
    if (this.data) return this.data;
    this.loading ??= this.store.load().then((d) => (this.data = d ?? { accounts: {}, sessions: {}, owned: {} }));
    return this.loading;
  }

  private persist(): Promise<void> {
    const snapshot = this.data!;
    this.writes = this.writes.then(() => this.store.save(snapshot));
    return this.writes;
  }

  private async issue(data: AuthData, playerId: string, username: string | null): Promise<string> {
    const token = newToken();
    data.sessions[hashToken(token)] = { playerId, username, createdAt: this.clock() };
    await this.persist();
    return token;
  }

  private accountView(data: AuthData, username: string | null): { username: string; displayName: string } | null {
    const a = username ? data.accounts[username] : undefined;
    return a ? { username: a.username, displayName: a.displayName } : null;
  }

  /**
   * A guest session. With a `playerId` the browser claims the village it already has
   * (first come, first served); without one it starts a new village.
   */
  async session(playerId?: string): Promise<AuthResult> {
    const data = await this.db();
    let id = playerId;
    if (id !== undefined) {
      if (!PLAYER_ID.test(id)) return { ok: false, status: 400, error: 'invalid player id' };
      if (data.owned[id]) return { ok: false, status: 409, error: 'That village belongs to someone — sign in to play it' };
    } else {
      id = newPlayerId();
    }
    data.owned[id] = { username: null };
    const token = await this.issue(data, id, null);
    return { ok: true, playerId: id, token, account: null };
  }

  async authenticate(token: string | null | undefined): Promise<Identity | null> {
    if (!token) return null;
    const data = await this.db();
    const s = data.sessions[hashToken(token)];
    if (!s) return null;
    const owner = data.owned[s.playerId]?.username ?? null;
    return { playerId: s.playerId, username: owner, displayName: owner ? data.accounts[owner]?.displayName ?? null : null };
  }

  /** Adds a username and password to the signed-in guest's village. */
  async register(token: string, username: string, password: string, displayName: string): Promise<AuthResult> {
    const data = await this.db();
    const me = await this.authenticate(token);
    if (!me) return { ok: false, status: 401, error: 'Not signed in' };
    if (me.username) return { ok: false, status: 409, error: 'This village already has an account' };
    const name = username.trim().toLowerCase();
    if (!USERNAME.test(name)) return { ok: false, status: 400, error: 'Usernames are 3–20 letters, numbers or _' };
    if (password.length < 8 || password.length > 200) return { ok: false, status: 400, error: 'Passwords need at least 8 characters' };
    if (data.accounts[name]) return { ok: false, status: 409, error: 'That username is taken' };
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, 64);
    data.accounts[name] = { username: name, displayName: displayName.trim().slice(0, 30) || name, playerId: me.playerId, salt: salt.toString('hex'), hash: hash.toString('hex'), createdAt: this.clock() };
    data.owned[me.playerId] = { username: name };
    for (const s of Object.values(data.sessions)) if (s.playerId === me.playerId) s.username = name;
    await this.persist();
    return { ok: true, playerId: me.playerId, token, account: this.accountView(data, name) };
  }

  async login(username: string, password: string): Promise<AuthResult> {
    const data = await this.db();
    const name = username.trim().toLowerCase();
    const now = this.clock();
    const f = this.failures.get(name);
    if (f && f.count >= MAX_FAILURES && f.until > now) return { ok: false, status: 429, error: 'Too many attempts — wait a minute and try again' };
    const a = data.accounts[name];
    // Hash even for unknown names so timing doesn't reveal which usernames exist.
    const salt = a ? Buffer.from(a.salt, 'hex') : randomBytes(16);
    const hash = await scrypt(password, salt, 64);
    if (!a || !timingSafeEqual(hash, Buffer.from(a.hash, 'hex'))) {
      const count = f && f.until > now ? f.count + 1 : 1;
      this.failures.set(name, { count, until: now + LOCKOUT_MS });
      return { ok: false, status: 401, error: 'Wrong username or password' };
    }
    this.failures.delete(name);
    const token = await this.issue(data, a.playerId, name);
    return { ok: true, playerId: a.playerId, token, account: this.accountView(data, name) };
  }

  async logout(token: string): Promise<void> {
    const data = await this.db();
    delete data.sessions[hashToken(token)];
    await this.persist();
  }

  async setDisplayName(token: string, displayName: string): Promise<boolean> {
    const data = await this.db();
    const me = await this.authenticate(token);
    if (!me?.username) return false;
    data.accounts[me.username].displayName = displayName.trim().slice(0, 30) || me.username;
    await this.persist();
    return true;
  }

  async me(token: string): Promise<AuthResult> {
    const data = await this.db();
    const id = await this.authenticate(token);
    if (!id) return { ok: false, status: 401, error: 'Not signed in' };
    return { ok: true, playerId: id.playerId, token, account: this.accountView(data, id.username) };
  }
}
