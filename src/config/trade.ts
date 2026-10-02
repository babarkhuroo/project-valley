import type { BuildingId } from './buildings';
import type { JobType } from './jobs';
import type { ResearchId } from './research';
import type { ResourceId } from './resources';

/**
 * Merchants, boosts and the Reputation Road. Merchant ships call at the Valley's
 * Trading Post once it's restored; each brings crates to fill (goods → coins and
 * reputation) and a few tonics for sale. All timing is in village sim seconds, so
 * ships come and go while the player is away exactly as they would on screen.
 */

export interface MerchantDef {
  name: string;
  ship: string;
  /** Sail and pennant colour. */
  color: string;
  /** Goods this merchant asks for more often. */
  likes: ResourceId[];
  /** Pay multiplier: some merchants are generous, some drive a hard bargain. */
  premium: number;
}

export const MERCHANTS: MerchantDef[] = [
  { name: 'Captain Mabel Quill', ship: "the Gull's Promise", color: '#d9544a', likes: ['timber', 'planks'], premium: 1.0 },
  { name: 'Peregrine Stout', ship: 'the Amber Lantern', color: '#e8a93a', likes: ['bricks', 'clay'], premium: 1.15 },
  { name: 'The Brine Sisters', ship: 'the Twin Herons', color: '#6f8fe0', likes: ['stone', 'bricks'], premium: 0.95 },
  { name: 'Old Hollis', ship: 'the Patient Otter', color: '#5fae4f', likes: ['stew', 'timber'], premium: 0.9 },
  { name: 'Juniper Vale', ship: 'the Silver Thimble', color: '#b36fc2', likes: ['planks', 'stone'], premium: 1.1 },
];

/** Goods merchants may ask for, and the research that makes each available to the village. */
export const TRADE_GOODS: { resource: ResourceId; requires: ResearchId | null; value: number }[] = [
  { resource: 'timber', requires: null, value: 1 },
  { resource: 'stew', requires: null, value: 1.2 },
  { resource: 'clay', requires: 'clayDigging', value: 1 },
  { resource: 'stone', requires: 'stonecutting', value: 1.5 },
  { resource: 'planks', requires: 'carpentry', value: 2.5 },
  { resource: 'bricks', requires: 'brickmaking', value: 3 },
];

export type BoostId = 'woodTonic' | 'minersMeal' | 'farmersTea' | 'researchBrew' | 'buildersBrew' | 'craftersOil';

export interface BoostDef {
  id: BoostId;
  name: string;
  description: string;
  jobs: JobType[];
  /** Work-rate multiplier while active. */
  mult: number;
  /** Sim seconds per dose (taking another extends it). */
  seconds: number;
  /** Merchant's asking price in coins, before haggling. */
  price: number;
  color: string;
}

export const BOOSTS: Record<BoostId, BoostDef> = {
  woodTonic: { id: 'woodTonic', name: 'Woodworker Tonic', description: 'Woodcutting +50% for 30 minutes.', jobs: ['chop'], mult: 1.5, seconds: 1800, price: 60, color: '#7aa84f' },
  minersMeal: { id: 'minersMeal', name: "Miner's Meal", description: 'Digging and quarrying +50% for 30 minutes.', jobs: ['dig', 'quarry'], mult: 1.5, seconds: 1800, price: 70, color: '#c7764a' },
  farmersTea: { id: 'farmersTea', name: "Farmer's Tea", description: 'Cooking +50% for 30 minutes.', jobs: ['cook'], mult: 1.5, seconds: 1800, price: 50, color: '#e0b040' },
  researchBrew: { id: 'researchBrew', name: 'Research Brew', description: 'Study +50% for 30 minutes.', jobs: ['study'], mult: 1.5, seconds: 1800, price: 80, color: '#6f8fe0' },
  buildersBrew: { id: 'buildersBrew', name: "Builder's Brew", description: 'Construction +50% for 30 minutes.', jobs: ['build'], mult: 1.5, seconds: 1800, price: 70, color: '#9a7b62' },
  craftersOil: { id: 'craftersOil', name: "Crafter's Oil", description: 'Workshop crafting +50% for 30 minutes.', jobs: ['craft'], mult: 1.5, seconds: 1800, price: 70, color: '#b36fc2' },
};

export const BOOST_ORDER: BoostId[] = ['woodTonic', 'minersMeal', 'farmersTea', 'researchBrew', 'buildersBrew', 'craftersOil'];

/** What each Trading Post level does for every member's merchant visits. */
export const TRADING_POST_LEVELS = [
  { crates: 3, pay: 1, gap: 1 },
  { crates: 4, pay: 1.1, gap: 0.85 },
  { crates: 5, pay: 1.2, gap: 0.7 },
];

export const TRADE_BALANCE = {
  /** Seconds after the Trading Post opens before the first ship. */
  firstShipDelay: 600,
  /** How long a ship stays in port. */
  stayHours: 4,
  /** Hours between one ship leaving and the next arriving (before Trading Post bonuses). */
  gapHours: { min: 2, max: 5 },
  /** Value of one crate: base + perLevel × village level, ± spread. */
  crateValue: { base: 40, perLevel: 30, spread: 0.3 },
  /** A crate never asks for more than this share of the village's storage for that good. */
  maxShareOfStorage: 0.8,
  /** Coins per point of crate value; each crate's price swings by ± priceSpread. */
  coinsPerValue: 0.6,
  priceSpread: 0.35,
  reputationPerValue: 0.05,
  /** Bonus for filling every crate: share of the crates' coins, plus flat reputation. */
  fullShipBonus: { coinShare: 0.25, reputation: 10 },
  /** Tonics on sale per ship, and the haggling range on their price. */
  wares: 2,
  priceHaggle: 0.15,
};

export type RoadReward =
  | { type: 'coins'; amount: number }
  | { type: 'boost'; boost: BoostId; count: number }
  | { type: 'resources'; resources: Partial<Record<ResourceId, number>> }
  | { type: 'decor'; building: BuildingId };

/** Reputation Road: milestones reached by helping the Valley and trading. Claimed in order. */
export const REPUTATION_ROAD: { at: number; reward: RoadReward }[] = [
  { at: 25, reward: { type: 'coins', amount: 50 } },
  { at: 75, reward: { type: 'boost', boost: 'woodTonic', count: 2 } },
  { at: 150, reward: { type: 'decor', building: 'valleyBanner' } },
  { at: 250, reward: { type: 'resources', resources: { planks: 40, bricks: 40 } } },
  { at: 400, reward: { type: 'coins', amount: 150 } },
  { at: 600, reward: { type: 'boost', boost: 'researchBrew', count: 2 } },
  { at: 850, reward: { type: 'decor', building: 'fountain' } },
  { at: 1150, reward: { type: 'boost', boost: 'buildersBrew', count: 3 } },
  { at: 1500, reward: { type: 'coins', amount: 300 } },
  { at: 2000, reward: { type: 'resources', resources: { stone: 150, planks: 100, bricks: 100 } } },
  { at: 2600, reward: { type: 'boost', boost: 'minersMeal', count: 3 } },
  { at: 3300, reward: { type: 'coins', amount: 500 } },
];
