import type pg from 'pg';

/**
 * The database schema, as ordered migrations. Each runs once, in its own
 * transaction, recorded in `schema_migrations`; processes starting together
 * serialise on an advisory lock so only one applies them. Append, never edit.
 *
 * Personal villages and Valleys are stored as versioned JSON documents: both are
 * simulated as a whole (the client's deterministic village sim, the server's Valley
 * sim), so the document is the natural unit. What has to be queried or unique on
 * its own — membership, invite codes, the open-Valley list, accounts, sessions —
 * gets real columns and indexes.
 */
export const MIGRATIONS: string[] = [
  // 1: saves, Valleys, membership, identity.
  `
  CREATE TABLE village_saves (
    player_id        text PRIMARY KEY,
    revision         integer NOT NULL,
    server_saved_at  bigint  NOT NULL,
    payload          jsonb   NOT NULL
  );

  CREATE TABLE valleys (
    id          text PRIMARY KEY,
    name        text    NOT NULL,
    code        text    NOT NULL,
    open        boolean NOT NULL,
    players     integer NOT NULL,
    neighbours  integer NOT NULL,
    levels      integer NOT NULL,
    state       jsonb   NOT NULL,
    updated_at  bigint  NOT NULL
  );
  CREATE INDEX valleys_code ON valleys (code);
  CREATE INDEX valleys_open ON valleys (players DESC, levels DESC) WHERE open;

  CREATE TABLE valley_members (
    player_id  text PRIMARY KEY,
    valley_id  text NOT NULL REFERENCES valleys (id) ON DELETE CASCADE,
    joined_at  bigint NOT NULL
  );
  CREATE INDEX valley_members_valley ON valley_members (valley_id);

  CREATE TABLE accounts (
    username      text PRIMARY KEY,
    display_name  text   NOT NULL,
    player_id     text   NOT NULL,
    salt          text   NOT NULL,
    hash          text   NOT NULL,
    created_at    bigint NOT NULL
  );

  -- Player ids someone owns: a guest (username null) or an account.
  CREATE TABLE players (
    player_id  text PRIMARY KEY,
    username   text REFERENCES accounts (username)
  );

  -- Keyed by sha-256 of the token; the token itself is never stored.
  CREATE TABLE sessions (
    token_hash  text PRIMARY KEY,
    player_id   text   NOT NULL,
    username    text,
    created_at  bigint NOT NULL
  );
  CREATE INDEX sessions_player ON sessions (player_id);
  `,
];

/** Arbitrary constant key for the migration advisory lock. */
const MIGRATION_LOCK = 7_301_942_118;

/** Applies any migrations this database hasn't seen. Safe to call from every process at start-up. */
export async function migrate(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await client.query<{ v: number | null }>('SELECT max(version) AS v FROM schema_migrations');
    const current = rows[0]?.v ?? 0;
    for (let i = current; i < MIGRATIONS.length; i++) {
      await client.query(MIGRATIONS[i]);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [i + 1]);
    }
    await client.query('COMMIT');
    return MIGRATIONS.length - current;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
