import * as THREE from 'three';
import type { ChunkGrid } from './ChunkGrid';

export interface FieldLevel {
  geometry: THREE.BufferGeometry;
  /** Chunks farther than this use the next level (or are hidden after the last). */
  maxDistance: number;
  castShadow: boolean;
}

/** Relative distance band around each LOD boundary that suppresses flicker. */
const HYSTERESIS = 0.07;

/**
 * One instanced layer (e.g. "round trees" or "grass") split across the chunk grid.
 *
 * Instead of one mesh per chunk (which would multiply draw calls), each LOD level is a
 * single InstancedMesh, and the instances of the chunks that are visible at that level
 * are packed into its buffer. Draw calls stay constant; triangles scale with what the
 * camera can actually see. Buffers are re-packed only when chunk visibility, LOD, or an
 * instance changes — a still camera costs nothing.
 */
export class InstanceField {
  readonly group = new THREE.Group();
  readonly meshes: THREE.InstancedMesh[] = [];
  private readonly pending: { chunk: number; matrix: THREE.Matrix4; color: THREE.Color }[] = [];
  private total = 0;
  /** Sorted (chunk-contiguous) storage. */
  private matrices = new Float32Array(0);
  private colors = new Float32Array(0);
  private active = new Uint8Array(0);
  private sourceOfSlot = new Int32Array(0);
  private slotOfSource = new Int32Array(0);
  private chunkStart = new Int32Array(0);
  private chunkEnd = new Int32Array(0);
  private chunks: number[] = [];
  private levelOfChunk = new Int8Array(0);
  private packedSource: Int32Array[] = [];
  private dirty = true;
  private readonly tmpBox = new THREE.Box3();

  constructor(
    private readonly grid: ChunkGrid,
    private readonly material: THREE.Material,
    private readonly levels: FieldLevel[],
    private readonly receiveShadow = true,
  ) {}

  /** Adds an instance before `finalize()`. Returns its stable source index. */
  add(matrix: THREE.Matrix4, color?: THREE.Color): number {
    const pos = new THREE.Vector3().setFromMatrixPosition(matrix);
    this.pending.push({ chunk: this.grid.chunkAt(pos.x, pos.z), matrix: matrix.clone(), color: color ? color.clone() : new THREE.Color(1, 1, 1) });
    return this.pending.length - 1;
  }

