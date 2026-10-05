import { COOP_RECIPES, MILLRACE, type CoopRecipeId } from '../config/millrace';
import type { ResourceId } from '../config/resources';
import type { ValleyBuildingId } from '../config/valley';
import { leaveForValley } from './away';
import type { CommandResult } from './commands';
import type { EventSink } from './events';
import type { GameState, Shift, Villager } from './types';
import { queueValleyGift } from './valley';
import { findVillager } from './villagerAI';
import type { World } from './world';

/**
 * Shifts at the Millrace Workshop: the village's side of cooperative crafting. The
 * inputs leave with the villager; when the shift ends the crafted goods go straight to
 * the chosen Valley project (through the outbox — anything the project no longer
 * needs comes home).
 */

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function millraceOpen(state: GameState): boolean {
  return state.valley.bonuses.workshopLevel > 0;
}

/** Output multiplier for this villager with `helpers` neighbours on shift alongside. */
export function shiftYield(state: GameState, v: Villager, helpers: number): number {
  const skill = 1 + v.skills.crafting.level * MILLRACE.craftingBonusPerLevel;
  const together = 1 + Math.min(helpers, MILLRACE.maxHelpers) * MILLRACE.helperBonus;
  return skill * together * state.valley.bonuses.workshopYield;
}

export function shiftOutput(recipe: CoopRecipeId, yieldMult: number): { resource: ResourceId; amount: number } {
  const out = COOP_RECIPES[recipe].output;
  return { resource: out.resource, amount: Math.floor(out.amount * yieldMult) };
}

/** Sends a villager to work a shift. `helpers`: neighbours on site now (from the Valley snapshot). */
export function startShift(state: GameState, world: World, villagerId: number, recipe: CoopRecipeId, project: ValleyBuildingId, helpers: number, sink: EventSink): CommandResult {
  if (!millraceOpen(state)) return fail('Restore the Millrace Workshop first');
  if (!state.valley.valleyId) return fail('Visit the Valley first');
  const v = findVillager(state, villagerId);
  if (!v) return fail('Unknown villager');
  if (v.away) return fail(`${v.name} is already away in the Valley`);
  const inputs = COOP_RECIPES[recipe].inputs;
  for (const [r, n] of Object.entries(inputs) as [ResourceId, number][]) {
    if (state.resources[r] < n) return fail(`Needs ${n} ${r}`);
  }
  for (const [r, n] of Object.entries(inputs) as [ResourceId, number][]) state.resources[r] -= n;
  const yieldMult = shiftYield(state, v, helpers);
  leaveForValley(state, world, v, { kind: 'shift', recipe, project, yield: yieldMult });
  sink.push({ type: 'shiftStarted', villagerId: v.id, recipe, project });
  return { ok: true };
}

/** Shift over: the crafted goods head for the project. */
export function completeShift(state: GameState, v: Villager, shift: Shift, sink: EventSink): void {
  const out = shiftOutput(shift.recipe, shift.yield);
  queueValleyGift(state, { kind: 'building', id: shift.project }, { [out.resource]: out.amount }, `s-${v.id}-${Math.round(shift.until ?? state.time)}`);
  sink.push({ type: 'shiftDone', villagerId: v.id, recipe: shift.recipe, project: shift.project, resource: out.resource, amount: out.amount });
}
