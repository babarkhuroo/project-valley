import type { EventSink } from './events';
import type { GameState } from './types';
import { EPS, integrateVillager, processVillager, regrowNode, settleVillagers, villagerNextEvent } from './villagerAI';
import type { World } from './world';

/** Hard stop against pathological loops; far above any realistic week of offline play. */
const MAX_EVENTS_PER_ADVANCE = 5_000_000;
const MAX_CASCADE = 64;

function nextEventTime(state: GameState): number {
  let t = Infinity;
  for (const v of state.villagers) {
    const e = villagerNextEvent(state, v);
    if (e < t) t = e;
  }
  for (const n of state.nodes) {
    if (n.regrowAt !== null && n.regrowAt < t) t = n.regrowAt;
  }
  return t;
}

function integrate(state: GameState, dt: number): void {
  if (dt <= 0) return;
  for (const v of state.villagers) integrateVillager(state, v, dt);
}

function processDue(state: GameState, world: World, sink: EventSink): void {
  for (let pass = 0; pass < MAX_CASCADE; pass++) {
    let acted = false;
    for (const n of state.nodes) {
      if (n.regrowAt !== null && n.regrowAt <= state.time + EPS) {
        regrowNode(n, sink);
        acted = true;
      }
    }
    for (const v of state.villagers) {
      if (villagerNextEvent(state, v) <= state.time + EPS && processVillager(state, world, v, sink)) acted = true;
    }
    settleVillagers(state, world, sink);
    if (!acted) return;
  }
}

/**
 * Advances the world by `dt` seconds using discrete-event integration: time jumps
 * straight to the next state change (arrival, finished batch, meal, regrowth) and all
 * continuous quantities are integrated analytically in between.
 *
 * The same function runs every animation frame (tiny dt), under dev speed-ups, and
 * for offline catch-up (dt of hours) — with identical results.
 */
export function advance(state: GameState, world: World, dt: number, sink: EventSink): void {
  if (!(dt > 0)) return;
  const end = state.time + dt;
  processDue(state, world, sink);
  let stalled = 0;
  for (let i = 0; i < MAX_EVENTS_PER_ADVANCE; i++) {
    const next = nextEventTime(state);
    if (next > end) break;
    stalled = next <= state.time + EPS ? stalled + 1 : 0;
    if (stalled > 1000) {
      // Defensive: an entity keeps reporting "due" without changing. Never freeze the game.
      console.warn('[sim] stalled event loop; skipping ahead');
      break;
    }
    integrate(state, next - state.time);
    state.time = Math.max(state.time, next);
    processDue(state, world, sink);
  }
  integrate(state, end - state.time);
  state.time = end;
}
