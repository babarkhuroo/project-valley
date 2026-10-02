import { VALLEY_BUILDING_ORDER, VALLEY_BUILDINGS, type ValleyBuildingDef } from '../../config/valley';
import { VALLEY_MAP } from '../../config/valleyMap';
import { newValleyState } from '../../sim/save';
import type { GameState, ResourceNode } from '../../sim/types';
import { createWorld, generateNodes, type World } from '../../sim/world';
import { VALLEY_MODEL_SIZE } from '../models/valleyModels';

/** Grid cells covered by a Valley building's (rotated) footprint, with a small margin. */
export function valleyFootprintCells(def: ValleyBuildingDef, margin = 0.6): [number, number][] {
  const { hx, hz } = VALLEY_MODEL_SIZE[def.model];
  const c = Math.cos(def.facing);
  const s = Math.sin(def.facing);
  const ex = Math.abs(hx * c) + Math.abs(hz * s) + margin;
  const ez = Math.abs(hx * s) + Math.abs(hz * c) + margin;
  const cells: [number, number][] = [];
  for (let z = Math.floor(def.z - ez); z <= Math.floor(def.z + ez); z++) {
    for (let x = Math.floor(def.x - ex); x <= Math.floor(def.x + ex); x++) cells.push([x, z]);
  }
  return cells;
}

export interface ValleyScene {
  world: World;
  /** Scenery-only state for NatureView/VillagersView: decorative trees, no village. */
  scenery: GameState;
}

/**
 * The Valley as the renderer needs it: terrain, a nav grid with the communal buildings
 * blocked out (for strolling neighbours and decor), and seeded scenery trees. Purely
 * presentational — the Valley's real state lives on the server.
 */
export function createValleyScene(): ValleyScene {
  const world = createWorld(VALLEY_MAP);
  for (const id of VALLEY_BUILDING_ORDER) {
    for (const [cx, cz] of valleyFootprintCells(VALLEY_BUILDINGS[id])) {
      if (world.grid.inBounds(cx, cz)) world.grid.occupancy[world.grid.index(cx, cz)] = -1;
    }
  }
  const clear = (n: ResourceNode) => {
    const cx = Math.floor(n.x);
    const cz = Math.floor(n.z);
    return world.grid.inBounds(cx, cz) && world.grid.occupancy[world.grid.index(cx, cz)] === 0;
  };
  const nodes = generateNodes(world, 1).filter(clear);
  const scenery = {
    time: 0,
    nextId: 100000,
    villagers: [],
    buildings: [],
    nodes,
    research: { completed: [], progress: {}, active: null },
    valley: newValleyState(),
    resources: {},
  } as unknown as GameState;
  return { world, scenery };
}
