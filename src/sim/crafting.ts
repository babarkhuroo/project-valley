import { BUILDINGS } from '../config/buildings';
import { RECIPES, REPEAT_ORDER, type RecipeId } from '../config/recipes';
import { RESOURCE_ORDER, type ResourceId } from '../config/resources';
import { addResource, canAfford, freeSpace, pay } from './economy';
import type { EventSink } from './events';
import type { BuildingInstance, CraftState, GameState } from './types';

/**
 * Workshop production. A workshop holds an ordered list of orders; its crafter makes
 * one item per work batch. Inputs are taken when an item starts (`current`), the
 * output is stored when it finishes, and the head order counts down — or repeats for
 * "keep making" orders.
 */

export function newCraftState(): CraftState {
  return { orders: [], current: null };
}

export function isWorkshop(b: BuildingInstance): boolean {
  return !!BUILDINGS[b.defId].workshop && !!b.craft;
}

/** The recipe the workshop is making or will make next (falls back to its first recipe for estimates). */
export function activeRecipe(b: BuildingInstance): RecipeId | null {
  const shop = BUILDINGS[b.defId].workshop;
  if (!shop || !b.craft) return null;
  return b.craft.current ?? b.craft.orders[0]?.recipe ?? shop.recipes[0] ?? null;
}

export type ItemStart = { ok: true; recipe: RecipeId } | { ok: false; reason: 'noOrders' } | { ok: false; reason: 'noInputs'; missing: ResourceId } | { ok: false; reason: 'storageFull'; resource: ResourceId };

/** Begins the next item if possible: checks output space, then takes the inputs. */
export function startNextItem(state: GameState, b: BuildingInstance): ItemStart {
  const craft = b.craft;
  if (!craft) return { ok: false, reason: 'noOrders' };
  const recipeId = craft.current ?? craft.orders[0]?.recipe;
  if (!recipeId) return { ok: false, reason: 'noOrders' };
  const recipe = RECIPES[recipeId];
  if (freeSpace(state, recipe.output.resource) < recipe.output.amount) return { ok: false, reason: 'storageFull', resource: recipe.output.resource };
  if (!craft.current) {
    if (!canAfford(state, recipe.inputs)) {
      const missing = RESOURCE_ORDER.find((r) => state.resources[r] < (recipe.inputs[r] ?? 0))!;
      return { ok: false, reason: 'noInputs', missing };
    }
    pay(state, recipe.inputs);
    craft.current = recipeId;
  }
  return { ok: true, recipe: recipeId };
}

/** Stores the finished item and advances the order list. */
export function finishItem(state: GameState, b: BuildingInstance, villagerId: number, sink: EventSink): void {
  const craft = b.craft;
  if (!craft?.current) return;
  const recipe = RECIPES[craft.current];
  const added = addResource(state, recipe.output.resource, recipe.output.amount);
  sink.push({ type: 'produced', villagerId, buildingId: b.id, resource: recipe.output.resource, amount: added });
  const order = craft.orders.find((o) => o.recipe === craft.current);
  craft.current = null;
  if (order && order.count !== REPEAT_ORDER) {
    order.count -= 1;
    if (order.count <= 0) craft.orders.splice(craft.orders.indexOf(order), 1);
  }
  if (craft.orders.length === 0) sink.push({ type: 'craftQueueEmpty', buildingId: b.id, defId: b.defId });
}

/** Returns the inputs of an item that was started but will no longer be finished. */
export function refundCurrent(state: GameState, b: BuildingInstance): void {
  const craft = b.craft;
  if (!craft?.current) return;
  for (const r of RESOURCE_ORDER) state.resources[r] += RECIPES[craft.current].inputs[r] ?? 0;
  craft.current = null;
}
