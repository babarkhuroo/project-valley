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
  stumpGeometry,
} from './models/natureModels';
import { applyWind } from './wind';

interface NodeSlot {
  mesh: THREE.InstancedMesh;
  index: number;
  base: THREE.Matrix4;
  lastScale: number;
  shakeUntil: number;
}

interface DecorLayer {
  mesh: THREE.InstancedMesh;
  cells: Int32Array;
  matrices: THREE.Matrix4[];
  hidden: Uint8Array;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const hidden = new THREE.Matrix4().makeScale(0, 0, 0);

function vertexColorMat(flat = true): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: flat });
}

/**
 * Trees, clay banks and all decorative plants/rocks. Everything is instanced: a few
 * draw calls for hundreds of objects. Resource nodes map instance ids back to node ids
 * for picking, and their visuals follow node state (felled, regrowing, dug out).
 */
export class NatureView {
  readonly group = new THREE.Group();
  /** Meshes that can be picked; instanceId → nodeId via `pickNode`. */
  readonly pickables: THREE.InstancedMesh[] = [];
  private readonly nodeSlots = new Map<number, NodeSlot>();
  private readonly stumpSlots = new Map<number, number>();
  private readonly instanceToNode = new Map<THREE.InstancedMesh, number[]>();
  private stumps!: THREE.InstancedMesh;
  private readonly stumpShown = new Set<number>();
  private decor: DecorLayer[] = [];

  constructor(private readonly terrain: Terrain, private readonly grid: NavGrid, state: GameState) {
    this.buildNodes(state);
    this.buildDecor(state);
  }

  private yAt(x: number, z: number): number {
    return this.terrain.heightAt(x, z);
  }

