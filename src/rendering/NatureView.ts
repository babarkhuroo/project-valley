import * as THREE from 'three';
import { NODES } from '../config/nodes';
import type { NavGrid } from '../sim/grid';
import type { GameState, ResourceNode } from '../sim/types';
import { pointInPolygon, smoothstep } from '../world/geometry';
import { createRng } from '../world/noise';
import type { Terrain } from '../world/terrain';
import {
  boulderGeometry,
  bushGeometry,
  clayGeometry,
  flowerGeometry,
  grassTuftGeometry,
  lilyGeometry,
  mushroomGeometry,
  pebbleGeometry,
  pineTreeGeometry,
  reedGeometry,
  roundTreeGeometry,
  stoneOutcropGeometry,
  stumpGeometry,
} from './models/natureModels';
import { applyWind } from './wind';
import type { ChunkGrid } from './culling/ChunkGrid';
import { InstanceField, type FieldLevel } from './culling/InstanceField';

interface NodeSlot {
  field: InstanceField;
  source: number;
  base: THREE.Matrix4;
  lastScale: number;
  shakeUntil: number;
}

interface DecorLayer {
  field: InstanceField;
  cells: Int32Array;
  hidden: Uint8Array;
}

/** LOD switch distance for interactive trees (full → low-poly canopy). */
const TREE_DETAIL_DISTANCE = 38;

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();

function vertexColorMat(flat = true): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: flat });
}

/**
 * Trees, clay banks and all decorative plants/rocks. Every layer is an InstanceField:
 * a constant handful of draw calls, with chunk-level frustum/occlusion culling and
 * distance LOD (detailed → low-poly trees; small decoration fades out with distance).
 * Resource nodes map instances back to node ids for picking, and their visuals follow
 * node state (felled, regrowing, dug out).
 */
export class NatureView {
  readonly group = new THREE.Group();
  /** Meshes that can be picked; instanceId → nodeId via `pickNode`. */
  readonly pickables: THREE.InstancedMesh[] = [];
  private readonly fields: InstanceField[] = [];
  private readonly nodeSlots = new Map<number, NodeSlot>();
  private readonly stumpSlots = new Map<number, number>();
  private readonly pickFields = new Map<THREE.Object3D, { field: InstanceField; ids: number[] }>();
  private stumps!: InstanceField;
  private decor: DecorLayer[] = [];

  constructor(private readonly terrain: Terrain, private readonly grid: NavGrid, private readonly chunks: ChunkGrid, state: GameState) {
    this.buildNodes(state);
    this.buildDecor(state);
  }

  private yAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  private field(material: THREE.Material, levels: FieldLevel[], receiveShadow = true): InstanceField {
    const f = new InstanceField(this.chunks, material, levels, receiveShadow);
    this.fields.push(f);
    return f;
  }

  private attach(f: InstanceField): InstanceField {
    f.finalize();
    this.group.add(f.group);
    return f;
  }

