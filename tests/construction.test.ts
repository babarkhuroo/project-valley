import { describe, expect, it } from 'vitest';
import { assignVillager, cancelConstruction, moveBuilding, placeBuilding } from '../src/sim/commands';
import { checkFootprint, nextCost } from '../src/sim/construction';
import { makeGame, villager } from './helpers';

describe('construction', () => {
  it('rejects placement without resources', () => {
    const h = makeGame();
    h.state.resources.timber = 10;
    const res = placeBuilding(h.state, h.world, 'academy', 34, 36, 0, h.events);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/resources/);
  });

  it('pays up front, needs a builder, and grants XP on completion', () => {
    const h = makeGame();
    h.state.resources.timber = 100;
    const res = placeBuilding(h.state, h.world, 'academy', 34, 36, 0, h.events);
    expect(res.ok).toBe(true);
    const site = res.ok ? res.value! : null!;
    expect(h.state.resources.timber).toBe(40);
    expect(site.status).toBe('construction');

    h.run(30);
    expect(site.progress).toBe(0);

    assignVillager(h.state, h.world, villager(h).id, { kind: 'construct', buildingId: site.id }, h.events);
    h.run(90);
    expect(site.status).toBe('complete');
    expect(h.state.player.xp).toBe(40);
    expect(villager(h).job).toBeNull();
    expect(h.events.some((e) => e.type === 'constructionComplete')).toBe(true);
  });

  it('two builders finish faster than one', () => {
    const time = (builders: number) => {
      const h = makeGame();
      h.state.resources.timber = 100;
      const res = placeBuilding(h.state, h.world, 'academy', 34, 36, 0, h.events);
      const site = res.ok ? res.value! : null!;
      for (let i = 0; i < builders; i++) assignVillager(h.state, h.world, villager(h, i).id, { kind: 'construct', buildingId: site.id }, h.events);
      let t = 0;
      while (site.status !== 'complete' && t < 300) {
        h.run(0.5);
        t += 0.5;
      }
      return t;
    };
    expect(time(2)).toBeLessThan(time(1) * 0.75);
  });

  it('validates footprints against water, buildings and trees', () => {
    const h = makeGame();
    expect(checkFootprint(h.world, 'timberYard', 8, 52, 0).ok).toBe(false);
    const kitchen = h.state.buildings.find((b) => b.defId === 'cookhouse')!;
    expect(checkFootprint(h.world, 'timberYard', kitchen.cellX, kitchen.cellZ, 0).ok).toBe(false);
    const tree = h.state.nodes.find((n) => n.kind === 'tree')!;
    expect(checkFootprint(h.world, 'flowerBed', Math.floor(tree.x), Math.floor(tree.z), 0).ok).toBe(false);
    expect(checkFootprint(h.world, 'academy', 34, 36, 0).ok).toBe(true);
  });

  it('cost tables escalate with each copy', () => {
    const h = makeGame();
    expect(nextCost(h.state, 'timberYard').resources.timber).toBe(40);
    h.state.resources.timber = 120;
    placeBuilding(h.state, h.world, 'timberYard', 36, 37, 0, h.events);
    expect(nextCost(h.state, 'timberYard').resources).toEqual({ timber: 70, clay: 20 });
  });

  it('cancelling refunds everything and frees the builders', () => {
    const h = makeGame();
    h.state.resources.timber = 100;
    const res = placeBuilding(h.state, h.world, 'academy', 34, 36, 0, h.events);
    const site = res.ok ? res.value! : null!;
    assignVillager(h.state, h.world, villager(h).id, { kind: 'construct', buildingId: site.id }, h.events);
    h.run(10);
    expect(cancelConstruction(h.state, h.world, site.id, h.events).ok).toBe(true);
    expect(h.state.resources.timber).toBe(100);
    expect(villager(h).job).toBeNull();
  });

  it('moving a building is instant and keeps its workers', () => {
    const h = makeGame();
    const kitchen = h.state.buildings.find((b) => b.defId === 'cookhouse')!;
    const cook = villager(h);
    assignVillager(h.state, h.world, cook.id, { kind: 'operate', buildingId: kitchen.id }, h.events);
    h.run(20);
    expect(moveBuilding(h.state, h.world, kitchen.id, 35, 37, 1, h.events).ok).toBe(true);
    expect(kitchen.cellX).toBe(35);
    h.run(20);
    expect(cook.job).toEqual({ kind: 'operate', buildingId: kitchen.id });
    expect(cook.activity).toBe('working');
  });

  it('decorations are placed instantly', () => {
    const h = makeGame();
    const res = placeBuilding(h.state, h.world, 'flowerBed', 36, 37, 0, h.events);
    expect(res.ok && res.value!.status).toBe('complete');
  });
});
