import type { Appearance } from './villagers';
import type { JobType } from './jobs';
import type { ResourceId } from './resources';

/**
 * The shared Valley: districts, communal buildings restored through contributions,
 * the simulated neighbours who share it until real multiplayer arrives, and the
 * numbers that pace it. Everything here is static data; Valley state lives on the
 * server (see src/valley/ and server/valley*.ts).
 */

export type DistrictId =
  | 'plaza'
  | 'guilds'
  | 'harbor'
  | 'library'
  | 'market'
  | 'farmland'
  | 'industry'
  | 'forest'
  | 'quarry'
  | 'river'
  | 'frontier';

export interface DistrictDef {
  id: DistrictId;
  name: string;
  blurb: string;
  /** Label anchor on the Valley map. */
  x: number;
  z: number;
}

export const DISTRICTS: Record<DistrictId, DistrictDef> = {
  plaza: { id: 'plaza', name: 'Hearth Plaza', blurb: 'The meeting place at the heart of the Valley.', x: 64, z: 71 },
  guilds: { id: 'guilds', name: 'Guild Row', blurb: 'Halls where villagers train beyond what practice teaches.', x: 86, z: 40 },
  harbor: { id: 'harbor', name: 'Saltreach Harbour', blurb: 'Where merchant ships tie up.', x: 33, z: 108 },
  library: { id: 'library', name: 'Lantern Hill', blurb: 'Scholars of every village share their notes here.', x: 51, z: 38 },
  market: { id: 'market', name: 'Market Green', blurb: 'Stalls, bunting and festival days.', x: 81, z: 86 },
  farmland: { id: 'farmland', name: 'Goldfurrow Fields', blurb: 'Patchwork fields along the southern road.', x: 104, z: 108 },
  industry: { id: 'industry', name: 'Millrace', blurb: 'Waterwheels and kilns along the river.', x: 43, z: 86 },
  forest: { id: 'forest', name: 'Old Wood', blurb: 'Ancient trees on the western slopes.', x: 14, z: 36 },
  quarry: { id: 'quarry', name: 'Greystep Quarry', blurb: 'Cut terraces in the northern hills.', x: 100, z: 22 },
  river: { id: 'river', name: 'Silverrun', blurb: 'The river that feeds the harbour.', x: 40, z: 24 },
  frontier: { id: 'frontier', name: 'The Far Reach', blurb: 'Unexplored country past the old fence.', x: 115, z: 64 },
};

/** Village-side bonuses granted to every member by restored Valley buildings. */
export type ValleyEffect =
  | { type: 'jobRate'; jobs: JobType[]; mult: number }
  | { type: 'storage'; mult: number }
  | { type: 'mealDuration'; mult: number }
  /** One Trading Post level: merchants call (more crates and better pay with each level). */
  | { type: 'trade' };

export interface ValleyLevelDef {
  /** Total resources the whole Valley must bring. */
  cost: Partial<Record<ResourceId, number>>;
  /** Hours of building work once everything has been delivered. */
  buildHours: number;
  effects: ValleyEffect[];
  /** One-line, player-facing description of what this level does. */
  summary: string;
}

export type ValleyBuildingId = 'hearthHall' | 'tradingPost' | 'forestersLodge' | 'minersGuild' | 'farmersGuild' | 'scholarsGuild' | 'buildersGuild' | 'craftersGuild';

export type ValleyModel = 'hall' | 'guild' | 'post';

export interface ValleyBuildingDef {
  id: ValleyBuildingId;
  name: string;
  district: DistrictId;
  description: string;
  model: ValleyModel;
  /** Banner / accent colour. */
  color: string;
  /** Centre on the Valley map, footprint radius in tiles, facing (radians, 0 = +z). */
  x: number;
  z: number;
  radius: number;
  facing: number;
  /** Must reach this before restoration can start. */
  requires: { building: ValleyBuildingId; level: number } | null;
  levels: ValleyLevelDef[];
  /** Where the camera looks when focusing this building, if not its centre. */
  view?: { x: number; z: number };
}

const guildLevels = (jobs: JobType[], craft: ResourceId, label: string): ValleyLevelDef[] => [
  {
    cost: { timber: 2400, clay: 1200 },
    buildHours: 2,
    effects: [{ type: 'jobRate', jobs, mult: 1.05 }],
    summary: `${label} +5% in every member's village`,
  },
  {
    cost: { timber: 5000, stone: 2000, [craft]: 800 },
    buildHours: 6,
    effects: [{ type: 'jobRate', jobs, mult: 1.05 }],
    summary: `${label} +5% more (×1.10 in all)`,
  },
  {
    cost: { timber: 9000, stone: 4000, planks: 1500, bricks: 1500 },
    buildHours: 12,
    effects: [{ type: 'jobRate', jobs, mult: 1.05 }],
    summary: `${label} +5% more (×1.16 in all)`,
  },
];

