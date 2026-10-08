import { useSyncExternalStore } from 'react';
import { useUI } from './store';
import { game, runtime } from '../game/runtime';
import type { ValleyView } from '../game/valleyClient';
import type { GameState } from '../sim/types';

/** Re-renders the calling component a few times per second and returns live state. */
export function useGameState(): GameState {
  useUI((s) => s.tick);
  return game().state;
}

const NO_VALLEY: ValleyView = { snapshot: null, connection: 'idle', fetchedAt: 0, receivedAt: 0 };
const noop = () => () => undefined;

/** The latest Valley snapshot from the server (re-renders when a new one arrives). */
export function useValley(): ValleyView {
  const client = runtime.valley;
  return useSyncExternalStore(client ? (l) => client.subscribe(l) : noop, () => client?.current ?? NO_VALLEY);
}

const NO_ONE: ReadonlySet<string> = new Set();

/** Members currently connected to the Valley (live presence; empty without a live link). */
export function useOnline(): ReadonlySet<string> {
  const client = runtime.valley;
  return useSyncExternalStore(client ? (l) => client.subscribe(l) : noop, () => client?.online ?? NO_ONE);
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function formatNumber(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.floor(n));
}
