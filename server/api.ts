import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SaveStore } from './saveStore.ts';
import type { ResourceBag } from '../src/valley/types.ts';
import type { JoinOutcome, ValleyService } from './valleyService.ts';
import type { AuthResult, AuthService } from './auth.ts';
import { isAdmin, playtestReport, receiveFeedback, receiveProgress, REPORT_REASONS, type PlaytestStore, type ReportReason } from './playtest.ts';
import { maskRude } from '../src/valley/chatFilter.ts';
import { RateLimiter, clientIp } from './rateLimit.ts';

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
 *   POST   /api/valley/:playerId/report       <- { messageId, reason, note? }  (someone else's chat message)
 *   GET    /api/admin/playtest                -> feedback, reported messages, milestones (ADMIN_TOKEN)
 *   POST   /api/admin/moderate                <- { valleyId, messageId?, member?, mute? }  (ADMIN_TOKEN)
 *
 *   POST   /api/session                       <- { playerId? } -> { playerId, token, account }
 *   GET    /api/me
 *   POST   /api/account/register              <- { username, password, displayName }
 *   POST   /api/account/login                 <- { username, password }
 *   POST   /api/account/logout
 *   POST   /api/account/delete                 (the signed-in player's account, village and Valley place)
 *
 * With an AuthService, every /api/save and /api/valley call must carry a session token
 * (Authorization: Bearer …, or `token` in the body for sendBeacon) for that player id.
 * The server clock is authoritative for offline progression: the client never
 * supplies the timestamp used to compute elapsed time.
 */
export interface ApiOptions {
  dev?: boolean;
  auth?: AuthService;
  /** Feedback notes and opt-in progress events. */
  playtest?: PlaytestStore;
  /** Bearer token for `GET /api/admin/playtest` (unset: the report is unavailable). */
  adminToken?: string;
  /** Request limits (tests pass their own; missing ones get the defaults). */
  limits?: Partial<Record<'session' | 'login' | 'register' | 'join' | 'progress' | 'report', RateLimiter>>;
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

function sendAuth(res: ServerResponse, out: AuthResult): void {
  if (out.ok) sendJson(res, 200, { playerId: out.playerId, token: out.token, account: out.account });
  else sendJson(res, out.status, { error: out.error });
}

/** Over the limit: slow down. */
const TOO_MANY = { error: 'Too many requests — wait a little and try again' };

export function createApiMiddleware(store: SaveStore, valleys?: ValleyService, options: ApiOptions = {}) {
  const auth = options.auth;
  // Per address: new guest villages, sign-ins, new accounts. Per player: invite-code joins, progress batches, chat reports.
  const limits = {
    session: new RateLimiter(30, 3_600_000),
    login: new RateLimiter(20, 600_000),
    register: new RateLimiter(10, 3_600_000),
    join: new RateLimiter(20, 600_000),
    progress: new RateLimiter(30, 600_000),
    report: new RateLimiter(20, 3_600_000),
    ...options.limits,
  };
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
      if (req.method === 'POST') {
        const perIp = url.pathname === '/api/session' ? limits.session : url.pathname === '/api/account/login' ? limits.login : url.pathname === '/api/account/register' ? limits.register : null;
        if (perIp && !perIp.take(clientIp(req))) {
          sendJson(res, 429, TOO_MANY);
          return;
        }
      }
      if (auth && (url.pathname === '/api/session' || url.pathname === '/api/me' || url.pathname.startsWith('/api/account/'))) {
        await handleAuth(req, res, auth, url.pathname, token, json(), async (playerId) => {
          await store.remove(playerId);
          await valleys?.forget(playerId);
          await options.playtest?.forget(playerId);
        });
        return;
      }
      const playtest = options.playtest;
      if (playtest && (url.pathname === '/api/feedback' || url.pathname === '/api/progress') && req.method === 'POST') {
        const body = json();
        // sendBeacon (leaving the page) can't set headers: the token may ride in the body.
        const me = auth ? await auth.authenticate(token ?? (typeof body.token === 'string' ? body.token : null)) : null;
        if (!me) {
          sendJson(res, 401, { error: 'Not signed in' });
          return;
        }
        if (url.pathname === '/api/progress' && !limits.progress.take(me.playerId)) {
          sendJson(res, 429, TOO_MANY);
          return;
        }
        const out = url.pathname === '/api/feedback' ? await receiveFeedback(playtest, me.playerId, body) : await receiveProgress(playtest, me.playerId, body);
        sendJson(res, out.status, out.body);
        return;
      }
      if (playtest && url.pathname === '/api/admin/playtest' && req.method === 'GET') {
        if (!isAdmin(req, options.adminToken)) {
          sendJson(res, 401, { error: 'admin token required' });
          return;
        }
        sendJson(res, 200, await playtestReport(playtest));
        return;
      }
      if (valleys && url.pathname === '/api/admin/moderate' && req.method === 'POST') {
        if (!isAdmin(req, options.adminToken)) {
          sendJson(res, 401, { error: 'admin token required' });
          return;
        }
        const body = json();
        const action = {
          messageId: typeof body.messageId === 'number' ? body.messageId : undefined,
          member: typeof body.member === 'string' ? body.member : undefined,
          mute: typeof body.mute === 'boolean' ? body.mute : undefined,
        };
        const done = typeof body.valleyId === 'string' && (await valleys.moderate(body.valleyId, action));
        sendJson(res, done ? 200 : 404, done ? { ok: true } : { error: 'nothing to do' });
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
      const reportMatch = /^\/api\/valley\/([^/]+)\/report$/.exec(url.pathname);
      if (reportMatch && req.method === 'POST' && valleys && options.playtest) {
        if (!limits.report.take(reportMatch[1])) {
          sendJson(res, 429, TOO_MANY);
          return;
        }
        const out = await reportMessage(valleys, options.playtest, reportMatch[1], json());
        sendJson(res, out.status, out.body);
        return;
      }
      const valleyMatch = /^\/api\/valley\/([^/]+)(?:\/(join|create|leave|settings|contribute|vote|profile|chat|dev-skip))?$/.exec(url.pathname);
      if (valleyMatch && valleys) {
        // Joining by code is the only way to reach an invite-only Valley: no scanning for codes.
        if (valleyMatch[2] === 'join' && !limits.join.take(valleyMatch[1])) {
          sendJson(res, 429, TOO_MANY);
          return;
        }
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
          const serverSavedAt = Date.now();
          const written = await store.write({ playerId, revision: body.revision, serverSavedAt, payload: body.payload });
          if (!written.ok) {
            sendJson(res, 409, { error: 'stale revision', revision: written.revision });
            return;
          }
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
      // Say what the caller got wrong; keep the server's own failures (database errors and the like) in the log.
      if (err instanceof Error && err.message === 'payload too large') sendJson(res, 413, { error: 'payload too large' });
      else if (err instanceof SyntaxError) sendJson(res, 400, { error: 'malformed JSON' });
      else {
        console.error('api', req.method, url.pathname, err);
        sendJson(res, 500, { error: 'server error' });
      }
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
    name: typeof body.name === 'string' ? maskRude(body.name.slice(0, 24)) : 'Founder',
    villageName: typeof body.villageName === 'string' ? maskRude(body.villageName.slice(0, 28)) : 'A village',
  };
  const joined = (out: JoinOutcome) => (out.ok ? sendJson(res, 200, out.view) : sendJson(res, out.status, { error: out.error }));
  if (action === 'join') {
    if (typeof body.code === 'string' || typeof body.valleyId === 'string') {
      joined(await valleys.joinExisting(playerId, names, { code: typeof body.code === 'string' ? body.code : undefined, valleyId: typeof body.valleyId === 'string' ? body.valleyId : undefined }));
    } else sendJson(res, 200, await valleys.join(playerId, names.name, names.villageName));
    return;
  }
  if (action === 'create') {
    joined(await valleys.create(playerId, names, { name: typeof body.valleyName === 'string' ? maskRude(body.valleyName) : undefined, open: body.open !== false }));
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
  if (action === 'chat') {
    const view = typeof body.text === 'string' ? await valleys.chat(playerId, body.text) : null;
    if (!view) sendJson(res, 422, { error: 'Message not sent (empty, or too fast)' });
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
    if (target.kind === 'sowing') {
      const round = (target as { round?: unknown }).round;
      const grain = (resources as { grain?: unknown } | undefined)?.grain;
      if (typeof round !== 'number' || typeof grain !== 'number' || !Number.isFinite(grain)) {
        sendJson(res, 400, { error: 'malformed contribution' });
        return;
      }
      const out = await valleys.sowing(playerId, round, Math.min(100_000, Math.max(0, grain)), opId);
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

/** POST /api/valley/:playerId/report — the player reports someone else's message in their Valley. */
async function reportMessage(valleys: ValleyService, playtest: PlaytestStore, playerId: string, body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  if (!PLAYER_ID.test(playerId)) return { status: 400, body: { error: 'invalid player id' } };
  const reason = typeof body.reason === 'string' && (REPORT_REASONS as readonly string[]).includes(body.reason) ? (body.reason as ReportReason) : null;
  if (typeof body.messageId !== 'number' || !reason) return { status: 400, body: { error: 'malformed report' } };
  const found = await valleys.reportable(playerId, body.messageId);
  if (!found) return { status: 404, body: { error: 'That message is no longer in the chat' } };
  const note = typeof body.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
  await playtest.addReport({
    reporterId: playerId,
    at: Date.now(),
    valleyId: found.valleyId,
    messageId: found.message.id,
    memberId: found.message.member,
    memberName: found.memberName,
    text: found.message.text,
    reason,
    note,
  });
  return { status: 200, body: { ok: true } };
}

/** Keeps only positive, finite, whole amounts. */
function cleanBag(resources: unknown): ResourceBag {
  const clean: ResourceBag = {};
  for (const [r, n] of Object.entries(resources as Record<string, unknown>)) {
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) clean[r as keyof ResourceBag] = Math.floor(n);
  }
  return clean;
}

async function handleAuth(req: IncomingMessage, res: ServerResponse, auth: AuthService, path: string, token: string | null, body: Record<string, unknown>, forget?: (playerId: string) => Promise<void>): Promise<void> {
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
  else if (path === '/api/account/delete' && req.method === 'POST') {
    // Everything about this player goes: account, sessions, village save, Valley place and chat.
    const playerId = await auth.deleteMe(token);
    if (!playerId) {
      sendJson(res, 401, { error: 'Not signed in' });
      return;
    }
    await forget?.(playerId);
    sendJson(res, 200, { ok: true });
  } else if (path === '/api/account/logout' && req.method === 'POST') {
    await auth.logout(token);
    sendJson(res, 200, { ok: true });
  } else sendJson(res, 404, { error: 'not found' });
}
