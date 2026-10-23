import type { JobType } from './jobs';
import type { ResearchId } from './research';
import type { RecipeId } from './recipes';
import type { ResourceId } from './resources';

export type BuildingId =
  | 'cookhouse'
  | 'lodge'
  | 'timberYard'
  | 'clayShed'
  | 'stoneYard'
  | 'sawmill'
  | 'brickworks'
  | 'warehouse'
  | 'woodlot'
  | 'clayPit'
  | 'quarry'
  | 'field'
  | 'granary'
  | 'bakery'
  | 'chickenCoop'
  | 'beehive'
  | 'house'
  | 'academy'
  | 'cottage'
  | 'flowerBed'
  | 'lantern'
  | 'bench'
  | 'swing'
  | 'campfire'
  | 'dogHouse'
  | 'catHouse'
  | 'valleyBanner'
  | 'fountain'
  | 'festivalLanterns';

export type BuildingCategory = 'essentials' | 'production' | 'storage' | 'homes' | 'decor';

export type ResourceBundle = Partial<Record<ResourceId, number>>;

export interface BuildCost {
  resources: ResourceBundle;
  /** Construction work units. A builder contributes `workRate` units/second. 0 = placed instantly. */
  work: number;
}

/**
 * One upgrade step. Stats listed here replace the building's previous values from this
 * level on; anything omitted carries over. Upgrades keep the footprint and the building
 * keeps working while builders upgrade it.
 */
