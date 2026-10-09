import { BUILDINGS } from '../config/buildings';
import { FARMING } from '../config/farming';
import { JOBS } from '../config/jobs';
import { pointInPolygon } from '../world/geometry';
import { bumpStat, freeSpace } from './economy';
import type { EventSink } from './events';
import { buildingCenter } from './grid';
import { getModifiers } from './modifiers';
import type { BuildingInstance, FieldState, GameState } from './types';
import type { VillageMapDef } from '../config/villageMap';
import type { World } from './world';

/**
 * Grain Fields. A farmer's batch does whatever the field needs right now — sow a fallow
 * field, tend a growing crop (bringing its ripening forward), or cut a load from a ripe
 * one — so several farmers can share a field without coordinating. A sown crop also
 * ripens untended, at its own pace: the ripening time is an event in the sim loop.
 */

export function newFieldState(): FieldState {
  return { stage: 'fallow', sownAt: null, ripeAt: null, stock: 0 };
}

export function isField(defId: BuildingInstance['defId']): boolean {
  return BUILDINGS[defId].operate?.job === 'farm';
}

/** Whether a field sits on the fertile southern meadow. */
export function isFertile(map: VillageMapDef, b: Pick<BuildingInstance, 'defId' | 'cellX' | 'cellZ' | 'rotation'>): boolean {
  const c = buildingCenter(b);
  return map.farmland.some((poly) => pointInPolygon(c.x, c.z, poly));
}

/** Grain a ripe crop on this field holds. */
export function fieldYield(state: GameState, map: VillageMapDef, b: BuildingInstance): number {
  return Math.round(FARMING.yield * (isFertile(map, b) ? FARMING.fertileMult : 1) * getModifiers(state).fieldYieldMult);
}

/** 0..1 how grown the crop is (1 when ripe, 0 when fallow). For visuals and the panel. */
export function growthFraction(state: GameState, b: BuildingInstance): number {
  const f = b.field;
  if (!f || f.stage === 'fallow') return 0;
  if (f.stage === 'ripe' || f.sownAt === null || f.ripeAt === null) return 1;
  const span = f.ripeAt - f.sownAt;
  return span > 0 ? Math.max(0, Math.min(1, (state.time - f.sownAt) / span)) : 1;
}

function ripen(state: GameState, world: World, b: BuildingInstance, sink: EventSink): void {
  const f = b.field!;
  f.stage = 'ripe';
  f.ripeAt = null;
  f.stock = fieldYield(state, world.map, b);
  sink.push({ type: 'fieldRipe', buildingId: b.id });
}

/** Earliest time a growing crop ripens on its own. */
export function fieldsNextEvent(state: GameState): number {
  let t = Infinity;
  for (const b of state.buildings) {
    const f = b.field;
    if (f?.stage === 'growing' && f.ripeAt !== null && f.ripeAt < t) t = f.ripeAt;
  }
  return t;
}

/** Ripens every crop that is due. Returns true if anything changed. */
export function processFields(state: GameState, world: World, sink: EventSink, eps: number): boolean {
  let acted = false;
  for (const b of state.buildings) {
    const f = b.field;
    if (f?.stage === 'growing' && f.ripeAt !== null && f.ripeAt <= state.time + eps) {
      ripen(state, world, b, sink);
      acted = true;
    }
  }
  return acted;
}

/**
 * A farmer finished a batch on this field. Returns the grain they cut (to carry to a
 * Granary), or 0 when the batch was sowing or tending.
 */
export function finishFarmBatch(state: GameState, world: World, b: BuildingInstance, villagerId: number, sink: EventSink): number {
  const f = (b.field ??= newFieldState());
  switch (f.stage) {
    case 'fallow':
      f.stage = 'growing';
      f.sownAt = state.time;
      f.ripeAt = state.time + FARMING.growSeconds;
      f.stock = 0;
      sink.push({ type: 'fieldSown', buildingId: b.id, villagerId });
      return 0;
    case 'growing':
      f.ripeAt = Math.max(state.time, (f.ripeAt ?? state.time) - FARMING.tendSeconds);
      if (f.ripeAt <= state.time) ripen(state, world, b, sink);
      return 0;
    case 'ripe': {
      const cut = Math.min(JOBS.farm.output!.amount, f.stock);
      f.stock -= cut;
      if (f.stock <= 1e-6) {
        f.stage = 'fallow';
        f.sownAt = null;
        f.ripeAt = null;
        f.stock = 0;
        sink.push({ type: 'fieldHarvested', buildingId: b.id });
      }
      return cut;
    }
  }
}

/** What a farmer working this field is doing right now (task labels, animation). */
export function farmTask(b: BuildingInstance | undefined): 'sow' | 'tend' | 'harvest' {
  const stage = b?.field?.stage ?? 'fallow';
  return stage === 'fallow' ? 'sow' : stage === 'growing' ? 'tend' : 'harvest';
}

/**
 * Cooking with grain: one pot takes `cookGrain` grain and makes `cookBonus` extra bowls,
 * when there is grain and room for them. Returns the bowls this pot makes.
 */
export function cookPot(state: GameState, baseBowls: number): number {
  if (state.resources.grain < FARMING.cookGrain || freeSpace(state, 'stew') < baseBowls + FARMING.cookBonus) return baseBowls;
  state.resources.grain -= FARMING.cookGrain;
  bumpStat(state, 'consumed.grain', FARMING.cookGrain);
  return baseBowls + FARMING.cookBonus;
}
