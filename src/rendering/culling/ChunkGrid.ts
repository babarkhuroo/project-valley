import * as THREE from 'three';

export interface CullingSettings {
  frustum: boolean;
  lod: boolean;
  occlusion: boolean;
}

export interface CullingStats {
  chunks: number;
  inView: number;
  occluded: number;
  visible: number;
}

/** How far shadows can reach into view from geometry just outside it (tall tree, low sun). */
const SHADOW_MARGIN = 3;

/**
 * Coarse spatial partition shared by every culled layer. Once per frame it decides
 * which chunks are in the camera frustum, how far each is (for LOD), and — together
 * with `OcclusionQueries` — which are hidden behind terrain or buildings.
 */
export class ChunkGrid {
  readonly cols: number;
  readonly rows: number;
  readonly count: number;
  /** World-space AABB of everything registered in each chunk. */
  readonly bounds: THREE.Box3[];
  /** Bounds grown by the shadow margin, used for the frustum test. */
  private readonly cullBounds: THREE.Box3[];
  readonly used: Uint8Array;
  readonly inView: Uint8Array;
  /** Set by OcclusionQueries. */
  readonly occluded: Uint8Array;
  /** Closest distance from the camera to each chunk's bounds. */
  readonly distance: Float32Array;
  readonly settings: CullingSettings = { frustum: true, lod: true, occlusion: true };
  /** Anything farther than this is lost in fog and skipped. */
  maxDistance = Infinity;
  readonly stats: CullingStats = { chunks: 0, inView: 0, occluded: 0, visible: 0 };
  readonly cameraPosition = new THREE.Vector3();
  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();

  constructor(
    readonly minX: number,
    readonly minZ: number,
    maxX: number,
    maxZ: number,
    readonly size = 12,
  ) {
    this.cols = Math.ceil((maxX - minX) / size);
    this.rows = Math.ceil((maxZ - minZ) / size);
    this.count = this.cols * this.rows;
    this.bounds = Array.from({ length: this.count }, () => new THREE.Box3());
    this.cullBounds = Array.from({ length: this.count }, () => new THREE.Box3());
    this.used = new Uint8Array(this.count);
    this.inView = new Uint8Array(this.count).fill(1);
    this.occluded = new Uint8Array(this.count);
    this.distance = new Float32Array(this.count);
  }

  chunkAt(x: number, z: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.size)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) / this.size)));
    return r * this.cols + c;
  }

  /** Grows a chunk's bounds to contain `box`. */
  include(chunk: number, box: THREE.Box3): void {
    if (this.used[chunk]) this.bounds[chunk].union(box);
    else this.bounds[chunk].copy(box);
    this.used[chunk] = 1;
    this.cullBounds[chunk].copy(this.bounds[chunk]).expandByScalar(SHADOW_MARGIN);
    this.stats.chunks = this.used.reduce((s, u) => s + u, 0);
  }

  isVisible(chunk: number): boolean {
    if (!this.used[chunk]) return false;
    if (this.settings.frustum && !this.inView[chunk]) return false;
    if (this.settings.occlusion && this.occluded[chunk]) return false;
    return this.distance[chunk] <= this.maxDistance;
  }

  /** LOD distance, or 0 when LOD is switched off (everything at full detail). */
  lodDistance(chunk: number): number {
    return this.settings.lod ? this.distance[chunk] : 0;
  }

  update(camera: THREE.Camera): void {
    camera.updateMatrixWorld();
    this.cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    let inView = 0;
    let occluded = 0;
    let visible = 0;
    for (let c = 0; c < this.count; c++) {
      if (!this.used[c]) continue;
      this.inView[c] = this.frustum.intersectsBox(this.cullBounds[c]) ? 1 : 0;
      this.distance[c] = this.bounds[c].distanceToPoint(this.cameraPosition);
      inView += this.inView[c];
      if (this.inView[c] && this.occluded[c]) occluded++;
      if (this.isVisible(c)) visible++;
    }
    this.stats.inView = inView;
    this.stats.occluded = this.settings.occlusion ? occluded : 0;
    this.stats.visible = visible;
  }
}