  private buildNodes(state: GameState): void {
    const trees = state.nodes.filter((n) => n.kind === 'tree');
    const round = trees.filter((n) => n.variant === 0);
    const pines = trees.filter((n) => n.variant === 1);
    const clay = state.nodes.filter((n) => n.kind === 'clay');
    const leafMat = applyWind(vertexColorMat(), 1, 0.9);
    const make = (geo: THREE.BufferGeometry, nodes: ResourceNode[], material: THREE.Material, sizeFor: (n: ResourceNode, r: () => number) => number): void => {
      const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, nodes.length));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = nodes.length;
      const ids: number[] = [];
      const color = new THREE.Color();
      nodes.forEach((n, i) => {
        const r = createRng(n.id * 7919);
        const s = sizeFor(n, r);
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(n.x, this.yAt(n.x, n.z) - 0.03, n.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * Math.PI * 2, 0)),
          new THREE.Vector3(s, s * (0.9 + r() * 0.25), s),
        );
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, color.setScalar(0.88 + r() * 0.2));
        this.nodeSlots.set(n.id, { mesh, index: i, base: m, lastScale: 1, shakeUntil: 0 });
        ids.push(n.id);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.instanceToNode.set(mesh, ids);
      this.pickables.push(mesh);
      this.group.add(mesh);
    };
    make(roundTreeGeometry(), round, leafMat, (_n, r) => 0.85 + r() * 0.35);
    make(pineTreeGeometry(), pines, leafMat, (_n, r) => 0.85 + r() * 0.4);
    make(clayGeometry(), clay, vertexColorMat(), (_n, r) => 0.9 + r() * 0.2);

    this.stumps = new THREE.InstancedMesh(stumpGeometry(), vertexColorMat(), Math.max(1, trees.length));
    this.stumps.castShadow = true;
    trees.forEach((n, i) => {
      this.stumpSlots.set(n.id, i);
      this.stumps.setMatrixAt(i, hidden);
    });
    this.stumps.instanceMatrix.needsUpdate = true;
    this.group.add(this.stumps);
  }

  pickNode(mesh: THREE.Object3D, instanceId: number | undefined): number | null {
    if (instanceId === undefined) return null;
    const ids = this.instanceToNode.get(mesh as THREE.InstancedMesh);
    return ids?.[instanceId] ?? null;
  }

  /** A quick wobble when an axe or shovel lands. */
  shake(nodeId: number, time: number): void {
    const slot = this.nodeSlots.get(nodeId);
    if (slot) slot.shakeUntil = time + 0.35;
  }

  update(state: GameState, realTime: number): void {
    const dirty = new Set<THREE.InstancedMesh>();
    let stumpsDirty = false;
    for (const n of state.nodes) {
      const slot = this.nodeSlots.get(n.id);
      if (!slot) continue;
      const def = NODES[n.kind];
      let scale = 1;
      let stump = 0;
      if (n.regrowAt !== null && n.depletedAt !== null) {
        const p = Math.max(0, Math.min(1, (state.time - n.depletedAt) / Math.max(1, n.regrowAt - n.depletedAt)));
        if (n.kind === 'tree') {
          scale = p < 0.3 ? 0 : 0.25 + 0.75 * smoothstep(0.3, 1, p);
          stump = p < 0.9 ? 1 : 0;
        } else {
          scale = 0.18 + 0.3 * p;
        }
      } else if (n.kind === 'clay') {
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
        if (n.kind === 'clay') tmpS.set(tmpS.x * (0.7 + 0.3 * scale), tmpS.y * scale, tmpS.z * (0.7 + 0.3 * scale));
        else tmpS.multiplyScalar(scale);
        tmpM.compose(tmpP, tmpQ, tmpS);
        slot.mesh.setMatrixAt(slot.index, scale <= 0 ? hidden : tmpM);
        slot.lastScale = shaking ? -1 : scale;
        dirty.add(slot.mesh);
      }
      const si = this.stumpSlots.get(n.id);
      if (si !== undefined) {
        const want = stump === 1;
        if (want !== this.stumpShown.has(si)) {
          if (want) this.stumpShown.add(si);
          else this.stumpShown.delete(si);
          if (want) {
            tmpM.compose(new THREE.Vector3(n.x, this.yAt(n.x, n.z), n.z), tmpQ.identity(), tmpS.set(1, 1, 1));
            this.stumps.setMatrixAt(si, tmpM);
          } else {
            this.stumps.setMatrixAt(si, hidden);
          }
          stumpsDirty = true;
        }
      }
    }
    for (const m of dirty) {
      m.instanceMatrix.needsUpdate = true;
      m.computeBoundingSphere();
    }
    if (stumpsDirty) this.stumps.instanceMatrix.needsUpdate = true;
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
      opts: { scale: [number, number]; colors?: string[]; shadow?: boolean; yOffset?: number; tiltWater?: boolean } = { scale: [1, 1] },
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
      const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, placed.length));
      mesh.count = placed.length;
      mesh.castShadow = opts.shadow ?? false;
      mesh.receiveShadow = true;
      const cells = new Int32Array(placed.length);
      const matrices: THREE.Matrix4[] = [];
      const color = new THREE.Color();
      placed.forEach((p, i) => {
        const y = opts.yOffset !== undefined ? opts.yOffset : this.terrain.heightAt(p.x, p.z) - 0.02;
        const m = new THREE.Matrix4().compose(
          new THREE.Vector3(p.x, y, p.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.rot, 0)),
          new THREE.Vector3(p.s, p.s, p.s),
        );
        matrices.push(m);
        mesh.setMatrixAt(i, m);
        cells[i] = inPlay(p.x, p.z) ? this.grid.index(Math.floor(p.x), Math.floor(p.z)) : -1;
        if (opts.colors) {
          color.set(opts.colors[Math.floor(p.c * opts.colors.length)]);
          mesh.setColorAt(i, color);
        } else {
          color.setRGB(0.9 + p.c * 0.2, 0.9 + p.c * 0.2, 0.9 + p.c * 0.2);
          mesh.setColorAt(i, color);
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
      this.decor.push({ mesh, cells, matrices, hidden: new Uint8Array(placed.length) });
    };

    const W = map.width;
    const H = map.height;
    const M = map.margin;
    const play = { minX: 0.5, maxX: W - 0.5, minZ: 0.5, maxZ: H - 0.5 };
    const wide = { minX: -12, maxX: W + 12, minZ: -12, maxZ: H + 12 };
    const land = (h: number, sdf: number) => sdf > 0.8 && h < 2.6;
    const clear = (x: number, z: number) => Math.hypot(x - map.clearing.x, z - map.clearing.z) > 3.5;

    const grassMat = applyWind(vertexColorMat(false), 1.6, 0.0);
    scatter(grassTuftGeometry(), grassMat, 2600, wide, (x, z, h, sdf) => land(h, sdf) && !nodeCells.has(`${Math.floor(x)},${Math.floor(z)}`), { scale: [0.7, 1.25] });
    const flowerMat = applyWind(vertexColorMat(false), 1.8, 0.0);
    scatter(flowerGeometry(), flowerMat, 900, play, (x, z, h, sdf) => land(h, sdf) && (meadow(x, z) || rng() < 0.18) && !forest(x, z), {
      scale: [0.8, 1.3],
      colors: ['#ffffff', '#f2c14e', '#e86b8a', '#b58be0', '#f08a4b', '#7fb2f0'],
    });
    scatter(bushGeometry(false), applyWind(vertexColorMat(), 0.5, 0.2), 150, wide, (x, z, h, sdf) => land(h, sdf) && clear(x, z) && !nodeCells.has(`${Math.floor(x)},${Math.floor(z)}`), {
      scale: [0.7, 1.2],
      shadow: true,
    });
    scatter(bushGeometry(true), applyWind(vertexColorMat(), 0.5, 0.2), 55, play, (x, z, h, sdf) => land(h, sdf) && clear(x, z), { scale: [0.8, 1.1], shadow: true });
    scatter(pebbleGeometry(), vertexColorMat(), 220, wide, (x, z, h, sdf) => sdf > 0.3 && h < 4 && clear(x, z), { scale: [0.6, 1.6] });
    scatter(reedGeometry(), applyWind(vertexColorMat(false), 1.2, 0.0), 320, wide, (_x, _z, _h, sdf) => sdf > -0.35 && sdf < 0.55, { scale: [0.8, 1.3] });
    scatter(lilyGeometry(), vertexColorMat(), 45, wide, (_x, _z, _h, sdf) => sdf < -1.6, { scale: [0.8, 1.4], yOffset: -0.2 });
    scatter(mushroomGeometry(), vertexColorMat(), 90, play, (x, z, h, sdf) => land(h, sdf) && forest(x, z), { scale: [0.8, 1.4] });

    // Hand-placed boulders from the map, plus rocks scattered on the mountain rim.
    const boulderGeo = boulderGeometry();
    const boulders = new THREE.InstancedMesh(boulderGeo, vertexColorMat(), map.boulders.length + 60);
    boulders.castShadow = true;
    boulders.receiveShadow = true;
    let bi = 0;
    const put = (x: number, z: number, s: number, rot: number) => {
      boulders.setMatrixAt(
        bi++,
        new THREE.Matrix4().compose(new THREE.Vector3(x, this.terrain.heightAt(x, z) - 0.1, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(s, s, s)),
      );
    };
    for (const [x, z, s] of map.boulders) put(x, z, s, rng() * 6);
    for (let i = 0; i < 400 && bi < boulders.count; i++) {
      const x = -M + rng() * (W + 2 * M);
      const z = -M + rng() * (H + 2 * M);
      if (inPlay(x, z) || this.terrain.waterSdfAt(x, z) < 1) continue;
      const h = this.terrain.heightAt(x, z);
      if (h < 2 || h > 12) continue;
      put(x, z, 0.8 + rng() * 1.8, rng() * 6);
    }
    boulders.count = bi;
    boulders.instanceMatrix.needsUpdate = true;
    this.group.add(boulders);

    // Scenic forest on the rim; never pickable.
    const rimTrees = (geo: THREE.BufferGeometry, count: number, pineBias: boolean) => {
      // Scenery: low-poly and shadowless — it is only ever seen from afar.
      const mesh = new THREE.InstancedMesh(geo, applyWind(vertexColorMat(), 0.8, 0.9), count);
      mesh.castShadow = false;
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
        mesh.setMatrixAt(n++, new THREE.Matrix4().compose(new THREE.Vector3(x, h - 0.05, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng() * 6, 0)), new THREE.Vector3(s, s * (0.9 + rng() * 0.3), s)));
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    };
    rimTrees(roundTreeGeometry(0), 480, false);
    rimTrees(pineTreeGeometry(0), 560, true);
  }

  /** Hides decoration under building footprints (call after buildings change). */
  refreshDecor(): void {
    for (const layer of this.decor) {
      let changed = false;
      for (let i = 0; i < layer.cells.length; i++) {
        const cell = layer.cells[i];
        const blocked = cell >= 0 && this.grid.occupancy[cell] !== 0;
        if (blocked !== (layer.hidden[i] === 1)) {
          layer.hidden[i] = blocked ? 1 : 0;
          layer.mesh.setMatrixAt(i, blocked ? hidden : layer.matrices[i]);
          changed = true;
        }
      }
      if (changed) layer.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
