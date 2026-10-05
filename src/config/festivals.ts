import type { BuildingId } from './buildings';
import type { ResourceId } from './resources';

/**
 * Rotating cooperative events at Market Green. Once the Festival Grounds are restored,
 * the Valley holds a festival every few days: a shared goal to deliver within 48 hours.
 * If the Valley makes it, every member who helped gets the rewards.
 */

export type FestivalId = 'harvestFestival' | 'greatBuild' | 'expeditionSupplies' | 'lanternFair';

export interface FestivalDef {
  id: FestivalId;
  name: string;
  description: string;
  goal: Partial<Record<ResourceId, number>>;
  reward: { coins: number; reputation: number; knowledge: number };
  /** Decoration a member unlocks the first time they help this festival succeed. */
  decor?: BuildingId;
  color: string;
}

export const FESTIVALS: Record<FestivalId, FestivalDef> = {
  harvestFestival: {
    id: 'harvestFestival',
    name: 'Harvest Festival',
    description: 'Long tables on Market Green and a pot from every village. Bring Stew for the feast!',
    goal: { stew: 2500, timber: 3000 },
    reward: { coins: 180, reputation: 40, knowledge: 150 },
    decor: 'festivalLanterns',
    color: '#e8a93a',
  },
  greatBuild: {
    id: 'greatBuild',
    name: 'Great Construction Project',
    description: 'All hands to raise a new bandstand in a weekend. Timber and stone, as much as you can spare.',
    goal: { timber: 5000, stone: 2500 },
    reward: { coins: 220, reputation: 50, knowledge: 200 },
    color: '#9a7b62',
  },
  expeditionSupplies: {
    id: 'expeditionSupplies',
    name: 'Expedition Supplies',
    description: 'Scouts are heading for the Far Reach. They need planks for rafts and Stew for the road.',
    goal: { planks: 1200, stew: 1500 },
    reward: { coins: 250, reputation: 50, knowledge: 220 },
    color: '#5fae4f',
  },
  lanternFair: {
    id: 'lanternFair',
    name: 'Lantern Fair',
    description: 'A night market lit by a thousand lanterns. Bricks for the stalls, clay for the lamps.',
    goal: { bricks: 900, clay: 2500 },
    reward: { coins: 240, reputation: 50, knowledge: 200 },
    decor: 'festivalLanterns',
    color: '#b36fc2',
  },
};

export const FESTIVAL_ORDER: FestivalId[] = ['harvestFestival', 'greatBuild', 'expeditionSupplies', 'lanternFair'];

export const FESTIVAL_BALANCE = {
  durationHours: 48,
  /** Hours from one festival ending to the next starting. */
  gapHours: { min: 24, max: 48 },
  /** Hours after the Festival Grounds open before the first festival. */
  firstDelayHours: 1,
  /** Chance a neighbour's visit goes to a running festival rather than a project. */
  neighbourShare: 0.35,
};