  finalize(): this {
    const n = this.pending.length;
    this.total = n;
    this.matrices = new Float32Array(n * 16);
    this.colors = new Float32Array(n * 3);
    this.active = new Uint8Array(n).fill(1);
    this.sourceOfSlot = new Int32Array(n);
    this.slotOfSource = new Int32Array(n);
    this.chunkStart = new Int32Array(this.grid.count).fill(-1);
    this.chunkEnd = new Int32Array(this.grid.count).fill(-1);
    this.levelOfChunk = new Int8Array(this.grid.count).fill(-2);
    const order = [...this.pending.keys()].sort((a, b) => this.pending[a].chunk - this.pending[b].chunk);
    let radius = 0;
    for (const lvl of this.levels) {
      if (!lvl.geometry.boundingBox) lvl.geometry.computeBoundingBox();
      if (!lvl.geometry.boundingSphere) lvl.geometry.computeBoundingSphere();
      radius = Math.max(radius, lvl.geometry.boundingSphere!.radius);
    }
    const world = new THREE.Box3();
    order.forEach((src, slot) => {
      const p = this.pending[src];
      p.matrix.toArray(this.matrices, slot * 16);
      p.color.toArray(this.colors, slot * 3);
      this.sourceOfSlot[slot] = src;
      this.slotOfSource[src] = slot;
      if (this.chunkStart[p.chunk] < 0) {
        this.chunkStart[p.chunk] = slot;
        this.chunks.push(p.chunk);
      }
      this.chunkEnd[p.chunk] = slot + 1;
      this.tmpBox.copy(this.levels[0].geometry.boundingBox!).applyMatrix4(p.matrix);
      this.grid.include(p.chunk, this.tmpBox);
      world.union(this.tmpBox);
    });
    this.pending.length = 0;
    // Picking tests this sphere before individual instances; it must cover the whole field.
    const sphere = world.isEmpty() ? new THREE.Sphere() : world.getBoundingSphere(new THREE.Sphere());
    sphere.radius += radius;
    for (const lvl of this.levels) {
      const mesh = new THREE.InstancedMesh(lvl.geometry, this.material, Math.max(1, n));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, n) * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = lvl.castShadow;
      mesh.receiveShadow = this.receiveShadow;
      // Culling happens per chunk in `sync`; the mesh itself always draws its packed set.
      mesh.frustumCulled = false;
      mesh.boundingSphere = sphere.clone();
      this.meshes.push(mesh);
      this.packedSource.push(new Int32Array(Math.max(1, n)));
      this.group.add(mesh);
    }
    return this;
  }

  setMatrix(source: number, m: THREE.Matrix4): void {
    m.toArray(this.matrices, this.slotOfSource[source] * 16);
    this.dirty = true;
  }

  getMatrix(source: number, out: THREE.Matrix4): THREE.Matrix4 {
    return out.fromArray(this.matrices, this.slotOfSource[source] * 16);
  }

  setActive(source: number, on: boolean): void {
    const slot = this.slotOfSource[source];
    if ((this.active[slot] === 1) === on) return;
    this.active[slot] = on ? 1 : 0;
    this.dirty = true;
  }

  isActive(source: number): boolean {
    return this.active[this.slotOfSource[source]] === 1;
  }

  /** Maps a picked instance back to its source index. */
  sourceFor(mesh: THREE.Object3D, instanceId: number): number | null {
    const level = this.meshes.indexOf(mesh as THREE.InstancedMesh);
    if (level < 0 || instanceId >= this.meshes[level].count) return null;
    return this.packedSource[level][instanceId];
  }

  get instanceCount(): number {
    return this.total;
  }

  private levelFor(distance: number): number {
    let i = 0;
    while (i < this.levels.length && distance > this.levels[i].maxDistance) i++;
    return i; // levels.length = hidden
  }

  /** Recomputes per-chunk levels and re-packs the GPU buffers if anything changed. */
  sync(): void {
    const hidden = this.levels.length;
    for (const c of this.chunks) {
      let next = hidden;
      if (this.grid.isVisible(c)) {
        const d = this.grid.lodDistance(c);
        const cur = this.levelOfChunk[c];
        next = this.levelFor(d);
        // Keep the current level while inside the hysteresis band around a boundary.
        if (cur >= 0 && cur !== next && cur >= this.levelFor(d * (1 - HYSTERESIS)) && cur <= this.levelFor(d * (1 + HYSTERESIS))) next = cur;
      }
      if (this.levelOfChunk[c] !== next) {
        this.levelOfChunk[c] = next;
        this.dirty = true;
      }
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.meshes.forEach((mesh, level) => {
      const mArr = mesh.instanceMatrix.array as Float32Array;
      const cArr = mesh.instanceColor!.array as Float32Array;
      const map = this.packedSource[level];
      let n = 0;
      for (const c of this.chunks) {
        if (this.levelOfChunk[c] !== level) continue;
        for (let slot = this.chunkStart[c]; slot < this.chunkEnd[c]; slot++) {
          if (!this.active[slot]) continue;
          mArr.set(this.matrices.subarray(slot * 16, slot * 16 + 16), n * 16);
          cArr.set(this.colors.subarray(slot * 3, slot * 3 + 3), n * 3);
          map[n] = this.sourceOfSlot[slot];
          n++;
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(0, n * 3);
      mesh.instanceColor!.needsUpdate = true;
    });
  }

  /** Triangles currently submitted (for the dev overlay). */
  triangles(): number {
    let t = 0;
    this.meshes.forEach((m, i) => {
      const g = this.levels[i].geometry;
      t += ((g.index ? g.index.count : g.attributes.position.count) / 3) * m.count;
    });
    return t;
  }
}
