import { describe, expect, it } from 'vitest';
import { BALANCE, levelBounds, levelForXp } from '../src/config/balance';
import { addXp } from '../src/sim/progression';
import { assignVillager, placeBuilding, acceptNewcomer } from '../src/sim/commands';
import { completeConstruction } from '../src/sim/construction';
import { makeGame } from './helpers';

describe('player progression', () => {
  it('maps XP to levels', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(79)).toBe(1);
    expect(levelForXp(80)).toBe(2);
    expect(levelForXp(250)).toBe(3);
    expect(levelBounds(2)).toEqual({ start: 80, next: 250 });
  });

  it('levels up with a gift and an event', () => {
    const h = makeGame();
    h.state.resources.stew = 0;
    addXp(h.state, 300, 'test', h.events);
    expect(h.state.player.level).toBe(3);
    expect(h.events.filter((e) => e.type === 'levelUp').length).toBe(2);
    expect(h.state.resources.stew).toBe(Math.min(40, 2 * (BALANCE.progression.levelUpGift.stew ?? 0)));
  });

  it('level-up gifts never overflow storage', () => {
    const h = makeGame();
    h.state.resources.stew = 39;
    addXp(h.state, 100, 'test', h.events);
    expect(h.state.resources.stew).toBe(40);
  });
});

describe('population', () => {
  it('a finished cottage brings newcomers to choose from', () => {
    const h = makeGame();
    h.state.research.completed.push('cottageCraft');
    h.state.resources.timber = 120;
    const res = placeBuilding(h.state, h.world, 'cottage', 35, 37, 0, h.events);
    if (!res.ok) throw new Error(res.error);
    completeConstruction(h.state, h.world, res.value!, h.events);
    expect(h.state.newcomers?.length).toBe(3);
    const pick = h.state.newcomers![1];
    const joined = acceptNewcomer(h.state, h.world, 1, h.events);
    expect(joined.ok).toBe(true);
    const v = joined.ok ? joined.value! : null!;
    expect(h.state.villagers.length).toBe(3);
    expect(v.name).toBe(pick.name);
    expect(v.homeId).toBe(res.value!.id);
    expect(v.skills[pick.specialty].level).toBe(1);
    expect(h.state.newcomers).toBeNull();
    // The newcomer walks in from the road and can be put to work immediately.
    const kitchen = h.state.buildings.find((b) => b.defId === 'cookhouse')!;
    expect(assignVillager(h.state, h.world, v.id, { kind: 'operate', buildingId: kitchen.id }, h.events).ok).toBe(true);
  });

  it('respects the cottage limit from research', () => {
    const h = makeGame();
    h.state.research.completed.push('cottageCraft');
    h.state.resources.timber = 500;
    h.state.resources.clay = 500;
    expect(placeBuilding(h.state, h.world, 'cottage', 35, 37, 0, h.events).ok).toBe(true);
    const second = placeBuilding(h.state, h.world, 'cottage', 38, 37, 0, h.events);
    expect(second.ok).toBe(false);
    h.state.research.completed.push('growingHamlet');
    expect(placeBuilding(h.state, h.world, 'cottage', 38, 37, 0, h.events).ok).toBe(true);
  });
});
