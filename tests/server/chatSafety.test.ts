import { describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { createApiMiddleware } from '../../server/api.ts';
import { AuthService, MemoryAuthStore } from '../../server/auth.ts';
import { MemoryPlaytestStore } from '../../server/playtest.ts';
import { RateLimiter } from '../../server/rateLimit.ts';
import { MemorySaveStore } from '../../server/saveStore.ts';
import { MemoryValleyStore, ValleyService } from '../../server/valleyService.ts';
import type { ChatMessage } from '../../src/valley/types.ts';

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

/** Two players in one invite-only Valley; each message is sent a little after the last (chat has a minimum gap). */
async function setup(limits?: { report: RateLimiter }) {
  let now = 1_000_000;
  const valleys = new ValleyService(new MemoryValleyStore(), () => now);
  const playtest = new MemoryPlaytestStore();
  const auth = new AuthService(new MemoryAuthStore());
  const api = createApiMiddleware(new MemorySaveStore(), valleys, { auth, playtest, adminToken: 'secret-admin', limits });
  const player = async (name: string) => {
    const s = await call(api, 'POST', '/api/session', {});
    return { id: s.body.playerId as string, token: s.body.token as string, name };
  };
  const wren = await player('Wren');
  const rook = await player('Rook');
  await call(api, 'POST', `/api/valley/${wren.id}/create`, { name: wren.name, villageName: 'Thistledown', open: false }, wren.token);
  const code = (await valleys.get(wren.id))!.valley.code;
  expect((await call(api, 'POST', `/api/valley/${rook.id}/join`, { name: 'Rook', villageName: 'Crowfield', code }, rook.token)).status).toBe(200);
  const say = async (p: { id: string; token: string }, text: string) => {
    now += 2000;
    return call(api, 'POST', `/api/valley/${p.id}/chat`, { text }, p.token);
  };
  const chat = async (): Promise<ChatMessage[]> => (await valleys.get(wren.id))!.valley.chat;
  return { api, valleys, playtest, wren, rook, say, chat };
}

describe('chat safety', () => {
  it('masks rude words in messages and names before anyone sees them', async () => {
    const { api, wren, say, chat } = await setup();
    expect((await say(wren, 'what the fuck, this is sh1t')).status).toBe(200);
    const mine = (await chat()).filter((c) => c.member === wren.id);
    expect(mine.at(-1)!.text).toBe('what the f***, this is s***');
    const v = await call(api, 'POST', `/api/valley/${wren.id}/profile`, { name: 'Bitch', villageName: 'Shitton' }, wren.token);
    const me = (v.body.valley as { members: { id: string; name: string; villageName: string }[] }).members.find((m) => m.id === wren.id)!;
    expect(me).toMatchObject({ name: 'B****', villageName: 'S******' });
  });

  it('lets a member report someone else’s message, and shows it in the admin report', async () => {
    const { api, playtest, wren, rook, say, chat } = await setup();
    await say(rook, 'give me your address');
    const msg = (await chat()).find((c) => c.member === rook.id)!;
    const report = (body: unknown, who = wren) => call(api, 'POST', `/api/valley/${who.id}/report`, body, who.token);

    expect((await call(api, 'POST', `/api/valley/${wren.id}/report`, { messageId: msg.id, reason: 'personal' })).status).toBe(401);
    expect((await call(api, 'POST', `/api/valley/${wren.id}/report`, { messageId: msg.id, reason: 'personal' }, rook.token)).status).toBe(401);
    expect((await report({ messageId: msg.id, reason: 'nonsense' })).status).toBe(400);
    expect((await report({ messageId: 99_999, reason: 'rude' })).status).toBe(404);
    // Your own messages aren't reportable.
    expect((await report({ messageId: msg.id, reason: 'rude' }, rook)).status).toBe(404);

    expect((await report({ messageId: msg.id, reason: 'personal', note: '  asked   for my address ' })).status).toBe(200);
    expect(playtest.chatReports).toHaveLength(1);
    expect(playtest.chatReports[0]).toMatchObject({ reporterId: wren.id, messageId: msg.id, memberId: rook.id, memberName: 'Rook', text: 'give me your address', reason: 'personal', note: 'asked for my address' });

    const admin = await call(api, 'GET', '/api/admin/playtest', undefined, 'secret-admin');
    expect(admin.body.reports).toEqual([expect.objectContaining({ text: 'give me your address', reason: 'personal' })]);
  });

  it('rate-limits reports per player', async () => {
    const { api, wren, rook, say, chat } = await setup({ report: new RateLimiter(2, 60_000) });
    await say(rook, 'hello');
    const msg = (await chat()).find((c) => c.member === rook.id)!;
    const send = () => call(api, 'POST', `/api/valley/${wren.id}/report`, { messageId: msg.id, reason: 'spam' }, wren.token);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });

  it('lets the admin remove a message, and mute a player so their chat is refused', async () => {
    const { api, valleys, wren, rook, say, chat } = await setup();
    await say(rook, 'one');
    await say(rook, 'two');
    const valleyId = (await valleys.get(wren.id))!.valley.id;
    const one = (await chat()).find((c) => c.text === 'one')!;
    const moderate = (body: unknown, token = 'secret-admin') => call(api, 'POST', '/api/admin/moderate', body, token);

    expect((await moderate({ valleyId, messageId: one.id }, 'wrong')).status).toBe(401);
    expect((await moderate({ valleyId, messageId: one.id })).status).toBe(200);
    expect((await chat()).map((c) => c.text)).not.toContain('one');
    expect((await chat()).map((c) => c.text)).toContain('two');

    expect((await moderate({ valleyId, member: rook.id, mute: true })).status).toBe(200);
    expect((await chat()).some((c) => c.member === rook.id)).toBe(false);
    expect((await say(rook, 'let me back')).status).toBe(422);
    expect((await say(wren, 'still here')).status).toBe(200);

    expect((await moderate({ valleyId, member: rook.id, mute: false })).status).toBe(200);
    expect((await say(rook, 'sorry')).status).toBe(200);
    expect((await moderate({ valleyId: 'v-nope', messageId: 1 })).status).toBe(404);
  });

  it('forgets the reports a player sent when they delete their account', async () => {
    const { api, playtest, wren, rook, say, chat } = await setup();
    await say(rook, 'hi');
    const msg = (await chat()).find((c) => c.member === rook.id)!;
    await call(api, 'POST', `/api/valley/${wren.id}/report`, { messageId: msg.id, reason: 'spam' }, wren.token);
    await playtest.forget(wren.id);
    expect(playtest.chatReports).toHaveLength(0);
  });
});
