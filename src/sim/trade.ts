import { BOOSTS, MERCHANTS, REPUTATION_ROAD, TRADE_BALANCE, TRADE_GOODS, TRADING_POST_LEVELS, type BoostId } from '../config/trade';
import type { JobType } from '../config/jobs';
import type { ResourceId } from '../config/resources';
import { mulberry32 } from '../world/noise';
import type { CommandResult } from './commands';
import { bumpStat, capacity } from './economy';
import type { EventSink } from './events';
import type { GameState, MerchantCrate, MerchantShip, MerchantWare } from './types';
import { sendKnowledge } from './valley';

/**
 * Merchant ships, tonics and the Reputation Road — the village side of trading.
 * Ships are timers in the village simulation (arrive → wait in port → sail), seeded
 * from the village RNG, so they come and go during offline catch-up exactly as they
 * would on screen. Merchants call only once the Valley's Trading Post is restored.
 */

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

function rand(state: GameState): number {
  const [v, next] = mulberry32(state.rng);
  state.rng = next;
  return v;
}

function postLevel(state: GameState) {
  const level = state.valley.bonuses.tradeLevel;
  return level > 0 ? TRADING_POST_LEVELS[Math.min(level, TRADING_POST_LEVELS.length) - 1] : null;
}

export function tradeOpen(state: GameState): boolean {
  return state.valley.bonuses.tradeLevel > 0;
}

/** Goods this village could supply right now. */
export function tradeGoods(state: GameState): (typeof TRADE_GOODS)[number][] {
  return TRADE_GOODS.filter((g) => (!g.requires || state.research.completed.includes(g.requires)) && capacity(state, g.resource) > 0);
}

function weightedPick<T>(state: GameState, items: T[], weight: (t: T) => number): T {
  const total = items.reduce((s, it) => s + weight(it), 0);
  let roll = rand(state) * total;
  for (const it of items) {
    roll -= weight(it);
    if (roll <= 0) return it;
  }
  return items[items.length - 1];
}

function rollShip(state: GameState): MerchantShip {
  const post = postLevel(state)!;
  const merchant = Math.floor(rand(state) * MERCHANTS.length) % MERCHANTS.length;
  const def = MERCHANTS[merchant];
  const B = TRADE_BALANCE;
  const pool = tradeGoods(state);
  const crates: MerchantCrate[] = [];
  const asked = new Map<ResourceId, number>();
  for (let i = 0; i < post.crates; i++) {
    // Favour goods the merchant likes and spread requests across the village's goods.
    const good = weightedPick(state, pool, (g) => (def.likes.includes(g.resource) ? 3 : 1) / (1 + (asked.get(g.resource) ?? 0) * 2));
    asked.set(good.resource, (asked.get(good.resource) ?? 0) + 1);
    const value = (B.crateValue.base + B.crateValue.perLevel * state.player.level) * (1 + (rand(state) * 2 - 1) * B.crateValue.spread);
    const cap = Math.max(5, Math.floor(capacity(state, good.resource) * B.maxShareOfStorage));
    const amount = Math.max(5, Math.min(cap, Math.round(value / good.value / 5) * 5));
    const realValue = amount * good.value;
    // Prices swing: some crates are a bargain, some barely worth the goods.
    const coins = Math.max(1, Math.round(realValue * B.coinsPerValue * def.premium * post.pay * state.valley.bonuses.tradePayMult * (1 + (rand(state) * 2 - 1) * B.priceSpread)));
    crates.push({
      resource: good.resource,
      amount,
      coins,
      reputation: Math.max(1, Math.round(realValue * B.reputationPerValue)),
      knowledge: Math.max(1, Math.round(realValue * B.knowledgePerValue)),
      filled: false,
    });
  }
  const boosts = Object.keys(BOOSTS) as BoostId[];
  const wares: MerchantWare[] = [];
  while (wares.length < B.wares) {
    const boost = boosts[Math.floor(rand(state) * boosts.length) % boosts.length];
    if (wares.some((w) => w.boost === boost)) continue;
    const price = Math.round((BOOSTS[boost].price * (1 + (rand(state) * 2 - 1) * B.priceHaggle)) / 5) * 5;
    wares.push({ boost, price, stock: 1 + Math.floor(rand(state) * 2) });
  }
  return {
    id: state.nextId++,
    merchant,
    arrivedAt: state.time,
    leavesAt: state.time + B.stayHours * 3600,
    crates,
    wares,
    bonusPaid: false,
  };
}

/** Next time something trade-related happens (arrival, departure, a tonic wearing off). */
export function tradeNextEvent(state: GameState): number {
  const t = state.trade;
  let next = Infinity;
  if (t.ship) next = t.ship.leavesAt;
  else if (t.nextShipAt !== null) next = t.nextShipAt;
  else if (tradeOpen(state)) next = state.time; // schedule the first ship now
  for (const a of t.active) if (a.until < next) next = a.until;
  return next;
}

