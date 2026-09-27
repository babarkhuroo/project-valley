import type { JobType } from './jobs';
import type { ResearchId } from './research';
import type { ResourceId } from './resources';

export type BuildingId =
  | 'cookhouse'
  | 'lodge'
  | 'timberYard'
  | 'clayShed'
  | 'academy'
  | 'cottage'
  | 'flowerBed'
  | 'lantern'
  | 'bench';

export type BuildingCategory = 'essentials' | 'storage' | 'homes' | 'decor';

export type ResourceBundle = Partial<Record<ResourceId, number>>;

export interface BuildCost {
  resources: ResourceBundle;
  /** Construction work units. A builder contributes `workRate` units/second. 0 = placed instantly. */
  work: number;
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
  /** Copies allowed before research bonuses. */
  maxCount: number;
  /** Cost of the next copy, indexed by copies already owned. The last entry repeats. */
  costs: BuildCost[];
  /** Village XP granted when construction finishes. */
  xp: number;
  storage?: Partial<Record<ResourceId, number>>;
  housing?: number;
  operate?: { job: JobType; slots: number };
  /** Key into the rendering model registry. */
  model: string;
  /** Approximate finished height, used for construction and label placement. */
  height: number;
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
  },
  lodge: {
    id: 'lodge',
    name: "Founders' Lodge",
    description: 'The long hall where the first settlers live. Home to two villagers.',
    category: 'homes',
    footprint: { w: 3, d: 2 },
    buildable: false,
    maxCount: 1,
    costs: [{ resources: {}, work: 0 }],
    xp: 0,
    housing: 2,
    model: 'lodge',
    height: 2.8,
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
      { resources: { timber: 160, clay: 90 }, work: 90 },
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
};

export const BUILD_MENU_ORDER: BuildingId[] = [
  'academy',
  'timberYard',
  'clayShed',
  'cottage',
  'flowerBed',
  'lantern',
  'bench',
];

export const BUILDING_CATEGORY_LABEL: Record<BuildingCategory, string> = {
  essentials: 'Essentials',
  storage: 'Storage',
  homes: 'Homes',
  decor: 'Decoration',
};
