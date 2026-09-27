import { BUILDINGS, type BuildCost, type BuildingId } from '../config/buildings';
import { bumpStat } from './economy';
import type { EventSink } from './events';
import { footprintCells } from './grid';
import { isBuildingUnlocked, maxBuildingCount } from './modifiers';
import { checkNewcomers } from './population';
import { addXp } from './progression';
import type { BuildingInstance, GameState, Rotation } from './types';
import { becomeIdle, villagerPosition } from './villagerAI';
import type { World } from './world';

export function countBuildings(state: GameState, id: BuildingId): number {
  return state.buildings.filter((b) => b.defId === id).length;
}

/** Cost of the next copy of a building (cost tables repeat their last entry). */
export function nextCost(state: GameState, id: BuildingId): BuildCost {
  const costs = BUILDINGS[id].costs;
  return costs[Math.min(countBuildings(state, id), costs.length - 1)];
}

export type PlacementCheck = { ok: true } | { ok: false; reason: string };

/** Pure footprint validation (terrain, overlaps, access). Cost and unlocks are checked separately. */
export function checkFootprint(
  world: World,
  defId: BuildingId,
  cellX: number,
  cellZ: number,
  rotation: Rotation,
  ignoreBuildingId = -1,
): PlacementCheck {
  const { grid } = world;
  const cells = footprintCells(defId, cellX, cellZ, rotation);
  for (const [cx, cz] of cells) {
    if (!grid.inBounds(cx, cz)) return { ok: false, reason: 'Outside the village' };
    const i = grid.index(cx, cz);
    const occupant = grid.occupancy[i];
    if (occupant !== 0 && occupant !== ignoreBuildingId) return { ok: false, reason: 'Overlaps another building' };
    if (grid.nodeAt[i] !== 0) return { ok: false, reason: 'Blocked by a tree or deposit' };
    if (!grid.terrainBuildable[i]) return { ok: false, reason: grid.terrainWalkable[i] ? 'Ground is too uneven' : 'Can’t build on water or cliffs' };
  }
  // Keep at least one open side so villagers can reach the door.
  const set = new Set(cells.map(([x, z]) => `${x},${z}`));
  let open = 0;
  for (const [cx, cz] of cells) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (set.has(`${nx},${nz}`) || !grid.inBounds(nx, nz)) continue;
      const i = grid.index(nx, nz);
      const occ = grid.occupancy[i];
      if (grid.terrainWalkable[i] && (occ === 0 || occ === ignoreBuildingId)) open++;
    }
  }
  if (open === 0) return { ok: false, reason: 'Needs an open side for the door' };
  return { ok: true };
}

export function checkBuildable(state: GameState, defId: BuildingId): PlacementCheck {
  const def = BUILDINGS[defId];
  if (!def.buildable) return { ok: false, reason: 'Cannot be built' };
  if (!isBuildingUnlocked(state, defId)) return { ok: false, reason: 'Needs research' };
  if (countBuildings(state, defId) >= maxBuildingCount(state, defId)) return { ok: false, reason: 'Limit reached' };
  return { ok: true };
}

export function completeConstruction(state: GameState, world: World, b: BuildingInstance, sink: EventSink): void {
  if (b.status === 'complete') return;
  b.status = 'complete';
  b.progress = b.workRequired;
  b.completedAt = state.time;
  bumpStat(state, 'buildings.completed');
  sink.push({ type: 'constructionComplete', buildingId: b.id, defId: b.defId });
  addXp(state, BUILDINGS[b.defId].xp, `Built ${BUILDINGS[b.defId].name}`, sink);
  for (const v of state.villagers) {
    if (v.job?.kind === 'construct' && v.job.buildingId === b.id) becomeIdle(state, world, v, sink, 'finished');
  }
  if (BUILDINGS[b.defId].housing) checkNewcomers(state, sink);
}

export function villagersInFootprint(state: GameState, b: BuildingInstance): number[] {
  const cells = new Set(footprintCells(b.defId, b.cellX, b.cellZ, b.rotation).map(([x, z]) => `${x},${z}`));
  return state.villagers
    .filter((v) => {
      const p = villagerPosition(v, state.time);
      return cells.has(`${Math.floor(p.x)},${Math.floor(p.z)}`);
    })
    .map((v) => v.id);
}
