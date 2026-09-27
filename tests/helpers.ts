import type { SimEvent } from '../src/sim/events';
import { createInitialState } from '../src/sim/initialState';
import { advance } from '../src/sim/simulation';
import type { GameState, ResourceNode } from '../src/sim/types';
import { buildingCenter } from '../src/sim/grid';
import { createWorld, syncWorld, type World } from '../src/sim/world';

export interface Harness {
  world: World;
  state: GameState;
  events: SimEvent[];
  run(seconds: number, step?: number): void;
}

export function makeGame(): Harness {
  const world = createWorld();
  const state = createInitialState(world, 0);
  const events: SimEvent[] = [];
  return {
    world,
    state,
    events,
    run(seconds: number, step?: number) {
      if (!step) {
        advance(state, world, seconds, events);
        return;
      }
      let left = seconds;
      while (left > 1e-9) {
        const dt = Math.min(step, left);
        advance(state, world, dt, events);
        left -= dt;
      }
    },
  };
}

/** Deep copy of a harness (state + fresh world) for determinism comparisons. */
export function cloneGame(h: Harness): Harness {
  const copy = makeGame();
  copy.state = JSON.parse(JSON.stringify(h.state)) as GameState;
  syncWorld(copy.world, copy.state);
  const events: SimEvent[] = [];
  return {
    world: copy.world,
    state: copy.state,
    events,
    run(seconds: number, step?: number) {
      if (!step) {
        advance(copy.state, copy.world, seconds, events);
        return;
      }
      let left = seconds;
      while (left > 1e-9) {
        const dt = Math.min(step, left);
        advance(copy.state, copy.world, dt, events);
        left -= dt;
      }
    },
  };
}

export function building(h: Harness, defId: string) {
  const b = h.state.buildings.find((x) => x.defId === defId);
  if (!b) throw new Error(`no ${defId}`);
  return b;
}

/** The tree (or clay deposit) closest to the given building. */
export function nearestNode(h: Harness, kind: ResourceNode['kind'], nearDef = 'timberYard'): ResourceNode {
  const c = buildingCenter(building(h, nearDef));
  const nodes = h.state.nodes.filter((n) => n.kind === kind && n.amount > 0);
  nodes.sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z));
  return nodes[0];
}

export function villager(h: Harness, index = 0) {
  return h.state.villagers[index];
}