export const VALLEY_BUILDINGS: Record<ValleyBuildingId, ValleyBuildingDef> = {
  hearthHall: {
    id: 'hearthHall',
    name: 'Hearth Hall',
    district: 'plaza',
    description: 'The old meeting hall. Bring it back to life and the rest of the Valley follows.',
    model: 'hall',
    color: '#d9544a',
    x: 64,
    z: 62,
    radius: 4.2,
    facing: 0,
    requires: null,
    levels: [
      {
        cost: { timber: 3000, clay: 1500 },
        buildHours: 1,
        effects: [{ type: 'mealDuration', mult: 1.1 }],
        summary: 'Shared suppers: a bowl of Stew lasts 10% longer',
      },
      {
        cost: { timber: 6000, stone: 3000, planks: 1500 },
        buildHours: 4,
        effects: [{ type: 'storage', mult: 1.1 }],
        summary: 'Valley storehouse: +10% storage in every village',
      },
      {
        cost: { timber: 12000, stone: 6000, planks: 3000, bricks: 3000 },
        buildHours: 10,
        effects: [
          { type: 'mealDuration', mult: 1.1 },
          { type: 'storage', mult: 1.1 },
        ],
        summary: 'Great feasts: Stew +10% longer and storage +10% more',
      },
    ],
  },
  tradingPost: {
    id: 'tradingPost',
    name: 'Trading Post',
    district: 'harbor',
    description: 'A warehouse and pier on Saltreach bay. Restored, it brings merchant ships to every village in the Valley.',
    model: 'post',
    color: '#3f7a8c',
    x: 36,
    z: 110,
    radius: 3,
    facing: -Math.PI / 2,
    requires: { building: 'hearthHall', level: 1 },
    view: { x: 28, z: 111 },
    levels: [
      { cost: { timber: 2000, clay: 1000 }, buildHours: 2, effects: [{ type: 'trade' }], summary: 'Merchant ships call on every member: 3 crates a ship' },
      { cost: { timber: 4000, stone: 1500, planks: 800 }, buildHours: 6, effects: [{ type: 'trade' }], summary: '4 crates a ship, pay +10%, ships return sooner' },
      { cost: { timber: 8000, stone: 3000, planks: 1500, bricks: 1500 }, buildHours: 12, effects: [{ type: 'trade' }], summary: '5 crates a ship, pay +20%, ships return sooner still' },
    ],
  },
  forestersLodge: {
    id: 'forestersLodge',
    name: "Foresters' Lodge",
    district: 'guilds',
    description: 'Woodcutters from every village share tricks of the trade.',
    model: 'guild',
    color: '#5fae4f',
    x: 80,
    z: 46,
    radius: 3,
    facing: Math.PI / 2,
    requires: { building: 'hearthHall', level: 1 },
    levels: guildLevels(['chop'], 'planks', 'Woodcutting'),
  },
  minersGuild: {
    id: 'minersGuild',
    name: "Miners' Guild",
    district: 'guilds',
    description: 'Diggers and quarrymen compare picks and spades.',
    model: 'guild',
    color: '#8f97a3',
    x: 80,
    z: 53,
    radius: 3,
    facing: Math.PI / 2,
    requires: { building: 'hearthHall', level: 1 },
    levels: guildLevels(['dig', 'quarry'], 'bricks', 'Digging and quarrying'),
  },
  farmersGuild: {
    id: 'farmersGuild',
    name: "Cooks' Guild",
    district: 'guilds',
    description: 'Recipes, ovens and gossip in equal measure.',
    model: 'guild',
    color: '#e8a93a',
    x: 92,
    z: 46,
    radius: 3,
    facing: -Math.PI / 2,
    requires: { building: 'hearthHall', level: 1 },
    levels: guildLevels(['cook'], 'bricks', 'Cooking'),
  },
  scholarsGuild: {
    id: 'scholarsGuild',
    name: "Scholars' Guild",
    district: 'guilds',
    description: 'A reading room where every village’s notes end up.',
    model: 'guild',
    color: '#6f8fe0',
    x: 92,
    z: 53,
    radius: 3,
    facing: -Math.PI / 2,
    requires: { building: 'hearthHall', level: 1 },
    levels: guildLevels(['study'], 'planks', 'Study'),
  },
  buildersGuild: {
    id: 'buildersGuild',
    name: "Builders' Guild",
    district: 'guilds',
    description: 'Master builders teach the craft of raising roofs fast.',
    model: 'guild',
    color: '#9a7b62',
    x: 80,
    z: 60,
    radius: 3,
    facing: Math.PI / 2,
    requires: { building: 'hearthHall', level: 1 },
    levels: guildLevels(['build'], 'planks', 'Construction'),
  },
  craftersGuild: {
    id: 'craftersGuild',
    name: "Craftsfolk's Guild",
    district: 'guilds',
    description: 'Sawyers and brickmakers trading workshop secrets.',
    model: 'guild',
    color: '#b36fc2',
    x: 92,
    z: 60,
    radius: 3,
    facing: -Math.PI / 2,
    requires: { building: 'hearthHall', level: 1 },
    levels: guildLevels(['craft'], 'bricks', 'Crafting'),
  },
};

