import { createInitialState } from '../sim/initialState';
import { createWorld, ensureMapNodes } from '../sim/world';
import type { SimEvent } from '../sim/events';
import { now } from './clock';
import { Game } from './Game';
import { clampOffline, summarizeAway, type AwaySummary } from './offline';
import { loadGame, type SaveSource } from './persistence';
import { updateTutorial } from './tutorial';

export interface BootResult {
  game: Game;
  away: AwaySummary | null;
  source: SaveSource;
  trustedClock: boolean;
}

/**
 * Loads (or founds) the village and replays the time the player was away. Offline
 * progress uses the same deterministic simulation as live play, just in one big step.
 */
export async function bootGame(): Promise<BootResult> {
  const world = createWorld();
  const loaded = await loadGame();
  const state = loaded.state ?? createInitialState(world, now());
  ensureMapNodes(state, world);
  const game = new Game(state, world);
  let away: AwaySummary | null = null;
  if (loaded.state && loaded.elapsedSeconds > 1) {
    const capped = clampOffline(loaded.elapsedSeconds);
    const before = { ...state.resources };
    const events = game.skip(capped);
    away = summarizeAway(before, state, events, loaded.elapsedSeconds, capped);
  }
  const sink: SimEvent[] = [];
  updateTutorial(state, sink);
  state.lastProcessedAt = now();
  return { game, away, source: loaded.source, trustedClock: loaded.trustedClock };
}
