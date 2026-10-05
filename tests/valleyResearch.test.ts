import { describe, expect, it } from 'vitest';
import { VALLEY_RESEARCH } from '../src/config/valleyResearch';
import { VALLEY_BALANCE } from '../src/config/valley';
import { TRADE_BALANCE } from '../src/config/trade';
import { migrate, newValleyBonuses, SAVE_VERSION } from '../src/sim/save';
import { fillCrate } from '../src/sim/trade';
import { trainingOffer } from '../src/sim/training';
import { advanceValley, availableResearch, contributeKnowledge, createValley, leadingResearch, raiseKnowledge, upgradeValley, valleyBonuses, voteResearch } from '../src/valley/valleySim';
import { makeGame, villager } from './helpers';

const T0 = Date.UTC(2026, 9, 5, 12);
const HOUR = 3_600_000;
const me = { id: 'p-research-test', name: 'Founder', villageName: 'Thistledown' };
const fresh = () => createValley('v-r', 99, T0, me);
const openLibrary = (v: ReturnType<typeof fresh>) => {
  v.buildings.greatLibrary.level = 1;
  v.buildings.greatLibrary.status = 'collecting';
};

describe('valley research', () => {
  it('banks Knowledge until the Great Library opens', () => {
    const v = fresh();
    raiseKnowledge(v, 250, T0);
    expect(v.research.banked).toBeCloseTo(250);
    expect(Object.keys(v.research.progress)).toHaveLength(0);
    openLibrary(v);
    raiseKnowledge(v, 30, T0);
    expect(v.research.banked).toBeCloseTo(0);
    const lead = leadingResearch(v)!;
    expect(v.research.progress[lead]).toBeCloseTo(280);
    raiseKnowledge(v, VALLEY_RESEARCH[lead].cost - 280, T0);
    expect(v.research.completed).toEqual([lead]);
  });

  it('only so much Knowledge can wait for the Library', () => {
    const v = fresh();
    raiseKnowledge(v, 5000, T0);
    expect(v.research.banked).toBe(VALLEY_BALANCE.knowledgeBankCap);
  });

  it('neighbours vote; the most-voted project gets the Knowledge; members can vote', () => {
    const v = fresh();
    expect(Object.keys(v.research.votes).length).toBe(7);
    const before = leadingResearch(v)!;
    const other = availableResearch(v).find((id) => id !== before)!;
    expect(voteResearch(v, me.id, other)).toBe(true);
    expect(voteResearch(v, me.id, 'deepStorehouses')).toBe(false);
    expect(voteResearch(v, 'stranger', other)).toBe(false);
    expect(v.research.votes[me.id]).toBe(other);
  });

  it('finishing a project unlocks the next tier and its bonus reaches every village', () => {
    const v = fresh();
    openLibrary(v);
    for (const m of v.members) v.research.votes[m.id] = 'merchantCharts';
    raiseKnowledge(v, VALLEY_RESEARCH.merchantCharts.cost, T0);
    expect(v.research.completed).toContain('merchantCharts');
    expect(availableResearch(v)).toContain('tradeWinds');
    expect(v.log.some((e) => e.kind === 'researched')).toBe(true);
    expect(valleyBonuses(v).tradePayMult).toBeCloseTo(1.15);
    // Neighbours who voted for it now back something else.
    expect(Object.values(v.research.votes).every((id) => id !== 'merchantCharts')).toBe(true);
  });

  it('contributions raise Knowledge; trading Knowledge is idempotent', () => {
    const v = fresh();
    const raised = v.research.raised;
    advanceValley(v, T0 + 12 * HOUR);
    expect(v.research.raised).toBeGreaterThan(raised);
    const a = contributeKnowledge(v, me.id, 40, 'k-1', T0 + 12 * HOUR);
    const b = contributeKnowledge(v, me.id, 40, 'k-1', T0 + 12 * HOUR);
    expect(a).toEqual(b);
    expect(v.log.filter((e) => e.kind === 'knowledge')).toHaveLength(1);
  });

  it('old Valleys gain the research state on load', () => {
    const v = fresh();
    delete (v as Partial<typeof v>).research;
    expect(upgradeValley(v, T0)).toBe(true);
    expect(v.research.completed).toEqual([]);
    expect(Object.keys(v.research.votes).length).toBe(7);
  });
});

describe('research in the village', () => {
  it('crates send their Knowledge to the Valley through the outbox', () => {
    const h = makeGame();
    h.state.valley.valleyId = 'v-r';
    h.state.valley.bonuses.tradeLevel = 1;
    h.run(TRADE_BALANCE.firstShipDelay + 1);
    const c = h.state.trade.ship!.crates[0];
    h.state.resources[c.resource] = c.amount;
    fillCrate(h.state, 0, h.events);
    const op = h.state.valley.outbox.find((o) => o.target.kind === 'knowledge')!;
    expect(op.knowledge).toBe(c.knowledge);
    expect(h.state.resources[c.resource]).toBe(0);
  });

  it('research multipliers change merchant pay and lesson cost', () => {
    const h = makeGame();
    h.state.valley.bonuses = { ...newValleyBonuses(), guildLevels: { woodcutting: 1 }, trainingCostMult: 0.75, trainingTimeMult: 0.75 };
    const v = villager(h);
    v.skills.woodcutting.level = 2;
    const offer = trainingOffer(h.state, v, 'woodcutting');
    expect(offer).toMatchObject({ ok: true, coins: 75, hours: 0.75 });
  });

  it('migrates version-6 outboxes to typed targets', () => {
    const out = migrate({ schemaVersion: 6, valley: { valleyId: 'v', outbox: [{ opId: 'a', building: 'hearthHall', resources: { timber: 5 }, at: 1 }], bonuses: { jobRate: {} } } });
    expect(out.schemaVersion).toBe(SAVE_VERSION);
    const valley = out.valley as { outbox: { target: unknown; building?: unknown }[]; bonuses: { tradePayMult: number } };
    expect(valley.outbox[0].target).toEqual({ kind: 'building', id: 'hearthHall' });
    expect(valley.outbox[0].building).toBeUndefined();
    expect(valley.bonuses.tradePayMult).toBe(1);
  });
});
