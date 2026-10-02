import { BUILDINGS, type BuildingId, type UpgradeDef } from '../config/buildings';
import type { ResourceId } from '../config/resources';
import { canAfford } from './economy';
import type { BuildingInstance, GameState } from './types';

/** Effective stats of a building at a given level (base definition + upgrades applied in order). */
export interface LevelStats {
  storage: Partial<Record<ResourceId, number>>;
  housing: number;
  slots: number;
  outputMult: number;
}

const cache = new Map<string, LevelStats>();

export function buildingStats(defId: BuildingId, level: number): LevelStats {
  const key = `${defId}:${level}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const def = BUILDINGS[defId];
  const stats: LevelStats = {
    storage: { ...(def.storage ?? {}) },
    housing: def.housing ?? 0,
    slots: def.operate?.slots ?? 0,
    outputMult: 1,
  };
  for (const up of (def.upgrades ?? []).slice(0, Math.max(0, level - 1))) {
    if (up.storage) stats.storage = { ...stats.storage, ...up.storage };
    if (up.housing !== undefined) stats.housing = up.housing;
    if (up.slots !== undefined) stats.slots = up.slots;
    if (up.outputMult !== undefined) stats.outputMult = up.outputMult;
  }
  cache.set(key, stats);
  return stats;
}

export function maxLevel(defId: BuildingId): number {
  return 1 + (BUILDINGS[defId].upgrades?.length ?? 0);
}

/** The upgrade that would take a building from `level` to `level + 1`, if any. */
export function nextUpgrade(defId: BuildingId, level: number): UpgradeDef | null {
  return BUILDINGS[defId].upgrades?.[level - 1] ?? null;
}

/**
 * Why this building can't start its next upgrade right now (missing resources are
 * reported separately so the UI can show the cost in red instead).
 */
export function upgradeBlocker(state: GameState, b: BuildingInstance): string | null {
  const up = nextUpgrade(b.defId, b.level);
  if (!up) return 'Fully upgraded';
  if (b.status !== 'complete') return 'Finish construction first';
  if (b.upgrade) return 'Already upgrading';
  if (up.requiresResearch && !state.research.completed.includes(up.requiresResearch)) return `needs-research:${up.requiresResearch}`;
  if (up.minPlayerLevel && state.player.level < up.minPlayerLevel) return `Reach village level ${up.minPlayerLevel}`;
  return null;
}

export function canAffordUpgrade(state: GameState, b: BuildingInstance): boolean {
  const up = nextUpgrade(b.defId, b.level);
  return !!up && canAfford(state, up.cost.resources);
}

/** Work progress of whatever is being built on this lot: a new building or an upgrade. */
export function siteWork(b: BuildingInstance): { progress: number; required: number } | null {
  if (b.status === 'construction') return { progress: b.progress, required: b.workRequired };
  if (b.upgrade) return { progress: b.upgrade.progress, required: b.upgrade.workRequired };
  return null;
}
