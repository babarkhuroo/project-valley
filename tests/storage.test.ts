import { describe, expect, it } from 'vitest';
import { assignVillager, placeBuilding } from '../src/sim/commands';
import { capacity } from '../src/sim/economy';
import { makeGame, nearestNode, villager } from './helpers';

describe('storage', () => {
  it('stops at capacity, waits, and resumes when space frees up', () => {
    const h = makeGame();
    const cap = capacity(h.state, 'timber');
    expect(cap).toBe(120);
    h.state.resources.timber = cap - 2;
    const v = villager(h);
    assignVillager(h.state, h.world, v.id, { kind: 'gather', nodeId: nearestNode(h, 'tree').id }, h.events);
    h.run(60);
    expect(h.state.resources.timber).toBe(cap);
    expect(v.activity).toBe('blocked');
    expect(v.blockedReason).toBe('storageFull');
    expect(v.carrying?.amount).toBe(2);
    expect(h.events.some((e) => e.type === 'storageFull')).toBe(true);

    // Spending timber frees space: the waiting villager delivers and goes back to work.
    const placed = placeBuilding(h.state, h.world, 'academy', 34, 36, 0, h.events);
    expect(placed.ok).toBe(true);
    h.run(5);
    expect(v.carrying).toBeNull();
    expect(v.activity).not.toBe('blocked');
  });

  it('never exceeds capacity with several producers', () => {
    const h = makeGame();
    h.state.resources.stew = 35;
    const kitchen = h.state.buildings.find((b) => b.defId === 'cookhouse')!;
    assignVillager(h.state, h.world, villager(h, 0).id, { kind: 'operate', buildingId: kitchen.id }, h.events);
    h.run(600);
    expect(h.state.resources.stew).toBe(capacity(h.state, 'stew'));
    expect(villager(h, 0).blockedReason).toBe('storageFull');
  });
});
