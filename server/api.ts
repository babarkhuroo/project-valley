import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SaveStore } from './saveStore.ts';
import type { ResourceBag } from '../src/valley/types.ts';
import type { ValleyService } from './valleyService.ts';

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
 * The server clock is authoritative for offline progression: the client never
 * supplies the timestamp used to compute elapsed time.
 */
export function createApiMiddleware(store: SaveStore, valleys?: ValleyService, options: { dev?: boolean } = {}) {
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
      const valleyMatch = /^\/api\/valley\/([^/]+)(?:\/(join|contribute|vote|dev-skip))?$/.exec(url.pathname);
      if (valleyMatch && valleys) {
        await handleValley(req, res, valleys, valleyMatch[1], valleyMatch[2] ?? null, options.dev ?? false);
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
          const body = JSON.parse(await readBody(req)) as { revision?: unknown; payload?: unknown };
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

async function handleValley(req: IncomingMessage, res: ServerResponse, valleys: ValleyService, playerId: string, action: string | null, dev: boolean): Promise<void> {
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
  const body = JSON.parse((await readBody(req)) || '{}') as Record<string, unknown>;
  if (action === 'join') {
    const name = typeof body.name === 'string' ? body.name.slice(0, 40) : 'Founder';
    const villageName = typeof body.villageName === 'string' ? body.villageName.slice(0, 40) : 'A village';
    sendJson(res, 200, await valleys.join(playerId, name, villageName));
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
