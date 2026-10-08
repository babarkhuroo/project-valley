import { IDENTITY } from '../config/identity';

/**
 * The browser's identity with the server: a session token proving it owns its player
 * id. Guests get one automatically; an account (username + password) lets the same
 * village be played from another device. Without a server (offline) the game still
 * runs from the local cache.
 */

const KEY_PLAYER = `${IDENTITY.storageKeyPrefix}:player-id`;
const KEY_TOKEN = `${IDENTITY.storageKeyPrefix}:session`;
const KEY_ACCOUNT = `${IDENTITY.storageKeyPrefix}:account`;
const KEY_CACHE = `${IDENTITY.storageKeyPrefix}:save-cache`;

export interface AccountInfo {
  username: string;
  displayName: string;
}

interface SessionReply {
  playerId: string;
  token: string;
  account: AccountInfo | null;
}

/**
 * Set once the browser starts switching identity (sign in / sign out). From then on
 * nothing may be saved: the village on screen belongs to the old identity, and the
 * page is about to reload into the new one.
 */
let switching = false;

export function isSwitchingIdentity(): boolean {
  return switching;
}

function local<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function sessionToken(): string | null {
  return local(() => localStorage.getItem(KEY_TOKEN), null);
}

export function currentAccount(): AccountInfo | null {
  return local(() => {
    const raw = localStorage.getItem(KEY_ACCOUNT);
    return raw ? (JSON.parse(raw) as AccountInfo) : null;
  }, null);
}

function adopt(reply: SessionReply): void {
  local(() => {
    const previous = localStorage.getItem(KEY_PLAYER);
    // A different village: the local cache belongs to the old one.
    if (previous && previous !== reply.playerId) localStorage.removeItem(KEY_CACHE);
    localStorage.setItem(KEY_PLAYER, reply.playerId);
    localStorage.setItem(KEY_TOKEN, reply.token);
    if (reply.account) localStorage.setItem(KEY_ACCOUNT, JSON.stringify(reply.account));
    else localStorage.removeItem(KEY_ACCOUNT);
  }, undefined);
}

/** fetch() with this browser's session attached. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = sessionToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(path, { cache: 'no-store', ...init, headers });
}

async function post(path: string, body: unknown, auth = false): Promise<Response> {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  return auth ? apiFetch(path, init) : fetch(path, init);
}

/**
 * Makes sure this browser holds a valid session before the game loads. Keeps the
 * village it already has when it can; otherwise starts a fresh one.
 */
export async function ensureSession(): Promise<'ok' | 'offline'> {
  try {
    if (sessionToken()) {
      const res = await apiFetch('/api/me');
      if (res.ok) {
        adopt((await res.json()) as SessionReply);
        return 'ok';
      }
      if (res.status !== 401) return 'offline';
      local(() => localStorage.removeItem(KEY_TOKEN), undefined);
    }
    const existing = local(() => localStorage.getItem(KEY_PLAYER), null);
    let res = await post('/api/session', existing ? { playerId: existing } : {});
    // Someone else owns that id (e.g. it was signed into an account): start fresh.
    if (res.status === 409) res = await post('/api/session', {});
    if (!res.ok) return 'offline';
    adopt((await res.json()) as SessionReply);
    return 'ok';
  } catch {
    return 'offline';
  }
}

/** Signs in to an account; the page should reload to load that village. */
export async function login(username: string, password: string): Promise<string | null> {
  try {
    const res = await post('/api/account/login', { username, password });
    const body = (await res.json()) as SessionReply & { error?: string };
    if (!res.ok) return body.error ?? 'Could not sign in';
    switching = true;
    adopt(body);
    return null;
  } catch {
    return 'The server is out of reach';
  }
}

/** Adds a username and password to the current village. */
export async function register(username: string, password: string, displayName: string): Promise<string | null> {
  try {
    const res = await post('/api/account/register', { username, password, displayName }, true);
    const body = (await res.json()) as SessionReply & { error?: string };
    if (!res.ok) return body.error ?? 'Could not create the account';
    adopt(body);
    return null;
  } catch {
    return 'The server is out of reach';
  }
}

/** Signs out. The page should reload; a new guest village starts on this device. */
export async function logout(): Promise<void> {
  switching = true;
  try {
    await post('/api/account/logout', {}, true);
  } catch {
    // Forgetting the token locally is what matters.
  }
  local(() => {
    for (const k of [KEY_TOKEN, KEY_ACCOUNT, KEY_PLAYER, KEY_CACHE]) localStorage.removeItem(k);
  }, undefined);
}
