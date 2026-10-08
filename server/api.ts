import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SaveStore } from './saveStore.ts';
import type { ResourceBag } from '../src/valley/types.ts';
import type { JoinOutcome, ValleyService } from './valleyService.ts';
import type { AuthResult, AuthService } from './auth.ts';

const PLAYER_ID = /^[a-z0-9-]{8,64}$/;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

type Next = () => void;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Connect-style middleware exposing the persistence API.
 *
 *   GET    /api/time             -> { now }
 *   GET    /api/save/:playerId   -> { revision, serverSavedAt, payload, now } | 404
 *   PUT    /api/save/:playerId   <- { revision, payload }   (POST accepted for sendBeacon)
 *   DELETE /api/save/:playerId
 *   GET    /api/valley/:playerId              -> { valley, memberId, now } | 404
 *   POST   /api/valley/:playerId/join         <- { name, villageName }
 *   POST   /api/valley/:playerId/contribute   <- { opId, building, resources } -> { result, valley, … }
 *
 *   POST   /api/session                       <- { playerId? } -> { playerId, token, account }
 *   GET    /api/me
 *   POST   /api/account/register              <- { username, password, displayName }
 *   POST   /api/account/login                 <- { username, password }
 *   POST   /api/account/logout
 *
 * With an AuthService, every /api/save and /api/valley call must carry a session token
 * (Authorization: Bearer …, or `token` in the body for sendBeacon) for that player id.
 * The server clock is authoritative for offline progression: the client never
 * supplies the timestamp used to compute elapsed time.
 */
export interface ApiOptions {
  dev?: boolean;
  auth?: AuthService;
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

function sendAuth(res: ServerResponse, out: AuthResult): void {
  if (out.ok) sendJson(res, 200, { playerId: out.playerId, token: out.token, account: out.account });
  else sendJson(res, out.status, { error: out.error });
}

export function createApiMiddleware(store: SaveStore, valleys?: ValleyService, options: ApiOptions = {}) {
  const auth = options.auth;
  return async (req: IncomingMessage, res: ServerResponse, next: Next): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      next();
      return;
    }
    try {
      if (url.pathname === '/api/time' && req.method === 'GET') {
        sendJson(res, 200, { now: Date.now() });
        return;
      }
      const raw = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : '';
      const json = (): Record<string, unknown> => (raw ? (JSON.parse(raw) as Record<string, unknown>) : {});
      const token = bearer(req);
      if (auth && (url.pathname === '/api/session' || url.pathname === '/api/me' || url.pathname.startsWith('/api/account/'))) {
        await handleAuth(req, res, auth, url.pathname, token, json());
        return;
      }
      if (url.pathname === '/api/valleys' && req.method === 'GET' && valleys) {
        if (auth && !(await auth.authenticate(token))) {
          sendJson(res, 401, { error: 'Not signed in' });
          return;
        }
        sendJson(res, 200, { valleys: await valleys.listOpen() });
        return;
      }
      // Every per-player route must be called by that player.
      const owner = /^\/api\/(?:save|valley)\/([^/]+)/.exec(url.pathname)?.[1];
      if (auth && owner) {
        const body = raw && url.pathname.startsWith('/api/save/') ? json() : {};
        const me = await auth.authenticate(token ?? (typeof body.token === 'string' ? body.token : null));
        if (!me || me.playerId !== owner) {
          sendJson(res, 401, { error: 'not signed in as this player' });
          return;
        }
      }
      const valleyMatch = /^\/api\/valley\/([^/]+)(?:\/(join|create|leave|settings|contribute|vote|profile|dev-skip))?$/.exec(url.pathname);
      if (valleyMatch && valleys) {
        await handleValley(req, res, valleys, valleyMatch[1], valleyMatch[2] ?? null, options.dev ?? false, json());
        return;
      }
      const match = /^\/api\/save\/([^/]+)$/.exec(url.pathname);
      if (!match) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      const playerId = match[1];
      if (!PLAYER_ID.test(playerId)) {
        sendJson(res, 400, { error: 'invalid player id' });
        return;
      }
      switch (req.method) {
        case 'GET': {
          const record = await store.load(playerId);
          if (!record) {
            sendJson(res, 404, { error: 'no save', now: Date.now() });
            return;
          }
          sendJson(res, 200, { ...record, now: Date.now() });
          return;
        }
        case 'PUT':
        case 'POST': {
          const body = json() as { revision?: unknown; payload?: unknown };
          if (typeof body.revision !== 'number' || body.payload === undefined) {
            sendJson(res, 400, { error: 'malformed save' });
            return;
          }
          const existing = await store.load(playerId);
          if (existing && existing.revision > body.revision) {
            sendJson(res, 409, { error: 'stale revision', revision: existing.revision });
            return;
          }
          const serverSavedAt = Date.now();
          await store.save({ playerId, revision: body.revision, serverSavedAt, payload: body.payload });
          sendJson(res, 200, { revision: body.revision, serverSavedAt });
          return;
        }
        case 'DELETE': {
          await store.remove(playerId);
          sendJson(res, 200, { ok: true });
          return;
        }
        default:
          sendJson(res, 405, { error: 'method not allowed' });
      }
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : 'server error' });
    }
  };
}

