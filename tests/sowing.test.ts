import { describe, expect, it } from 'vitest';
import { SOWING } from '../src/config/sowing';
import { fieldYield } from '../src/sim/farming';
import { migrate } from '../src/sim/save';
import { claimHarvest, sendToSowing, settleValleyOp } from '../src/sim/valley';
import { advanceValley, contributeSowing, createValley, harvestMult, sowers, sowingOpen, upgradeValley, valleyBonuses } from '../src/valley/valleySim';
import type { ValleyState } from '../src/valley/types';
import { makeGame } from './helpers';

const T0 = Date.UTC(2026, 9, 9, 12);
const HOUR = 3_600_000;
const me = { id: 'p-sowing-test', name: 'Founder', villageName: 'Thistledown' };

/** A Valley whose Goldfurrow Commons has just been restored. */
function withCommons(quiet = true): ValleyState {
  const v = createValley('v-s', 11, T0, me);
  v.buildings.hearthHall.level = 1;
  v.buildings.farmersGuild.level = 1;
  advanceValley(v, T0);
  upgradeValley(v, T0);
  const c = v.buildings.goldfurrowCommons;
  c.status = 'collecting';
  c.delivered = { timber: 3500, clay: 1500, planks: 600 };
  c.status = 'building';
  c.doneAt = T0 + 1000;
  if (quiet) for (const m of v.members) if (m.kind === 'simulated') m.nextVisitAt = null;
  advanceValley(v, T0 + 1000);
  return v;
}

describe('Goldfurrow sowing', () => {
  it('the Commons opens with the Cooks’ Guild, and the first round follows its restoration', () => {
    const fresh = createValley('v-s', 11, T0, me);
    expect(fresh.buildings.goldfurrowCommons.status).toBe('locked');
    const v = withCommons();
    expect(v.buildings.goldfurrowCommons.level).toBe(1);
    expect(v.nextSowingAt).toBe(T0 + 1000 + SOWING.gapHours * HOUR);
    advanceValley(v, v.nextSowingAt!);
    expect(v.sowing).not.toBeNull();
    expect(sowingOpen(v.sowing, v.time)).toBe(true);
  });

  it('seed comes back multiplied, more so with more villages, and rounds keep coming', () => {
    const v = withCommons();
    advanceValley(v, v.nextSowingAt!);
    const round = v.sowing!.id;
    const a = contributeSowing(v, me.id, round, 200, 'op-1');
    expect(a).toMatchObject({ ok: true, result: { accepted: { grain: 200 } } });
    // Idempotent: the retried op changes nothing.
    contributeSowing(v, me.id, round, 200, 'op-1');
    expect(v.sowing!.seed[me.id]).toBe(200);
    // Past the per-village cap, the rest comes home.
    const b = contributeSowing(v, me.id, round, 200, 'op-2');
    expect(b).toMatchObject({ ok: true, result: { accepted: { grain: SOWING.maxSeed - 200 }, returned: { grain: 400 - SOWING.maxSeed } } });
    // Two neighbours join in.
    v.sowing!.seed['sim-1'] = 50;
    v.sowing!.seed['sim-2'] = 80;
    expect(sowers(v.sowing!)).toBe(3);
    const mult = harvestMult(v.sowing!);
    expect(mult).toBeCloseTo(SOWING.baseMult + SOWING.perVillage * 3, 6);
    const ripe = v.sowing!.ripeAt;
    // Seed after the window closes comes home.
    advanceValley(v, v.sowing!.closesAt + 1);
    expect(contributeSowing(v, me.id, round, 10, 'op-3')).toMatchObject({ ok: true, result: { returned: { grain: 10 } } });
    advanceValley(v, ripe);
    expect(v.sowing).toBeNull();
    const h = v.harvests[v.harvests.length - 1];
    expect(h.id).toBe(round);
    expect(h.yields[me.id]).toBe(Math.floor(SOWING.maxSeed * mult));
    expect(v.nextSowingAt).toBe(ripe + SOWING.gapHours * HOUR);
    // Only the last few harvests are kept.
    for (let i = 0; i < 5; i++) advanceValley(v, v.nextSowingAt! + (SOWING.windowHours + SOWING.growHours) * HOUR);
    expect(v.harvests.length).toBe(SOWING.harvestsKept);
  });

  it('neighbours sow on their visits, and one big step equals many small ones', () => {
    const a = withCommons(false);
    const b = structuredClone(a);
    const end = T0 + 3 * 24 * HOUR;
    advanceValley(a, end);
    for (let t = T0; t <= end; t += 7 * 60_000) advanceValley(b, t);
    advanceValley(b, end);
    expect(b).toEqual(a);
    const sown = a.harvests.some((h) => Object.keys(h.yields).some((id) => id.startsWith('sim-')));
    expect(sown).toBe(true);
  });

  it('the village sows, settles and takes its share home once', () => {
    const h = makeGame();
    h.state.research.completed.push('valleyRoad');
    h.state.valley.valleyId = 'v-s';
    h.state.resources.grain = 120;
    expect(sendToSowing(h.state, 7, 100, 'op-v', h.events, 300).ok).toBe(true);
    expect(h.state.resources.grain).toBe(20);
    settleValleyOp(h.state, 'op-v', { grain: 90 }, { grain: 10 }, 10, h.events);
    expect(h.state.resources.grain).toBe(30);
    expect(h.events.some((e) => e.type === 'sowingAccepted' && e.accepted === 90)).toBe(true);
    expect(claimHarvest(h.state, 7, 190, 2.1, h.events)).toBe(true);
    expect(claimHarvest(h.state, 7, 190, 2.1, h.events)).toBe(false);
    expect(h.state.resources.grain).toBe(220);
  });

  it('upper Commons levels make every village’s Grain Fields yield more', () => {
    const v = withCommons();
    expect(valleyBonuses(v).fieldYieldMult).toBe(1);
    v.buildings.goldfurrowCommons.level = 3;
    const bonus = valleyBonuses(v).fieldYieldMult;
    expect(bonus).toBeCloseTo(1.21, 6);
    const h = makeGame();
    h.state.valley.bonuses = valleyBonuses(v);
    const field = { defId: 'field', cellX: 36, cellZ: 42, rotation: 0 } as Parameters<typeof fieldYield>[2];
    expect(fieldYield(h.state, h.world.map, field)).toBe(Math.round(24 * bonus));
  });

  it('old saves and old Valleys gain the new fields', () => {
    const out = migrate({ schemaVersion: 11, trade: { coins: 3 }, valley: { bonuses: { storageMult: 1 } } }) as { trade: { harvestsClaimed: number[] }; valley: { bonuses: { fieldYieldMult: number } } };
    expect(out.trade.harvestsClaimed).toEqual([]);
    expect(out.valley.bonuses.fieldYieldMult).toBe(1);
    const v = createValley('v-old', 3, T0, me) as Partial<ValleyState>;
    delete v.harvests;
    delete v.sowing;
    delete v.nextSowingAt;
    expect(upgradeValley(v as ValleyState, T0)).toBe(true);
    expect(v.harvests).toEqual([]);
  });
});
