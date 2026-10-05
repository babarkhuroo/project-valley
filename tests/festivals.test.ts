import { describe, expect, it } from 'vitest';
import { FESTIVALS, FESTIVAL_BALANCE } from '../src/config/festivals';
import { isBuildingUnlocked } from '../src/sim/modifiers';
import { migrate, SAVE_VERSION } from '../src/sim/save';
import { claimFestival, sendToFestival } from '../src/sim/valley';
import { advanceValley, contributeFestival, createValley, festivalRemaining, raiseKnowledge } from '../src/valley/valleySim';
import { makeGame } from './helpers';

const T0 = Date.UTC(2026, 9, 5, 12);
const HOUR = 3_600_000;
const me = { id: 'p-festival-test', name: 'Founder', villageName: 'Thistledown' };

/** A Valley whose Festival Grounds have just been restored. */
function withGrounds() {
  const v = createValley('v-f', 7, T0, me);
  v.buildings.hearthHall.level = 1;
  v.buildings.greatLibrary.level = 1;
  for (const m of v.members) v.research.votes[m.id] = 'sharedLarders';
  raiseKnowledge(v, 600, T0);
  for (const m of v.members) v.research.votes[m.id] = 'festivalCharter';
  raiseKnowledge(v, 1000, T0);
  const g = v.buildings.festivalGrounds;
  g.delivered = { timber: 3500, clay: 1500, planks: 600 };
  g.status = 'building';
  g.doneAt = T0 + 1000;
  advanceValley(v, T0 + 1000);
  return v;
}

describe('festivals', () => {
  it('the Festival Grounds open with the Festival Charter research', () => {
    const v = createValley('v-f', 7, T0, me);
    expect(v.buildings.festivalGrounds.status).toBe('locked');
    const w = withGrounds();
    expect(w.research.completed).toContain('festivalCharter');
    expect(w.buildings.festivalGrounds.level).toBe(1);
    expect(w.nextFestivalAt).toBe(T0 + 1000 + FESTIVAL_BALANCE.firstDelayHours * HOUR);
  });

  it('runs for its duration, and a missed goal is a gentle loss with another festival to come', () => {
    const v = withGrounds();
    // Keep the neighbours out of it for this test.
    for (const m of v.members) if (m.kind === 'simulated') m.nextVisitAt = null;
    advanceValley(v, v.nextFestivalAt!);
    const f = v.festival!;
    expect(f.outcome).toBe('running');
    advanceValley(v, f.endsAt);
    expect(f.outcome).toBe('lost');
    expect(v.nextFestivalAt).toBeGreaterThanOrEqual(f.endsAt + FESTIVAL_BALANCE.gapHours.min * HOUR);
    advanceValley(v, v.nextFestivalAt!);
    expect(v.festival!.id).not.toBe(f.id);
    expect(v.festival!.kind).not.toBe(f.kind);
  });

  it('members deliver to it; meeting the goal wins it and raises Knowledge', () => {
    const v = withGrounds();
    for (const m of v.members) if (m.kind === 'simulated') m.nextVisitAt = null;
    advanceValley(v, v.nextFestivalAt!);
    const f = v.festival!;
    const raised = v.research.raised;
    const extra = { ...festivalRemaining(f) };
    const first = Object.keys(extra)[0] as keyof typeof extra;
    extra[first] = extra[first]! + 50;
    const out = contributeFestival(v, me.id, f.id, extra, 'op-1');
    expect(out.ok && out.result.returned).toEqual({ [first]: 50 });
    expect(f.outcome).toBe('won');
    expect(v.research.raised).toBeGreaterThan(raised + FESTIVALS[f.kind].reward.knowledge * 0.9);
    expect(contributeFestival(v, me.id, f.id, extra, 'op-1')).toEqual(out);
    const late = contributeFestival(v, me.id, f.id, { timber: 10 }, 'op-2');
    expect(late.ok && late.result.returned).toEqual({ timber: 10 });
  });

  it('neighbours join in', () => {
    const v = withGrounds();
    advanceValley(v, v.nextFestivalAt! + 24 * HOUR);
    const f = v.festival!;
    expect(Object.keys(f.shares).some((id) => id.startsWith('sim-'))).toBe(true);
  });
});

describe('festivals in the village', () => {
  it('sends Stew to a festival and claims the rewards once', () => {
    const h = makeGame();
    h.state.research.completed.push('valleyRoad');
    h.state.valley.valleyId = 'v-f';
    h.state.resources.stew = 30;
    expect(sendToFestival(h.state, 9, { stew: 20 }, 'a', h.events, { stew: 2500 }).ok).toBe(true);
    expect(h.state.resources.stew).toBe(10);
    expect(h.state.valley.outbox[0].target).toEqual({ kind: 'festival', festivalId: 9 });
    expect(claimFestival(h.state, 9, 'harvestFestival', 1.5, h.events)).toBe(true);
    expect(claimFestival(h.state, 9, 'harvestFestival', 1.5, h.events)).toBe(false);
    expect(h.state.trade.coins).toBe(Math.round(FESTIVALS.harvestFestival.reward.coins * 1.5));
    expect(isBuildingUnlocked(h.state, 'festivalLanterns')).toBe(true);
  });

  it('migrates version-7 saves', () => {
    const out = migrate({ schemaVersion: 7, trade: { coins: 3 } });
    expect(out.schemaVersion).toBe(SAVE_VERSION);
    expect(out.trade).toMatchObject({ coins: 3, festivalsClaimed: [] });
  });
});
