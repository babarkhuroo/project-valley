import { describe, expect, it } from 'vitest';
import { assignVillager } from '../src/sim/commands';
import { makeGame, nearestNode, villager } from './helpers';

describe('resource production', () => {
  it('a woodcutter walks to a tree, chops, carries timber home and repeats', () => {
    const h = makeGame();
    const tree = nearestNode(h, 'tree');
    const v = villager(h);
    const before = h.state.resources.timber;
    const res = assignVillager(h.state, h.world, v.id, { kind: 'gather', nodeId: tree.id }, h.events);
    expect(res.ok).toBe(true);
    expect(v.activity).toBe('walking');

    h.run(1);
    expect(['walking', 'working']).toContain(v.activity);

    h.run(90);
    const deposits = h.events.filter((e) => e.type === 'deposit');
    expect(deposits.length).toBeGreaterThanOrEqual(3);
    expect(h.state.resources.timber).toBe(before + deposits.reduce((s, e) => s + (e.type === 'deposit' ? e.amount : 0), 0));
    expect(tree.amount).toBeLessThan(24);
  });

  it('moves on to the next tree when one is exhausted', () => {
    const h = makeGame();
    const tree = nearestNode(h, 'tree');
    const v = villager(h);
    tree.amount = 4;
    assignVillager(h.state, h.world, v.id, { kind: 'gather', nodeId: tree.id }, h.events);
    h.run(60);
    expect(tree.amount).toBe(0);
    expect(tree.regrowAt).not.toBeNull();
    expect(h.events.some((e) => e.type === 'autoContinue')).toBe(true);
    expect(v.job?.kind).toBe('gather');
    expect(v.job && 'nodeId' in v.job && v.job.nodeId).not.toBe(tree.id);
  });

  it('exhausted nodes regrow on their timer', () => {
    const h = makeGame();
    const tree = nearestNode(h, 'tree');
    tree.amount = 0;
    tree.depletedAt = 0;
    tree.regrowAt = 900;
    h.run(899);
    expect(tree.amount).toBe(0);
    h.run(2);
    expect(tree.amount).toBe(24);
    expect(tree.regrowAt).toBeNull();
  });

  it('refuses clay before Clay Digging is researched', () => {
    const h = makeGame();
    const clay = h.state.nodes.find((n) => n.kind === 'clay')!;
    const res = assignVillager(h.state, h.world, villager(h).id, { kind: 'gather', nodeId: clay.id }, h.events);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Clay Digging/);
  });
});
