import { describe, expect, it } from 'vitest';
import { BOOSTS, REPUTATION_ROAD, TRADE_BALANCE, TRADING_POST_LEVELS } from '../src/config/trade';
import { assignVillager } from '../src/sim/commands';
import { capacity } from '../src/sim/economy';
import { isBuildingUnlocked } from '../src/sim/modifiers';
import { migrate, SAVE_VERSION } from '../src/sim/save';
import { buyWare, claimRoadReward, fillCrate, tradeGoods, useBoost } from '../src/sim/trade';
import { workRateBreakdown } from '../src/sim/villagerAI';
import { cloneGame, makeGame, nearestNode, villager, type Harness } from './helpers';

function trading(level = 1): Harness {
  const h = makeGame();
  h.state.valley.bonuses.tradeLevel = level;
  return h;
}

describe('merchant ships', () => {
  it('only call once the Valley has a Trading Post', () => {
    const h = makeGame();
    h.run(6 * 3600);
    expect(h.state.trade.ship).toBeNull();
    expect(h.state.trade.shipsSeen).toBe(0);
  });

  it('arrive, wait in port, sail, and come back after a gap', () => {
    const h = trading();
    h.run(TRADE_BALANCE.firstShipDelay - 1);
    expect(h.state.trade.ship).toBeNull();
    h.run(2);
    const ship = h.state.trade.ship!;
    expect(ship).not.toBeNull();
    expect(ship.crates).toHaveLength(TRADING_POST_LEVELS[0].crates);
    expect(h.events.some((e) => e.type === 'shipArrived')).toBe(true);
    h.run(TRADE_BALANCE.stayHours * 3600);
    expect(h.state.trade.ship).toBeNull();
    expect(h.state.trade.nextShipAt).toBeGreaterThan(h.state.time + TRADE_BALANCE.gapHours.min * 3600 - 10);
    h.run(TRADE_BALANCE.gapHours.max * 3600 + 1);
    expect(h.state.trade.shipsSeen).toBe(2);
  });

  it('a better Trading Post brings more crates', () => {
    const h = trading(3);
    h.run(TRADE_BALANCE.firstShipDelay + 1);
    expect(h.state.trade.ship!.crates).toHaveLength(TRADING_POST_LEVELS[2].crates);
  });

  it('asks only for goods the village can make, within its storage', () => {
    const h = trading();
    h.run(TRADE_BALANCE.firstShipDelay + 1);
    const goods = tradeGoods(h.state).map((g) => g.resource);
    for (const c of h.state.trade.ship!.crates) {
      expect(goods).toContain(c.resource);
      expect(c.amount).toBeLessThanOrEqual(Math.max(5, capacity(h.state, c.resource)));
      expect(c.coins).toBeGreaterThan(0);
    }
    expect(goods).not.toContain('bricks');
  });

  it('is deterministic: ships and tonics replay identically in one step or many', () => {
    const a = trading();
    assignVillager(a.state, a.world, villager(a).id, { kind: 'gather', nodeId: nearestNode(a, 'tree').id }, a.events);
    a.state.trade.inventory.woodTonic = 1;
    useBoost(a.state, 'woodTonic', a.events);
    const b = cloneGame(a);
    a.run(9 * 3600);
    b.run(9 * 3600, 37);
    expect(b.state).toEqual(a.state);
    expect(a.state.trade.shipsSeen).toBeGreaterThan(0);
  });
});

