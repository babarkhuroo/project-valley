import { BUILDINGS } from '../config/buildings';
import type { Terrain } from '../world/terrain';
import type { BuildingInstance, GameState, Rotation, Vec2 } from './types';

/**
 * Tile grid used for walkability, building placement and pathfinding. Derived data:
 * rebuilt from the static terrain plus current building/node positions, never saved.
 */
export class NavGrid {
  readonly width: number;
  readonly height: number;
  readonly terrainWalkable: Uint8Array;
  readonly terrainBuildable: Uint8Array;
  readonly bridge: Uint8Array;
  /** Movement cost multiplier (paths and bridges are cheaper). */
  readonly moveCost: Float32Array;
  /** Building id occupying the tile, 0 when free. */
  readonly occupancy: Int32Array;
  /** Resource node id on the tile, 0 when none. */
  readonly nodeAt: Int32Array;

  constructor(readonly terrain: Terrain) {
    const { width, height } = terrain.map;
    this.width = width;
    this.height = height;
    const n = width * height;
    this.terrainWalkable = new Uint8Array(n);
    this.terrainBuildable = new Uint8Array(n);
    this.bridge = new Uint8Array(n);
    this.moveCost = new Float32Array(n);
    this.occupancy = new Int32Array(n);
    this.nodeAt = new Int32Array(n);
    for (let cz = 0; cz < height; cz++) {
      for (let cx = 0; cx < width; cx++) {
        this.classify(cx, cz);
      }
    }
  }

  private classify(cx: number, cz: number): void {
    const t = this.terrain;
    const i = cz * this.width + cx;
    const x = cx + 0.5;
    const z = cz + 0.5;
    const samples = [t.heightAt(x, z), t.heightAt(cx, cz), t.heightAt(cx + 1, cz), t.heightAt(cx, cz + 1), t.heightAt(cx + 1, cz + 1)];
    const hMin = Math.min(...samples);
    const hMax = Math.max(...samples);
    const slope = hMax - hMin;
    const water = t.waterSdfAt(x, z);
    const isBridge = t.isBridge(x, z);
    this.bridge[i] = isBridge ? 1 : 0;
    const wet = water < 0.3;
    const walkable = isBridge || (!wet && slope < 0.9 && samples[0] < 2.4);
    this.terrainWalkable[i] = walkable ? 1 : 0;
    const edge = cx < 1 || cz < 1 || cx > this.width - 2 || cz > this.height - 2;
    this.terrainBuildable[i] = walkable && !isBridge && !edge && water > 1.0 && slope < 0.42 && samples[0] < 1.4 ? 1 : 0;
    this.moveCost[i] = isBridge || t.pathAt(x, z) > 0.5 ? 0.75 : 1;
  }

  index(cx: number, cz: number): number {
    return cz * this.width + cx;
  }

  inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.width && cz < this.height;
  }

  walkable(cx: number, cz: number): boolean {
    if (!this.inBounds(cx, cz)) return false;
    const i = cz * this.width + cx;
    return this.terrainWalkable[i] === 1 && this.occupancy[i] === 0;
  }

  walkableAt(p: Vec2): boolean {
    return this.walkable(Math.floor(p.x), Math.floor(p.z));
  }

  syncBuildings(state: GameState): void {
    this.occupancy.fill(0);
    for (const b of state.buildings) {
      for (const [cx, cz] of footprintCells(b.defId, b.cellX, b.cellZ, b.rotation)) {
        if (this.inBounds(cx, cz)) this.occupancy[this.index(cx, cz)] = b.id;
      }
    }
  }

  syncNodes(state: GameState): void {
    this.nodeAt.fill(0);
    for (const n of state.nodes) {
      const cx = Math.floor(n.x);
      const cz = Math.floor(n.z);
      if (this.inBounds(cx, cz)) this.nodeAt[this.index(cx, cz)] = n.id;
    }
  }

  /** Nearest walkable tile centre to `p`, searching outward in rings. */
  nearestWalkable(p: Vec2, maxRadius = 12): Vec2 | null {
    const cx0 = Math.floor(p.x);
    const cz0 = Math.floor(p.z);
    if (this.walkable(cx0, cz0)) return { x: cx0 + 0.5, z: cz0 + 0.5 };
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (let r = 1; r <= maxRadius; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = cx0 + dx;
          const cz = cz0 + dz;
          if (!this.walkable(cx, cz)) continue;
          const d = Math.hypot(cx + 0.5 - p.x, cz + 0.5 - p.z);
          if (d < bestD) {
            bestD = d;
            best = { x: cx + 0.5, z: cz + 0.5 };
          }
        }
      }
      if (best) return best;
    }
    return null;
  }
}

export function rotatedSize(defId: BuildingInstance['defId'], rotation: Rotation): { w: number; d: number } {
  const { w, d } = BUILDINGS[defId].footprint;
  return rotation % 2 === 0 ? { w, d } : { w: d, d: w };
}

export function footprintCells(defId: BuildingInstance['defId'], cellX: number, cellZ: number, rotation: Rotation): [number, number][] {
  const { w, d } = rotatedSize(defId, rotation);
  const cells: [number, number][] = [];
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) cells.push([cellX + x, cellZ + z]);
  return cells;
}

export function buildingCenter(b: Pick<BuildingInstance, 'defId' | 'cellX' | 'cellZ' | 'rotation'>): Vec2 {
  const { w, d } = rotatedSize(b.defId, b.rotation);
  return { x: b.cellX + w / 2, z: b.cellZ + d / 2 };
}

/** Unit vector pointing out of the building's front door. Rotation 0 faces south (+z). */
export function frontDirection(rotation: Rotation): Vec2 {
  switch (rotation) {
    case 0:
      return { x: 0, z: 1 };
    case 1:
      return { x: 1, z: 0 };
    case 2:
      return { x: 0, z: -1 };
    default:
      return { x: -1, z: 0 };
  }
}

/** Tiles in the one-tile ring around a building footprint. */
export function perimeterCells(b: Pick<BuildingInstance, 'defId' | 'cellX' | 'cellZ' | 'rotation'>): [number, number][] {
  const { w, d } = rotatedSize(b.defId, b.rotation);
  const cells: [number, number][] = [];
  for (let z = -1; z <= d; z++) {
    for (let x = -1; x <= w; x++) {
      if (x >= 0 && x < w && z >= 0 && z < d) continue;
      cells.push([b.cellX + x, b.cellZ + z]);
    }
  }
  return cells;
}