  private buildNodes(state: GameState): void {
    const trees = state.nodes.filter((n) => n.kind === 'tree');
    const round = trees.filter((n) => n.variant === 0);
    const pines = trees.filter((n) => n.variant === 1);
    const clay = state.nodes.filter((n) => n.kind === 'clay');
    const stone = state.nodes.filter((n) => n.kind === 'stone');
    const leafMat = applyWind(vertexColorMat(), 1, 0.9);
    const make = (levels: FieldLevel[], nodes: ResourceNode[], material: THREE.Material, sizeFor: (n: ResourceNode, r: () => number) => number): void => {
      const field = this.field(material, levels);
      const ids: number[] = [];
      const color = new THREE.Color();
      for (const n of nodes) {
        const r = createRng(n.id * 7919);
        const s = sizeFor(n, r);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(n.x, this.yAt(n.x, n.z) - 0.03, n.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * Math.PI * 2, 0)),
          new THREE.Vector3(s, s * (0.9 + r() * 0.25), s),
        );
        const source = field.add(m, color.setScalar(0.88 + r() * 0.2));
        this.nodeSlots.set(n.id, { field, source, base: m, lastScale: 1, shakeUntil: 0 });
        ids[source] = n.id;
      }
      this.attach(field);
      for (const mesh of field.meshes) {
        this.pickFields.set(mesh, { field, ids });
        this.pickables.push(mesh);
      }
    };
    const treeLevels = (hi: THREE.BufferGeometry, lo: THREE.BufferGeometry): FieldLevel[] => [
      { geometry: hi, maxDistance: TREE_DETAIL_DISTANCE, castShadow: true },
      { geometry: lo, maxDistance: Infinity, castShadow: true },
    ];
    make(treeLevels(roundTreeGeometry(1), roundTreeGeometry(0)), round, leafMat, (_n, r) => 0.85 + r() * 0.35);
    make(treeLevels(pineTreeGeometry(1), pineTreeGeometry(0)), pines, leafMat, (_n, r) => 0.85 + r() * 0.4);
    make([{ geometry: clayGeometry(), maxDistance: Infinity, castShadow: true }], clay, vertexColorMat(), (_n, r) => 0.9 + r() * 0.2);
    make([{ geometry: stoneOutcropGeometry(), maxDistance: Infinity, castShadow: true }], stone, vertexColorMat(), (_n, r) => 0.95 + r() * 0.3);

    this.stumps = this.field(vertexColorMat(), [{ geometry: stumpGeometry(), maxDistance: 60, castShadow: true }]);
    for (const n of trees) {
      const source = this.stumps.add(new THREE.Matrix4().makeTranslation(n.x, this.yAt(n.x, n.z), n.z));
      this.stumpSlots.set(n.id, source);
    }
    this.attach(this.stumps);
    for (const source of this.stumpSlots.values()) this.stumps.setActive(source, false);
  }

  pickNode(mesh: THREE.Object3D, instanceId: number | undefined): number | null {
    if (instanceId === undefined) return null;
    const entry = this.pickFields.get(mesh);
    if (!entry) return null;
    const source = entry.field.sourceFor(mesh, instanceId);
    return source === null ? null : (entry.ids[source] ?? null);
  }

  /** Re-packs every layer for the current chunk visibility / LOD (after ChunkGrid.update). */
  sync(): void {
    for (const f of this.fields) f.sync();
  }

  /** Triangles submitted by all nature layers this frame. */
  triangles(): number {
    return this.fields.reduce((s, f) => s + f.triangles(), 0);
  }

  /** A quick wobble when an axe or shovel lands. */
  shake(nodeId: number, time: number): void {
    const slot = this.nodeSlots.get(nodeId);
    if (slot) slot.shakeUntil = time + 0.35;
  }

  update(state: GameState, realTime: number): void {
    for (const n of state.nodes) {
      const slot = this.nodeSlots.get(n.id);
      if (!slot) continue;
      const def = NODES[n.kind];
      let scale = 1;
      let stump = false;
      if (n.regrowAt !== null && n.depletedAt !== null) {
        const p = Math.max(0, Math.min(1, (state.time - n.depletedAt) / Math.max(1, n.regrowAt - n.depletedAt)));
        if (n.kind === 'tree') {
          scale = p < 0.3 ? 0 : 0.25 + 0.75 * smoothstep(0.3, 1, p);
          stump = p < 0.9;
        } else {
          scale = 0.18 + 0.3 * p;
        }
      } else if (n.kind !== 'tree') {
        // Clay banks and outcrops shrink as they are dug out.
        scale = 0.45 + 0.55 * (n.amount / def.amount);
      }
      const shaking = slot.shakeUntil > realTime;
      if (Math.abs(scale - slot.lastScale) > 0.004 || shaking || (slot.lastScale < 0 && !shaking)) {
        slot.base.decompose(tmpP, tmpQ, tmpS);
        if (shaking) {
          const k = (slot.shakeUntil - realTime) / 0.35;
          const wob = Math.sin(realTime * 60) * 0.05 * k;
          tmpQ.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(wob, 0, wob * 0.7)));
        }
        if (n.kind !== 'tree') tmpS.set(tmpS.x * (0.7 + 0.3 * scale), tmpS.y * scale, tmpS.z * (0.7 + 0.3 * scale));
        else tmpS.multiplyScalar(scale);
        slot.field.setActive(slot.source, scale > 0);
        if (scale > 0) slot.field.setMatrix(slot.source, tmpM.compose(tmpP, tmpQ, tmpS));
        slot.lastScale = shaking ? -1 : scale;
      }
      const si = this.stumpSlots.get(n.id);
      if (si !== undefined) this.stumps.setActive(si, stump);
    }
  }

  // -------------------------------------------------------------------------
  // Decoration
  // -------------------------------------------------------------------------

  private buildDecor(state: GameState): void {
    const { map } = this.terrain;
    const rng = createRng(map.seed ^ 0xdec0);
    const nodeCells = new Set(state.nodes.map((n) => `${Math.floor(n.x)},${Math.floor(n.z)}`));
    const inPlay = (x: number, z: number) => x >= 0 && z >= 0 && x < map.width && z < map.height;
    const forest = (x: number, z: number) => map.forests.some((f) => pointInPolygon(x, z, f.polygon));
    const meadow = (x: number, z: number) => map.meadows.some((m) => pointInPolygon(x, z, m));
    const startCells = new Set<string>();
    for (const b of state.buildings) {
      const { w, d } = { w: 4, d: 4 };
      for (let dz = -1; dz < d; dz++) for (let dx = -1; dx < w; dx++) startCells.add(`${b.cellX + dx},${b.cellZ + dz}`);
    }

    const scatter = (
      geo: THREE.BufferGeometry,
      material: THREE.Material,
      count: number,
      area: { minX: number; maxX: number; minZ: number; maxZ: number },
      accept: (x: number, z: number, h: number, sdf: number) => boolean,
      opts: { scale: [number, number]; colors?: string[]; shadow?: boolean; yOffset?: number; fadeAt?: number } = { scale: [1, 1] },
    ): void => {
      const placed: { x: number; z: number; s: number; rot: number; c: number }[] = [];
      for (let attempt = 0; attempt < count * 6 && placed.length < count; attempt++) {
        const x = area.minX + rng() * (area.maxX - area.minX);
        const z = area.minZ + rng() * (area.maxZ - area.minZ);
        const h = this.terrain.heightAt(x, z);
        const sdf = this.terrain.waterSdfAt(x, z);
        if (!accept(x, z, h, sdf)) continue;
        const key = `${Math.floor(x)},${Math.floor(z)}`;
        if (inPlay(x, z) && (this.terrain.pathAt(x, z) > 0.25 || startCells.has(key) || this.terrain.isBridge(x, z))) continue;
        placed.push({ x, z, s: opts.scale[0] + rng() * (opts.scale[1] - opts.scale[0]), rot: rng() * Math.PI * 2, c: rng() });
      }
      const field = this.field(material, [{ geometry: geo, maxDistance: opts.fadeAt ?? Infinity, castShadow: opts.shadow ?? false }]);
      const cells = new Int32Array(placed.length);
      const color = new THREE.Color();
      placed.forEach((p, i) => {
        const y = opts.yOffset !== undefined ? opts.yOffset : this.terrain.heightAt(p.x, p.z) - 0.02;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(p.x, y, p.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.rot, 0)),
          new THREE.Vector3(p.s, p.s, p.s),
        );
        cells[i] = inPlay(p.x, p.z) ? this.grid.index(Math.floor(p.x), Math.floor(p.z)) : -1;
        if (opts.colors) color.set(opts.colors[Math.floor(p.c * opts.colors.length)]);
        else color.setScalar(0.9 + p.c * 0.2);
        field.add(m, color);
      });
      this.attach(field);
      this.decor.push({ field, cells, hidden: new Uint8Array(placed.length) });
    };

    const W = map.width;
    const H = map.height;
    const M = map.margin;
    const play = { minX: 0.5, maxX: W - 0.5, minZ: 0.5, maxZ: H - 0.5 };
    const wide = { minX: -12, maxX: W + 12, minZ: -12, maxZ: H + 12 };
    const land = (h: number, sdf: number) => sdf > 0.8 && h < 2.6;
    const clear = (x: number, z: number) => Math.hypot(x - map.clearing.x, z - map.clearing.z) > 3.5;

    const grassMat = applyWind(vertexColorMat(false), 1.6, 0.0);
    scatter(grassTuftGeometry(), grassMat, 2600, wide, (x, z, h, sdf) => land(h, sdf) && !nodeCells.has(`${Math.floor(x)},${Math.floor(z)}`), { scale: [0.7, 1.25], fadeAt: 46 });
    const flowerMat = applyWind(vertexColorMat(false), 1.8, 0.0);
    scatter(flowerGeometry(), flowerMat, 900, play, (x, z, h, sdf) => land(h, sdf) && (meadow(x, z) || rng() < 0.18) && !forest(x, z), {
      scale: [0.8, 1.3],
      colors: ['#ffffff', '#f2c14e', '#e86b8a', '#b58be0', '#f08a4b', '#7fb2f0'],
      fadeAt: 58,
    });
    scatter(bushGeometry(false), applyWind(vertexColorMat(), 0.5, 0.2), 150, wide, (x, z, h, sdf) => land(h, sdf) && clear(x, z) && !nodeCells.has(`${Math.floor(x)},${Math.floor(z)}`), {
      scale: [0.7, 1.2],
      shadow: true,
      fadeAt: 80,
    });
    scatter(bushGeometry(true), applyWind(vertexColorMat(), 0.5, 0.2), 55, play, (x, z, h, sdf) => land(h, sdf) && clear(x, z), { scale: [0.8, 1.1], shadow: true, fadeAt: 80 });
    scatter(pebbleGeometry(), vertexColorMat(), 220, wide, (x, z, h, sdf) => sdf > 0.3 && h < 4 && clear(x, z), { scale: [0.6, 1.6], fadeAt: 40 });
    scatter(reedGeometry(), applyWind(vertexColorMat(false), 1.2, 0.0), 320, wide, (_x, _z, _h, sdf) => sdf > -0.35 && sdf < 0.55, { scale: [0.8, 1.3], fadeAt: 52 });
    scatter(lilyGeometry(), vertexColorMat(), 45, wide, (_x, _z, _h, sdf) => sdf < -1.6, { scale: [0.8, 1.4], yOffset: -0.2, fadeAt: 60 });
    scatter(mushroomGeometry(), vertexColorMat(), 90, play, (x, z, h, sdf) => land(h, sdf) && forest(x, z), { scale: [0.8, 1.4], fadeAt: 34 });

    // Hand-placed boulders from the map, plus rocks scattered on the mountain rim.
    const boulders = this.field(vertexColorMat(), [{ geometry: boulderGeometry(), maxDistance: Infinity, castShadow: true }]);
    const put = (x: number, z: number, s: number, rot: number) => {
      boulders.add(
        new THREE.Matrix4().compose(new THREE.Vector3(x, this.terrain.heightAt(x, z) - 0.1, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(s, s, s)),
      );
    };
    for (const [x, z, s] of map.boulders) put(x, z, s, rng() * 6);
    let rimRocks = 0;
    for (let i = 0; i < 400 && rimRocks < 60; i++) {
      const x = -M + rng() * (W + 2 * M);
      const z = -M + rng() * (H + 2 * M);
      if (inPlay(x, z) || this.terrain.waterSdfAt(x, z) < 1) continue;
      const h = this.terrain.heightAt(x, z);
      if (h < 2 || h > 12) continue;
      put(x, z, 0.8 + rng() * 1.8, rng() * 6);
      rimRocks++;
    }
    this.attach(boulders);

    // Scenic forest on the rim; never pickable.
    const rimTrees = (geo: THREE.BufferGeometry, count: number, pineBias: boolean) => {
      // Scenery: low-poly and shadowless — it is only ever seen from afar.
      const field = this.field(applyWind(vertexColorMat(), 0.8, 0.9), [{ geometry: geo, maxDistance: Infinity, castShadow: false }], false);
      let n = 0;
      for (let i = 0; i < count * 8 && n < count; i++) {
        const x = -M + rng() * (W + 2 * M);
        const z = -M + rng() * (H + 2 * M);
        const out = Math.max(-x, x - W, -z, z - H, 0);
        if (out < 0.6) continue;
        // Keep the camera side (south) open so trees never stand between camera and village.
        if (z > H && rng() < 0.85) continue;
        const h = this.terrain.heightAt(x, z);
        if (this.terrain.waterSdfAt(x, z) < 1 || h > 8.5) continue;
        if (pineBias !== h > 3 && rng() < 0.7) continue;
        const s = 0.9 + rng() * 0.6;
        field.add(new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.05, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * 6, 0)), new THREE.Vector3(s, s * (0.9 + rng() * 0.3), s)));
        n++;
      }
      this.attach(field);
    };
    rimTrees(roundTreeGeometry(0), 480, false);
    rimTrees(pineTreeGeometry(0), 560, true);
  }

  /** Hides decoration under building footprints (call after buildings change). */
  refreshDecor(): void {
    for (const layer of this.decor) {
      for (let i = 0; i < layer.cells.length; i++) {
        const cell = layer.cells[i];
        const blocked = cell >= 0 && this.grid.occupancy[cell] !== 0;
        if (blocked !== (layer.hidden[i] === 1)) {
          layer.hidden[i] = blocked ? 1 : 0;
          layer.field.setActive(i, !blocked);
        }
      }
    }
  }
}
