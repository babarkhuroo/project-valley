import { describe, expect, it } from 'vitest';
import { VALLEY_BALANCE, VALLEY_BUILDINGS } from '../src/config/valley';
import { capacity } from '../src/sim/economy';
import { mealDuration } from '../src/sim/modifiers';
import { migrate, SAVE_VERSION } from '../src/sim/save';
import { inTransit, joinValley, sendToValley, setValleyBonuses, settleValleyOp } from '../src/sim/valley';
import { workRateBreakdown } from '../src/sim/villagerAI';
import { advanceValley, ageValley, contribute, createValley, deliveredFraction, remainingFor, snapshotOf, valleyBonuses } from '../src/valley/valleySim';
import { MemoryValleyStore, ValleyService } from '../server/valleyService.ts';
import { makeGame, villager } from './helpers';

const T0 = Date.UTC(2026, 9, 2, 12);
const HOUR = 3_600_000;
const player = { id: 'p-test-player', name: 'Founder', villageName: 'Thistledown' };
const fresh = () => createValley('v-test', 4242, T0, player);

describe('valley simulation', () => {
  it('founds a Valley with neighbours already at work on Hearth Hall', () => {
    const v = fresh();
    expect(v.members.filter((m) => m.kind === 'simulated')).toHaveLength(7);
    expect(v.members.some((m) => m.id === player.id)).toBe(true);
    expect(deliveredFraction(v.buildings.hearthHall)).toBeCloseTo(VALLEY_BALANCE.foundingProgress, 1);
    expect(v.buildings.hearthHall.status).toBe('collecting');
    expect(v.buildings.forestersLodge.status).toBe('locked');
  });

  it('is deterministic: one big advance equals many small ones', () => {
    const a = fresh();
    const b = fresh();
    advanceValley(a, T0 + 72 * HOUR);
    for (let t = T0; t <= T0 + 72 * HOUR; t += 7 * 60_000) advanceValley(b, t);
    advanceValley(b, T0 + 72 * HOUR);
    expect(b).toEqual(a);
  });

  it('neighbours finish the hall and open the guilds, but not everything at once', () => {
    const v = fresh();
    advanceValley(v, T0 + 24 * HOUR);
    expect(v.buildings.hearthHall.level).toBeGreaterThanOrEqual(1);
    expect(v.buildings.forestersLodge.status).not.toBe('locked');
    expect(v.log.some((e) => e.kind === 'finished' && e.building === 'hearthHall')).toBe(true);
    advanceValley(v, T0 + 7 * 24 * HOUR);
    const levels = Object.values(v.buildings).reduce((n, b) => n + b.level, 0);
    expect(levels).toBeLessThan(Object.values(VALLEY_BUILDINGS).reduce((n, d) => n + d.levels.length, 0));
  });

  it('accepts what is needed, returns the rest and is idempotent per op', () => {
    const v = fresh();
    const hall = v.buildings.hearthHall;
    const need = remainingFor(hall).clay!;
    const out = contribute(v, player.id, 'hearthHall', { clay: need + 40, timber: 10 }, 'op-1', T0);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.accepted).toEqual({ clay: need, timber: 10 });
    expect(out.result.returned).toEqual({ clay: 40 });
    expect(out.result.reputation).toBe(Math.round((need + 10) * VALLEY_BALANCE.reputationPerValue));
    expect(hall.shares[player.id]).toBe(need + 10);
    const again = contribute(v, player.id, 'hearthHall', { clay: need + 40, timber: 10 }, 'op-1', T0);
    expect(again).toEqual(out);
    expect(hall.delivered.timber).toBe(Math.floor(3000 * VALLEY_BALANCE.foundingProgress) + 10);
    expect(contribute(v, 'p-stranger', 'hearthHall', { clay: 5 }, 'op-2', T0).ok).toBe(false);
  });

  it('a fully supplied level builds for its build time, then grants bonuses', () => {
    const v = fresh();
    const left = remainingFor(v.buildings.hearthHall);
    contribute(v, player.id, 'hearthHall', left, 'finish', T0);
    expect(v.buildings.hearthHall.status).toBe('building');
    advanceValley(v, T0 + VALLEY_BUILDINGS.hearthHall.levels[0].buildHours * HOUR - 1);
    expect(v.buildings.hearthHall.level).toBe(0);
    advanceValley(v, T0 + VALLEY_BUILDINGS.hearthHall.levels[0].buildHours * HOUR);
    expect(v.buildings.hearthHall.level).toBe(1);
    expect(valleyBonuses(snapshotOf(v)).mealDurationMult).toBeCloseTo(1.1);
    // Late deliveries to a building that is no longer collecting come straight back.
    v.buildings.forestersLodge.status = 'building';
    const late = contribute(v, player.id, 'forestersLodge', { timber: 30 }, 'late', T0);
    expect(late.ok && late.result.returned).toEqual({ timber: 30 });
  });

  it('ageing a Valley (dev time skip) plays out exactly like waiting', () => {
    const aged = fresh();
    // Whole days, so the neighbours' night-time rhythm lines up.
    ageValley(aged, 48 * HOUR);
    advanceValley(aged, T0);
    const waited = fresh();
    advanceValley(waited, T0 + 48 * HOUR);
    const shape = (v: typeof aged) => Object.values(v.buildings).map((b) => ({ level: b.level, status: b.status, delivered: b.delivered, shares: b.shares }));
    expect(shape(aged)).toEqual(shape(waited));
    expect(aged.members.map((m) => m.lifetimeValue)).toEqual(waited.members.map((m) => m.lifetimeValue));
  });

  it('snapshots hide server bookkeeping', () => {
    const v = fresh();
    contribute(v, player.id, 'hearthHall', { timber: 5 }, 'op-x', T0);
    const snap = snapshotOf(v) as Record<string, unknown>;
    expect(snap.ops).toBeUndefined();
    expect(snap.rng).toBeUndefined();
  });
});

