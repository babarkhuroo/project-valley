import type { ResourceId } from './resources';

/**
 * Cooperative crafting at the Millrace Workshop. A member sends a villager for a shift
 * with materials from home; the shared waterwheel-driven saws and kilns turn them into
 * more than they'd make apart, delivered straight to a Valley project. Every recipe
 * beats the village's own Sawmill/Brickworks for the same inputs (no workshop time
 * either), before Crafting skill and neighbours on shift add more.
 */

export type CoopRecipeId = 'beams' | 'dressedStone' | 'planks' | 'bricks';

export interface CoopRecipeDef {
  id: CoopRecipeId;
  name: string;
  description: string;
  inputs: Partial<Record<ResourceId, number>>;
  output: { resource: ResourceId; amount: number };
}

export const COOP_RECIPES: Record<CoopRecipeId, CoopRecipeDef> = {
  beams: { id: 'beams', name: 'Sawn beams', description: 'The big saw turns rough logs into long beams.', inputs: { timber: 100 }, output: { resource: 'timber', amount: 140 } },
  dressedStone: { id: 'dressedStone', name: 'Dressed stone', description: 'Water-driven chisels square up rough stone.', inputs: { stone: 60 }, output: { resource: 'stone', amount: 85 } },
  planks: { id: 'planks', name: 'Mill planks', description: 'The great saw runs boards all day.', inputs: { timber: 120 }, output: { resource: 'planks', amount: 75 } },
  bricks: { id: 'bricks', name: 'Kiln bricks', description: 'The shared kiln fires bricks by the hundred.', inputs: { clay: 100, timber: 20 }, output: { resource: 'bricks', amount: 80 } },
};

export const COOP_RECIPE_ORDER: CoopRecipeId[] = ['beams', 'dressedStone', 'planks', 'bricks'];

export const MILLRACE = {
  /** Hours a shift lasts. */
  shiftHours: 2,
  /** Each level of the villager's Crafting skill adds this much output. */
  craftingBonusPerLevel: 0.05,
  /** Each neighbour working a shift at the same time adds this much (cooperation). */
  helperBonus: 0.05,
  maxHelpers: 6,
};
