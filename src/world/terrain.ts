import type { VillageMapDef } from '../config/villageMap';
import { distanceToPolyline, smoothstep } from './geometry';
import { fbm } from './noise';

export const WATER_LEVEL = -0.22;
const SAMPLE_STEP = 0.5;

/**
 * Static terrain field derived from a map definition. Heights are precomputed on a
 * half-tile lattice (including the decorative margin) and bilinearly interpolated.
 * Pure data: shared by the simulation (walkability) and the renderer (meshes).
 */
export class Terrain {
  readonly minX: number;
  readonly minZ: number;
  readonly cols: number;
  readonly rows: number;
  private readonly heights: Float32Array;
  private readonly water: Float32Array;
  private readonly pathField: Float32Array;

  constructor(readonly map: VillageMapDef) {
    this.minX = -map.margin;
    this.minZ = -map.margin;
    this.cols = Math.round((map.width + map.margin * 2) / SAMPLE_STEP) + 1;
    this.rows = Math.round((map.height + map.margin * 2) / SAMPLE_STEP) + 1;
    const n = this.cols * this.rows;
    this.heights = new Float32Array(n);
    this.water = new Float32Array(n);
    this.pathField = new Float32Array(n);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = this.minX + c * SAMPLE_STEP;
        const z = this.minZ + r * SAMPLE_STEP;
        const i = r * this.cols + c;
        const w = this.computeWaterSdf(x, z);
        this.water[i] = w;
        this.pathField[i] = this.computePath(x, z);
        this.heights[i] = this.computeHeight(x, z, w);
      }
    }
  }

  /** Signed distance to open water (negative inside a lake or the creek). */
  private computeWaterSdf(x: number, z: number): number {
    let lake = Infinity;
    for (const c of this.map.lake) lake = Math.min(lake, Math.hypot(x - c.x, z - c.z) - c.r);
    const wobble = fbm(x * 0.35, z * 0.35, this.map.seed + 7, 2) * 0.6;
    const creek = distanceToPolyline(x, z, this.map.creek.points) - this.map.creek.width / 2;
    return Math.min(lake + wobble, creek + wobble * 0.4);
  }

  private computePath(x: number, z: number): number {
    let best = 0;
    for (const p of this.map.paths) {
      const d = distanceToPolyline(x, z, p.points);
      best = Math.max(best, 1 - smoothstep(p.width * 0.28, p.width * 0.8, d));
    }
    return best;
  }

  private computeHeight(x: number, z: number, waterSdf: number): number {
    const { map } = this;
    let h = fbm(x * 0.08, z * 0.08, map.seed, 4) * 0.22;
    for (const hill of map.hills) {
      const d = Math.hypot(x - hill.x, z - hill.z);
      h += hill.h * smoothstep(hill.r, 0, d);
    }
    // Mountains rise beyond the north, east and west edges. The south edge is the
    // camera's default side, so it only rolls gently and never blocks the view.
    const ridge = fbm(x * 0.06, z * 0.06, map.seed + 31, 3) * 0.5 + 0.5;
    const tall = Math.max(-x, x - map.width, -z, 0);
    if (tall > 0) h += Math.pow(tall, 1.25) * (0.42 + ridge * 0.5);
    const south = Math.max(z - map.height, 0);
    if (south > 0) h += south * 0.1 * ridge;
    // Carve water basins; keep banks gently sloped.
    const shore = WATER_LEVEL + 0.06;
    if (waterSdf >= 0) {
      if (waterSdf < 1.8) h = shore + (h - shore) * smoothstep(0, 1.8, waterSdf);
    } else {
      const depth = 0.3 + smoothstep(0, 3.2, -waterSdf) * 1.1;
      h = shore - depth * smoothstep(0, 0.7, -waterSdf);
    }
    // Flatten the dirt paths slightly so roads read as worn-in.
    const p = this.computePath(x, z);
    if (p > 0) h -= p * 0.04;
    return h;
  }

  private sample(field: Float32Array, x: number, z: number): number {
    const fx = Math.max(0, Math.min(this.cols - 1.001, (x - this.minX) / SAMPLE_STEP));
    const fz = Math.max(0, Math.min(this.rows - 1.001, (z - this.minZ) / SAMPLE_STEP));
    const c = Math.floor(fx);
    const r = Math.floor(fz);
    const tx = fx - c;
    const tz = fz - r;
    const i = r * this.cols + c;
    const a = field[i];
    const b = field[i + 1];
    const d = field[i + this.cols];
    const e = field[i + this.cols + 1];
    return a + (b - a) * tx + (d - a) * tz + (a - b - d + e) * tx * tz;
  }

  heightAt(x: number, z: number): number {
    return this.sample(this.heights, x, z);
  }

  waterSdfAt(x: number, z: number): number {
    return this.sample(this.water, x, z);
  }

  pathAt(x: number, z: number): number {
    return this.sample(this.pathField, x, z);
  }

  isBridge(x: number, z: number): boolean {
    for (const b of this.map.bridges) {
      if (distanceToPolyline(x, z, b.points) < b.width / 2) return true;
    }
    return false;
  }

  /** Walking height, following bridge decks over water. */
  groundHeightAt(x: number, z: number): number {
    const h = this.heightAt(x, z);
    if (h < WATER_LEVEL + 0.12 && this.isBridge(x, z)) return WATER_LEVEL + 0.28;
    return h;
  }
}
