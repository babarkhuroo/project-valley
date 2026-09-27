import { BUILDINGS, type ResourceBundle } from '../config/buildings';
import { RESOURCE_ORDER, type ResourceId } from '../config/resources';
import { getModifiers } from './modifiers';
import type { BuildingInstance, GameState, Vec2 } from './types';
import { buildingCenter } from './grid';

/** Total storage for a resource across all completed buildings, after research bonuses. */
export function capacity(state: GameState, resource: ResourceId): number {
  let cap = 0;
  for (const b of state.buildings) {
    if (b.status !== 'complete') continue;
    cap += BUILDINGS[b.defId].storage?.[resource] ?? 0;
  }
  return Math.floor(cap * (getModifiers(state).storageMult[resource] ?? 1));
}

export function freeSpace(state: GameState, resource: ResourceId): number {
  return Math.max(0, capacity(state, resource) - state.resources[resource]);
}

/** Adds up to the free space; returns how much was actually stored. */
export function addResource(state: GameState, resource: ResourceId, amount: number): number {
  const added = Math.min(amount, freeSpace(state, resource));
  if (added > 0) {
    state.resources[resource] += added;
    bumpStat(state, `produced.${resource}`, added);
  }
  return added;
}

export function canAfford(state: GameState, bundle: ResourceBundle): boolean {
  return RESOURCE_ORDER.every((r) => state.resources[r] >= (bundle[r] ?? 0));
}

export function missingFor(state: GameState, bundle: ResourceBundle): Partial<Record<ResourceId, number>> {
  const missing: Partial<Record<ResourceId, number>> = {};
  for (const r of RESOURCE_ORDER) {
    const need = (bundle[r] ?? 0) - state.resources[r];
    if (need > 0) missing[r] = need;
  }
  return missing;
}

export function pay(state: GameState, bundle: ResourceBundle): void {
  for (const r of RESOURCE_ORDER) state.resources[r] -= bundle[r] ?? 0;
}

/** Refunds ignore capacity so cancelling never destroys resources. */
export function refund(state: GameState, bundle: ResourceBundle): void {
  for (const r of RESOURCE_ORDER) state.resources[r] += bundle[r] ?? 0;
}

export function storageBuildingsFor(state: GameState, resource: ResourceId): BuildingInstance[] {
  return state.buildings.filter((b) => b.status === 'complete' && (BUILDINGS[b.defId].storage?.[resource] ?? 0) > 0);
}

export function nearestStorage(state: GameState, resource: ResourceId, from: Vec2): BuildingInstance | null {
  let best: BuildingInstance | null = null;
  let bestD = Infinity;
  for (const b of storageBuildingsFor(state, resource)) {
    const c = buildingCenter(b);
    const d = Math.hypot(c.x - from.x, c.z - from.z);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best;
}

export function bumpStat(state: GameState, key: string, amount = 1): void {
  state.stats[key] = (state.stats[key] ?? 0) + amount;
}
