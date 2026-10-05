import { describe, expect, it } from 'vitest';
import { TRAINING } from '../src/config/training';
import { assignVillager } from '../src/sim/commands';
import { migrate, SAVE_VERSION } from '../src/sim/save';
import { idleVillagers, villagerTask } from '../src/sim/selectors';
import { startTraining, trainingOffer } from '../src/sim/training';
import type { Job } from '../src/sim/types';
import { workRateBreakdown } from '../src/sim/villagerAI';
import { cloneGame, makeGame, nearestNode, villager, type Harness } from './helpers';

/** A village with a restored Foresters' Lodge, coins, and a woodcutter at the practice cap. */
function ready(guildLevel = 1): Harness & { job: Job } {
  const h = makeGame();
  h.state.valley.bonuses.guildLevels = { woodcutting: guildLevel };
  h.state.trade.coins = 1000;
  const v = villager(h);
  v.skills.woodcutting = { level: 2, xp: 90 };
  const job: Job = { kind: 'gather', nodeId: nearestNode(h, 'tree').id };
  assignVillager(h.state, h.world, v.id, job, h.events);
  h.run(20);
  return Object.assign(h, { job });
}

describe('guild training offers', () => {
  it('needs the guild restored, practice finished and a guild high enough', () => {
    const h = makeGame();
    const v = villager(h);
    expect(trainingOffer(h.state, v, 'woodcutting').ok).toBe(false);
    h.state.valley.bonuses.guildLevels = { woodcutting: 1 };
    const early = trainingOffer(h.state, v, 'woodcutting');
    expect(early.ok === false && early.reason).toMatch(/Practice reaches/);
    v.skills.woodcutting.level = 2;
    const ok = trainingOffer(h.state, v, 'woodcutting');
    expect(ok).toMatchObject({ ok: true, toLevel: 3, coins: TRAINING.lessons[3].coins });
    v.skills.woodcutting.level = 4;
    const capped = trainingOffer(h.state, v, 'woodcutting');
    expect(capped.ok === false && capped.reason).toMatch(/must reach level 2/);
    h.state.valley.bonuses.guildLevels = { woodcutting: 3 };
    v.skills.woodcutting.level = 6;
    const done = trainingOffer(h.state, v, 'woodcutting');
    expect(done.ok === false && done.reason).toBe('Mastered');
  });

  it('costs coins', () => {
    const h = ready();
    h.state.trade.coins = 10;
    expect(startTraining(h.state, h.world, villager(h).id, 'woodcutting', h.events).ok).toBe(false);
    expect(villager(h).away).toBeNull();
  });
});

describe('a villager in training', () => {
  it('walks out, is away for the lesson, then comes home a level higher and back to work', () => {
    const h = ready();
    const v = villager(h);
    const base = workRateBreakdown(h.state, v, 'chop', h.job).rate;
    expect(startTraining(h.state, h.world, v.id, 'woodcutting', h.events).ok).toBe(true);
    expect(h.state.trade.coins).toBe(1000 - TRAINING.lessons[3].coins);
    expect(v.job).toBeNull();
    expect(v.activity).toBe('walking');
    expect(villagerTask(h.state, v).label).toMatch(/Setting off/);
    expect(idleVillagers(h.state)).not.toContain(v);
    expect(assignVillager(h.state, h.world, v.id, h.job, h.events).ok).toBe(false);
    h.run(120);
    expect(v.activity).toBe('away');
    expect(villagerTask(h.state, v).label).toMatch(/Training at the Foresters/);
    h.run(TRAINING.lessons[3].hours * 3600);
    expect(v.away).toBeNull();
    expect(v.skills.woodcutting.level).toBe(3);
    expect(v.job?.kind).toBe('gather');
    expect(h.events.some((e) => e.type === 'trainingDone')).toBe(true);
    expect(workRateBreakdown(h.state, v, 'chop', h.job).rate).toBeGreaterThan(base);
  });

  it('goes home instead if someone else took the job meanwhile', () => {
    const h = makeGame();
    h.state.valley.bonuses.guildLevels = { farming: 1 };
    h.state.trade.coins = 1000;
    const [a, b] = [villager(h, 0), villager(h, 1)];
    a.skills.farming = { level: 2, xp: 90 };
    const cook: Job = { kind: 'operate', buildingId: h.state.buildings.find((x) => x.defId === 'cookhouse')!.id };
    assignVillager(h.state, h.world, a.id, cook, h.events);
    h.run(10);
    startTraining(h.state, h.world, a.id, 'farming', h.events);
    assignVillager(h.state, h.world, b.id, cook, h.events);
    h.run(TRAINING.lessons[3].hours * 3600 + 300);
    expect(a.away).toBeNull();
    expect(a.skills.farming.level).toBe(3);
    expect(a.job).toBeNull();
    expect(b.job).toEqual(cook);
  });

  it('is deterministic across one big step and many small ones', () => {
    const a = ready();
    startTraining(a.state, a.world, villager(a).id, 'woodcutting', a.events);
    const b = cloneGame(a);
    a.run(3 * 3600);
    b.run(3 * 3600, 29);
    expect(b.state).toEqual(a.state);
    expect(villager(a).skills.woodcutting.level).toBe(3);
  });

  it('migrates version-5 saves', () => {
    const out = migrate({ schemaVersion: 5, villagers: [{ id: 1 }], valley: { bonuses: { jobRate: {}, storageMult: 1, mealDurationMult: 1, tradeLevel: 0 } } });
    expect(out.schemaVersion).toBe(SAVE_VERSION);
    expect((out.villagers as { away: unknown }[])[0].away).toBeNull();
    expect((out.valley as { bonuses: { guildLevels: object } }).bonuses.guildLevels).toEqual({});
  });
});
