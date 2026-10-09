import pg from 'pg';
import type { ValleyState } from '../../src/valley/types.ts';
import { MAX_PLAYERS } from '../../src/valley/valleySim.ts';
import type { Account, AuthStore, Session } from '../auth.ts';
import { newOrigin, type BusMessage, type Envelope, type LiveBus } from '../bus.ts';
import type { SaveStore, SaveWrite, StoredSave } from '../saveStore.ts';
import { listingOf, type ValleyListing, type ValleyStore } from '../valleyService.ts';
import { migrate } from './schema.ts';

/**
 * PostgreSQL implementations of the server's stores, plus the LISTEN/NOTIFY bus
 * that lets several server processes share live Valley updates. Everything that
 * must not race across processes is done in the database: save revisions with a
 * conditional upsert, unique claims with ON CONFLICT, and each Valley's
 * load → simulate → save with a session advisory lock.
 */

// Timestamps are ms since the epoch: well inside a double, so read bigint as a number.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export interface PgConnection {
  pool: pg.Pool;
  /** Advisory locks hold a connection for a whole Valley operation; keep them off the query pool. */
  lockPool: pg.Pool;
  url: string;
  /** Postgres `search_path` (tests use a throwaway schema). */
  schema: string | null;
  close(): Promise<void>;
}

