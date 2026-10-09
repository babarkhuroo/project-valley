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
 * Stored through `AuthStore`: a file for single-process setups, Postgres
 * (`server/db/pgStores.ts`) when several processes share the load.
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

/**
 * Record-level storage, so several server processes can share one database: every
 * operation reads or writes just the rows it needs, and the two that must be unique
 * (claiming a player id, taking a username) are atomic in the store.
 */
export interface AuthStore {
  getSession(tokenHash: string): Promise<Session | null>;
  putSession(tokenHash: string, session: Session): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Marks every session of a player as belonging to an account. */
  setSessionsUsername(playerId: string, username: string): Promise<void>;
  getAccount(username: string): Promise<Account | null>;
  /** Creates the account unless the username is taken; false when it is. */
  createAccount(account: Account): Promise<boolean>;
  setDisplayName(username: string, displayName: string): Promise<void>;
  owner(playerId: string): Promise<{ username: string | null } | null>;
  /** Claims an unowned player id for a guest; false when someone already owns it. */
  claim(playerId: string): Promise<boolean>;
  setOwner(playerId: string, username: string): Promise<void>;
}

/**
 * An AuthStore over one in-memory document (`AuthData`), persisted whole after each
 * write. Fine for a single process; the Postgres store is the multi-process one.
 */
abstract class DocumentAuthStore implements AuthStore {
  private data: AuthData | null = null;
  private loading: Promise<AuthData> | null = null;
  private writes: Promise<void> = Promise.resolve();

  protected abstract read(): Promise<AuthData | null>;
  protected abstract write(data: AuthData): Promise<void>;

  private async db(): Promise<AuthData> {
    if (this.data) return this.data;
    this.loading ??= this.read().then((d) => (this.data = d ?? { accounts: {}, sessions: {}, owned: {} }));
    return this.loading;
  }

  private persist(): Promise<void> {
    const snapshot = this.data!;
    this.writes = this.writes.then(() => this.write(snapshot));
    return this.writes;
  }

  async getSession(tokenHash: string): Promise<Session | null> {
    return (await this.db()).sessions[tokenHash] ?? null;
  }
  async putSession(tokenHash: string, session: Session): Promise<void> {
    (await this.db()).sessions[tokenHash] = session;
    await this.persist();
  }
  async deleteSession(tokenHash: string): Promise<void> {
    delete (await this.db()).sessions[tokenHash];
    await this.persist();
  }
  async setSessionsUsername(playerId: string, username: string): Promise<void> {
    for (const s of Object.values((await this.db()).sessions)) if (s.playerId === playerId) s.username = username;
    await this.persist();
  }
  async getAccount(username: string): Promise<Account | null> {
    return (await this.db()).accounts[username] ?? null;
  }
  async createAccount(account: Account): Promise<boolean> {
    const data = await this.db();
    if (data.accounts[account.username]) return false;
    data.accounts[account.username] = account;
    await this.persist();
    return true;
  }
  async setDisplayName(username: string, displayName: string): Promise<void> {
    const a = (await this.db()).accounts[username];
    if (!a) return;
    a.displayName = displayName;
    await this.persist();
  }
  async owner(playerId: string): Promise<{ username: string | null } | null> {
    return (await this.db()).owned[playerId] ?? null;
  }
  async claim(playerId: string): Promise<boolean> {
    const data = await this.db();
    if (data.owned[playerId]) return false;
    data.owned[playerId] = { username: null };
    await this.persist();
    return true;
  }
  async setOwner(playerId: string, username: string): Promise<void> {
    (await this.db()).owned[playerId] = { username };
    await this.persist();
  }
}

export class MemoryAuthStore extends DocumentAuthStore {
  private saved: string | null = null;
  protected async read(): Promise<AuthData | null> {
    return this.saved ? (JSON.parse(this.saved) as AuthData) : null;
  }
  protected async write(data: AuthData): Promise<void> {
    this.saved = JSON.stringify(data);
  }
}

export class FileAuthStore extends DocumentAuthStore {
  constructor(private readonly file: string) {
    super();
  }
  protected async read(): Promise<AuthData | null> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8')) as AuthData;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }
  protected async write(data: AuthData): Promise<void> {
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
  /** Per process: a lockout only needs to slow guessing down, not be exact. */
  private readonly failures = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly store: AuthStore,
    private readonly clock: () => number = Date.now,
  ) {}

