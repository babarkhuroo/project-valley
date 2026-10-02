import type { BuildingId, ResourceBundle } from './buildings';
import type { ResourceId } from './resources';

export type RecipeId = 'planks' | 'bricks';

/**
 * Something a workshop makes. Inputs are taken when an item starts (so they can never
 * vanish mid-way) and the output is stored when the worker finishes it.
 */
export interface RecipeDef {
  id: RecipeId;
  name: string;
  /** Present-tense label for the worker, e.g. "Sawing planks". */
  verb: string;
  building: BuildingId;
  inputs: ResourceBundle;
  output: { resource: ResourceId; amount: number };
  /** Work units per item (a crafter produces `workRate` units/second). */
  work: number;
}

export const RECIPES: Record<RecipeId, RecipeDef> = {
  planks: {
    id: 'planks',
    name: 'Planks',
    verb: 'Sawing planks',
    building: 'sawmill',
    inputs: { timber: 4 },
    output: { resource: 'planks', amount: 2 },
    work: 12,
  },
  bricks: {
    id: 'bricks',
    name: 'Bricks',
    verb: 'Firing bricks',
    building: 'brickworks',
    inputs: { clay: 3, timber: 1 },
    output: { resource: 'bricks', amount: 2 },
    work: 14,
  },
};

export const RECIPE_IDS = Object.keys(RECIPES) as RecipeId[];

/** Largest single order, and the number used for "keep making" orders. */
export const MAX_ORDER = 50;
export const REPEAT_ORDER = -1;
