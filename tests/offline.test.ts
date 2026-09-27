import { describe, expect, it } from 'vitest';
import { assignVillager, placeBuilding } from '../src/sim/commands';
import { cloneGame, makeGame, nearestNode, villager } from './helpers';
import { villagerPosition } from '../src/sim/villagerAI';

describe('offline progression', () => {
  it('one big advance matches thousands of frame-sized steps', () => {
    const live = makeGame();
    const cookhouse = live.state.buildings.find((b) => b.defId === 'cookhouse')!;
    assignVillager(live.state, live.world, villager(live, 0).id, { kind: 'gather', nodeId: nearestNode(live, 'tree').id }, live.events);
    assignVillager(live.state, live.world, villager(live, 1).id, { kind: 'operate', buildingId: cookhouse.id }, live.events);
    const offline = cloneGame(live);

    live.run(1800, 1 / 30);
    offline.run(1800);

    expect(offline.state.time).toBeCloseTo(live.state.time, 6);
    expect(offline.state.resources).toEqual(live.state.resources);
    for (let i = 0; i < live.state.villagers.length; i++) {
      const a = live.state.villagers[i];
      const b = offline.state.villagers[i];
      expect(b.activity).toBe(a.activity);
      expect(b.job).toEqual(a.job);
      const pa = villagerPosition(a, live.state.time);
      const pb = villagerPosition(b, offline.state.time);
      expect(pb.x).toBeCloseTo(pa.x, 4);
      expect(pb.z).toBeCloseTo(pa.z, 4);
    }
    expect(offline.state.nodes.map((n) => n.amount)).toEqual(live.state.nodes.map((n) => n.amount));
  });

  it('keeps producing while away until storage fills, then stops cleanly', () => {
    const h = makeGame();
    const cookhouse = h.state.buildings.find((b) => b.defId === 'cookhouse')!;
    assignVillager(h.state, h.world, villager(h, 0).id, { kind: 'gather', nodeId: nearestNode(h, 'tree').id }, h.events);
    assignVillager(h.state, h.world, villager(h, 1).id, { kind: 'operate', buildingId: cookhouse.id }, h.events);
    const t0 = performance.now();
    h.run(3 * 24 * 3600);
    const elapsedMs = performance.now() - t0;
    expect(h.state.resources.timber).toBe(120);
    expect(h.state.resources.stew).toBeGreaterThan(0);
    expect(villager(h, 0).blockedReason).toBe('storageFull');
    expect(elapsedMs).toBeLessThan(3000);
  });

  it('finishes construction while offline', () => {
    const h = makeGame();
    h.state.resources.timber = 100;
    const res = placeBuilding(h.state, h.world, 'academy', 34, 36, 0, h.events);
    const site = res.ok ? res.value! : null!;
    assignVillager(h.state, h.world, villager(h).id, { kind: 'construct', buildingId: site.id }, h.events);
    h.run(3600);
    expect(site.status).toBe('complete');
    expect(villager(h).activity).toBe('idle');
  });
});