  private async issue(playerId: string, username: string | null): Promise<string> {
    const token = newToken();
    await this.store.putSession(hashToken(token), { playerId, username, createdAt: this.clock() });
    return token;
  }

  private async accountView(username: string | null): Promise<{ username: string; displayName: string } | null> {
    const a = username ? await this.store.getAccount(username) : null;
    return a ? { username: a.username, displayName: a.displayName } : null;
  }

  /**
   * A guest session. With a `playerId` the browser claims the village it already has
   * (first come, first served); without one it starts a new village.
   */
  async session(playerId?: string): Promise<AuthResult> {
    let id = playerId;
    if (id !== undefined) {
      if (!PLAYER_ID.test(id)) return { ok: false, status: 400, error: 'invalid player id' };
      if (!(await this.store.claim(id))) return { ok: false, status: 409, error: 'That village belongs to someone — sign in to play it' };
    } else {
      do id = newPlayerId();
      while (!(await this.store.claim(id)));
    }
    const token = await this.issue(id, null);
    return { ok: true, playerId: id, token, account: null };
  }

  async authenticate(token: string | null | undefined): Promise<Identity | null> {
    if (!token) return null;
    const s = await this.store.getSession(hashToken(token));
    if (!s) return null;
    const owner = (await this.store.owner(s.playerId))?.username ?? null;
    const account = owner ? await this.store.getAccount(owner) : null;
    return { playerId: s.playerId, username: owner, displayName: account?.displayName ?? null };
  }

  /** Adds a username and password to the signed-in guest's village. */
  async register(token: string, username: string, password: string, displayName: string): Promise<AuthResult> {
    const me = await this.authenticate(token);
    if (!me) return { ok: false, status: 401, error: 'Not signed in' };
    if (me.username) return { ok: false, status: 409, error: 'This village already has an account' };
    const name = username.trim().toLowerCase();
    if (!USERNAME.test(name)) return { ok: false, status: 400, error: 'Usernames are 3–20 letters, numbers or _' };
    if (password.length < 8 || password.length > 200) return { ok: false, status: 400, error: 'Passwords need at least 8 characters' };
    if (await this.store.getAccount(name)) return { ok: false, status: 409, error: 'That username is taken' };
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, 64);
    const account: Account = { username: name, displayName: displayName.trim().slice(0, 30) || name, playerId: me.playerId, salt: salt.toString('hex'), hash: hash.toString('hex'), createdAt: this.clock() };
    if (!(await this.store.createAccount(account))) return { ok: false, status: 409, error: 'That username is taken' };
    await this.store.setOwner(me.playerId, name);
    await this.store.setSessionsUsername(me.playerId, name);
    return { ok: true, playerId: me.playerId, token, account: await this.accountView(name) };
  }

  async login(username: string, password: string): Promise<AuthResult> {
    const name = username.trim().toLowerCase();
    const now = this.clock();
    const f = this.failures.get(name);
    if (f && f.count >= MAX_FAILURES && f.until > now) return { ok: false, status: 429, error: 'Too many attempts — wait a minute and try again' };
    const a = await this.store.getAccount(name);
    // Hash even for unknown names so timing doesn't reveal which usernames exist.
    const salt = a ? Buffer.from(a.salt, 'hex') : randomBytes(16);
    const hash = await scrypt(password, salt, 64);
    if (!a || !timingSafeEqual(hash, Buffer.from(a.hash, 'hex'))) {
      const count = f && f.until > now ? f.count + 1 : 1;
      this.failures.set(name, { count, until: now + LOCKOUT_MS });
      return { ok: false, status: 401, error: 'Wrong username or password' };
    }
    this.failures.delete(name);
    const token = await this.issue(a.playerId, name);
    return { ok: true, playerId: a.playerId, token, account: await this.accountView(name) };
  }

  async logout(token: string): Promise<void> {
    await this.store.deleteSession(hashToken(token));
  }

  async setDisplayName(token: string, displayName: string): Promise<boolean> {
    const me = await this.authenticate(token);
    if (!me?.username) return false;
    await this.store.setDisplayName(me.username, displayName.trim().slice(0, 30) || me.username);
    return true;
  }

  async me(token: string): Promise<AuthResult> {
    const id = await this.authenticate(token);
    if (!id) return { ok: false, status: 401, error: 'Not signed in' };
    return { ok: true, playerId: id.playerId, token, account: await this.accountView(id.username) };
  }
}
