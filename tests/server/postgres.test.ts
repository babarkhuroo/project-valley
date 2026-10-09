import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { AuthService } from '../../server/auth.ts';
import type { Envelope } from '../../server/bus.ts';
import { connectPostgres, PgAuthStore, PgBus, PgSaveStore, PgValleyStore, type PgConnection } from '../../server/db/pgStores.ts';
import { MIGRATIONS, migrate } from '../../server/db/schema.ts';
import { ValleyService } from '../../server/valleyService.ts';
import { PgPlaytestStore, playtestReport } from '../../server/playtest.ts';

/**
 * Runs against a real Postgres when TEST_DATABASE_URL is set (`npm run test:pg` uses
 * the local `project_valley_test` database). Each run gets its own throwaway schema.
 */
const URL = process.env.TEST_DATABASE_URL;
const schema = `t_${randomBytes(5).toString('hex')}`;

describe.skipIf(!URL)('postgres stores', () => {
  let db: PgConnection;
  // A second connection set stands in for a second server process.
  let db2: PgConnection;

  beforeAll(async () => {
    db = await connectPostgres(URL!, { schema });
    db2 = await connectPostgres(URL!, { schema });
  });

  afterAll(async () => {
    await db2?.close();
    await db?.close();
    const admin = new pg.Client({ connectionString: URL });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${pg.escapeIdentifier(schema)} CASCADE`);
    await admin.end();
  });

  it('migrates once, however many processes start', async () => {
    expect(await migrate(db.pool)).toBe(0);
    const { rows } = await db.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
    expect(rows[0].n).toBe(MIGRATIONS.length);
  });

  it('saves refuse stale revisions atomically', async () => {
    const saves = new PgSaveStore(db);
    const other = new PgSaveStore(db2);
    expect(await saves.write({ playerId: 'p-pg-save-01', revision: 3, serverSavedAt: 1000, payload: { a: [1, 2.5, 'x'] } })).toEqual({ ok: true });
    expect(await other.write({ playerId: 'p-pg-save-01', revision: 2, serverSavedAt: 2000, payload: { a: 'old' } })).toEqual({ ok: false, revision: 3 });
    const loaded = await other.load('p-pg-save-01');
    expect(loaded).toEqual({ playerId: 'p-pg-save-01', revision: 3, serverSavedAt: 1000, payload: { a: [1, 2.5, 'x'] } });
    // Racing writers: the highest revision always ends up stored.
    await Promise.all([5, 9, 7, 6, 8].map((r, i) => (i % 2 ? saves : other).write({ playerId: 'p-pg-save-01', revision: r, serverSavedAt: r, payload: { r } })));
    expect((await saves.load('p-pg-save-01'))?.revision).toBe(9);
    await saves.remove('p-pg-save-01');
    expect(await saves.load('p-pg-save-01')).toBeNull();
  });

  it('identity is shared between processes', async () => {
    const a = new AuthService(new PgAuthStore(db));
    const b = new AuthService(new PgAuthStore(db2));
    const s = await a.session('p-pg-auth-0001');
    expect(s.ok).toBe(true);
    expect(await b.session('p-pg-auth-0001')).toMatchObject({ ok: false, status: 409 });
    if (!s.ok) return;
    expect((await b.authenticate(s.token))?.playerId).toBe('p-pg-auth-0001');
    expect((await a.register(s.token, 'pgfolk', 'long enough', 'PG Folk')).ok).toBe(true);
    const other = await b.session();
    if (!other.ok) throw new Error('no session');
    expect(await b.register(other.token, 'pgfolk', 'another one', 'X')).toMatchObject({ ok: false, status: 409 });
    const login = await b.login('pgfolk', 'long enough');
    expect(login).toMatchObject({ ok: true, playerId: 'p-pg-auth-0001', account: { username: 'pgfolk', displayName: 'PG Folk' } });
    expect((await a.authenticate(s.token))?.username).toBe('pgfolk');
    await b.logout(s.token);
    expect(await a.authenticate(s.token)).toBeNull();
  });

  it('Valleys: create, list, join by code, leave', async () => {
    const one = new ValleyService(new PgValleyStore(db));
    const two = new ValleyService(new PgValleyStore(db2));
    const made = await one.create('p-pg-vy-0001', { name: 'Ada', villageName: 'Aston' }, { name: 'Pg Dale', open: true });
    if (!made.ok) throw new Error(made.error);
    expect((await two.listOpen()).some((l) => l.id === made.view.valley.id && l.players === 1)).toBe(true);
    const joined = await two.joinExisting('p-pg-vy-0002', { name: 'Bo', villageName: 'Brook' }, { code: made.view.valley.code.toLowerCase() });
    expect(joined.ok).toBe(true);
    expect((await one.get('p-pg-vy-0002'))?.valley.id).toBe(made.view.valley.id);
    expect((await two.listOpen()).find((l) => l.id === made.view.valley.id)?.players).toBe(2);
    expect(await one.leave('p-pg-vy-0002')).toBe(true);
    expect(await two.get('p-pg-vy-0002')).toBeNull();
  });

  it('two processes delivering at once never lose a delivery', async () => {
    const one = new ValleyService(new PgValleyStore(db));
    const two = new ValleyService(new PgValleyStore(db2));
    const made = await one.create('p-pg-race-001', { name: 'Ada', villageName: 'Aston' }, { open: true });
    if (!made.ok) throw new Error(made.error);
    const joined = await two.joinExisting('p-pg-race-002', { name: 'Bo', villageName: 'Brook' }, { code: made.view.valley.code });
    expect(joined.ok).toBe(true);
    // Each service serialises its own calls; only the database lock keeps the two apart.
    const sends = Array.from({ length: 12 }, (_, i) =>
      i % 2 ? two.contribute('p-pg-race-002', 'hearthHall', { timber: 10 }, `op-b-${i}`) : one.contribute('p-pg-race-001', 'hearthHall', { timber: 10 }, `op-a-${i}`),
    );
    await Promise.all(sends);
    const view = await one.get('p-pg-race-001');
    const shares = view!.valley.buildings.hearthHall.shares;
    expect(shares['p-pg-race-001']).toBe(60);
    expect(shares['p-pg-race-002']).toBe(60);
  });

  it('the bus carries messages between processes, never back to the sender', async () => {
    const a = await PgBus.start(db);
    const b = await PgBus.start(db2);
    const heardA: Envelope[] = [];
    const heardB: Envelope[] = [];
    a.subscribe((m) => heardA.push(m));
    b.subscribe((m) => heardB.push(m));
    a.publish({ type: 'changed', valleyId: 'v-bus-1' });
    b.publish({ type: 'presence', valleyId: 'v-bus-1', online: ['p-1'] });
    for (let i = 0; i < 50 && (heardA.length === 0 || heardB.length === 0); i++) await new Promise((r) => setTimeout(r, 20));
    expect(heardB).toEqual([{ type: 'changed', valleyId: 'v-bus-1', origin: a.origin }]);
    expect(heardA).toEqual([{ type: 'presence', valleyId: 'v-bus-1', online: ['p-1'], origin: b.origin }]);
    await a.close();
    await b.close();
  });

  it('keeps playtest feedback and progress', async () => {
    const store = new PgPlaytestStore(db.pool);
    await store.addFeedback({ playerId: 'p-pg-play-01', at: 1000, mood: 'stuck', text: 'where is clay?', context: { level: 2 } });
    await store.addEvents([
      { playerId: 'p-pg-play-01', at: 1000, kind: 'built', simTime: 300, playMinutes: 5, data: { id: 'academy', label: 'Built Academy' } },
      { playerId: 'p-pg-play-02', at: 1001, kind: 'built', simTime: 500, playMinutes: 7, data: { id: 'academy', label: 'Built Academy' } },
    ]);
    const r = await playtestReport(store);
    expect(r.feedback[0]).toMatchObject({ text: 'where is clay?', mood: 'stuck', context: { level: 2 } });
    expect(r.milestones.find((m) => m.label === 'Built Academy')).toMatchObject({ players: 2, medianSimMinutes: 7, medianPlayMinutes: 6 });
  });
});
