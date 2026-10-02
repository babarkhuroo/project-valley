import type { BuildingId } from './buildings';
import type { JobType } from './jobs';
import type { NodeKind } from './nodes';
import type { ResourceId } from './resources';

export type ResearchId =
  | 'cottageCraft'
  | 'clayDigging'
  | 'stonecutting'
  | 'masonry'
  | 'carpentry'
  | 'brickmaking'
  | 'familyHomes'
  | 'clayPits'
  | 'organisedStores'
  | 'preservedFood'
  | 'woodlots'
  | 'apprenticeship'
  | 'masterCrafts'
  | 'townhouses'
  | 'stoneQuarry'
  | 'masterBuilders'
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

export type ResearchCategory = 'villagers' | 'resources' | 'storage' | 'food' | 'production' | 'knowledge' | 'crafting';

export type ResearchEffect =
  | { type: 'unlockBuilding'; building: BuildingId }
  | { type: 'maxCount'; building: BuildingId; add: number }
  | { type: 'unlockNode'; node: NodeKind }
  | { type: 'jobRate'; job: JobType; mult: number }
  | { type: 'storage'; resources: ResourceId[]; mult: number }
  | { type: 'mealDuration'; mult: number }
  | { type: 'regrow'; node: NodeKind; mult: number }
  | { type: 'practiceCap'; add: number }
  /** Informational: opens building upgrades up to this level (checked by upgrade definitions). */
  | { type: 'upgradeTier'; level: number };

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
  crafting: 'Crafting',
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
  carpentry: {
    id: 'carpentry',
    name: 'Carpentry',
    description: 'Saw pits and trestles: build a Sawmill and turn timber into planks.',
    category: 'crafting',
    tier: 2,
    cost: 55,
    prereqs: [],
    effects: [{ type: 'unlockBuilding', building: 'sawmill' }],
    xp: 55,
    row: 6,
  },
  brickmaking: {
    id: 'brickmaking',
    name: 'Brickmaking',
    description: 'Moulded clay fired hard in a kiln. Build a Brickworks, and a Warehouse for finished goods.',
    category: 'crafting',
    tier: 3,
    cost: 110,
    prereqs: ['carpentry'],
    effects: [
      { type: 'unlockBuilding', building: 'brickworks' },
      { type: 'unlockBuilding', building: 'warehouse' },
    ],
    xp: 110,
    row: 6,
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
    name: 'Iron-shod Spades',
    description: 'Iron edges on every spade and pick. Digging clay and quarrying stone are 20% faster.',
    category: 'production',
    tier: 3,
    cost: 80,
    prereqs: ['stonecutting'],
    effects: [
      { type: 'jobRate', job: 'dig', mult: 1.2 },
      { type: 'jobRate', job: 'quarry', mult: 1.2 },
    ],
    xp: 80,
    row: 1,
  },
  stonecutting: {
    id: 'stonecutting',
    name: 'Stonecutting',
    description: 'Learn to split the hillside rock. Quarry Rock Outcrops and store stone in a Stone Yard.',
    category: 'resources',
    tier: 2,
    cost: 50,
    prereqs: ['clayDigging'],
    effects: [
      { type: 'unlockNode', node: 'stone' },
      { type: 'unlockBuilding', building: 'stoneYard' },
    ],
    xp: 50,
    row: 1,
  },
  masonry: {
    id: 'masonry',
    name: 'Masonry',
    description: 'Mortar, footings and true walls. Buildings can be raised to level 3, and the Founders’ Lodge can grow a third bed.',
    category: 'storage',
    tier: 3,
    cost: 100,
    prereqs: ['stonecutting'],
    effects: [{ type: 'upgradeTier', level: 3 }],
    xp: 100,
    row: 2,
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
  // ---------------------------------------------------------------- Tier 4 (level 4)
  familyHomes: {
    id: 'familyHomes',
    name: 'Family Homes',
    description: 'Two storeys, a brick chimney and room for two. Unlocks the House.',
    category: 'villagers',
    tier: 4,
    cost: 180,
    prereqs: ['villageCommons'],
    effects: [{ type: 'unlockBuilding', building: 'house' }],
    xp: 180,
    row: 0,
  },
  clayPits: {
    id: 'clayPits',
    name: 'Clay Pits',
    description: 'Dig a proper pit wherever the ground is good. Unlocks the Clay Pit — clay that never runs out.',
    category: 'resources',
    tier: 4,
    cost: 160,
    prereqs: ['claySpades'],
    effects: [{ type: 'unlockBuilding', building: 'clayPit' }],
    xp: 160,
    row: 1,
  },
  organisedStores: {
    id: 'organisedStores',
    name: 'Organised Stores',
    description: 'Labelled bays and tidy stacks. Stone, plank and brick storage +50%.',
    category: 'storage',
    tier: 4,
    cost: 170,
    prereqs: ['masonry'],
    effects: [{ type: 'storage', resources: ['stone', 'planks', 'bricks'], mult: 1.5 }],
    xp: 170,
    row: 2,
  },
  preservedFood: {
    id: 'preservedFood',
    name: 'Preserved Food',
    description: 'Salted, smoked and sealed. Each bowl of Stew fuels another 30% more work.',
    category: 'food',
    tier: 4,
    cost: 150,
    prereqs: ['fieldRations'],
    effects: [{ type: 'mealDuration', mult: 1.3 }],
    xp: 150,
    row: 3,
  },
  woodlots: {
    id: 'woodlots',
    name: 'Managed Woodland',
    description: 'Coppice and replant on purpose. Unlocks the Woodlot — timber that never runs out, placed where you like.',
    category: 'resources',
    tier: 4,
    cost: 160,
    prereqs: ['woodlandTending'],
    effects: [{ type: 'unlockBuilding', building: 'woodlot' }],
    xp: 160,
    row: 4,
  },
  apprenticeship: {
    id: 'apprenticeship',
    name: 'Apprenticeship',
    description: 'Elders teach while they work. Villagers can practise any skill up to level 3.',
    category: 'knowledge',
    tier: 4,
    cost: 170,
    prereqs: ['studyNotes'],
    effects: [{ type: 'practiceCap', add: 1 }],
    xp: 170,
    row: 5,
  },
  masterCrafts: {
    id: 'masterCrafts',
    name: 'Master Crafts',
    description: 'Jigs, moulds and better kilns. Workshops produce 25% faster.',
    category: 'crafting',
    tier: 4,
    cost: 190,
    prereqs: ['brickmaking'],
    effects: [{ type: 'jobRate', job: 'craft', mult: 1.25 }],
    xp: 190,
    row: 6,
  },
  // ---------------------------------------------------------------- Tier 5 (level 5)
  townhouses: {
    id: 'townhouses',
    name: 'Townhouses',
    description: 'Shared walls and tidy lanes: room for a second House.',
    category: 'villagers',
    tier: 5,
    cost: 260,
    prereqs: ['familyHomes'],
    effects: [{ type: 'maxCount', building: 'house', add: 1 }],
    xp: 260,
    row: 0,
  },
  stoneQuarry: {
    id: 'stoneQuarry',
    name: 'Stone Quarry',
    description: 'Open a quarry face with a crane and ramps. Unlocks the Quarry — stone that never runs out.',
    category: 'resources',
    tier: 5,
    cost: 240,
    prereqs: ['clayPits'],
    effects: [{ type: 'unlockBuilding', building: 'quarry' }],
    xp: 240,
    row: 1,
  },
  masterBuilders: {
    id: 'masterBuilders',
    name: 'Master Builders',
    description: 'Cranes, templates and practised crews. Construction is 30% faster.',
    category: 'production',
    tier: 5,
    cost: 240,
    prereqs: ['apprenticeship'],
    effects: [{ type: 'jobRate', job: 'build', mult: 1.3 }],
    xp: 240,
    row: 5,
  },
};

export const RESEARCH_IDS = Object.keys(RESEARCH) as ResearchId[];
export const MAX_RESEARCH_TIER = Math.max(...RESEARCH_IDS.map((id) => RESEARCH[id].tier));
