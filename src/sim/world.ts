import { VILLAGE_MAP, type VillageMapDef } from '../config/villageMap';
import { NODES } from '../config/nodes';
import { Terrain } from '../world/terrain';
import { pointInPolygon, polygonArea, polygonBounds } from '../world/geometry';
import { createRng } from '../world/noise';
import { NavGrid, footprintCells } from './grid';
import type { GameState, ResourceNode } from './types';

/** Static world context shared by every simulation call. Never saved. */
export interface World {
  map: VillageMapDef;
  terrain: Terrain;
  grid: NavGrid;
}

const worldCache = new Map<string, { terrain: Terrain }>();

export function createWorld(map: VillageMapDef = VILLAGE_MAP): World {
  let cached = worldCache.get(map.id);
  if (!cached) {
    cached = { terrain: new Terrain(map) };
    worldCache.set(map.id, cached);
  }
  const grid = new NavGrid(cached.terrain);
  return { map, terrain: cached.terrain, grid };
}

/** Rebuild the derived occupancy layers after loading or any building change. */
export function syncWorld(world: World, state: GameState): void {
  world.grid.syncBuildings(state);
  world.grid.syncNodes(state);
}

/**
 * Places the map's resource nodes: hand-placed lone trees and clay deposits plus
 * seeded, spacing-aware scattering inside the authored forest zones.
 */
export function generateNodes(world: World, firstId: number): ResourceNode[] {
  const { map, grid } = world;
  const rng = createRng(map.seed ^ 0x5eed);
  const nodes: ResourceNode[] = [];
  const taken: { x: number; z: number }[] = [];
  const reserved = new Set<number>();
  for (const sb of map.startBuildings) {
    for (const [cx, cz] of footprintCells(sb.building, sb.cellX, sb.cellZ, sb.rotation)) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) reserved.add((cz + dz) * map.width + cx + dx);
    }
  }
  let id = firstId;

  const usable = (x: number, z: number, spacing: number, minWater = 0.9): boolean => {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (!grid.inBounds(cx, cz)) return false;
    const i = grid.index(cx, cz);
    if (!grid.terrainWalkable[i] || grid.bridge[i] || grid.moveCost[i] < 1) return false;
    if (reserved.has(i)) return false;
    if (world.terrain.waterSdfAt(x, z) < minWater) return false;
    for (const t of taken) if (Math.hypot(t.x - x, t.z - z) < spacing) return false;
    // One node per tile keeps selection unambiguous.
    for (const n of nodes) if (Math.floor(n.x) === cx && Math.floor(n.z) === cz) return false;
    return true;
  };

  const addNode = (kind: ResourceNode['kind'], x: number, z: number, variant: number): void => {
    nodes.push({ id: id++, kind, x, z, variant, amount: NODES[kind].amount, regrowAt: null, depletedAt: null });
    taken.push({ x, z });
  };

  for (const [x, z] of map.clayDeposits) {
    if (usable(x, z, 1.2, 0.35)) addNode('clay', x, z, Math.floor(rng() * 3));
  }
  for (const [x, z] of map.loneTrees) {
    if (usable(x, z, 1.2)) addNode('tree', x, z, rng() < 0.25 ? 1 : 0);
  }
  for (const zone of map.forests) {
    const b = polygonBounds(zone.polygon);
    const target = Math.round(polygonArea(zone.polygon) * zone.density * 0.75);
    let placed = 0;
    for (let attempt = 0; attempt < target * 30 && placed < target; attempt++) {
      const x = b.minX + rng() * (b.maxX - b.minX);
      const z = b.minZ + rng() * (b.maxZ - b.minZ);
      if (!pointInPolygon(x, z, zone.polygon)) continue;
      if (Math.hypot(x - map.clearing.x, z - map.clearing.z) < map.clearing.r) continue;
      if (!usable(x, z, 1.3)) continue;
      addNode('tree', x, z, rng() < zone.pineRatio ? 1 : 0);
      placed++;
    }
  }
  return nodes;
}