export const VALLEY_BUILDING_ORDER: ValleyBuildingId[] = ['hearthHall', 'tradingPost', 'forestersLodge', 'minersGuild', 'farmersGuild', 'scholarsGuild', 'buildersGuild', 'craftersGuild'];

/** Resources the Valley accepts, in display order. */
export const VALLEY_RESOURCES: ResourceId[] = ['timber', 'clay', 'stone', 'planks', 'bricks'];

export interface NeighbourDef {
  name: string;
  villageName: string;
  appearance: Appearance;
  /** Relative preference for each resource they bring. */
  focus: Partial<Record<ResourceId, number>>;
  /** Hour of day (UTC) their village goes quiet for the night. */
  sleepAt: number;
  /** Multiplier on how much they bring per visit. */
  generosity: number;
}

/** Simulated Valley members. Replaced one by one by real players in milestone 4. */
export const NEIGHBOURS: NeighbourDef[] = [
  {
    name: 'Rowan',
    villageName: 'Brackenford',
    appearance: { skin: '#e8b48f', hair: '#6b3a1f', hairStyle: 0, shirt: '#3f7a8c', trousers: '#4a3b2c', hat: 1, hatColor: '#7a5c3a' },
    focus: { timber: 3, planks: 1 },
    sleepAt: 22,
    generosity: 1.1,
  },
  {
    name: 'Ilse',
    villageName: 'Millbrook',
    appearance: { skin: '#f3d0b0', hair: '#d9a54a', hairStyle: 2, shirt: '#b8553a', trousers: '#3b4a5c', hat: 0, hatColor: '#c96b3b' },
    focus: { clay: 3, bricks: 1 },
    sleepAt: 23,
    generosity: 1,
  },
  {
    name: 'Tamsin',
    villageName: 'Copperhollow',
    appearance: { skin: '#a8714c', hair: '#1f1a17', hairStyle: 1, shirt: '#8f97a3', trousers: '#4a4038', hat: 2, hatColor: '#5b6470' },
    focus: { stone: 3, clay: 1 },
    sleepAt: 1,
    generosity: 0.9,
  },
  {
    name: 'Bram',
    villageName: 'Oakhaven',
    appearance: { skin: '#d49a72', hair: '#8a4b2a', hairStyle: 0, shirt: '#6c8c3a', trousers: '#5b4a3a', hat: 0, hatColor: '#6c8c3a' },
    focus: { timber: 2, planks: 2 },
    sleepAt: 21,
    generosity: 1.2,
  },
  {
    name: 'Linnet',
    villageName: 'Larkspur Rise',
    appearance: { skin: '#f1c7a2', hair: '#b23a2a', hairStyle: 3, shirt: '#d9a865', trousers: '#40506a', hat: 1, hatColor: '#b36fc2' },
    focus: { bricks: 2, clay: 2 },
    sleepAt: 0,
    generosity: 0.85,
  },
  {
    name: 'Odo',
    villageName: 'Fernwick',
    appearance: { skin: '#7d5236', hair: '#2f2622', hairStyle: 1, shirt: '#e8a93a', trousers: '#3a3a44', hat: 2, hatColor: '#9a7b62' },
    focus: { timber: 2, clay: 2, stone: 1 },
    sleepAt: 2,
    generosity: 1,
  },
  {
    name: 'Marigold',
    villageName: 'Hollowmere',
    appearance: { skin: '#f6d6bd', hair: '#e0c27a', hairStyle: 2, shirt: '#d97a9a', trousers: '#4f6b4a', hat: 0, hatColor: '#d9544a' },
    focus: { timber: 1, clay: 1, stone: 1, planks: 1, bricks: 1 },
    sleepAt: 23,
    generosity: 1.05,
  },
];

export const VALLEY_BALANCE = {
  /** Relative worth of each resource, for reputation and neighbours' parcel sizes. */
  value: { timber: 1, clay: 1, stone: 1.5, planks: 2.5, bricks: 3 } as Partial<Record<ResourceId, number>>,
  /** Reputation earned per point of contributed value. */
  reputationPerValue: 0.1,
  neighbours: {
    /** Value of one delivery, before generosity and Valley growth. */
    parcelValue: { min: 50, max: 150 },
    /** Minutes between deliveries while awake. */
    intervalMinutes: { min: 25, max: 70 },
    sleepHours: 8,
    /** Each finished Valley level makes neighbours' villages (and parcels) this much bigger. */
    growthPerLevel: 0.04,
  },
  /** Share of Hearth Hall level 1 already delivered when a new Valley is founded. */
  foundingProgress: 0.55,
  /** Log entries kept on the server. */
  logSize: 60,
};
