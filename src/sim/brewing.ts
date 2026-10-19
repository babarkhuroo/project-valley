import { BOOSTS, type BaseBoostId, type BoostId } from '../config/trade';
import { BUILDINGS } from '../config/buildings';
import { RESOURCES, type ResourceId } from '../config/resources';
import { canAfford, capacity, pay } from './economy';
import type { CommandResult } from './commands';
import type { EventSink } from './events';
import type { BrewState, GameState } from './types';

/**
 * Brewing tonics in the Cookhouse kettle: herbs from the wild herb patches, Stew and the good
 * each tonic is made from, plus coins for the stronger brews. Ordinary brews (+50%, 30 min) from
 * Cookhouse level 1, Strong (+75%, 45 min) from level 2, Grand (+100%, an hour) from level 3; a
 * second kettle at level 4. A brew simmers 15, 30 or 45 minutes and then goes into the satchel.
 * Timed rather than worked, so it never touches the villagers' simulation.
 */
export const BREWING = { unlockLevel: 3, strengths: 3, herbPouch: 30 };
const HERB_COST = [2, 4, 7];
const STEW_COST = [10, 20, 35];
const COIN_COST = [0, 25, 60];
const MINUTES = [15, 30, 45];
const SUFFIX = ['', 'Strong', 'Grand'];

/** The good each tonic is brewed from. */
export const BREW_BASE: Record<BaseBoostId, ResourceId> = {
  woodTonic: 'timber',
  minersMeal: 'clay',
  farmersTea: 'grain',
  researchBrew: 'knowledge',
  buildersBrew: 'planks',
  craftersOil: 'bricks',
};

const goodCost = (r: ResourceId, strength: number) => (r === 'knowledge' ? 10 * strength : [15, 30, 50][strength - 1]);
const kitchen = (state: GameState) => state.buildings.find((b) => b.defId === 'cookhouse' && b.status === 'complete') ?? null;

export const brewingUnlocked = (state: GameState): boolean => state.player.level >= BREWING.unlockLevel && kitchen(state) !== null;
/** Kettles at the Cookhouse: two from level 4. */
export const kettles = (state: GameState): number => ((kitchen(state)?.level ?? 1) >= 4 ? 2 : 1);
/** The strongest brew the Cookhouse can make (1–3). */
export const maxStrength = (state: GameState): number => Math.min(BREWING.strengths, Math.max(1, kitchen(state)?.level ?? 1));
export const herbs = (state: GameState): number => state.brewing?.herbs ?? 0;
/** The tonic a brew makes: the ordinary one, or its Strong or Grand version. */
export const variant = (tonic: BaseBoostId, strength: number): BoostId => `${tonic}${SUFFIX[strength - 1]}` as BoostId;
export const brewSeconds = (strength: number): number => MINUTES[strength - 1] * 60;

/** What a brew takes from the stores (Stew and its good), its herbs and its coins. */
export function brewCost(tonic: BaseBoostId, strength: number): { goods: Partial<Record<ResourceId, number>>; herbs: number; coins: number } {
  const goods: Partial<Record<ResourceId, number>> = { stew: STEW_COST[strength - 1] };
  const good = BREW_BASE[tonic];
  goods[good] = (goods[good] ?? 0) + goodCost(good, strength);
  return { goods, herbs: HERB_COST[strength - 1], coins: COIN_COST[strength - 1] };
}

const brewState = (state: GameState): BrewState => (state.brewing ??= { herbs: 0, kettles: [], brewed: 0 });

/** Herbs into the pouch (from the wild herb patches); the pouch holds 30. */
export function addHerbs(state: GameState, n: number): number {
  const b = brewState(state);
  const take = Math.max(0, Math.min(n, BREWING.herbPouch - b.herbs));
  b.herbs += take;
  return take;
}

/** Why this brew can't start now, or null. */
export function brewBlocker(state: GameState, tonic: BaseBoostId, strength: number): string | null {
  if (!brewingUnlocked(state)) return `Brewing opens at village level ${BREWING.unlockLevel}`;
  if (!(tonic in BREW_BASE) || strength < 1 || strength > BREWING.strengths) return 'Unknown brew';
  if (strength > maxStrength(state)) return `Needs a level ${strength} ${BUILDINGS.cookhouse.name}`;
  if ((state.brewing?.kettles.length ?? 0) >= kettles(state)) return 'The kettle is busy';
  const cost = brewCost(tonic, strength);
  if (capacity(state, BREW_BASE[tonic]) <= 0) return `Needs somewhere to store ${RESOURCES[BREW_BASE[tonic]].name}`;
  if (herbs(state) < cost.herbs) return 'Not enough herbs — gather them from herb patches';
  if (state.trade.coins < cost.coins) return 'Not enough coins';
  if (!canAfford(state, cost.goods)) return 'Not enough in store';
  return null;
}

export function brew(state: GameState, tonic: BaseBoostId, strength: number): CommandResult {
  const why = brewBlocker(state, tonic, strength);
  if (why) return { ok: false, error: why };
  const cost = brewCost(tonic, strength);
  const b = brewState(state);
  pay(state, cost.goods);
  b.herbs -= cost.herbs;
  state.trade.coins -= cost.coins;
  b.kettles.push({ tonic: variant(tonic, strength), doneAt: state.time + brewSeconds(strength) });
  return { ok: true };
}

/** Finished brews go into the satchel. Safe to call any time (also after time away). */
export function settleBrewing(state: GameState, sink: EventSink): void {
  const b = state.brewing;
  if (!b) return;
  for (const k of b.kettles.filter((k) => k.doneAt <= state.time)) {
    b.kettles.splice(b.kettles.indexOf(k), 1);
    state.trade.inventory[k.tonic] = (state.trade.inventory[k.tonic] ?? 0) + 1;
    b.brewed += 1;
    sink.push({ type: 'tonicBrewed', tonic: k.tonic });
  }
}

export const brewName = (tonic: BoostId): string => BOOSTS[tonic].name;
