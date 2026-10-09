import { describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { createApiMiddleware } from '../../server/api.ts';
import { AuthService, MemoryAuthStore } from '../../server/auth.ts';
import { MemoryPlaytestStore } from '../../server/playtest.ts';
import { MemorySaveStore } from '../../server/saveStore.ts';

async function call(api: ReturnType<typeof createApiMiddleware>, method: string, url: string, body?: unknown, token?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  Object.assign(req, { method, url, headers: token ? { authorization: `Bearer ${token}` } : {} });
  let status = 200;
  let text = '';
  const res = { set statusCode(v: number) { status = v; }, setHeader() {}, end(t: string) { text = t; } } as unknown as ServerResponse;
  await api(req, res, () => {
    status = 404;
    text = '{}';
  });
  return { status, body: JSON.parse(text || '{}') as Record<string, unknown> };
}

describe('playtest API', () => {
  const setup = () => {
    const playtest = new MemoryPlaytestStore();
    const auth = new AuthService(new MemoryAuthStore());
    const api = createApiMiddleware(new MemorySaveStore(), undefined, { auth, playtest, adminToken: 'secret-admin' });
    return { playtest, api };
  };

  it('takes feedback from signed-in players, tidied and rate-limited', async () => {
    const { playtest, api } = setup();
    expect((await call(api, 'POST', '/api/feedback', { text: 'hi' })).status).toBe(401);
    const s = await call(api, 'POST', '/api/session', {});
    const token = s.body.token as string;
    const ok = await call(api, 'POST', '/api/feedback', { text: '  loved   the hens ', mood: 'happy', context: { level: 3, bad: { nested: true }, screen: '1024x768' } }, token);
    expect(ok.status).toBe(200);
    expect(playtest.notes[0]).toMatchObject({ text: 'loved the hens', mood: 'happy', context: { level: 3, screen: '1024x768' } });
    expect(playtest.notes[0].context).not.toHaveProperty('bad');
    expect((await call(api, 'POST', '/api/feedback', { text: 'again' }, token)).status).toBe(429);
  });

  it('stores progress (token in the body for sendBeacon) and reports it to the admin only', async () => {
    const { playtest, api } = setup();
    const a = await call(api, 'POST', '/api/session', {});
    const b = await call(api, 'POST', '/api/session', {});
    const send = (token: string, events: unknown[], inBody = false) => call(api, 'POST', '/api/progress', inBody ? { events, token } : { events }, inBody ? undefined : token);
    await send(a.body.token as string, [{ kind: 'levelUp', simTime: 600, playMinutes: 9, data: { level: 2, label: 'Village level 2' } }, { kind: 'bad kind!', simTime: 1 }]);
    await send(b.body.token as string, [{ kind: 'levelUp', simTime: 1200, playMinutes: 15, data: { level: 2, label: 'Village level 2' } }], true);
    expect(playtest.log).toHaveLength(2);
    expect((await call(api, 'GET', '/api/admin/playtest')).status).toBe(401);
    expect((await call(api, 'GET', '/api/admin/playtest', undefined, 'wrong')).status).toBe(401);
    const report = await call(api, 'GET', '/api/admin/playtest', undefined, 'secret-admin');
    expect(report.status).toBe(200);
    const level2 = (report.body.milestones as { label: string; players: number; medianSimMinutes: number; medianPlayMinutes: number }[]).find((m) => m.label === 'Village level 2');
    expect(level2).toEqual(expect.objectContaining({ players: 2, medianSimMinutes: 15, medianPlayMinutes: 12 }));
  });
});