export interface UpgradeDef {
  cost: BuildCost;
  requiresResearch?: ResearchId;
  /** Village level needed to start this upgrade. */
  minPlayerLevel?: number;
  storage?: Partial<Record<ResourceId, number>>;
  housing?: number;
  /** Worker slots for the building's operate job. */
  slots?: number;
  /** Work-rate multiplier for the building's operate job. */
  outputMult?: number;
  xp: number;
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  description: string;
  category: BuildingCategory;
  /** Footprint in tiles at rotation 0 (w along x, d along z). */
  footprint: { w: number; d: number };
  /** Whether the player can place new copies from the build menu. */
  buildable: boolean;
  requiresResearch?: ResearchId;
  /** Unlocked by a Valley reward (Reputation Road, festivals) instead of research. */
  requiresReward?: boolean;
  /** Copies allowed before research bonuses. */
  maxCount: number;
  /** Cost of the next copy, indexed by copies already owned. The last entry repeats. */
  costs: BuildCost[];
  /** Village XP granted when construction finishes. */
  xp: number;
  storage?: Partial<Record<ResourceId, number>>;
  housing?: number;
  operate?: { job: JobType; slots: number };
  /** Workshops take orders for these recipes, up to `orderSlots` orders at once. */
  workshop?: { recipes: RecipeId[]; orderSlots: number };
  /** Key into the rendering model registry. */
  model: string;
  /** Approximate finished height, used for construction and label placement. */
  height: number;
  /** Upgrade steps: `upgrades[0]` raises the building to level 2, and so on. */
  upgrades?: UpgradeDef[];
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  cookhouse: {
    id: 'cookhouse',
    name: 'Cookhouse',
    description: 'The heart of the village. A cook here simmers Stew that keeps everyone working.',
    category: 'essentials',
    footprint: { w: 3, d: 3 },
    buildable: false,
    maxCount: 1,
    costs: [{ resources: {}, work: 0 }],
    xp: 0,
    storage: { stew: 40 },
    operate: { job: 'cook', slots: 1 },
    model: 'cookhouse',
    height: 3.4,
    upgrades: [
      { cost: { resources: { timber: 120, clay: 50, stone: 40 }, work: 60 }, storage: { stew: 60 }, slots: 2, outputMult: 1.2, xp: 40 },
      { cost: { resources: { timber: 160, clay: 60, stone: 100, bricks: 30 }, work: 90 }, requiresResearch: 'masonry', minPlayerLevel: 3, storage: { stew: 90 }, outputMult: 1.4, xp: 60 },
      // Levels opened by the sixth research tier.
      { cost: { resources: { timber: 260, stone: 200, planks: 80, bricks: 80 }, work: 120 }, requiresResearch: 'guildKitchens', minPlayerLevel: 7, storage: { stew: 130 }, slots: 3, outputMult: 1.6, xp: 90 },
      { cost: { resources: { timber: 380, stone: 300, planks: 150, bricks: 160 }, work: 150 }, requiresResearch: 'guildKitchens', minPlayerLevel: 8, storage: { stew: 180 }, outputMult: 1.8, xp: 130 },
    ],
  },
  lodge: {
    id: 'lodge',
    name: "Founders' Lodge",
    description: 'The long hall where the first settlers live. Home to two villagers — three once extended.',
    category: 'homes',
    footprint: { w: 3, d: 2 },
    buildable: false,
    maxCount: 1,
    costs: [{ resources: {}, work: 0 }],
    xp: 0,
    housing: 2,
    model: 'lodge',
    height: 2.8,
    upgrades: [
      { cost: { resources: { timber: 120, clay: 60, stone: 80, planks: 30 }, work: 80 }, requiresResearch: 'masonry', housing: 3, xp: 60 },
    ],
  },
  timberYard: {
    id: 'timberYard',
    name: 'Timber Yard',
    description: 'Covered racks for stacking logs. Woodcutters carry their timber here.',
    category: 'storage',
    footprint: { w: 2, d: 2 },
    buildable: true,
    maxCount: 3,
    costs: [
      { resources: { timber: 40 }, work: 20 },
      { resources: { timber: 40 }, work: 20 },
      { resources: { timber: 70, clay: 20 }, work: 35 },
    ],
    xp: 15,
    storage: { timber: 120 },
    model: 'timberYard',
    height: 1.9,
    upgrades: [
      { cost: { resources: { timber: 80, clay: 30 }, work: 30 }, storage: { timber: 200 }, xp: 20 },
      { cost: { resources: { timber: 100, clay: 40, stone: 60, planks: 20 }, work: 45 }, requiresResearch: 'masonry', minPlayerLevel: 3, storage: { timber: 320 }, xp: 35 },
      // Levels opened by the sixth research tier.
      { cost: { resources: { timber: 260, stone: 140, planks: 80, bricks: 40 }, work: 70 }, requiresResearch: 'grandYards', minPlayerLevel: 7, storage: { timber: 480 }, xp: 70 },
      { cost: { resources: { timber: 400, stone: 260, planks: 160, bricks: 120 }, work: 100 }, requiresResearch: 'grandStores', minPlayerLevel: 8, storage: { timber: 700 }, xp: 110 },
    ],
  },
  clayShed: {
    id: 'clayShed',
    name: 'Clay Shed',
    description: 'A cool, shaded shed that keeps clay workable. Diggers deliver here.',
    category: 'storage',
    footprint: { w: 2, d: 2 },
    buildable: true,
    requiresResearch: 'clayDigging',
    maxCount: 2,
    costs: [
      { resources: { timber: 50 }, work: 30 },
      { resources: { timber: 80, clay: 30 }, work: 40 },
    ],
    xp: 20,
    storage: { clay: 100 },
    model: 'clayShed',
    height: 2.1,
    upgrades: [
      { cost: { resources: { timber: 90, clay: 40 }, work: 30 }, storage: { clay: 170 }, xp: 20 },
      { cost: { resources: { timber: 100, clay: 60, stone: 60, planks: 20 }, work: 45 }, requiresResearch: 'masonry', minPlayerLevel: 3, storage: { clay: 260 }, xp: 35 },
      // Levels opened by the sixth research tier.
      { cost: { resources: { timber: 200, clay: 160, stone: 120, planks: 70, bricks: 40 }, work: 70 }, requiresResearch: 'grandYards', minPlayerLevel: 7, storage: { clay: 400 }, xp: 70 },
      { cost: { resources: { timber: 320, clay: 260, stone: 220, planks: 140, bricks: 110 }, work: 100 }, requiresResearch: 'grandStores', minPlayerLevel: 8, storage: { clay: 600 }, xp: 110 },
    ],
  },
  stoneYard: {
    id: 'stoneYard',
    name: 'Stone Yard',
    description: 'A paved yard with a hoist for stacking cut stone. Quarrymen deliver here.',
    category: 'storage',
    footprint: { w: 2, d: 2 },
    buildable: true,
    requiresResearch: 'stonecutting',
    maxCount: 2,
    costs: [
      { resources: { timber: 60, clay: 20 }, work: 35 },
      { resources: { timber: 90, clay: 40 }, work: 45 },
    ],
    xp: 25,
    storage: { stone: 100 },
    model: 'stoneYard',
    height: 2.2,
    upgrades: [
      { cost: { resources: { timber: 80, clay: 30, stone: 40 }, work: 35 }, storage: { stone: 170 }, xp: 25 },
      { cost: { resources: { timber: 100, clay: 60, stone: 100, planks: 20 }, work: 50 }, requiresResearch: 'masonry', minPlayerLevel: 3, storage: { stone: 260 }, xp: 40 },
      // Levels opened by the sixth research tier.
      { cost: { resources: { timber: 240, stone: 180, planks: 80, bricks: 50 }, work: 70 }, requiresResearch: 'grandYards', minPlayerLevel: 7, storage: { stone: 400 }, xp: 70 },
      { cost: { resources: { timber: 360, stone: 320, planks: 160, bricks: 120 }, work: 100 }, requiresResearch: 'grandStores', minPlayerLevel: 8, storage: { stone: 600 }, xp: 110 },
    ],
  },
  sawmill: {
    id: 'sawmill',
    name: 'Sawmill',
    description: 'A saw pit and bench where a crafter turns rough timber into straight planks.',
    category: 'production',
    footprint: { w: 3, d: 2 },
    buildable: true,
    requiresResearch: 'carpentry',
    maxCount: 1,
    costs: [{ resources: { timber: 120, stone: 30 }, work: 60 }],
    xp: 45,
    storage: { planks: 40 },
    operate: { job: 'craft', slots: 1 },
    workshop: { recipes: ['planks'], orderSlots: 4 },
    model: 'sawmill',
    height: 2.6,
    upgrades: [
      { cost: { resources: { timber: 140, stone: 60, planks: 30 }, work: 60 }, storage: { planks: 80 }, slots: 2, outputMult: 1.2, xp: 45 },
      // Levels opened by the sixth research tier.
      { cost: { resources: { timber: 220, stone: 120, planks: 80, bricks: 40 }, work: 90 }, requiresResearch: 'fineJoinery', minPlayerLevel: 6, storage: { planks: 140 }, slots: 3, outputMult: 1.4, xp: 70 },
    ],
  },
  brickworks: {
    id: 'brickworks',
    name: 'Brickworks',
    description: 'Moulds, drying racks and a wood-fired kiln. Clay goes in, bricks come out.',
    category: 'production',
    footprint: { w: 3, d: 2 },
    buildable: true,
    requiresResearch: 'brickmaking',
    maxCount: 1,
    costs: [{ resources: { timber: 100, clay: 60, stone: 40, planks: 20 }, work: 70 }],
    xp: 55,
    storage: { bricks: 40 },
    operate: { job: 'craft', slots: 1 },
    workshop: { recipes: ['bricks'], orderSlots: 4 },
    model: 'brickworks',
    height: 2.8,
    upgrades: [
      { cost: { resources: { timber: 120, stone: 60, planks: 30, bricks: 30 }, work: 70 }, storage: { bricks: 80 }, slots: 2, outputMult: 1.2, xp: 55 },
      // Levels opened by the sixth research tier.
      { cost: { resources: { timber: 200, stone: 140, planks: 60, bricks: 70 }, work: 100 }, requiresResearch: 'fineJoinery', minPlayerLevel: 6, storage: { bricks: 140 }, slots: 3, outputMult: 1.4, xp: 80 },
    ],
  },
  warehouse: {
    id: 'warehouse',
    name: 'Warehouse',
    description: 'A tall timber barn with racks for finished goods — planks and bricks.',
    category: 'storage',
    footprint: { w: 3, d: 3 },
    buildable: true,
    requiresResearch: 'brickmaking',
    maxCount: 2,
    costs: [
      { resources: { timber: 100, stone: 40, planks: 40 }, work: 60 },
      { resources: { timber: 140, stone: 80, planks: 60, bricks: 40 }, work: 80 },
    ],
    xp: 40,
    storage: { planks: 100, bricks: 100 },
    model: 'warehouse',
    height: 3.6,
  },
  bakery: {
    id: 'bakery',
    name: 'Bakery',
    description: 'A warm brick oven where a crafter bakes grain into Bread. Villagers eat a loaf before Stew, and it lasts half as long again.',
    category: 'production',
    footprint: { w: 2, d: 2 },
    buildable: true,
    requiresResearch: 'baking',
    maxCount: 1,
    costs: [{ resources: { timber: 100, clay: 40, stone: 40 }, work: 55 }],
    xp: 50,
    storage: { bread: 40 },
    operate: { job: 'craft', slots: 1 },
    workshop: { recipes: ['bread'], orderSlots: 4 },
    model: 'bakery',
    height: 2.6,
    upgrades: [
      { cost: { resources: { timber: 140, stone: 60, bricks: 30 }, work: 60 }, storage: { bread: 80 }, slots: 2, outputMult: 1.2, xp: 45 },
    ],
  },
  chickenCoop: {
    id: 'chickenCoop',
    name: 'Chicken Coop',
    description: 'A little henhouse and its run. A keeper feeds the hens and gathers Eggs, which merchants and visitors love.',
    category: 'production',
    footprint: { w: 2, d: 2 },
    buildable: true,
    requiresResearch: 'henkeeping',
    maxCount: 2,
    costs: [
      { resources: { timber: 80, clay: 20 }, work: 40 },
      { resources: { timber: 120, planks: 20 }, work: 50 },
    ],
    xp: 40,
    storage: { eggs: 30 },
    operate: { job: 'keepHens', slots: 1 },
    model: 'chickenCoop',
    height: 1.8,
    upgrades: [
      { cost: { resources: { timber: 120, planks: 30, stone: 20 }, work: 50 }, storage: { eggs: 60 }, slots: 2, outputMult: 1.2, xp: 40 },
    ],
  },
  beehive: {
    id: 'beehive',
    name: 'Apiary',
    description: 'A row of hives among the flowers. A keeper tends the bees and draws off golden Honey to trade.',
    category: 'production',
    footprint: { w: 2, d: 2 },
    buildable: true,
    requiresResearch: 'beekeeping',
    maxCount: 2,
    costs: [
      { resources: { timber: 70, planks: 20 }, work: 40 },
      { resources: { timber: 110, planks: 40 }, work: 50 },
    ],
    xp: 45,
    storage: { honey: 25 },
    operate: { job: 'keepBees', slots: 1 },
    model: 'beehive',
    height: 1.4,
    upgrades: [
      { cost: { resources: { timber: 110, planks: 40, stone: 20 }, work: 50 }, storage: { honey: 50 }, slots: 2, outputMult: 1.2, xp: 45 },
    ],
  },
  woodlot: {
    id: 'woodlot',
    name: 'Woodlot',
    description: 'A fenced, managed grove. Woodcutters work it forever — it never runs out. Place it near a Timber Yard.',
    category: 'production',
    footprint: { w: 3, d: 3 },
    buildable: true,
    requiresResearch: 'woodlots',
    maxCount: 2,
    costs: [
      { resources: { timber: 80, planks: 20 }, work: 50 },
      { resources: { timber: 120, planks: 40, stone: 20 }, work: 60 },
    ],
    xp: 40,
    operate: { job: 'chop', slots: 2 },
    model: 'woodlot',
    height: 2.8,
    upgrades: [
      { cost: { resources: { timber: 120, planks: 40, stone: 40 }, work: 60 }, slots: 3, outputMult: 1.2, xp: 40 },
      // Levels opened by the sixth research tier.
      { cost: { resources: { timber: 180, planks: 80, stone: 80 }, work: 80 }, requiresResearch: 'deepSeams', minPlayerLevel: 6, slots: 4, outputMult: 1.4, xp: 60 },
    ],
  },
  clayPit: {
    id: 'clayPit',
    name: 'Clay Pit',
    description: 'A dug pit with ladders and a sluice. Diggers work it forever. Place it near a Clay Shed.',
    category: 'production',
    footprint: { w: 2, d: 2 },
    buildable: true,
    requiresResearch: 'clayPits',
    maxCount: 2,
    costs: [
      { resources: { timber: 80, planks: 20, stone: 20 }, work: 45 },
      { resources: { timber: 120, planks: 40, stone: 40 }, work: 55 },
    ],
    xp: 40,
    operate: { job: 'dig', slots: 2 },
    model: 'clayPit',
    height: 1.4,
    upgrades: [
      { cost: { resources: { timber: 100, planks: 40, bricks: 20 }, work: 55 }, slots: 3, outputMult: 1.2, xp: 40 },
      // Levels opened by the sixth research tier.
      { cost: { resources: { timber: 160, planks: 80, bricks: 60 }, work: 80 }, requiresResearch: 'deepSeams', minPlayerLevel: 6, slots: 4, outputMult: 1.4, xp: 60 },
    ],
  },
  quarry: {
    id: 'quarry',
    name: 'Quarry',
    description: 'A cut rock face with a crane. Quarrymen work it forever. Place it near a Stone Yard.',
    category: 'production',
    footprint: { w: 3, d: 3 },
    buildable: true,
    requiresResearch: 'stoneQuarry',
    maxCount: 1,
    costs: [{ resources: { timber: 120, planks: 40, bricks: 20 }, work: 70 }],
    xp: 60,
    operate: { job: 'quarry', slots: 2 },
    model: 'quarry',
    height: 2.6,
    upgrades: [
      { cost: { resources: { timber: 160, planks: 60, bricks: 40 }, work: 80 }, slots: 3, outputMult: 1.2, xp: 60 },
      // Levels opened by the sixth research tier.
      { cost: { resources: { timber: 220, planks: 100, bricks: 80 }, work: 110 }, requiresResearch: 'deepSeams', minPlayerLevel: 6, slots: 4, outputMult: 1.4, xp: 80 },
    ],
  },
  field: {
    id: 'field',
    name: 'Grain Field',
    description: 'Ploughed rows for grain. Farmers sow, tend and harvest it; a crop ripens on its own too, only slower. Fields on the southern meadow yield more.',
    category: 'production',
    footprint: { w: 3, d: 3 },
    buildable: true,
    requiresResearch: 'fieldSowing',
    maxCount: 2,
    costs: [
      { resources: { timber: 40 }, work: 20 },
      { resources: { timber: 60, planks: 10 }, work: 30 },
    ],
    xp: 25,
    operate: { job: 'farm', slots: 2 },
    model: 'field',
    height: 0.7,
    upgrades: [{ cost: { resources: { timber: 80, planks: 30, stone: 20 }, work: 40 }, slots: 3, outputMult: 1.2, xp: 30 }],
  },
  granary: {
    id: 'granary',
    name: 'Granary',
    description: 'A raised barn on stone feet that keeps grain dry and the mice out. Farmers carry their harvest here.',
    category: 'storage',
    footprint: { w: 2, d: 2 },
    buildable: true,
    requiresResearch: 'fieldSowing',
    maxCount: 2,
    costs: [
      { resources: { timber: 60, stone: 20 }, work: 35 },
      { resources: { timber: 90, stone: 40, planks: 20 }, work: 45 },
    ],
    xp: 25,
    storage: { grain: 80 },
    model: 'granary',
    height: 2.6,
    upgrades: [
      { cost: { resources: { timber: 80, stone: 40, planks: 20 }, work: 35 }, storage: { grain: 140 }, xp: 25 },
      // Levels opened by the sixth research tier.
      { cost: { resources: { timber: 140, stone: 80, planks: 50, bricks: 30 }, work: 60 }, requiresResearch: 'guildKitchens', minPlayerLevel: 6, storage: { grain: 220 }, xp: 45 },
    ],
  },
  house: {
    id: 'house',
    name: 'House',
    description: 'A two-storey family home with a brick chimney. Room for two villagers.',
    category: 'homes',
    footprint: { w: 3, d: 2 },
    buildable: true,
    requiresResearch: 'familyHomes',
    maxCount: 1,
    costs: [
      { resources: { timber: 160, stone: 40, planks: 60, bricks: 40 }, work: 100 },
      { resources: { timber: 200, stone: 60, planks: 80, bricks: 60 }, work: 120 },
    ],
    xp: 80,
    housing: 2,
    model: 'house',
    height: 3.6,
  },
  academy: {
    id: 'academy',
    name: 'Academy',
    description: 'A study hall with a star-watching tower. Scholars here earn Knowledge for research.',
    category: 'essentials',
    footprint: { w: 3, d: 3 },
    buildable: true,
    maxCount: 1,
    costs: [{ resources: { timber: 60 }, work: 40 }],
    xp: 40,
    storage: { knowledge: 30 },
    operate: { job: 'study', slots: 1 },
    model: 'academy',
    height: 4.4,
    upgrades: [
      { cost: { resources: { timber: 140, clay: 60, stone: 50 }, work: 70 }, storage: { knowledge: 50 }, slots: 2, outputMult: 1.2, xp: 45 },
      { cost: { resources: { timber: 160, clay: 80, stone: 120, planks: 40, bricks: 30 }, work: 100 }, requiresResearch: 'masonry', minPlayerLevel: 3, storage: { knowledge: 80 }, outputMult: 1.4, xp: 70 },
      // Levels opened by the sixth research tier.
      { cost: { resources: { timber: 280, stone: 220, planks: 100, bricks: 80 }, work: 130 }, requiresResearch: 'learnedSociety', minPlayerLevel: 7, storage: { knowledge: 120 }, slots: 3, outputMult: 1.6, xp: 100 },
      { cost: { resources: { timber: 400, stone: 320, planks: 180, bricks: 160 }, work: 160 }, requiresResearch: 'learnedSociety', minPlayerLevel: 8, storage: { knowledge: 170 }, outputMult: 1.8, xp: 140 },
    ],
  },
  cottage: {
    id: 'cottage',
    name: 'Cottage',
    description: 'A snug round home. Each Cottage welcomes one new villager to the settlement.',
    category: 'homes',
    footprint: { w: 2, d: 2 },
    buildable: true,
    requiresResearch: 'cottageCraft',
    maxCount: 1,
    costs: [
      { resources: { timber: 100 }, work: 60 },
      { resources: { timber: 120, clay: 50 }, work: 75 },
      { resources: { timber: 120, clay: 60, planks: 40, bricks: 30 }, work: 90 },
    ],
    xp: 50,
    housing: 1,
    model: 'cottage',
    height: 2.6,
  },
  flowerBed: {
    id: 'flowerBed',
    name: 'Flower Bed',
    description: 'A splash of colour. Purely for the joy of it.',
    category: 'decor',
    footprint: { w: 1, d: 1 },
    buildable: true,
    maxCount: 24,
    costs: [{ resources: { timber: 5 }, work: 0 }],
    xp: 1,
    model: 'flowerBed',
    height: 0.5,
  },
  lantern: {
    id: 'lantern',
    name: 'Lantern Post',
    description: 'A warm light for evening strolls.',
    category: 'decor',
    footprint: { w: 1, d: 1 },
    buildable: true,
    maxCount: 16,
    costs: [{ resources: { timber: 12 }, work: 0 }],
    xp: 1,
    model: 'lantern',
    height: 1.8,
  },
  bench: {
    id: 'bench',
    name: 'Garden Bench',
    description: 'Somewhere to sit and watch the village work.',
    category: 'decor',
    footprint: { w: 1, d: 1 },
    buildable: true,
    maxCount: 12,
    costs: [{ resources: { timber: 15 }, work: 0 }],
    xp: 1,
    model: 'bench',
    height: 0.8,
  },
  swing: {
    id: 'swing',
    name: 'Garden Swing',
    description: 'A plank swing on a little frame. Resting villagers take turns on it.',
    category: 'decor',
    footprint: { w: 1, d: 1 },
    buildable: true,
    maxCount: 6,
    costs: [{ resources: { timber: 18 }, work: 0 }],
    xp: 1,
    model: 'swing',
    height: 1.4,
  },
  campfire: {
    id: 'campfire',
    name: 'Campfire',
    description: 'A ring of stones and a crackling fire. Resting villagers gather round to warm their hands.',
    category: 'decor',
    footprint: { w: 1, d: 1 },
    buildable: true,
    maxCount: 4,
    costs: [{ resources: { timber: 12 }, work: 0 }],
    xp: 1,
    model: 'campfire',
    height: 0.6,
  },
  dogHouse: {
    id: 'dogHouse',
    name: 'Dog Kennel',
    description: 'A snug kennel with a water bowl. A friendly dog moves in and pads about the village.',
    category: 'decor',
    footprint: { w: 1, d: 1 },
    buildable: true,
    maxCount: 2,
    costs: [{ resources: { timber: 25 }, work: 0 }],
    xp: 2,
    model: 'dogHouse',
    height: 0.9,
  },
  catHouse: {
    id: 'catHouse',
    name: 'Cat Cottage',
    description: 'A little cottage with a cushion on the roof. A cat moves in and naps in the sun.',
    category: 'decor',
    footprint: { w: 1, d: 1 },
    buildable: true,
    maxCount: 2,
    costs: [{ resources: { timber: 25 }, work: 0 }],
    xp: 2,
    model: 'catHouse',
    height: 0.9,
  },
  valleyBanner: {
    id: 'valleyBanner',
    name: 'Valley Banner',
    description: 'Flies the Valley colours. A Reputation Road reward.',
    category: 'decor',
    footprint: { w: 1, d: 1 },
    buildable: true,
    requiresReward: true,
    maxCount: 8,
    costs: [{ resources: { timber: 10 }, work: 0 }],
    xp: 2,
    model: 'valleyBanner',
    height: 2.6,
  },
  festivalLanterns: {
    id: 'festivalLanterns',
    name: 'Festival Lanterns',
    description: 'Paper lanterns strung between two posts. Earned by helping a Valley festival succeed.',
    category: 'decor',
    footprint: { w: 2, d: 1 },
    buildable: true,
    requiresReward: true,
    maxCount: 6,
    costs: [{ resources: { timber: 15 }, work: 0 }],
    xp: 3,
    model: 'festivalLanterns',
    height: 2.2,
  },
  fountain: {
    id: 'fountain',
    name: 'Fountain',
    description: 'A carved stone fountain, gift of the Valley. A Reputation Road reward.',
    category: 'decor',
    footprint: { w: 2, d: 2 },
    buildable: true,
    requiresReward: true,
    maxCount: 2,
    costs: [{ resources: { stone: 30 }, work: 0 }],
    xp: 5,
    model: 'fountain',
    height: 1.6,
  },
};

export const BUILD_MENU_ORDER: BuildingId[] = [
  'academy',
  'timberYard',
  'clayShed',
  'stoneYard',
  'sawmill',
  'brickworks',
  'warehouse',
  'woodlot',
  'clayPit',
  'quarry',
  'granary',
  'field',
  'bakery',
  'chickenCoop',
  'beehive',
  'cottage',
  'house',
  'flowerBed',
  'lantern',
  'bench',
  'swing',
  'campfire',
  'dogHouse',
  'catHouse',
  'valleyBanner',
  'fountain',
  'festivalLanterns',
];

export const BUILDING_CATEGORY_LABEL: Record<BuildingCategory, string> = {
  essentials: 'Essentials',
  production: 'Workshops',
  storage: 'Storage',
  homes: 'Homes',
  decor: 'Decoration',
};
