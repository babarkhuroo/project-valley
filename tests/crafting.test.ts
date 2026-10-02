import { describe, expect, it } from 'vitest';
import { REPEAT_ORDER } from '../src/config/recipes';
import { assignVillager, cancelCraftOrder, moveCraftOrder, placeBuilding, queueCraft } from '../src/sim/commands';
import { completeConstruction } from '../src/sim/construction';
import { productionSummary, villagerTask } from '../src/sim/selectors';
import { cloneGame, makeGame, villager, type Harness } from './helpers';

function withSawmill(): { h: Harness; mill: number } {
  const h = makeGame();
  h.state.research.completed.push('carpentry');
  h.state.resources.timber = 120;
  h.state.resources.stone = 30;
  const res = placeBuilding(h.state, h.world, 'sawmill', 35, 37, 0, h.events);
  if (!res.ok) throw new Error(res.error);
  completeConstruction(h.state, h.world, res.value!, h.events);
  h.state.resources.timber = 100;
  return { h, mill: res.value!.id };
}

const mill = (h: Harness, id: number) => h.state.buildings.find((b) => b.id === id)!;

describe('workshops', () => {
  it('a crafter turns timber into planks, one order item at a time', () => {
    const { h, mill: id } = withSawmill();
    expect(queueCraft(h.state, h.world, id, 'planks', 3, h.events).ok).toBe(true);
    assignVillager(h.state, h.world, villager(h).id, { kind: 'operate', buildingId: id }, h.events);
    h.run(10);
    // The first item has started: its 4 timber are already taken.
    expect(h.state.resources.timber).toBe(96);
    expect(villagerTask(h.state, villager(h)).label).toBe('Sawing planks');
    h.run(60);
    expect(h.state.resources.planks).toBe(6);
    expect(h.state.resources.timber).toBe(88);
    expect(mill(h, id).craft!.orders).toEqual([]);
    expect(villager(h).blockedReason).toBe('noOrders');
    expect(h.events.some((e) => e.type === 'craftQueueEmpty')).toBe(true);
  });

  it('waits for inputs instead of failing, then resumes by itself', () => {
    const { h, mill: id } = withSawmill();
    h.state.resources.timber = 2;
    queueCraft(h.state, h.world, id, 'planks', REPEAT_ORDER, h.events);
    const v = villager(h);
    assignVillager(h.state, h.world, v.id, { kind: 'operate', buildingId: id }, h.events);
    h.run(20);
    expect(v.blockedReason).toBe('noInputs');
    expect(villagerTask(h.state, v).label).toBe('Waiting — Waiting for timber');
    h.state.resources.timber = 40;
    h.run(40);
    expect(h.state.resources.planks).toBeGreaterThan(0);
    // "Keep making" orders never run out.
    expect(mill(h, id).craft!.orders[0].count).toBe(REPEAT_ORDER);
  });

  it('stops when plank storage is full', () => {
    const { h, mill: id } = withSawmill();
    h.state.resources.timber = 120;
    h.state.resources.planks = 39;
    queueCraft(h.state, h.world, id, 'planks', 5, h.events);
    assignVillager(h.state, h.world, villager(h).id, { kind: 'operate', buildingId: id }, h.events);
    h.run(60);
    expect(h.state.resources.planks).toBe(39);
    expect(villager(h).blockedReason).toBe('storageFull');
  });

  it('merges, limits, reorders and cancels orders — refunding a started item', () => {
    const { h, mill: id } = withSawmill();
    queueCraft(h.state, h.world, id, 'planks', 2, h.events);
    queueCraft(h.state, h.world, id, 'planks', 3, h.events);
    expect(mill(h, id).craft!.orders).toEqual([{ recipe: 'planks', count: 5 }]);
    queueCraft(h.state, h.world, id, 'planks', REPEAT_ORDER, h.events);
    expect(mill(h, id).craft!.orders.length).toBe(2);
    expect(moveCraftOrder(h.state, id, 1, -1).ok).toBe(true);
    expect(mill(h, id).craft!.orders[0].count).toBe(REPEAT_ORDER);
    expect(queueCraft(h.state, h.world, id, 'planks', 99, h.events).ok).toBe(false);
    assignVillager(h.state, h.world, villager(h).id, { kind: 'operate', buildingId: id }, h.events);
    h.run(8);
    expect(mill(h, id).craft!.current).toBe('planks');
    const timber = h.state.resources.timber;
    cancelCraftOrder(h.state, h.world, id, 0, h.events);
    expect(mill(h, id).craft!.current).toBe('planks');
    cancelCraftOrder(h.state, h.world, id, 0, h.events);
    expect(mill(h, id).craft!.current).toBeNull();
    expect(h.state.resources.timber).toBe(timber + 4);
  });

  it('shows the net flow of inputs and outputs', () => {
    const { h, mill: id } = withSawmill();
    queueCraft(h.state, h.world, id, 'planks', REPEAT_ORDER, h.events);
    assignVillager(h.state, h.world, villager(h).id, { kind: 'operate', buildingId: id }, h.events);
    h.run(10);
    const flow = productionSummary(h.state, h.world);
    expect(flow.planks.gain).toBeCloseTo(10);
    expect(flow.timber.use).toBeCloseTo(20);
  });

  it('keeps crafting while offline, identically to live play', () => {
    const { h, mill: id } = withSawmill();
    queueCraft(h.state, h.world, id, 'planks', 20, h.events);
    assignVillager(h.state, h.world, villager(h, 0).id, { kind: 'operate', buildingId: id }, h.events);
    const copy = cloneGame(h);
    h.run(300, 1 / 30);
    copy.run(300);
    expect(copy.state.resources).toEqual(h.state.resources);
    expect(copy.state.buildings).toEqual(h.state.buildings);
    expect(h.state.resources.planks).toBe(40);
  });
});