describe('crates and coins', () => {
  it('filling crates pays coins and reputation, with a bonus for a full ship', () => {
    const h = trading();
    h.run(TRADE_BALANCE.firstShipDelay + 1);
    const ship = h.state.trade.ship!;
    expect(fillCrate(h.state, 0, h.events).ok).toBe(ship.crates[0].amount <= h.state.resources[ship.crates[0].resource]);
    for (const c of ship.crates) h.state.resources[c.resource] = Math.max(h.state.resources[c.resource], c.amount) + 1000;
    const coinsBefore = h.state.trade.coins;
    const repBefore = h.state.valley.reputation;
    for (let i = 0; i < ship.crates.length; i++) fillCrate(h.state, i, h.events);
    expect(ship.crates.every((c) => c.filled)).toBe(true);
    expect(fillCrate(h.state, 0, h.events).ok).toBe(false);
    const paid = ship.crates.reduce((s, c) => s + c.coins, 0);
    expect(h.state.trade.coins).toBeGreaterThan(coinsBefore);
    expect(h.state.trade.coins).toBeGreaterThanOrEqual(paid);
    expect(h.state.valley.reputation).toBeGreaterThan(repBefore + TRADE_BALANCE.fullShipBonus.reputation - 1);
    expect(h.events.some((e) => e.type === 'shipComplete')).toBe(true);
  });

  it('refuses crates the village cannot fill', () => {
    const h = trading();
    h.run(TRADE_BALANCE.firstShipDelay + 1);
    const c = h.state.trade.ship!.crates[0];
    h.state.resources[c.resource] = 0;
    expect(fillCrate(h.state, 0, h.events).ok).toBe(false);
    expect(h.state.trade.coins).toBe(0);
  });

  it('buys tonics with coins while stock lasts', () => {
    const h = trading();
    h.run(TRADE_BALANCE.firstShipDelay + 1);
    const ware = h.state.trade.ship!.wares[0];
    expect(buyWare(h.state, 0, h.events).ok).toBe(false);
    h.state.trade.coins = ware.price * 5;
    for (let i = 0; i < ware.stock + 1; i++) buyWare(h.state, 0, h.events);
    expect(h.state.trade.ship!.wares[0].stock).toBe(0);
    expect(h.state.trade.inventory[ware.boost]).toBeGreaterThan(0);
  });
});

describe('tonics', () => {
  it('speed up their job, stack in time and wear off on schedule', () => {
    const h = makeGame();
    const v = villager(h);
    const base = workRateBreakdown(h.state, v, 'chop').rate;
    expect(useBoost(h.state, 'woodTonic', h.events).ok).toBe(false);
    h.state.trade.inventory.woodTonic = 2;
    useBoost(h.state, 'woodTonic', h.events);
    useBoost(h.state, 'woodTonic', h.events);
    expect(workRateBreakdown(h.state, v, 'chop').rate).toBeCloseTo(base * BOOSTS.woodTonic.mult);
    expect(workRateBreakdown(h.state, v, 'cook').rate).toBeCloseTo(workRateBreakdown(makeGame().state, v, 'cook').rate);
    h.run(BOOSTS.woodTonic.seconds * 2 - 1);
    expect(h.state.trade.active).toHaveLength(1);
    h.run(2);
    expect(h.state.trade.active).toHaveLength(0);
    expect(workRateBreakdown(h.state, v, 'chop').rate).toBeCloseTo(base);
  });
});

describe('reputation road', () => {
  it('pays out milestones in order once reputation allows', () => {
    const h = makeGame();
    expect(claimRoadReward(h.state, h.events).ok).toBe(false);
    h.state.valley.reputation = REPUTATION_ROAD[2].at;
    expect(isBuildingUnlocked(h.state, 'valleyBanner')).toBe(false);
    expect(claimRoadReward(h.state, h.events).ok).toBe(true);
    expect(h.state.trade.coins).toBe((REPUTATION_ROAD[0].reward as { amount: number }).amount);
    expect(claimRoadReward(h.state, h.events).ok).toBe(true);
    expect(h.state.trade.inventory.woodTonic).toBe(2);
    expect(claimRoadReward(h.state, h.events).ok).toBe(true);
    expect(isBuildingUnlocked(h.state, 'valleyBanner')).toBe(true);
    expect(claimRoadReward(h.state, h.events).ok).toBe(false);
    expect(h.state.trade.roadClaimed).toBe(3);
  });

  it('migrates version-4 saves', () => {
    const out = migrate({ schemaVersion: 4, valley: { valleyId: 'v', reputation: 3, outbox: [], given: {}, bonuses: { jobRate: {}, storageMult: 1, mealDurationMult: 1 } } });
    expect(out.schemaVersion).toBe(SAVE_VERSION);
    expect(out.trade).toMatchObject({ coins: 0, ship: null, roadClaimed: 0 });
    expect((out.valley as { bonuses: { tradeLevel: number } }).bonuses.tradeLevel).toBe(0);
  });
});
