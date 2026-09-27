import { describe, expect, it } from 'vitest';
import { placeBuilding } from '../src/sim/commands';
import { findPath, lineClear, pathLength } from '../src/sim/pathfinding';
import { makeGame } from './helpers';

describe('pathfinding', () => {
  it('finds a path across the clearing', () => {
    const h = makeGame();
    const p = findPath(h.world.grid, { x: 24.5, z: 34.5 }, { x: 40.5, z: 34.5 });
    expect(p).not.toBeNull();
    expect(pathLength(p!)).toBeGreaterThanOrEqual(16);
    expect(pathLength(p!)).toBeLessThan(20);
  });

  it('routes around buildings instead of through them', () => {
    const h = makeGame();
    const kitchen = h.state.buildings.find((b) => b.defId === 'cookhouse')!;
    const from = { x: kitchen.cellX + 1.5, z: kitchen.cellZ - 1.5 };
    const to = { x: kitchen.cellX + 1.5, z: kitchen.cellZ + 4.5 };
    const p = findPath(h.world.grid, from, to)!;
    expect(p).not.toBeNull();
    for (let i = 1; i < p.length; i++) expect(lineClear(h.world.grid, p[i - 1], p[i]) || i === 1 || i === p.length - 1).toBe(true);
    expect(pathLength(p)).toBeGreaterThan(6.2);
  });

  it('never enters the lake, and uses the bridge to cross the creek', () => {
    const h = makeGame();
    expect(h.world.grid.walkable(9, 52)).toBe(false);
    const north = { x: 32.5, z: 44.5 };
    const south = { x: 32.5, z: 56.5 };
    const p = findPath(h.world.grid, north, south)!;
    expect(p).not.toBeNull();
    for (const pt of p) expect(h.world.grid.walkableAt(pt)).toBe(true);
  });

  it('re-plans after a new building blocks the way', () => {
    const h = makeGame();
    const from = { x: 33.5, z: 38.5 };
    const to = { x: 37.5, z: 38.5 };
    const before = pathLength(findPath(h.world.grid, from, to)!);
    h.state.resources.timber = 200;
    const res = placeBuilding(h.state, h.world, 'academy', 34, 37, 0, h.events);
    expect(res.ok).toBe(true);
    const after = findPath(h.world.grid, from, to)!;
    expect(after).not.toBeNull();
    expect(pathLength(after)).toBeGreaterThan(before);
  });
});
