import { describe, expect, it } from 'vitest';
import { COOP_RECIPES, MILLRACE } from '../src/config/millrace';
import { assignVillager } from '../src/sim/commands';
import { shiftOutput, shiftYield, startShift } from '../src/sim/millrace';
import { migrate, SAVE_VERSION } from '../src/sim/save';
import { villagerTask } from '../src/sim/selectors';
import type { Job } from '../src/sim/types';
import { createValley, millraceCrew } from '../src/valley/valleySim';
import { cloneGame, makeGame, nearestNode, villager, type Harness } from './helpers';

function withWorkshop(): Harness & { job: Job } {
  const h = makeGame();
  h.state.valley.valleyId = 'v-m';
  h.state.valley.bonuses.workshopLevel = 1;
  h.state.resources.timber = 150;
  const job: Job = { kind: 'gather', nodeId: nearestNode(h, 'tree').id };
  assignVillager(h.state, h.world, villager(h).id, job, h.events);
  h.run(10);
  return Object.assign(h, { job });
}

describe('Millrace shifts', () => {
  it('need the workshop restored and the materials', () => {
    const h = makeGame();
    h.state.valley.valleyId = 'v-m';
    expect(startShift(h.state, h.world, villager(h).id, 'beams', 'hearthHall', 0, h.events).ok).toBe(false);
    h.state.valley.bonuses.workshopLevel = 1;
    h.state.resources.timber = 50;
    expect(startShift(h.state, h.world, villager(h).id, 'beams', 'hearthHall', 0, h.events).ok).toBe(false);
  });

  it('take the inputs, keep the villager away for the shift, then send the goods to the project', () => {
    const h = withWorkshop();
    const v = villager(h);
    const before = h.state.resources.timber;
    expect(startShift(h.state, h.world, v.id, 'beams', 'tradingPost', 2, h.events).ok).toBe(true);
    expect(h.state.resources.timber).toBe(before - COOP_RECIPES.beams.inputs.timber!);
    expect(v.away?.kind).toBe('shift');
    h.run(120);
    expect(v.activity).toBe('away');
    expect(villagerTask(h.state, v).label).toMatch(/On shift at the Millrace/);
    h.run(MILLRACE.shiftHours * 3600);
    expect(v.away).toBeNull();
    const op = h.state.valley.outbox.find((o) => o.target.kind === 'building' && o.target.id === 'tradingPost')!;
    const expected = shiftOutput('beams', shiftYield(h.state, v, 2));
    expect(op.resources).toEqual({ timber: expected.amount });
    expect(expected.amount).toBeGreaterThan(COOP_RECIPES.beams.output.amount);
    expect(v.job?.kind).toBe('gather');
  });

  it('pays off more with Crafting skill and neighbours on shift', () => {
    const h = withWorkshop();
    const v = villager(h);
    const alone = shiftYield(h.state, v, 0);
    expect(shiftYield(h.state, v, 3)).toBeCloseTo(alone * (1 + 3 * MILLRACE.helperBonus));
    v.skills.crafting.level = 2;
    expect(shiftYield(h.state, v, 0)).toBeCloseTo(1 + 2 * MILLRACE.craftingBonusPerLevel);
  });

  it('is deterministic across one big step and many small ones', () => {
    const a = withWorkshop();
    startShift(a.state, a.world, villager(a).id, 'beams', 'hearthHall', 1, a.events);
    const b = cloneGame(a);
    a.run(3 * 3600);
    b.run(3 * 3600, 31);
    expect(b.state).toEqual(a.state);
  });

  it('neighbours take turns on shift once the workshop is open', () => {
    const v = createValley('v-m', 3, Date.UTC(2026, 9, 5, 12), { id: 'p-m', name: 'F', villageName: 'T' });
    expect(millraceCrew(v, Date.UTC(2026, 9, 5, 14))).toEqual([]);
    v.buildings.millraceWorkshop.level = 1;
    const seen = new Set<number>();
    for (let h = 0; h < 24; h++) seen.add(millraceCrew(v, Date.UTC(2026, 9, 5, h)).length);
    expect(Math.max(...seen)).toBeGreaterThan(0);
  });

  it('migrates version-8 lessons to away trips', () => {
    const out = migrate({ schemaVersion: 8, villagers: [{ id: 1, training: { skill: 'mining', toLevel: 3, until: 50, resumeJob: null } }, { id: 2, training: null }] });
    expect(out.schemaVersion).toBe(SAVE_VERSION);
    const vs = out.villagers as { away: unknown; training?: unknown }[];
    expect(vs[0].away).toMatchObject({ kind: 'lesson', skill: 'mining', toLevel: 3 });
    expect(vs[1].away).toBeNull();
    expect(vs[0].training).toBeUndefined();
  });
});