async function handleValley(req: IncomingMessage, res: ServerResponse, valleys: ValleyService, playerId: string, action: string | null, dev: boolean, body: Record<string, unknown>): Promise<void> {
  if (!PLAYER_ID.test(playerId)) {
    sendJson(res, 400, { error: 'invalid player id' });
    return;
  }
  if (action === null && req.method === 'GET') {
    const view = await valleys.get(playerId);
    if (!view) sendJson(res, 404, { error: 'not in a valley', now: Date.now() });
    else sendJson(res, 200, view);
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  const names = {
    name: typeof body.name === 'string' ? body.name.slice(0, 24) : 'Founder',
    villageName: typeof body.villageName === 'string' ? body.villageName.slice(0, 28) : 'A village',
  };
  const joined = (out: JoinOutcome) => (out.ok ? sendJson(res, 200, out.view) : sendJson(res, out.status, { error: out.error }));
  if (action === 'join') {
    if (typeof body.code === 'string' || typeof body.valleyId === 'string') {
      joined(await valleys.joinExisting(playerId, names, { code: typeof body.code === 'string' ? body.code : undefined, valleyId: typeof body.valleyId === 'string' ? body.valleyId : undefined }));
    } else sendJson(res, 200, await valleys.join(playerId, names.name, names.villageName));
    return;
  }
  if (action === 'create') {
    joined(await valleys.create(playerId, names, { name: typeof body.valleyName === 'string' ? body.valleyName : undefined, open: body.open !== false }));
    return;
  }
  if (action === 'leave') {
    sendJson(res, (await valleys.leave(playerId)) ? 200 : 404, { ok: true });
    return;
  }
  if (action === 'settings') {
    const view = await valleys.setOpen(playerId, body.open === true);
    if (!view) sendJson(res, 404, { error: 'not in a valley' });
    else sendJson(res, 200, view);
    return;
  }
  if (action === 'profile') {
    const view = await valleys.profile(playerId, typeof body.name === 'string' ? body.name : '', typeof body.villageName === 'string' ? body.villageName : '');
    if (!view) sendJson(res, 404, { error: 'not in a valley' });
    else sendJson(res, 200, view);
    return;
  }
  if (action === 'vote') {
    const view = typeof body.research === 'string' ? await valleys.vote(playerId, body.research) : null;
    if (!view) sendJson(res, 422, { error: 'cannot vote for that' });
    else sendJson(res, 200, view);
    return;
  }
  if (action === 'dev-skip' && dev) {
    const hours = typeof body.hours === 'number' ? Math.min(24 * 30, Math.max(0, body.hours)) : 1;
    const view = await valleys.devSkip(playerId, hours * 3_600_000);
    if (!view) sendJson(res, 404, { error: 'not in a valley' });
    else sendJson(res, 200, view);
    return;
  }
  if (action === 'contribute') {
    const { opId, resources } = body;
    // Older clients send `building`; newer ones a typed `target`.
    const target = (body.target ?? (typeof body.building === 'string' ? { kind: 'building', id: body.building } : null)) as { kind?: unknown; id?: unknown } | null;
    if (typeof opId !== 'string' || opId.length > 80 || !target || typeof target.kind !== 'string') {
      sendJson(res, 400, { error: 'malformed contribution' });
      return;
    }
    if (target.kind === 'knowledge') {
      const amount = typeof body.knowledge === 'number' && Number.isFinite(body.knowledge) ? Math.min(10_000, Math.max(0, body.knowledge)) : 0;
      const out = await valleys.knowledge(playerId, amount, opId);
      if (!out) sendJson(res, 404, { error: 'not in a valley' });
      else if (!out.ok) sendJson(res, 422, { error: out.reason });
      else sendJson(res, 200, { result: out.result, ...out.view });
      return;
    }
    if (target.kind === 'festival') {
      if (typeof (target as { festivalId?: unknown }).festivalId !== 'number' || !resources || typeof resources !== 'object') {
        sendJson(res, 400, { error: 'malformed contribution' });
        return;
      }
      const out = await valleys.festival(playerId, (target as { festivalId: number }).festivalId, cleanBag(resources), opId);
      if (!out) sendJson(res, 404, { error: 'not in a valley' });
      else if (!out.ok) sendJson(res, 422, { error: out.reason });
      else sendJson(res, 200, { result: out.result, ...out.view });
      return;
    }
    const building = target.id;
    if (target.kind !== 'building' || typeof building !== 'string' || !resources || typeof resources !== 'object') {
      sendJson(res, 400, { error: 'malformed contribution' });
      return;
    }
    const out = await valleys.contribute(playerId, building, cleanBag(resources), opId);
    if (!out) sendJson(res, 404, { error: 'not in a valley' });
    else if (!out.ok) sendJson(res, 422, { error: out.reason });
    else sendJson(res, 200, { result: out.result, ...out.view });
    return;
  }
  sendJson(res, 404, { error: 'not found' });
}

/** Keeps only positive, finite, whole amounts. */
function cleanBag(resources: unknown): ResourceBag {
  const clean: ResourceBag = {};
  for (const [r, n] of Object.entries(resources as Record<string, unknown>)) {
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) clean[r as keyof ResourceBag] = Math.floor(n);
  }
  return clean;
}

async function handleAuth(req: IncomingMessage, res: ServerResponse, auth: AuthService, path: string, token: string | null, body: Record<string, unknown>): Promise<void> {
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '');
  if (path === '/api/session' && req.method === 'POST') {
    sendAuth(res, await auth.session(typeof body.playerId === 'string' ? body.playerId : undefined));
    return;
  }
  if (path === '/api/account/login' && req.method === 'POST') {
    sendAuth(res, await auth.login(str('username'), str('password')));
    return;
  }
  if (!token) {
    sendJson(res, 401, { error: 'Not signed in' });
    return;
  }
  if (path === '/api/me' && req.method === 'GET') sendAuth(res, await auth.me(token));
  else if (path === '/api/account/register' && req.method === 'POST') sendAuth(res, await auth.register(token, str('username'), str('password'), str('displayName')));
  else if (path === '/api/account/logout' && req.method === 'POST') {
    await auth.logout(token);
    sendJson(res, 200, { ok: true });
  } else sendJson(res, 404, { error: 'not found' });
}
