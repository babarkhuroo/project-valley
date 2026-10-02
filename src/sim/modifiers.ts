import { BALANCE } from '../config/balance';
import { BUILDINGS, type BuildingId } from '../config/buildings';
import type { JobType } from '../config/jobs';
import { NODES, type NodeKind } from '../config/nodes';
import { RESEARCH, type ResearchId } from '../config/research';
import type { ResourceId } from '../config/resources';
import type { GameState } from './types';

/** Aggregated effects of completed research. Recomputed only when research changes. */
export interface Modifiers {
  unlockedBuildings: Set<BuildingId>;
  unlockedNodes: Set<NodeKind>;
  maxCountBonus: Partial<Record<BuildingId, number>>;
  jobRate: Partial<Record<JobType, { mult: number; sources: ResearchId[] }>>;
  storageMult: Partial<Record<ResourceId, number>>;
  mealDurationMult: number;
  regrowMult: Partial<Record<NodeKind, number>>;
  /** Extra levels villagers can reach through practice alone. */
  practiceCapBonus: number;
}

const cache = new WeakMap<GameState, { key: string; mods: Modifiers }>();

export function getModifiers(state: GameState): Modifiers {
  const key = state.research.completed.join(',');
  const hit = cache.get(state);
  if (hit && hit.key === key) return hit.mods;
  const mods: Modifiers = {
    unlockedBuildings: new Set(),
    unlockedNodes: new Set(),
    maxCountBonus: {},
    jobRate: {},
    storageMult: {},
    mealDurationMult: 1,
    regrowMult: {},
    practiceCapBonus: 0,
  };
  for (const id of state.research.completed) {
    for (const e of RESEARCH[id].effects) {
      switch (e.type) {
        case 'unlockBuilding':
          mods.unlockedBuildings.add(e.building);
          break;
        case 'unlockNode':
          mods.unlockedNodes.add(e.node);
          break;
        case 'maxCount':
          mods.maxCountBonus[e.building] = (mods.maxCountBonus[e.building] ?? 0) + e.add;
          break;
        case 'jobRate': {
          const cur = mods.jobRate[e.job] ?? { mult: 1, sources: [] };
          mods.jobRate[e.job] = { mult: cur.mult * e.mult, sources: [...cur.sources, id] };
          break;
        }
        case 'storage':
          for (const r of e.resources) mods.storageMult[r] = (mods.storageMult[r] ?? 1) * e.mult;
          break;
        case 'mealDuration':
          mods.mealDurationMult *= e.mult;
          break;
        case 'regrow':
          mods.regrowMult[e.node] = (mods.regrowMult[e.node] ?? 1) * e.mult;
          break;
        case 'practiceCap':
          mods.practiceCapBonus += e.add;
          break;
      }
    }
  }
  cache.set(state, { key, mods });
  return mods;
}

export function isBuildingUnlocked(state: GameState, id: BuildingId): boolean {
  const def = BUILDINGS[id];
  return !def.requiresResearch || state.research.completed.includes(def.requiresResearch);
}

export function isNodeUnlocked(state: GameState, kind: NodeKind): boolean {
  const req = NODES[kind].requiresResearch;
  return !req || state.research.completed.includes(req);
}

export function maxBuildingCount(state: GameState, id: BuildingId): number {
  return BUILDINGS[id].maxCount + (getModifiers(state).maxCountBonus[id] ?? 0);
}

export function mealDuration(state: GameState): number {
  return BALANCE.villager.mealDuration * getModifiers(state).mealDurationMult * state.valley.bonuses.mealDurationMult;
}

/** Whether the road to the shared Valley is open. */
export function isValleyUnlocked(state: GameState): boolean {
  return state.research.completed.some((id) => RESEARCH[id].effects.some((e) => e.type === 'unlockValley'));
}

export function regrowSeconds(state: GameState, kind: NodeKind): number {
  return NODES[kind].regrowSeconds / (getModifiers(state).regrowMult[kind] ?? 1);
}

/** Highest skill level reachable through practice right now. */
export function practiceCap(state: GameState): number {
  return BALANCE.skills.practiceCap + getModifiers(state).practiceCapBonus;
}
