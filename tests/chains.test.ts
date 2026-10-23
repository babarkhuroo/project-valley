import { describe, expect, it } from 'vitest';
import type { BuildingId } from '../src/config/buildings';
import type { ResearchId } from '../src/config/research';
import { assignVillager, placeBuilding, queueCraft } from '../src/sim/commands';
import { completeConstruction } from '../src/sim/construction';
import { BREAD_MEAL_MULT } from '../src/sim/villagerAI';
import { mealDuration } from '../src/sim/modifiers';
import { migrate } from '../src/sim/save';
import { makeGame, nearestNode, villager, type Harness } from './helpers';

function build(h: Harness, defId: BuildingId, research: ResearchId, x: number, z: number): number {
  h.state.research.completed.push(research);
  Object.assign(h.state.resources, { timber: 300, clay: 100, stone: 100, planks: 100 });
  const res = placeBuilding(h.state, h.world, defId, x, z, 0, h.events);
  if (!res.ok) throw new Error(res.error);
  completeConstruction(h.state, h.world, res.value!, h.events);
  return res.value!.id;
}

describe('the food and farmyard chains', () => {
  it('a baker turns grain into bread at the Bakery', () => {
    const h = makeGame();
    const id = build(h, 'bakery', 'baking', 35, 37);
    h.state.resources.grain = 30;
    expect(queueCraft(h.state, h.world, id, 'bread', 3, h.events).ok).toBe(true);
    assignVillager(h.state, h.world, villager(h).id, { kind: 'operate', buildingId: id }, h.events);
    h.run(120);
    // three loaves of two from 9 grain (the baker may have eaten one of them on the job)
    expect(h.state.resources.grain).toBe(21);
    expect(h.state.resources.bread + (h.state.stats['consumed.bread'] ?? 0)).toBe(6);
  });

  it('villagers eat a loaf before stew, and it lasts half as long again', () => {
    const h = makeGame();
    h.state.resources.bread = 5;
    const stew = h.state.resources.stew;
    const v = villager(h);
    assignVillager(h.state, h.world, v.id, { kind: 'gather', nodeId: nearestNode(h, 'tree').id }, h.events);
    v.energy = 0;
    let after = -1;
    for (let i = 0; i < 120 && after < 0; i++) {
      h.run(0.25);
      if (h.state.resources.bread === 4) after = v.energy;
    }
    expect(h.state.resources.stew).toBe(stew);
    // a fresh loaf's worth, less a moment of work
    expect(after).toBeGreaterThan(mealDuration(h.state) * BREAD_MEAL_MULT * 0.98);
  });

  it('a keeper gathers eggs at the Chicken Coop and honey at the Apiary', () => {
    const h = makeGame();
    const coop = build(h, 'chickenCoop', 'henkeeping', 35, 37);
    const hive = build(h, 'beehive', 'beekeeping', 39, 37);
    assignVillager(h.state, h.world, villager(h, 0).id, { kind: 'operate', buildingId: coop }, h.events);
    assignVillager(h.state, h.world, villager(h, 1).id, { kind: 'operate', buildingId: hive }, h.events);
    h.run(180);
    expect(h.state.resources.eggs).toBeGreaterThan(0);
    expect(h.state.resources.honey).toBeGreaterThan(0);
  });

  it('old saves gain the new stores, empty', () => {
    const old = { schemaVersion: 12, time: 0, player: {}, resources: { timber: 5, stew: 3 }, villagers: [], buildings: [], nodes: [], research: {} };
    const out = migrate(old) as { resources: Record<string, number> };
    expect(out.resources).toMatchObject({ timber: 5, bread: 0, eggs: 0, honey: 0 });
  });
});
