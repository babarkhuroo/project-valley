import { BASE_BOOST_ORDER, type BoostId } from '../config/trade';
import type { ResourceId } from '../config/resources';
import { addResource } from './economy';
import { addXp } from './progression';
import { buildingCenter } from './grid';
import { addHerbs } from './brewing';
import { nextOf, seedFrom } from './extrasRng';
import type { CommandResult } from './commands';
import type { EventSink } from './events';
import type { GameState, WildKind, WildSpot, WildState } from './types';
import type { World } from './world';

/**
 * Wild finds: berry bushes, mushroom rings and herb patches around the village that the player
 * taps to gather — a handful of Stew, a few coins, herbs for the Cookhouse kettle, now and then
 * a tonic. Six at a time, on dry open ground a short walk from the village; a gathered one comes
 * back somewhere else 20–45 minutes later. Gathering is instant, and everything rolls from the
 * finds' own random stream, so the simulation and its replays are untouched.
 */
export const WILDS = { spots: 6, respawnMin: 20 * 60, respawnMax: 45 * 60, nearMin: 5, nearMax: 22 };

const KINDS: [WildKind, number][] = [['berries', 0.4], ['mushrooms', 0.3], ['herbs', 0.3]];

/** Open ground: dry and flat enough to build on, with no building or resource on it. */
function free(world: World, cx: number, cz: number): boolean {
  const g = world.grid;
  if (!g.inBounds(cx, cz)) return false;
  const i = g.index(cx, cz);
  return g.terrainBuildable[i] === 1 && g.occupancy[i] === 0 && g.nodeAt[i] === 0;
}

/** Plants the finds (first time), drops any a building now stands on and fills empty places. */
export function ensureWilds(state: GameState, world: World): void {
  const wilds = (state.wilds ??= { spots: [], rng: seedFrom(state.seed, 104729, 31), nextId: 1, gathered: 0 });
  wilds.spots = wilds.spots.filter((s) => free(world, Math.floor(s.x), Math.floor(s.z)));
  let tries = 0;
  while (wilds.spots.length < WILDS.spots && tries++ < WILDS.spots * 2) {
    const spot = roll(state, world, wilds, state.time);
    if (!spot) break;
    wilds.spots.push(spot);
  }
}

/** Finds showing now. */
export const readyWilds = (state: GameState): WildSpot[] => state.wilds?.spots.filter((s) => s.readyAt <= state.time) ?? [];

/** Gathers a find: its gifts go to the village and another grows elsewhere later. */
export function gatherWild(state: GameState, world: World, spotId: number, sink: EventSink): CommandResult {
  const wilds = state.wilds;
  const spot = wilds?.spots.find((s) => s.id === spotId);
  if (!wilds || !spot || spot.readyAt > state.time) return { ok: false, error: 'Nothing to gather there yet' };
  const rand = () => nextOf(wilds);
  const gifts: Partial<Record<ResourceId | 'herbs', number>> = {};
  let coins = 0;
  let tonic: BoostId | null = null;
  switch (spot.kind) {
    case 'berries':
      gifts.stew = 4 + Math.floor(rand() * 5);
      break;
    case 'mushrooms':
      gifts.stew = 3 + Math.floor(rand() * 4);
      coins = 3 + Math.floor(rand() * 4);
      break;
    default: {
      // Herbs for the Cookhouse kettle (sim/brewing.ts), a few coins, and now and then a ready-made tonic.
      const herbs = addHerbs(state, 2 + Math.floor(rand() * 2));
      if (herbs > 0) gifts.herbs = herbs;
      coins = 2 + Math.floor(rand() * 4);
      if (rand() < 0.08) tonic = BASE_BOOST_ORDER[Math.floor(rand() * BASE_BOOST_ORDER.length) % BASE_BOOST_ORDER.length];
    }
  }
  for (const [r, n] of Object.entries(gifts) as [ResourceId | 'herbs', number][]) if (r !== 'herbs') gifts[r] = addResource(state, r, n);
  state.trade.coins += coins;
  if (tonic) state.trade.inventory[tonic] = (state.trade.inventory[tonic] ?? 0) + 1;
  wilds.gathered += 1;
  sink.push({ type: 'wildGathered', spotId: spot.id, kind: spot.kind, x: spot.x, z: spot.z, gifts, coins, tonic });
  addXp(state, 2, 'wild', sink);
  wilds.spots.splice(wilds.spots.indexOf(spot), 1);
  const next = roll(state, world, wilds, state.time + WILDS.respawnMin + rand() * (WILDS.respawnMax - WILDS.respawnMin));
  if (next) wilds.spots.push(next);
  return { ok: true };
}

/** A new find on open, dry ground a short walk from the village heart, away from the others. */
function roll(state: GameState, world: World, wilds: WildState, readyAt: number): WildSpot | null {
  const kitchen = state.buildings.find((b) => b.defId === 'cookhouse');
  const heart = kitchen ? buildingCenter(kitchen) : { x: world.grid.width / 2, z: world.grid.height / 2 };
  for (let attempt = 0; attempt < 60; attempt++) {
    const angle = nextOf(wilds) * Math.PI * 2;
    const radius = WILDS.nearMin + nextOf(wilds) * (WILDS.nearMax - WILDS.nearMin);
    const cx = Math.floor(heart.x + Math.cos(angle) * radius);
    const cz = Math.floor(heart.z + Math.sin(angle) * radius);
    if (!free(world, cx, cz) || world.terrain.pathAt(cx + 0.5, cz + 0.5) > 0.3) continue;
    const x = cx + 0.3 + nextOf(wilds) * 0.4;
    const z = cz + 0.3 + nextOf(wilds) * 0.4;
    if (wilds.spots.some((s) => Math.hypot(s.x - x, s.z - z) < 3)) continue;
    const pick = nextOf(wilds);
    let acc = 0;
    let kind: WildKind = KINDS[KINDS.length - 1][0];
    for (const [k, w] of KINDS) {
      acc += w;
      if (pick < acc) {
        kind = k;
        break;
      }
    }
    return { id: wilds.nextId++, kind, x, z, readyAt };
  }
  return null;
}
