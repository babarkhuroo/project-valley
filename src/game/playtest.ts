import { BUILDINGS } from '../config/buildings';
import { RESEARCH } from '../config/research';
import type { GameState } from '../sim/types';
import type { Game } from './Game';
import { playerId } from './persistence';
import { apiFetch, sessionToken } from './session';

/**
 * Playtest progress, only for players who said yes: milestones (levels, buildings,
 * research, newcomers, joining the Valley) and how long they've actively played, sent
 * in small batches. Used to compare real players' pacing with the autoplayer's.
 * Nothing personal is sent — the player id is random, and notes are only what the
 * player types into the feedback form (`sendFeedback`).
 */

const PLAY_KEY = 'project-valley:playtime';
const FLUSH_MS = 60_000;
const HEARTBEAT_MS = 5 * 60_000;

interface Pending {
  kind: string;
  simTime: number;
  playMinutes: number;
  data: Record<string, string | number | boolean>;
}

let activeMs = 0;
let lastTick = Date.now();

function loadPlaytime(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAY_KEY) ?? '{}') as Record<string, number>;
    activeMs = saved[playerId()] ?? 0;
  } catch {
    activeMs = 0;
  }
}

function savePlaytime(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(PLAY_KEY) ?? '{}') as Record<string, number>;
    saved[playerId()] = activeMs;
    localStorage.setItem(PLAY_KEY, JSON.stringify(saved));
  } catch {
    // Private mode and the like: play time just isn't remembered.
  }
}

/** Minutes this browser has had the game open and visible, for this village. */
export function playMinutes(): number {
  const now = Date.now();
  if (document.visibilityState === 'visible') activeMs += Math.min(now - lastTick, 30_000);
  lastTick = now;
  return Math.round((activeMs / 60_000) * 10) / 10;
}

/** A snapshot of where the player is, attached to feedback notes. */
export function feedbackContext(state: GameState, scene: string): Record<string, string | number | boolean> {
  return {
    level: state.player.level,
    villagers: state.villagers.length,
    buildings: state.buildings.length,
    research: state.research.completed.length,
    tutorialStep: state.tutorial.done || state.tutorial.skipped ? -1 : state.tutorial.step,
    simHours: Math.round((state.time / 3600) * 10) / 10,
    playMinutes: playMinutes(),
    inValley: !!state.valley.valleyId,
    scene,
    screen: `${window.innerWidth}x${window.innerHeight}`,
    touch: window.matchMedia?.('(pointer: coarse)').matches ?? false,
  };
}

/** Sends a feedback note. Returns an error to show, or null. */
export async function sendFeedback(text: string, mood: 'happy' | 'okay' | 'stuck' | null, context: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await apiFetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, mood, context }) });
    if (res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error ?? 'It didn’t send — try again in a moment';
  } catch {
    return 'The server is out of reach right now';
  }
}

/**
 * Watches the game for milestones and reports them while `enabled()` says the player
 * agreed. Returns a stop function.
 */
export function attachProgressReporter(game: Game, enabled: () => boolean): () => void {
  loadPlaytime();
  let queue: Pending[] = [];
  let valleyId = game.state.valley.valleyId;
  const push = (kind: string, data: Pending['data'] = {}) => {
    if (!enabled()) return;
    queue.push({ kind, simTime: Math.round(game.state.time), playMinutes: playMinutes(), data });
  };
  const flush = async (beacon = false): Promise<void> => {
    savePlaytime();
    if (queue.length === 0 || !enabled()) return;
    const events = queue;
    queue = [];
    if (beacon) {
      // Leaving the page: fetch may be cancelled, so the token rides in the body.
      navigator.sendBeacon?.('/api/progress', new Blob([JSON.stringify({ events, token: sessionToken() })], { type: 'application/json' }));
      return;
    }
    try {
      const res = await apiFetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events }) });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      queue = [...events, ...queue].slice(-200);
    }
  };

  push('session', { level: game.state.player.level });
  const unsubscribe = game.subscribe((events) => {
    for (const e of events) {
      switch (e.type) {
        case 'levelUp':
          push('levelUp', { level: e.level, label: `Village level ${e.level}` });
          break;
        case 'constructionComplete':
          if (BUILDINGS[e.defId].category !== 'decor') push('built', { id: e.defId, label: `Built ${BUILDINGS[e.defId].name}` });
          break;
        case 'upgradeComplete':
          push('upgraded', { id: `${e.defId}:${e.level}`, label: `${BUILDINGS[e.defId].name} → level ${e.level}` });
          break;
        case 'researchComplete':
          push('researched', { id: e.researchId, label: `Researched ${RESEARCH[e.researchId].name}` });
          break;
        case 'villagerJoined':
          push('villager', { id: game.state.villagers.length, label: `Villager #${game.state.villagers.length} joins` });
          break;
        default:
          break;
      }
    }
    if (game.state.valley.valleyId && game.state.valley.valleyId !== valleyId) push('joinedValley', { id: 'valley', label: 'Joined a Valley' });
    valleyId = game.state.valley.valleyId;
  });
  const flushTimer = window.setInterval(() => void flush(), FLUSH_MS);
  const heartbeat = window.setInterval(() => push('heartbeat', { level: game.state.player.level }), HEARTBEAT_MS);
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flush(true);
    else lastTick = Date.now();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', () => void flush(true));
  return () => {
    unsubscribe();
    window.clearInterval(flushTimer);
    window.clearInterval(heartbeat);
    document.removeEventListener('visibilitychange', onHide);
  };
}
