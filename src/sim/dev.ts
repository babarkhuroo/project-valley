import { BALANCE } from '../config/balance';
import { RESEARCH_IDS, RESEARCH } from '../config/research';
import { RESOURCE_ORDER, type ResourceId } from '../config/resources';
import { NEWCOMER_NAMES, APPEARANCE_PALETTE } from '../config/villagers';
import { capacity } from './economy';
import type { EventSink } from './events';
import { completeConstruction } from './construction';
import { createVillager } from './population';
import { addXp } from './progression';
import { completeResearch } from './research';
import type { GameState, Vec2 } from './types';
import { goRest, goToWork, settleVillagers } from './villagerAI';
import type { World } from './world';

/**
 * Developer cheats. Only reachable from the dev panel, which is compiled out of
 * production builds (see ui/dev/DevPanel.tsx).
 */
export const devCommands = {
  addResources(state: GameState, world: World, amount: number, sink: EventSink, only?: ResourceId): void {
    for (const r of RESOURCE_ORDER) {
      if (only && r !== only) continue;
      state.resources[r] = Math.max(0, state.resources[r] + amount);
    }
    settleVillagers(state, world, sink);
  },
  fillStorage(state: GameState, world: World, sink: EventSink): void {
    for (const r of RESOURCE_ORDER) state.resources[r] = Math.max(state.resources[r], capacity(state, r));
    settleVillagers(state, world, sink);
  },
  levelUp(state: GameState, sink: EventSink): void {
    const table = BALANCE.progression.levelXp;
    const next = table[Math.min(state.player.level, table.length - 1)];
    addXp(state, Math.max(1, next - state.player.xp), 'Developer', sink);
  },
  completeActiveResearch(state: GameState, world: World, sink: EventSink): void {
    const id = state.research.active;
    if (id) completeResearch(state, id, sink);
    settleVillagers(state, world, sink);
  },
  unlockAllResearch(state: GameState, world: World, sink: EventSink): void {
    for (const id of RESEARCH_IDS) {
      while (state.player.level < RESEARCH[id].tier) devCommands.levelUp(state, sink);
      completeResearch(state, id, sink);
    }
    settleVillagers(state, world, sink);
  },
  completeConstructions(state: GameState, world: World, sink: EventSink): void {
    for (const b of state.buildings) if (b.status === 'construction') completeConstruction(state, world, b, sink);
  },
  addVillager(state: GameState, world: World, at: Vec2, sink: EventSink): void {
    const n = state.villagers.length;
    const v = createVillager(
      state,
      {
        name: NEWCOMER_NAMES[(n * 7) % NEWCOMER_NAMES.length],
        appearance: {
          skin: APPEARANCE_PALETTE.skin[n % APPEARANCE_PALETTE.skin.length],
          hair: APPEARANCE_PALETTE.hair[n % APPEARANCE_PALETTE.hair.length],
          hairStyle: (n % 4) as 0 | 1 | 2 | 3,
          shirt: APPEARANCE_PALETTE.shirt[n % APPEARANCE_PALETTE.shirt.length],
          trousers: APPEARANCE_PALETTE.trousers[n % APPEARANCE_PALETTE.trousers.length],
          hat: (n % 3) as 0 | 1 | 2,
          hatColor: APPEARANCE_PALETTE.hatColor[n % APPEARANCE_PALETTE.hatColor.length],
        },
      },
      null,
      world.grid.nearestWalkable(at) ?? at,
    );
    state.villagers.push(v);
    sink.push({ type: 'villagerJoined', villagerId: v.id });
  },
  teleportVillager(state: GameState, world: World, villagerId: number, to: Vec2, sink: EventSink): void {
    const v = state.villagers.find((o) => o.id === villagerId);
    const spot = world.grid.nearestWalkable(to);
    if (!v || !spot) return;
    v.pos = spot;
    v.route = null;
    if (v.job) {
      v.activity = 'idle';
      v.purpose = null;
      // Resume their job from the new position.
      v.batchWork = 0;
      v.workProgress = 0;
      goToWork(state, world, v, sink);
    } else {
      goRest(state, world, v);
    }
  },
};
