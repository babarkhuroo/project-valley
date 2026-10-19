import { BASE_BOOST_ORDER, TRADE_GOODS } from '../config/trade';
import type { ResourceId } from '../config/resources';
import { canAfford, capacity, pay } from './economy';
import { addXp } from './progression';
import { nextOf, seedFrom } from './extrasRng';
import type { CommandResult } from './commands';
import type { EventSink } from './events';
import type { GameState, RequestBoard, VillageRequest } from './types';

/**
 * The requests board: folk from around the valley ask the village for goods ("the cartwright
 * from Elmstead needs 180 Timber to mend the market wagons"), and pay in Village XP, coins and
 * now and then a tonic. It gives full stores somewhere to go. Three requests at a time, each a
 * third to two thirds of one of the village's stores, from village level 3. A fulfilled or
 * skipped request is replaced at once, but the new one only appears after a pause (20 or 30
 * minutes). Rolled from the board's own random stream, so the simulation is untouched.
 */
export const REQUESTS = { unlockLevel: 3, slots: 3, nextAfterFulfil: 20 * 60, nextAfterSkip: 30 * 60, tonicChance: 0.3 };

/** Who's asking and why, by what they want. */
const FOLK: Partial<Record<ResourceId, [string, string][]>> = {
  timber: [['A cartwright from Elmstead', 'to mend the market wagons'], ['The ferryman at Rushford', 'for a new landing'], ['Old Maud by the mill', 'for winter firewood']],
  clay: [['A potter from Larkfield', 'for a kiln-load of jugs'], ['The thatchers at Brookend', 'to daub their new cottage'], ['A tile-maker passing through', 'for a roof of tiles']],
  stone: [['The bridge-wardens at Rushford', 'to shore up the old bridge'], ['A wall-builder from the high pastures', 'for a sheepfold'], ["The miller's family", 'for a new millstone']],
  planks: [['A boatwright from the bay', 'for a fishing boat'], ['The schoolhouse at Larkfield', 'for new benches'], ['A travelling carpenter', 'for a run of shutters']],
  bricks: [['The baker at Brookend', 'for a bigger oven'], ["A chimney-sweep's guild", 'to rebuild a chimney stack'], ['The well-keepers at Elmstead', 'to line a new well']],
  grain: [["The miller's family", 'to keep the stones turning'], ['A goose-girl from the commons', 'for her geese'], ['The brewers at Rushford', 'for the harvest ale']],
};

export const requestsUnlocked = (state: GameState): boolean => state.player.level >= REQUESTS.unlockLevel;

/** Opens the board once the village is ready and fills any empty places. Safe to call any time. */
export function ensureRequests(state: GameState): void {
  if (!requestsUnlocked(state)) return;
  const board = (state.requests ??= { slots: [], rng: seedFrom(state.seed, 7919, 17), nextId: 1, done: 0 });
  while (board.slots.length < REQUESTS.slots) {
    const r = roll(state, board, state.time);
    if (!r) break;
    board.slots.push(r);
  }
}

/** Requests up now (not still on their way). */
export const readyRequests = (state: GameState): VillageRequest[] => state.requests?.slots.filter((r) => r.readyAt <= state.time) ?? [];

/** How many ready requests the village could fulfil right now (the button's badge). */
export const requestsCanFulfil = (state: GameState): number => readyRequests(state).filter((r) => canAfford(state, r.wants)).length;

export function fulfilRequest(state: GameState, requestId: number, sink: EventSink): CommandResult {
  const r = state.requests?.slots.find((x) => x.id === requestId);
  if (!r || !state.requests) return { ok: false, error: 'That request has gone' };
  if (r.readyAt > state.time) return { ok: false, error: "That request hasn't arrived yet" };
  if (!canAfford(state, r.wants)) return { ok: false, error: 'Not enough in store yet' };
  pay(state, r.wants);
  state.trade.coins += r.coins;
  if (r.tonic) state.trade.inventory[r.tonic] = (state.trade.inventory[r.tonic] ?? 0) + 1;
  state.requests.done += 1;
  sink.push({ type: 'requestFulfilled', requestId: r.id, who: r.who, wants: r.wants, xp: r.xp, coins: r.coins, tonic: r.tonic });
  addXp(state, r.xp, 'request', sink);
  replace(state, r, REQUESTS.nextAfterFulfil);
  return { ok: true };
}

export function skipRequest(state: GameState, requestId: number): CommandResult {
  const r = state.requests?.slots.find((x) => x.id === requestId);
  if (!r) return { ok: false, error: 'That request has gone' };
  if (r.readyAt > state.time) return { ok: false, error: "That request hasn't arrived yet" };
  replace(state, r, REQUESTS.nextAfterSkip);
  return { ok: true };
}

function replace(state: GameState, old: VillageRequest, pause: number): void {
  const board = state.requests!;
  const i = board.slots.indexOf(old);
  board.slots.splice(i, 1);
  const next = roll(state, board, state.time + pause);
  if (next) board.slots.splice(i, 0, next);
}

/** A share of a store, in round fives (at least 10). */
const amount = (cap: number, share: number) => Math.max(10, Math.floor((cap * share) / 5) * 5);

/** A new request: one good (two from level 5, sometimes), a third to two thirds of a full store, paid by its trade value. */
function roll(state: GameState, board: RequestBoard, readyAt: number): VillageRequest | null {
  const goods = (Object.keys(FOLK) as ResourceId[]).filter((r) => capacity(state, r) >= 50);
  if (goods.length === 0) return null;
  const rand = () => nextOf(board);
  const first = goods[Math.floor(rand() * goods.length) % goods.length];
  const wants: Partial<Record<ResourceId, number>> = {};
  const two = state.player.level >= 5 && goods.length >= 2 && rand() < 0.4;
  if (two) {
    const rest = goods.filter((g) => g !== first);
    const second = rest[Math.floor(rand() * rest.length) % rest.length];
    for (const g of [first, second]) wants[g] = amount(capacity(state, g), 0.2 + rand() * 0.2);
  } else wants[first] = amount(capacity(state, first), 0.33 + rand() * 0.33);
  const value = (Object.entries(wants) as [ResourceId, number][]).reduce((sum, [r, n]) => sum + n * (TRADE_GOODS.find((t) => t.resource === r)?.value ?? 1), 0);
  // Someone not already waiting on the board, when there's anyone else.
  const asking = new Set(board.slots.map((s) => s.who));
  let folk = FOLK[first]!.filter(([who]) => !asking.has(who));
  if (folk.length === 0) folk = FOLK[first]!;
  const [who, why] = folk[Math.floor(rand() * folk.length) % folk.length];
  const tonic = rand() < REQUESTS.tonicChance ? BASE_BOOST_ORDER[Math.floor(rand() * BASE_BOOST_ORDER.length) % BASE_BOOST_ORDER.length] : null;
  return { id: board.nextId++, who, why, wants, coins: Math.max(5, Math.round(value * 0.45)), xp: Math.max(5, Math.round(value * 0.5)), tonic, readyAt };
}