/** Handles whatever trade timers are due. Returns true if anything changed. */
export function processTrade(state: GameState, sink: EventSink, eps: number): boolean {
  const t = state.trade;
  let acted = false;
  for (let i = t.active.length - 1; i >= 0; i--) {
    if (t.active[i].until <= state.time + eps) {
      sink.push({ type: 'boostEnded', boost: t.active[i].boost });
      t.active.splice(i, 1);
      acted = true;
    }
  }
  if (!tradeOpen(state)) return acted;
  if (t.ship && t.ship.leavesAt <= state.time + eps) {
    sink.push({ type: 'shipLeft', merchant: t.ship.merchant, filled: t.ship.crates.filter((c) => c.filled).length });
    t.ship = null;
    const { min, max } = TRADE_BALANCE.gapHours;
    t.nextShipAt = state.time + (min + rand(state) * (max - min)) * 3600 * postLevel(state)!.gap * state.valley.bonuses.tradeGapMult;
    acted = true;
  }
  if (!t.ship && t.nextShipAt === null) {
    t.nextShipAt = state.time + TRADE_BALANCE.firstShipDelay;
    acted = true;
  }
  if (!t.ship && t.nextShipAt !== null && t.nextShipAt <= state.time + eps) {
    t.ship = rollShip(state);
    t.nextShipAt = null;
    t.shipsSeen += 1;
    sink.push({ type: 'shipArrived', merchant: t.ship.merchant, crates: t.ship.crates.length });
    acted = true;
  }
  return acted;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function fillCrate(state: GameState, index: number, sink: EventSink): CommandResult {
  const ship = state.trade.ship;
  if (!ship) return fail('No ship in port');
  const crate = ship.crates[index];
  if (!crate) return fail('No such crate');
  if (crate.filled) return fail('Already filled');
  if (state.resources[crate.resource] < crate.amount) return fail(`Needs ${crate.amount} ${crate.resource}`);
  state.resources[crate.resource] -= crate.amount;
  crate.filled = true;
  state.trade.coins += crate.coins;
  state.valley.reputation += crate.reputation;
  bumpStat(state, 'trade.crates');
  bumpStat(state, `traded.${crate.resource}`, crate.amount);
  // The Valley's research gets the crate's Knowledge (queued like any Valley delivery).
  sendKnowledge(state, crate.knowledge ?? 0, `k-${ship.id}-${index}`);
  sink.push({ type: 'crateFilled', resource: crate.resource, amount: crate.amount, coins: crate.coins, reputation: crate.reputation });
  if (!ship.bonusPaid && ship.crates.every((c) => c.filled)) {
    ship.bonusPaid = true;
    const coins = Math.round(ship.crates.reduce((s, c) => s + c.coins, 0) * TRADE_BALANCE.fullShipBonus.coinShare);
    state.trade.coins += coins;
    state.valley.reputation += TRADE_BALANCE.fullShipBonus.reputation;
    sink.push({ type: 'shipComplete', merchant: ship.merchant, coins, reputation: TRADE_BALANCE.fullShipBonus.reputation });
  }
  return { ok: true };
}

export function buyWare(state: GameState, index: number, sink: EventSink): CommandResult {
  const ware = state.trade.ship?.wares[index];
  if (!ware) return fail('Nothing for sale');
  if (ware.stock <= 0) return fail('Sold out');
  if (state.trade.coins < ware.price) return fail(`Needs ${ware.price} coins`);
  state.trade.coins -= ware.price;
  ware.stock -= 1;
  state.trade.inventory[ware.boost] = (state.trade.inventory[ware.boost] ?? 0) + 1;
  sink.push({ type: 'boostBought', boost: ware.boost });
  return { ok: true };
}

/** Drinks a tonic: starts it, or extends it if one is already working. */
export function useBoost(state: GameState, boost: BoostId, sink: EventSink): CommandResult {
  const have = state.trade.inventory[boost] ?? 0;
  if (have <= 0) return fail(`No ${BOOSTS[boost].name} left`);
  state.trade.inventory[boost] = have - 1;
  const running = state.trade.active.find((a) => a.boost === boost);
  if (running) running.until += BOOSTS[boost].seconds;
  else state.trade.active.push({ boost, until: state.time + BOOSTS[boost].seconds });
  sink.push({ type: 'boostStarted', boost });
  return { ok: true };
}

/** Combined multiplier from active tonics for a job, and their names (for rate breakdowns). */
export function boostFor(state: GameState, job: JobType): { mult: number; names: string[] } {
  let mult = 1;
  const names: string[] = [];
  for (const a of state.trade.active) {
    const def = BOOSTS[a.boost];
    if (def.jobs.includes(job)) {
      mult *= def.mult;
      names.push(def.name);
    }
  }
  return { mult, names };
}

export function nextRoadMilestone(state: GameState): (typeof REPUTATION_ROAD)[number] | null {
  return REPUTATION_ROAD[state.trade.roadClaimed] ?? null;
}

export function canClaimRoad(state: GameState): boolean {
  const next = nextRoadMilestone(state);
  return !!next && state.valley.reputation >= next.at;
}

/** Claims the next Reputation Road reward. Resource rewards may overfill storage — gifts aren't wasted. */
export function claimRoadReward(state: GameState, sink: EventSink): CommandResult {
  const next = nextRoadMilestone(state);
  if (!next) return fail('The road is complete');
  if (state.valley.reputation < next.at) return fail(`Needs ${next.at} reputation`);
  const r = next.reward;
  switch (r.type) {
    case 'coins':
      state.trade.coins += r.amount;
      break;
    case 'boost':
      state.trade.inventory[r.boost] = (state.trade.inventory[r.boost] ?? 0) + r.count;
      break;
    case 'resources':
      for (const [res, n] of Object.entries(r.resources) as [ResourceId, number][]) state.resources[res] += n;
      break;
    case 'decor':
      if (!state.trade.unlockedDecor.includes(r.building)) state.trade.unlockedDecor.push(r.building);
      break;
  }
  state.trade.roadClaimed += 1;
  sink.push({ type: 'roadReward', index: state.trade.roadClaimed - 1 });
  return { ok: true };
}
