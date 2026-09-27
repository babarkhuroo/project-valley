import type { BuildingId } from './buildings';
import type { JobType } from './jobs';
import type { NodeKind } from './nodes';
import type { ResourceId } from './resources';

export type ResearchId =
  | 'cottageCraft'
  | 'clayDigging'
  | 'heartyRecipes'
  | 'growingHamlet'
  | 'sturdyRacks'
  | 'fieldRations'
  | 'sharpAxes'
  | 'studyNotes'
  | 'villageCommons'
  | 'claySpades'
  | 'woodlandTending'
  | 'buildersPlans';

export type ResearchCategory = 'villagers' | 'resources' | 'storage' | 'food' | 'production' | 'knowledge';

export type ResearchEffect =
  | { type: 'unlockBuilding'; building: BuildingId }
  | { type: 'maxCount'; building: BuildingId; add: number }
  | { type: 'unlockNode'; node: NodeKind }
  | { type: 'jobRate'; job: JobType; mult: number }
  | { type: 'storage'; resources: ResourceId[]; mult: number }
  | { type: 'mealDuration'; mult: number }
  | { type: 'regrow'; node: NodeKind; mult: number };

export interface ResearchDef {
  id: ResearchId;
  name: string;
  description: string;
  category: ResearchCategory;
  /** Player level that opens this tier. */
  tier: number;
  /** Knowledge required to complete. */
  cost: number;
  prereqs: ResearchId[];
  effects: ResearchEffect[];
  /** Village XP granted on completion. */
  xp: number;
  /** Row in the research tree (column = tier). */
  row: number;
}

export const RESEARCH_CATEGORY_LABEL: Record<ResearchCategory, string> = {
  villagers: 'Villagers',
  resources: 'Resources',
  storage: 'Storage',
  food: 'Food',
  production: 'Production',
  knowledge: 'Knowledge',
};

export const RESEARCH: Record<ResearchId, ResearchDef> = {
  cottageCraft: {
    id: 'cottageCraft',
    name: 'Cottage Craft',
    description: 'Learn to raise a snug Cottage — a home for one more villager.',
    category: 'villagers',
    tier: 1,
    cost: 20,
    prereqs: [],
    effects: [{ type: 'unlockBuilding', building: 'cottage' }],
    xp: 20,
    row: 0,
  },
  clayDigging: {
    id: 'clayDigging',
    name: 'Clay Digging',
    description: 'Work the soft creek banks for Clay, and build a Clay Shed to store it.',
    category: 'resources',
    tier: 1,
    cost: 15,
    prereqs: [],
    effects: [
      { type: 'unlockNode', node: 'clay' },
      { type: 'unlockBuilding', building: 'clayShed' },
    ],
    xp: 15,
    row: 1,
  },
  heartyRecipes: {
    id: 'heartyRecipes',
    name: 'Hearty Recipes',
    description: 'Better recipes let the cook fill bowls 25% faster.',
    category: 'food',
    tier: 1,
    cost: 25,
    prereqs: [],
    effects: [{ type: 'jobRate', job: 'cook', mult: 1.25 }],
    xp: 25,
    row: 3,
  },
  growingHamlet: {
    id: 'growingHamlet',
    name: 'Growing Hamlet',
    description: 'Room for a second Cottage — and a second newcomer.',
    category: 'villagers',
    tier: 2,
    cost: 60,
    prereqs: ['cottageCraft'],
    effects: [{ type: 'maxCount', building: 'cottage', add: 1 }],
    xp: 60,
    row: 0,
  },
  sturdyRacks: {
    id: 'sturdyRacks',
    name: 'Sturdy Racks',
    description: 'Reinforced shelving: Timber Yards and Clay Sheds hold 50% more.',
    category: 'storage',
    tier: 2,
    cost: 45,
    prereqs: ['clayDigging'],
    effects: [{ type: 'storage', resources: ['timber', 'clay'], mult: 1.5 }],
    xp: 45,
    row: 2,
  },
  fieldRations: {
    id: 'fieldRations',
    name: 'Field Rations',
    description: 'Packed lunches: each bowl of Stew fuels 30% more work.',
    category: 'food',
    tier: 2,
    cost: 40,
    prereqs: ['heartyRecipes'],
    effects: [{ type: 'mealDuration', mult: 1.3 }],
    xp: 40,
    row: 3,
  },
  sharpAxes: {
    id: 'sharpAxes',
    name: 'Sharpened Axes',
    description: 'A whetstone for every axe. Woodcutting is 20% faster.',
    category: 'production',
    tier: 2,
    cost: 40,
    prereqs: [],
    effects: [{ type: 'jobRate', job: 'chop', mult: 1.2 }],
    xp: 40,
    row: 4,
  },
  studyNotes: {
    id: 'studyNotes',
    name: 'Study Notes',
    description: 'Shared notebooks help scholars earn Knowledge 25% faster.',
    category: 'knowledge',
    tier: 2,
    cost: 50,
    prereqs: [],
    effects: [{ type: 'jobRate', job: 'study', mult: 1.25 }],
    xp: 50,
    row: 5,
  },
  villageCommons: {
    id: 'villageCommons',
    name: 'Village Commons',
    description: 'Plan a proper village green with room for a third Cottage.',
    category: 'villagers',
    tier: 3,
    cost: 120,
    prereqs: ['growingHamlet'],
    effects: [{ type: 'maxCount', building: 'cottage', add: 1 }],
    xp: 120,
    row: 0,
  },
  claySpades: {
    id: 'claySpades',
    name: 'Clay Spades',
    description: 'Narrow, sharpened spades make digging clay 20% faster.',
    category: 'production',
    tier: 3,
    cost: 80,
    prereqs: ['clayDigging'],
    effects: [{ type: 'jobRate', job: 'dig', mult: 1.2 }],
    xp: 80,
    row: 1,
  },
  woodlandTending: {
    id: 'woodlandTending',
    name: 'Woodland Tending',
    description: 'Replant as you go. Felled trees regrow three times faster.',
    category: 'resources',
    tier: 3,
    cost: 110,
    prereqs: ['sharpAxes'],
    effects: [{ type: 'regrow', node: 'tree', mult: 3 }],
    xp: 110,
    row: 4,
  },
  buildersPlans: {
    id: 'buildersPlans',
    name: "Builder's Plans",
    description: 'Drawn plans and measured timber. Construction is 25% faster.',
    category: 'production',
    tier: 3,
    cost: 90,
    prereqs: ['studyNotes'],
    effects: [{ type: 'jobRate', job: 'build', mult: 1.25 }],
    xp: 90,
    row: 5,
  },
};

export const RESEARCH_IDS = Object.keys(RESEARCH) as ResearchId[];
export const MAX_RESEARCH_TIER = Math.max(...RESEARCH_IDS.map((id) => RESEARCH[id].tier));
