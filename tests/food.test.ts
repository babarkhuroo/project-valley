import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { assignVillager } from '../src/sim/commands';
import { workRate } from '../src/sim/villagerAI';
import { building, makeGame, nearestNode, villager } from './helpers';

describe('food', () => {
  it('working villagers eat one Stew per meal duration of work', () => {
    const h = makeGame();
    const v = villager(h);
    h.state.resources.stew = 30;
    assignVillager(h.state, h.world, v.id, { kind: 'gather', nodeId: nearestNode(h, 'tree').id }, h.events);
    h.run(120);
    const ate = h.events.filter((e) => e.type === 'ate').length;
    expect(ate).toBeGreaterThan(0);
    expect(h.state.resources.stew).toBe(30 - ate);
  });

  it('hungry villagers slow down instead of stopping, and recover when Stew arrives', () => {
    const h = makeGame();
    const chopper = villager(h, 0);
    const cook = villager(h, 1);
    h.state.resources.stew = 0;
    chopper.energy = 0;
    assignVillager(h.state, h.world, chopper.id, { kind: 'gather', nodeId: nearestNode(h, 'tree').id }, h.events);
    h.run(20);
    expect(chopper.hungry).toBe(true);
    expect(h.events.some((e) => e.type === 'hungry')).toBe(true);
    expect(workRate(h.state, chopper, 'chop')).toBeCloseTo(BALANCE.villager.hungryWorkMult);

    assignVillager(h.state, h.world, cook.id, { kind: 'operate', buildingId: building(h, 'cookhouse').id }, h.events);
    h.run(40);
    expect(chopper.hungry).toBe(false);
    expect(workRate(h.state, chopper, 'chop')).toBeCloseTo(1);
  });

  it('cooks do not eat while cooking', () => {
    const h = makeGame();
    const cook = villager(h, 0);
    h.state.resources.stew = 0;
    assignVillager(h.state, h.world, cook.id, { kind: 'operate', buildingId: building(h, 'cookhouse').id }, h.events);
    h.run(200);
    expect(h.events.some((e) => e.type === 'ate' && e.villagerId === cook.id)).toBe(false);
    expect(h.state.resources.stew).toBeGreaterThan(15);
  });
});
