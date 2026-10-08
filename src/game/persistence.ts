import { IDENTITY } from '../config/identity';
import { deserialize, serialize } from '../sim/save';
import type { GameState } from '../sim/types';
import { applyServerTime, now } from './clock';
import { apiFetch, isSwitchingIdentity, sessionToken } from './session';

const KEY_PLAYER = `${IDENTITY.storageKeyPrefix}:player-id`;
const KEY_CACHE = `${IDENTITY.storageKeyPrefix}:save-cache`;

export type SaveSource = 'server' | 'local' | 'new';

export interface LoadResult {
  state: GameState | null;
  source: SaveSource;
  /** Seconds that passed since the save was last current, by the most trustworthy clock available. */
  elapsedSeconds: number;
  /** True when elapsed time came from the server clock rather than the device. */
  trustedClock: boolean;
}

function safeLocal<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function playerId(): string {
  return safeLocal(() => {
    let id = localStorage.getItem(KEY_PLAYER);
    if (!id) {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      id = `p-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
      localStorage.setItem(KEY_PLAYER, id);
    }
    return id;
  }, 'p-ephemeral-session');
}

function readCache(): GameState | null {
  return safeLocal(() => {
    const raw = localStorage.getItem(KEY_CACHE);
    return raw ? deserialize(raw) : null;
  }, null);
}

function writeCache(json: string): void {
  safeLocal(() => localStorage.setItem(KEY_CACHE, json), undefined);
}

/**
 * Loads the authoritative save from the server, falling back to the local cache when
 * the server is unreachable (offline play). The newer revision wins.
 */
export async function loadGame(): Promise<LoadResult> {
  const cached = readCache();
  try {
    const start = Date.now();
    const res = await apiFetch(`/api/save/${playerId()}`);
    const end = Date.now();
    const body = (await res.json()) as { now: number; revision?: number; serverSavedAt?: number; payload?: unknown };
    applyServerTime(body.now, start, end);
    if (res.status === 404) {
      if (cached) {
        return { state: cached, source: 'local', elapsedSeconds: Math.max(0, (now() - cached.lastProcessedAt) / 1000), trustedClock: false };
      }
      return { state: null, source: 'new', elapsedSeconds: 0, trustedClock: true };
    }
    if (!res.ok || body.payload === undefined || body.serverSavedAt === undefined) throw new Error('bad response');
    const serverState = deserialize(body.payload);
    // Compare using the server's record revision — the same number it uses to reject stale writes.
    const serverRevision = body.revision ?? serverState.revision;
    if (cached && cached.revision > serverRevision) {
      // A newer local save never reached the server (e.g. played offline); prefer it.
      return { state: cached, source: 'local', elapsedSeconds: Math.max(0, (body.now - cached.lastProcessedAt) / 1000), trustedClock: false };
    }
    return { state: serverState, source: 'server', elapsedSeconds: Math.max(0, (body.now - body.serverSavedAt) / 1000), trustedClock: true };
  } catch {
    if (cached) {
      return { state: cached, source: 'local', elapsedSeconds: Math.max(0, (Date.now() - cached.lastProcessedAt) / 1000), trustedClock: false };
    }
    return { state: null, source: 'new', elapsedSeconds: 0, trustedClock: false };
  }
}

export type SaveOutcome = 'server' | 'local-only';

let inFlight: Promise<SaveOutcome> | null = null;

/** Writes the cache immediately and the server copy in the background. */
export async function saveGame(state: GameState): Promise<SaveOutcome> {
  if (inFlight) await inFlight.catch(() => undefined);
  if (isSwitchingIdentity()) return 'local-only';
  state.revision += 1;
  state.lastProcessedAt = now();
  const json = serialize(state);
  writeCache(json);
  inFlight = (async (): Promise<SaveOutcome> => {
    try {
      const res = await apiFetch(`/api/save/${playerId()}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: `{"revision":${state.revision},"payload":${json}}`,
      });
      return res.ok ? 'server' : 'local-only';
    } catch {
      return 'local-only';
    }
  })();
  const out = await inFlight;
  inFlight = null;
  return out;
}

/** Best-effort save while the page is being hidden or closed. */
export function saveOnExit(state: GameState): void {
  if (isSwitchingIdentity()) return;
  state.revision += 1;
  state.lastProcessedAt = now();
  const json = serialize(state);
  writeCache(json);
  try {
    const blob = new Blob([`{"revision":${state.revision},"token":${JSON.stringify(sessionToken())},"payload":${json}}`], { type: 'application/json' });
    navigator.sendBeacon?.(`/api/save/${playerId()}`, blob);
  } catch {
    // The local cache above is the fallback.
  }
}

export async function deleteSave(): Promise<void> {
  safeLocal(() => localStorage.removeItem(KEY_CACHE), undefined);
  try {
    await apiFetch(`/api/save/${playerId()}`, { method: 'DELETE' });
  } catch {
    // Nothing else to do offline.
  }
}
