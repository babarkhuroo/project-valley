import { describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { createApiMiddleware } from '../../server/api.ts';
import { AuthService, MemoryAuthStore } from '../../server/auth.ts';
import type { SaveStore, StoredSave } from '../../server/saveStore.ts';

class MemorySaveStore implements SaveStore {
  readonly saves = new Map<string, StoredSave>();
  async load(id: string) {
    return this.saves.get(id) ?? null;
  }
  async save(r: StoredSave) {
    this.saves.set(r.playerId, r);
  }
  async remove(id: string) {
    this.saves.delete(id);
  }
}

/** Drives the middleware with an in-memory request/response pair. */
async function call(api: ReturnType<typeof createApiMiddleware>, method: string, url: string, body?: unknown, token?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  Object.assign(req, { method, url, headers: token ? { authorization: `Bearer ${token}` } : {} });
  let status = 200;
  let text = '';
  const res = {
    set statusCode(v: number) {
      status = v;
    },
    setHeader() {},
    end(t: string) {
      text = t;
    },
  } as unknown as ServerResponse;
  await api(req, res, () => {
    status = 404;
    text = '{}';
  });
  return { status, body: JSON.parse(text || '{}') as Record<string, unknown> };
}

describe('auth service', () => {
  it('claims a guest village once, then needs the token', async () => {
    const auth = new AuthService(new MemoryAuthStore());
    const a = await auth.session('p-abcdefgh1234');
    expect(a.ok).toBe(true);
    const again = await auth.session('p-abcdefgh1234');
    expect(again).toMatchObject({ ok: false, status: 409 });
    if (!a.ok) return;
    expect((await auth.authenticate(a.token))?.playerId).toBe('p-abcdefgh1234');
    expect(await auth.authenticate('nope')).toBeNull();
    const fresh = await auth.session();
    expect(fresh.ok && fresh.playerId).toMatch(/^p-[0-9a-f]{24}$/);
  });

  it('registers, signs in from another device, and rejects wrong passwords', async () => {
    const auth = new AuthService(new MemoryAuthStore());
    const guest = await auth.session('p-device-one-01');
    if (!guest.ok) throw new Error('no session');
    expect((await auth.register(guest.token, 'x', 'longenough', 'Me')).ok).toBe(false);
    expect((await auth.register(guest.token, 'wren_keeper', 'short', 'Me')).ok).toBe(false);
    const reg = await auth.register(guest.token, 'Wren_Keeper', 'correct horse', 'Wren');
    expect(reg).toMatchObject({ ok: true, account: { username: 'wren_keeper', displayName: 'Wren' } });
    const other = await auth.session('p-device-two-02');
    if (!other.ok) throw new Error('no session');
    expect((await auth.register(other.token, 'wren_keeper', 'another one', 'X')).ok).toBe(false);
    expect(await auth.login('wren_keeper', 'wrong password')).toMatchObject({ ok: false, status: 401 });
    const login = await auth.login('WREN_KEEPER', 'correct horse');
    expect(login).toMatchObject({ ok: true, playerId: 'p-device-one-01' });
    if (!login.ok) return;
    await auth.logout(login.token);
    expect(await auth.authenticate(login.token)).toBeNull();
    expect(await auth.authenticate(guest.token)).not.toBeNull();
  });

  it('locks out repeated wrong guesses for a while', async () => {
    let now = 1_000_000;
    const auth = new AuthService(new MemoryAuthStore(), () => now);
    const g = await auth.session('p-lockout-test-1');
    if (!g.ok) throw new Error('no session');
    await auth.register(g.token, 'target', 'the real one', 'T');
    for (let i = 0; i < 5; i++) await auth.login('target', `guess ${i}`);
    expect(await auth.login('target', 'the real one')).toMatchObject({ ok: false, status: 429 });
    now += 61_000;
    expect((await auth.login('target', 'the real one')).ok).toBe(true);
  });

  it('persists through its store', async () => {
    const store = new MemoryAuthStore();
    const a = new AuthService(store);
    const s = await a.session('p-persisted-001');
    if (!s.ok) throw new Error('no session');
    await a.register(s.token, 'keeper', 'password123', 'K');
    const b = new AuthService(store);
    expect((await b.authenticate(s.token))?.username).toBe('keeper');
    expect((await b.login('keeper', 'password123')).ok).toBe(true);
  });
});

describe('API authorisation', () => {
  it('only the owner can read or write a save', async () => {
    const saves = new MemorySaveStore();
    const auth = new AuthService(new MemoryAuthStore());
    const api = createApiMiddleware(saves, undefined, { auth });
    const s = await call(api, 'POST', '/api/session', { playerId: 'p-owner-000001' });
    const token = s.body.token as string;
    const put = await call(api, 'PUT', '/api/save/p-owner-000001', { revision: 1, payload: { a: 1 } }, token);
    expect(put.status).toBe(200);
    expect((await call(api, 'GET', '/api/save/p-owner-000001')).status).toBe(401);
    expect((await call(api, 'GET', '/api/save/p-owner-000001', undefined, 'forged')).status).toBe(401);
    const other = await call(api, 'POST', '/api/session', {});
    expect((await call(api, 'GET', '/api/save/p-owner-000001', undefined, other.body.token as string)).status).toBe(401);
    expect((await call(api, 'GET', '/api/save/p-owner-000001', undefined, token)).status).toBe(200);
    // sendBeacon can't set headers: the token rides in the body.
    expect((await call(api, 'POST', '/api/save/p-owner-000001', { revision: 2, payload: { a: 2 }, token })).status).toBe(200);
    expect(saves.saves.get('p-owner-000001')?.revision).toBe(2);
  });

  it('serves sign-in through the API', async () => {
    const auth = new AuthService(new MemoryAuthStore());
    const api = createApiMiddleware(new MemorySaveStore(), undefined, { auth });
    const s = await call(api, 'POST', '/api/session', {});
    const reg = await call(api, 'POST', '/api/account/register', { username: 'hollis', password: 'patient otter', displayName: 'Hollis' }, s.body.token as string);
    expect(reg.status).toBe(200);
    const me = await call(api, 'GET', '/api/me', undefined, s.body.token as string);
    expect(me.body.account).toEqual({ username: 'hollis', displayName: 'Hollis' });
    const bad = await call(api, 'POST', '/api/account/login', { username: 'hollis', password: 'nope' });
    expect(bad.status).toBe(401);
    const good = await call(api, 'POST', '/api/account/login', { username: 'hollis', password: 'patient otter' });
    expect(good.body.playerId).toBe(s.body.playerId);
  });
});
