import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApiMiddleware } from '../../server/api.ts';
import { AuthService, MemoryAuthStore } from '../../server/auth.ts';
import { LiveHub } from '../../server/live.ts';
import type { SaveStore } from '../../server/saveStore.ts';
import { MemoryValleyStore, ValleyService } from '../../server/valleyService.ts';
import { MemoryBusNetwork } from '../../server/bus.ts';

const noSaves: SaveStore = { load: async () => null, write: async () => ({ ok: true }), remove: async () => undefined };

interface Msg {
  type: string;
  online?: string[];
  valley?: { chat: { text: string }[]; buildings: { hearthHall: { shares: Record<string, number> } } };
}

/** A WebSocket client that remembers what it was sent. */
function connect(port: number, token: string): Promise<{ ws: WebSocket; inbox: Msg[]; next: (pred: (m: Msg) => boolean) => Promise<Msg> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/live?token=${token}`);
    const inbox: Msg[] = [];
    const waiters: { pred: (m: Msg) => boolean; done: (m: Msg) => void }[] = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data)) as Msg;
      inbox.push(m);
      for (const w of [...waiters]) if (w.pred(m)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.done(m);
      }
    };
    const next = (pred: (m: Msg) => boolean) =>
      new Promise<Msg>((done, fail) => {
        const hit = [...inbox].reverse().find(pred);
        if (hit) return done(hit);
        waiters.push({ pred, done });
        setTimeout(() => fail(new Error('timed out waiting for a push')), 3000);
      });
    ws.onopen = () => resolve({ ws, inbox, next });
    ws.onerror = () => reject(new Error('websocket failed'));
  });
}

describe('live Valley over websockets', () => {
  let server: Server;
  let port = 0;
  let hub: LiveHub;
  const auth = new AuthService(new MemoryAuthStore());
  const valleys = new ValleyService(new MemoryValleyStore());

  beforeAll(async () => {
    hub = new LiveHub(valleys, auth, { tickMs: 60_000 });
    const api = createApiMiddleware(noSaves, valleys, { auth });
    server = createServer((req, res) => void api(req, res, () => res.end()));
    server.on('upgrade', (req, socket) => void hub.handleUpgrade(req, socket));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    hub.close();
    server.close();
  });

  const http = async (path: string, token: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it('pushes one player’s delivery, chat and presence to the others', async () => {
    const a = await auth.session();
    const b = await auth.session();
    if (!a.ok || !b.ok) throw new Error('no sessions');
    const made = await http(`/api/valley/${a.playerId}/create`, a.token, { valleyName: 'Live Dale', name: 'Ada', villageName: 'Aston' });
    const code = (made.body.valley as { code: string }).code;
    await http(`/api/valley/${b.playerId}/join`, b.token, { code, name: 'Bo', villageName: 'Brook' });

    const alice = await connect(port, a.token);
    const bob = await connect(port, b.token);
    const both = await alice.next((m) => m.type === 'presence' && (m.online?.length ?? 0) === 2);
    expect(new Set(both.online)).toEqual(new Set([a.playerId, b.playerId]));

    await http(`/api/valley/${b.playerId}/contribute`, b.token, { opId: 'op-1', target: { kind: 'building', id: 'hearthHall' }, resources: { timber: 40 } });
    const pushed = await alice.next((m) => m.type === 'snapshot' && (m.valley?.buildings.hearthHall.shares[b.playerId] ?? 0) >= 40);
    expect(pushed.valley!.buildings.hearthHall.shares[b.playerId]).toBe(40);

    await http(`/api/valley/${b.playerId}/chat`, b.token, { text: '  hello   valley  ' });
    const chat = await alice.next((m) => m.type === 'snapshot' && (m.valley?.chat ?? []).some((c) => c.text === 'hello valley'));
    expect(chat).toBeTruthy();

    bob.ws.close();
    const alone = await alice.next((m) => m.type === 'presence' && (m.online?.length ?? 0) === 1);
    expect(alone.online).toEqual([a.playerId]);
    alice.ws.close();
  });

  it('refuses connections without a valid token', async () => {
    await expect(connect(port, 'not-a-token')).rejects.toThrow();
  });
});

describe('live Valley across several server processes', () => {
  // Two "processes": separate services, hubs and HTTP servers over one store, one auth database and one bus.
  const store = new MemoryValleyStore();
  const auth = new AuthService(new MemoryAuthStore());
  const network = new MemoryBusNetwork();
  const procs: { server: Server; hub: LiveHub; port: number }[] = [];

  beforeAll(async () => {
    for (let i = 0; i < 2; i++) {
      const valleys = new ValleyService(store);
      const hub = new LiveHub(valleys, auth, { tickMs: 60_000, bus: network.connect() });
      const api = createApiMiddleware(noSaves, valleys, { auth });
      const server = createServer((req, res) => void api(req, res, () => res.end()));
      server.on('upgrade', (req, socket) => void hub.handleUpgrade(req, socket));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      procs.push({ server, hub, port: (server.address() as AddressInfo).port });
    }
  });

  afterAll(() => {
    for (const p of procs) {
      p.hub.close();
      p.server.close();
    }
  });

  const http = async (port: number, path: string, token: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  it('pushes changes and presence to players connected to another process', async () => {
    const [one, two] = procs;
    const a = await auth.session();
    const b = await auth.session();
    if (!a.ok || !b.ok) throw new Error('no sessions');
    const made = await http(one.port, `/api/valley/${a.playerId}/create`, a.token, { valleyName: 'Split Dale', name: 'Ada', villageName: 'Aston' });
    const code = (made.body.valley as { code: string }).code;

    const alice = await connect(one.port, a.token);
    // Bob is connected to process one but joins through process two: his socket must follow.
    const bob = await connect(one.port, b.token);
    await http(two.port, `/api/valley/${b.playerId}/join`, b.token, { code, name: 'Bo', villageName: 'Brook' });
    await alice.next((m) => m.type === 'presence' && (m.online?.length ?? 0) === 2);
    bob.ws.close();
    await alice.next((m) => m.type === 'presence' && (m.online?.length ?? 0) === 1);

    // Now Bob connects to process two; Alice (on one) sees him arrive.
    alice.inbox.length = 0;
    const bob2 = await connect(two.port, b.token);
    const both = await alice.next((m) => m.type === 'presence' && (m.online?.length ?? 0) === 2);
    expect(new Set(both.online)).toEqual(new Set([a.playerId, b.playerId]));
    await bob2.next((m) => m.type === 'presence' && (m.online?.length ?? 0) === 2);

    // A delivery and a chat line through process two reach Alice on process one.
    alice.inbox.length = 0;
    await http(two.port, `/api/valley/${b.playerId}/contribute`, b.token, { opId: 'op-x1', target: { kind: 'building', id: 'hearthHall' }, resources: { timber: 25 } });
    const pushed = await alice.next((m) => m.type === 'snapshot' && (m.valley?.buildings.hearthHall.shares[b.playerId] ?? 0) >= 25);
    expect(pushed.valley!.buildings.hearthHall.shares[b.playerId]).toBe(25);
    await http(two.port, `/api/valley/${b.playerId}/chat`, b.token, { text: 'hello from two' });
    await alice.next((m) => m.type === 'snapshot' && (m.valley?.chat ?? []).some((c) => c.text === 'hello from two'));

    // And the other way round.
    await http(one.port, `/api/valley/${a.playerId}/chat`, a.token, { text: 'hello from one' });
    await bob2.next((m) => m.type === 'snapshot' && (m.valley?.chat ?? []).some((c) => c.text === 'hello from one'));

    alice.inbox.length = 0;
    bob2.ws.close();
    const alone = await alice.next((m) => m.type === 'presence' && (m.online?.length ?? 0) === 1);
    expect(alone.online).toEqual([a.playerId]);
    alice.ws.close();
  });

  it('forgets players on a process that went silent (crashed)', async () => {
    // Its own hub with a controllable clock and a quick tick.
    let now = Date.now();
    const valleys = new ValleyService(store);
    const hub = new LiveHub(valleys, auth, { tickMs: 20, bus: network.connect(), clock: () => now });
    const api = createApiMiddleware(noSaves, valleys, { auth });
    const server = createServer((req, res) => void api(req, res, () => res.end()));
    server.on('upgrade', (req, socket) => void hub.handleUpgrade(req, socket));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    try {
      const a = await auth.session();
      if (!a.ok) throw new Error('no session');
      const made = await http(port, `/api/valley/${a.playerId}/create`, a.token, { name: 'Ada', villageName: 'Aston' });
      const valleyId = (made.body.valley as { id: string }).id;
      const alice = await connect(port, a.token);
      // A "process" that reports a player once and then dies without a goodbye.
      const ghost = network.connect();
      ghost.publish({ type: 'presence', valleyId, online: ['p-ghost-000001'] });
      await alice.next((m) => m.type === 'presence' && (m.online ?? []).includes('p-ghost-000001'));
      await ghost.close();
      alice.inbox.length = 0;
      now += 40_000;
      const after = await alice.next((m) => m.type === 'presence');
      expect(after.online).toEqual([a.playerId]);
      alice.ws.close();
    } finally {
      hub.close();
      server.close();
    }
  });
});
