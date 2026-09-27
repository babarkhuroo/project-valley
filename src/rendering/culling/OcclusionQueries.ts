import * as THREE from 'three';
import type { ChunkGrid } from './ChunkGrid';

/** Consecutive "no samples" answers required before a chunk is hidden. */
const HIDE_AFTER = 2;
/** Visible chunks re-tested per frame (round-robin). Hidden chunks are tested every frame. */
const VISIBLE_BUDGET = 6;

const proxyGeometry = new THREE.BoxGeometry(1, 1, 1);
const proxyMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });

/**
 * Hardware occlusion culling with WebGL2 queries. Each chunk has an invisible proxy
 * box drawn after all opaque geometry; ANY_SAMPLES_PASSED_CONSERVATIVE tells us
 * whether any of it survived the depth test. Results are read a frame later (never
 * stalling the GPU), chunks are hidden only after repeated negative answers, and a
 * hidden chunk is re-tested every frame so it reappears as soon as it's uncovered.
 */
export class OcclusionQueries {
  readonly group = new THREE.Group();
  private readonly proxies: (THREE.Mesh | null)[];
  private readonly queries: (WebGLQuery | null)[];
  private readonly pending: Uint8Array;
  private readonly started: Uint8Array;
  private readonly streak: Uint8Array;
  private cursor = 0;
  private readonly expanded = new THREE.Box3();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly grid: ChunkGrid,
  ) {
    this.proxies = new Array(grid.count).fill(null);
    this.queries = new Array(grid.count).fill(null);
    this.pending = new Uint8Array(grid.count);
    this.started = new Uint8Array(grid.count);
    this.streak = new Uint8Array(grid.count);
    this.group.name = 'occlusion-proxies';
  }

  /** Creates proxies for every chunk that has content (call after all layers are registered). */
  build(): void {
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    for (let c = 0; c < this.grid.count; c++) {
      if (!this.grid.used[c] || this.proxies[c]) continue;
      const box = this.grid.bounds[c].clone().expandByScalar(0.3);
      const proxy = new THREE.Mesh(proxyGeometry, proxyMaterial);
      proxy.position.copy(box.getCenter(center));
      proxy.scale.copy(box.getSize(size));
      proxy.renderOrder = 1_000_000;
      proxy.castShadow = false;
      proxy.receiveShadow = false;
      proxy.visible = false;
      proxy.raycast = () => undefined;
      proxy.onBeforeRender = () => {
        const q = this.queries[c];
        if (!q || this.pending[c]) return;
        this.gl.beginQuery(this.gl.ANY_SAMPLES_PASSED_CONSERVATIVE, q);
        this.started[c] = 1;
      };
      proxy.onAfterRender = () => {
        if (!this.started[c]) return;
        this.gl.endQuery(this.gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
        this.started[c] = 0;
        this.pending[c] = 1;
      };
      proxy.updateMatrixWorld();
      this.proxies[c] = proxy;
      this.queries[c] = this.gl.createQuery();
      this.group.add(proxy);
    }
  }

  /** Collects finished queries and schedules this frame's tests. Call before rendering. */
  update(): void {
    const { grid, gl } = this;
    // 1. Harvest results from earlier frames.
    for (let c = 0; c < grid.count; c++) {
      const q = this.queries[c];
      if (!q || !this.pending[c]) continue;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) continue;
      const passed = Boolean(gl.getQueryParameter(q, gl.QUERY_RESULT));
      this.pending[c] = 0;
      if (passed) {
        this.streak[c] = 0;
        grid.occluded[c] = 0;
      } else if (++this.streak[c] >= HIDE_AFTER) {
        grid.occluded[c] = 1;
      }
    }
    // 2. Decide which proxies draw (and therefore query) this frame.
    const enabled = grid.settings.occlusion;
    let budget = VISIBLE_BUDGET;
    let next = this.cursor;
    const n = grid.count;
    for (let k = 0; k < n; k++) {
      const c = (this.cursor + k) % n;
      const proxy = this.proxies[c];
      if (!proxy) continue;
      let test = false;
      if (!enabled || !grid.inView[c] || grid.distance[c] > grid.maxDistance) {
        // Stale answers must never keep something hidden once it comes back into view.
        grid.occluded[c] = 0;
        this.streak[c] = 0;
      } else if (this.expanded.copy(grid.bounds[c]).expandByScalar(1).containsPoint(grid.cameraPosition)) {
        grid.occluded[c] = 0;
      } else if (grid.occluded[c]) {
        test = true;
      } else if (budget > 0) {
        test = true;
        budget--;
        next = (c + 1) % n;
      }
      proxy.visible = test && !this.pending[c];
    }
    this.cursor = next;
  }

  dispose(): void {
    for (const q of this.queries) if (q) this.gl.deleteQuery(q);
  }
}
