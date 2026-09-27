import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SaveStore } from './saveStore.ts';

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
 *
 * The server clock is authoritative for offline progression: the client never
 * supplies the timestamp used to compute elapsed time.
 */
export function createApiMiddleware(store: SaveStore) {
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
