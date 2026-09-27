import { describe, expect, it } from 'vitest';
import { assignVillager } from '../src/sim/commands';
import { workRate, workRateBreakdown } from '../src/sim/villagerAI';
import { estimateJob } from '../src/sim/selectors';
import { makeGame, nearestNode, villager } from './helpers';

describe('worker productivity', () => {
  it('skill levels raise work rate', () => {
    const h = makeGame();
    const v = villager(h);
    expect(workRate(h.state, v, 'chop')).toBeCloseTo(1);
    v.skills.woodcutting.level = 2;
    expect(workRate(h.state, v, 'chop')).toBeCloseTo(1.2);
  });

  it('research bonuses stack multiplicatively and are listed in the breakdown', () => {
    const h = makeGame();
    const v = villager(h);
    v.skills.woodcutting.level = 1;
    h.state.research.completed.push('sharpAxes');
    const { rate, factors } = workRateBreakdown(h.state, v, 'chop');
    expect(rate).toBeCloseTo(1.1 * 1.2);
    expect(factors.map((f) => f.label)).toEqual(['Base work rate', 'Skill level 1', 'Research']);
  });

  it('a trained woodcutter out-produces an untrained one', () => {
    const h = makeGame();
    const tree = nearestNode(h, 'tree');
    const a = villager(h, 0);
    const b = villager(h, 1);
    b.skills.woodcutting.level = 2;
    const ea = estimateJob(h.state, h.world, a, { kind: 'gather', nodeId: tree.id })!;
    const eb = estimateJob(h.state, h.world, b, { kind: 'gather', nodeId: tree.id })!;
    expect(eb.perMinute).toBeGreaterThan(ea.perMinute);
    expect(ea.destination).toBe('Timber Yard');
    expect(ea.travelSeconds).toBeGreaterThan(0);
  });

  it('practice raises skills up to the practice cap', () => {
    const h = makeGame();
    const v = villager(h);
    const tree = nearestNode(h, 'tree');
    tree.amount = 10_000;
    v.skills.woodcutting.xp = 28;
    // Two batches push practice XP over the level-1 threshold (30).
    assignVillager(h.state, h.world, v.id, { kind: 'gather', nodeId: tree.id }, h.events);
    h.run(60);
    expect(v.skills.woodcutting.level).toBe(1);
    expect(h.events.some((e) => e.type === 'skillUp')).toBe(true);
    v.skills.woodcutting.xp = 10_000;
    h.run(30);
    expect(v.skills.woodcutting.level).toBe(2);
  });
});