describe('village side of the valley', () => {
  const unlocked = () => {
    const h = makeGame();
    h.state.research.completed.push('valleyRoad');
    h.state.resources.timber = 200;
    h.state.resources.clay = 50;
    return h;
  };

  it('needs the research and a Valley to send anything', () => {
    const h = makeGame();
    expect(sendToValley(h.state, 'hearthHall', { timber: 10 }, 'a', h.events).ok).toBe(false);
    h.state.research.completed.push('valleyRoad');
    expect(sendToValley(h.state, 'hearthHall', { timber: 10 }, 'a', h.events).ok).toBe(false);
    joinValley(h.state, 'v-test');
    expect(sendToValley(h.state, 'hearthHall', { timber: 10 }, 'a', h.events).ok).toBe(true);
  });

  it('sends through the outbox and settles exactly once', () => {
    const h = unlocked();
    joinValley(h.state, 'v-test');
    expect(sendToValley(h.state, 'hearthHall', { timber: 500 }, 'too-much', h.events).ok).toBe(false);
    expect(sendToValley(h.state, 'hearthHall', { timber: 120, clay: 50 }, 'op-1', h.events, { timber: 100, clay: 80 }).ok).toBe(true);
    expect(h.state.resources.timber).toBe(100);
    expect(h.state.resources.clay).toBe(0);
    expect(inTransit(h.state)).toEqual({ timber: 100, clay: 50 });
    expect(settleValleyOp(h.state, 'op-1', { timber: 100, clay: 30 }, { clay: 20 }, 13, h.events)).toBe(true);
    expect(settleValleyOp(h.state, 'op-1', { timber: 100, clay: 30 }, { clay: 20 }, 13, h.events)).toBe(false);
    expect(h.state.resources.clay).toBe(20);
    expect(h.state.valley.reputation).toBe(13);
    expect(h.state.valley.given).toEqual({ timber: 100, clay: 30 });
    expect(h.state.valley.outbox).toHaveLength(0);
  });

  it('applies guild, storehouse and supper bonuses in the village', () => {
    const h = makeGame();
    const v = villager(h);
    const baseRate = workRateBreakdown(h.state, v, 'chop').rate;
    const baseCap = capacity(h.state, 'timber');
    const baseMeal = mealDuration(h.state);
    setValleyBonuses(h.state, { jobRate: { chop: 1.1 }, storageMult: 1.1, mealDurationMult: 1.1 });
    const after = workRateBreakdown(h.state, v, 'chop');
    expect(after.rate).toBeCloseTo(baseRate * 1.1);
    expect(after.factors.some((f) => f.label === 'Valley guild')).toBe(true);
    expect(capacity(h.state, 'timber')).toBe(Math.floor(baseCap * 1.1));
    expect(capacity(h.state, 'stew')).toBe(capacity(makeGame().state, 'stew'));
    expect(mealDuration(h.state)).toBeCloseTo(baseMeal * 1.1);
  });

  it('migrates version-3 saves into the Valley era', () => {
    const out = migrate({ schemaVersion: 3, resources: {}, buildings: [] });
    expect(out.schemaVersion).toBe(SAVE_VERSION);
    expect(out.valley).toMatchObject({ valleyId: null, reputation: 0, outbox: [] });
  });
});

describe('valley service (server)', () => {
  it('joins once, advances on the server clock and serialises concurrent deliveries', async () => {
    let now = T0;
    const service = new ValleyService(new MemoryValleyStore(), () => now);
    expect(await service.get(player.id)).toBeNull();
    const joined = await service.join(player.id, 'Founder', 'Thistledown');
    expect((await service.join(player.id, 'Founder', 'Thistledown')).valley.id).toBe(joined.valley.id);
    const [a, b] = await Promise.all([
      service.contribute(player.id, 'hearthHall', { timber: 10 }, 'one'),
      service.contribute(player.id, 'hearthHall', { timber: 15 }, 'two'),
    ]);
    expect(a?.ok && b?.ok).toBe(true);
    now += 2 * HOUR;
    const later = (await service.get(player.id))!;
    expect(later.valley.buildings.hearthHall.shares[player.id]).toBe(25);
    expect(later.valley.time).toBe(now);
    expect(later.valley.log.some((e) => e.kind === 'delivery' && e.member.startsWith('sim-'))).toBe(true);
    expect((await service.contribute(player.id, 'nowhere', { timber: 1 }, 'x'))?.ok).toBe(false);
  });
});
