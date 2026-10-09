import { describe, expect, it } from 'vitest';
import { FARMING } from '../src/config/farming';
import type { BuildingId } from '../src/config/buildings';
import { assignVillager, placeBuilding } from '../src/sim/commands';
import { checkFootprint, completeConstruction } from '../src/sim/construction';
import { fieldYield, isFertile } from '../src/sim/farming';
import { migrate } from '../src/sim/save';
import { estimateJob } from '../src/sim/selectors';
import type { BuildingInstance } from '../src/sim/types';
import { building, cloneGame, makeGame, villager, type Harness } from './helpers';

function farmingReady(h: Harness): void {
  h.state.research.completed.push('fieldSowing');
  h.state.resources = { ...h.state.resources, timber: 500, stone: 200, planks: 200 };
}

/** Places and instantly finishes a building on the first free spot near (x, z). */
function build(h: Harness, defId: BuildingId, x: number, z: number): BuildingInstance {
  for (let r = 0; r < 12; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        if (!checkFootprint(h.world, defId, x + dx, z + dz, 0).ok) continue;
        const res = placeBuilding(h.state, h.world, defId, x + dx, z + dz, 0, h.events);
        if (!res.ok) throw new Error(res.error);
        completeConstruction(h.state, h.world, res.value!, h.events);
        return res.value!;
      }
    }
  }
  throw new Error(`no room for ${defId}`);
}

describe('farming', () => {
  it('a farmer sows, tends, harvests and carries grain to the Granary', () => {
    const h = makeGame();
    farmingReady(h);
    build(h, 'granary', 36, 38);
    const field = build(h, 'field', 36, 42);
    expect(field.field?.stage).toBe('fallow');
    const v = villager(h);
    expect(assignVillager(h.state, h.world, v.id, { kind: 'operate', buildingId: field.id }, h.events).ok).toBe(true);

    h.run(30);
    expect(field.field?.stage).toBe('growing');
    const sownAt = field.field!.sownAt!;
    // Tending brings the harvest well forward of the untended growing time.
    h.run(120);
    const ripe = h.events.find((e) => e.type === 'fieldRipe');
    expect(ripe).toBeDefined();
    expect(h.state.time - sownAt).toBeLessThan(FARMING.growSeconds / 2);

    h.run(400);
    expect(h.events.some((e) => e.type === 'fieldHarvested')).toBe(true);
    const delivered = h.events.filter((e) => e.type === 'deposit' && e.resource === 'grain').reduce((n, e) => n + (e.type === 'deposit' ? e.amount : 0), 0);
    expect(delivered).toBeGreaterThanOrEqual(fieldYield(h.state, h.world.map, field));
    expect(h.state.resources.grain).toBe(delivered);
    // The farmer sows again straight away.
    expect(h.events.filter((e) => e.type === 'fieldSown').length).toBeGreaterThanOrEqual(2);
  });

  it('a sown crop ripens on its own, exactly on time', () => {
    const h = makeGame();
    farmingReady(h);
    const field = build(h, 'field', 36, 42);
    field.field = { stage: 'growing', sownAt: h.state.time, ripeAt: h.state.time + FARMING.growSeconds, stock: 0 };
    h.run(FARMING.growSeconds - 1);
    expect(field.field.stage).toBe('growing');
    h.run(2);
    expect(field.field.stage).toBe('ripe');
    expect(field.field.stock).toBe(fieldYield(h.state, h.world.map, field));
  });

  it('fields on the southern meadow yield more', () => {
    const h = makeGame();
    farmingReady(h);
    const meadow = build(h, 'field', 26, 56);
    const clearing = build(h, 'field', 36, 42);
    expect(isFertile(h.world.map, meadow)).toBe(true);
    expect(isFertile(h.world.map, clearing)).toBe(false);
    expect(fieldYield(h.state, h.world.map, meadow)).toBe(Math.round(FARMING.yield * FARMING.fertileMult));
    expect(fieldYield(h.state, h.world.map, clearing)).toBe(FARMING.yield);
    h.state.research.completed.push('cropRotation');
    expect(fieldYield(h.state, h.world.map, clearing)).toBe(Math.round(FARMING.yield * 1.25));
  });

  it('grain in the pot makes three bowls instead of one', () => {
    const h = makeGame();
    const cook = villager(h);
    h.state.resources.stew = 0;
    h.state.resources.grain = 3;
    assignVillager(h.state, h.world, cook.id, { kind: 'operate', buildingId: building(h, 'cookhouse').id }, h.events);
    h.run(60);
    const pots = h.events.filter((e) => e.type === 'produced' && e.resource === 'stew');
    expect(pots.length).toBeGreaterThan(3);
    expect(pots.slice(0, 3).every((e) => e.type === 'produced' && e.amount === 1 + FARMING.cookBonus)).toBe(true);
    expect(pots.slice(3).every((e) => e.type === 'produced' && e.amount === 1)).toBe(true);
    expect(h.state.resources.grain).toBe(0);
    const est = estimateJob(h.state, h.world, cook, cook.job!);
    expect(est?.consumes.grain ?? 0).toBe(0);
    h.state.resources.grain = 10;
    expect(estimateJob(h.state, h.world, cook, cook.job!)?.consumes.grain).toBeGreaterThan(0);
  });

  it('one big step equals many small ones with fields in play', () => {
    const h = makeGame();
    farmingReady(h);
    build(h, 'granary', 36, 38);
    const field = build(h, 'field', 36, 42);
    assignVillager(h.state, h.world, villager(h, 0).id, { kind: 'operate', buildingId: field.id }, h.events);
    assignVillager(h.state, h.world, villager(h, 1).id, { kind: 'operate', buildingId: field.id }, h.events);
    const copy = cloneGame(h);
    h.run(1800);
    copy.run(1800, 0.25);
    expect(copy.state.resources.grain).toBeCloseTo(h.state.resources.grain, 6);
    expect(copy.state.buildings.find((b) => b.id === field.id)?.field).toEqual(field.field);
    expect(copy.state.time).toBeCloseTo(h.state.time, 6);
  });

  it('old saves gain grain and empty field slots', () => {
    const old = { schemaVersion: 10, resources: { timber: 5, stew: 3 }, buildings: [{ id: 1, defId: 'cookhouse' }] };
    const out = migrate(old) as { resources: Record<string, number>; buildings: { field: unknown }[] };
    expect(out.resources.grain).toBe(0);
    expect(out.buildings[0].field).toBeNull();
  });
});