/** Connects, creates the schema if asked for, and brings the database up to date. */
export async function connectPostgres(url: string, options: { schema?: string; max?: number } = {}): Promise<PgConnection> {
  const schema = options.schema ?? null;
  const config = { connectionString: url, ...(schema ? { options: `-c search_path=${schema}` } : {}) };
  if (schema) {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA IF NOT EXISTS ${pg.escapeIdentifier(schema)}`);
    await admin.end();
  }
  const pool = new pg.Pool({ ...config, max: options.max ?? 10 });
  const lockPool = new pg.Pool({ ...config, max: options.max ?? 10 });
  await migrate(pool);
  return {
    pool,
    lockPool,
    url,
    schema,
    async close() {
      await Promise.all([pool.end(), lockPool.end()]);
    },
  };
}

export class PgSaveStore implements SaveStore {
  constructor(private readonly db: PgConnection) {}

  async load(playerId: string): Promise<StoredSave | null> {
    const { rows } = await this.db.pool.query<{ revision: number; server_saved_at: number; payload: unknown }>(
      'SELECT revision, server_saved_at, payload FROM village_saves WHERE player_id = $1',
      [playerId],
    );
    const r = rows[0];
    return r ? { playerId, revision: r.revision, serverSavedAt: r.server_saved_at, payload: r.payload } : null;
  }

  async write(record: StoredSave): Promise<SaveWrite> {
    const written = await this.db.pool.query(
      `INSERT INTO village_saves (player_id, revision, server_saved_at, payload) VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (player_id) DO UPDATE SET revision = EXCLUDED.revision, server_saved_at = EXCLUDED.server_saved_at, payload = EXCLUDED.payload
       WHERE village_saves.revision <= EXCLUDED.revision`,
      [record.playerId, record.revision, record.serverSavedAt, JSON.stringify(record.payload)],
    );
    if (written.rowCount === 1) return { ok: true };
    const current = await this.load(record.playerId);
    return { ok: false, revision: current?.revision ?? record.revision };
  }

  async remove(playerId: string): Promise<void> {
    await this.db.pool.query('DELETE FROM village_saves WHERE player_id = $1', [playerId]);
  }
}

export class PgValleyStore implements ValleyStore {
  constructor(private readonly db: PgConnection) {}

  async valleyFor(playerId: string): Promise<string | null> {
    const { rows } = await this.db.pool.query<{ valley_id: string }>('SELECT valley_id FROM valley_members WHERE player_id = $1', [playerId]);
    return rows[0]?.valley_id ?? null;
  }

  async setMembership(playerId: string, valleyId: string): Promise<void> {
    await this.db.pool.query(
      `INSERT INTO valley_members (player_id, valley_id, joined_at) VALUES ($1, $2, $3)
       ON CONFLICT (player_id) DO UPDATE SET valley_id = EXCLUDED.valley_id, joined_at = EXCLUDED.joined_at`,
      [playerId, valleyId, Date.now()],
    );
  }

  async clearMembership(playerId: string): Promise<void> {
    await this.db.pool.query('DELETE FROM valley_members WHERE player_id = $1', [playerId]);
  }

  async load(valleyId: string): Promise<ValleyState | null> {
    const { rows } = await this.db.pool.query<{ state: ValleyState }>('SELECT state FROM valleys WHERE id = $1', [valleyId]);
    return rows[0]?.state ?? null;
  }

  async save(valley: ValleyState): Promise<void> {
    const l = listingOf(valley);
    await this.db.pool.query(
      `INSERT INTO valleys (id, name, code, open, players, neighbours, levels, state, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, code = EXCLUDED.code, open = EXCLUDED.open, players = EXCLUDED.players,
         neighbours = EXCLUDED.neighbours, levels = EXCLUDED.levels, state = EXCLUDED.state, updated_at = EXCLUDED.updated_at`,
      [valley.id, l.name, l.code, l.open, l.players, l.neighbours, l.levels, JSON.stringify(valley), Date.now()],
    );
  }

  async listOpen(limit: number): Promise<ValleyListing[]> {
    const { rows } = await this.db.pool.query<ValleyListing>(
      `SELECT id, name, players, neighbours, levels FROM valleys
       WHERE open AND players < $1 ORDER BY players DESC, levels DESC LIMIT $2`,
      [MAX_PLAYERS, limit],
    );
    return rows;
  }

  async findByCode(code: string): Promise<string | null> {
    const { rows } = await this.db.pool.query<{ id: string }>('SELECT id FROM valleys WHERE code = $1 LIMIT 1', [code]);
    return rows[0]?.id ?? null;
  }

  /**
   * Holds a session advisory lock on the Valley for the whole operation, so a
   * Valley is loaded, advanced and saved by one process at a time. The lock lives on
   * its own connection: if the process dies, Postgres releases it.
   */
  async lock<T>(valleyId: string, fn: () => Promise<T>): Promise<T> {
    const client = await this.db.lockPool.connect();
    let broken = false;
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [`valley:${valleyId}`]);
      try {
        return await fn();
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [`valley:${valleyId}`]).catch(() => {
          broken = true;
        });
      }
    } finally {
      // A connection whose unlock failed may still hold the lock: throw it away.
      client.release(broken);
    }
  }
}

export class PgAuthStore implements AuthStore {
  constructor(private readonly db: PgConnection) {}

  async getSession(tokenHash: string): Promise<Session | null> {
    const { rows } = await this.db.pool.query<{ player_id: string; username: string | null; created_at: number }>(
      'SELECT player_id, username, created_at FROM sessions WHERE token_hash = $1',
      [tokenHash],
    );
    const r = rows[0];
    return r ? { playerId: r.player_id, username: r.username, createdAt: r.created_at } : null;
  }

  async putSession(tokenHash: string, s: Session): Promise<void> {
    await this.db.pool.query(
      `INSERT INTO sessions (token_hash, player_id, username, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (token_hash) DO UPDATE SET player_id = EXCLUDED.player_id, username = EXCLUDED.username`,
      [tokenHash, s.playerId, s.username, s.createdAt],
    );
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  async setSessionsUsername(playerId: string, username: string): Promise<void> {
    await this.db.pool.query('UPDATE sessions SET username = $2 WHERE player_id = $1', [playerId, username]);
  }

  async getAccount(username: string): Promise<Account | null> {
    const { rows } = await this.db.pool.query<{ username: string; display_name: string; player_id: string; salt: string; hash: string; created_at: number }>(
      'SELECT username, display_name, player_id, salt, hash, created_at FROM accounts WHERE username = $1',
      [username],
    );
    const r = rows[0];
    return r ? { username: r.username, displayName: r.display_name, playerId: r.player_id, salt: r.salt, hash: r.hash, createdAt: r.created_at } : null;
  }

  async createAccount(a: Account): Promise<boolean> {
    const out = await this.db.pool.query(
      `INSERT INTO accounts (username, display_name, player_id, salt, hash, created_at) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (username) DO NOTHING`,
      [a.username, a.displayName, a.playerId, a.salt, a.hash, a.createdAt],
    );
    return out.rowCount === 1;
  }

  async setDisplayName(username: string, displayName: string): Promise<void> {
    await this.db.pool.query('UPDATE accounts SET display_name = $2 WHERE username = $1', [username, displayName]);
  }

  async owner(playerId: string): Promise<{ username: string | null } | null> {
    const { rows } = await this.db.pool.query<{ username: string | null }>('SELECT username FROM players WHERE player_id = $1', [playerId]);
    return rows[0] ? { username: rows[0].username } : null;
  }

  async claim(playerId: string): Promise<boolean> {
    const out = await this.db.pool.query('INSERT INTO players (player_id) VALUES ($1) ON CONFLICT (player_id) DO NOTHING', [playerId]);
    return out.rowCount === 1;
  }

  async setOwner(playerId: string, username: string): Promise<void> {
    await this.db.pool.query(
      'INSERT INTO players (player_id, username) VALUES ($1, $2) ON CONFLICT (player_id) DO UPDATE SET username = EXCLUDED.username',
      [playerId, username],
    );
  }
}

/** Channel name, namespaced by schema so throwaway test schemas don't hear each other. */
function channelFor(db: PgConnection): string {
  return db.schema ? `valley_bus_${db.schema}` : 'valley_bus';
}

/**
 * The live bus over LISTEN/NOTIFY: one listening connection per process, which
 * reconnects (with backoff) if the database restarts. Messages are small JSON
 * (well under NOTIFY's 8 kB limit); a missed message only delays a push until the
 * next one or the client's slow poll.
 */
export class PgBus implements LiveBus {
  readonly origin = newOrigin();
  private readonly handlers = new Set<(msg: Envelope) => void>();
  private client: pg.Client | null = null;
  private closed = false;
  private retryMs = 500;
  private readonly channel: string;

  private constructor(private readonly db: PgConnection) {
    this.channel = channelFor(db);
  }

  static async start(db: PgConnection): Promise<PgBus> {
    const bus = new PgBus(db);
    await bus.listen();
    return bus;
  }

  private async listen(): Promise<void> {
    const client = new pg.Client({ connectionString: this.db.url });
    client.on('notification', (n) => {
      if (n.channel !== this.channel || !n.payload) return;
      try {
        const env = JSON.parse(n.payload) as Envelope;
        if (env.origin === this.origin) return;
        for (const h of this.handlers) h(env);
      } catch {
        // Not ours.
      }
    });
    const reconnect = () => {
      if (this.closed || this.client !== client) return;
      this.client = null;
      setTimeout(() => void this.listen().catch(reconnect), this.retryMs).unref?.();
      this.retryMs = Math.min(10_000, this.retryMs * 2);
    };
    client.on('error', reconnect);
    client.on('end', reconnect);
    await client.connect();
    await client.query(`LISTEN ${pg.escapeIdentifier(this.channel)}`);
    this.client = client;
    this.retryMs = 500;
  }

  publish(msg: BusMessage): void {
    const payload = JSON.stringify({ ...msg, origin: this.origin });
    this.db.pool.query('SELECT pg_notify($1, $2)', [this.channel, payload]).catch(() => undefined);
  }

  subscribe(fn: (msg: Envelope) => void): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.handlers.clear();
    const c = this.client;
    this.client = null;
    await c?.end().catch(() => undefined);
  }
}
