import * as THREE from 'three';
import type { VillageMapDef } from '../config/villageMap';
import type { NavGrid } from '../sim/grid';
import { pointInPolygon, smoothstep } from '../world/geometry';
import { fbm } from '../world/noise';
import { WATER_LEVEL, type Terrain } from '../world/terrain';
import { PALETTE } from './materials';

const STEP = 0.5;
/** The ground is split into TILES×TILES meshes so off-screen tiles are frustum-culled. */
const TILES = 4;

function inForest(map: VillageMapDef, x: number, z: number): boolean {
  return map.forests.some((f) => pointInPolygon(x, z, f.polygon));
}

/**
 * Ground mesh with hand-tuned vertex colours (grass, forest floor, meadows, dirt
 * roads, sandy banks, clay earth and mountain rock), plus the placement grid overlay.
 */
export class TerrainView {
  readonly mesh: THREE.Group;
  readonly gridOverlay: THREE.Mesh;
  private readonly gridTexture: THREE.DataTexture;
  private readonly gridData: Uint8Array;
  private groundMaterial!: THREE.MeshLambertMaterial;
  private wet = -1;

  constructor(private readonly terrain: Terrain, private readonly grid: NavGrid) {
    this.mesh = this.buildGround();
    const { overlay, texture, data } = this.buildGridOverlay();
    this.gridOverlay = overlay;
    this.gridTexture = texture;
    this.gridData = data;
  }

  /** Rain darkens the ground a little (0 = dry, 1 = soaked). */
  setWetness(w: number): void {
    if (Math.abs(w - this.wet) < 0.01) return;
    this.wet = w;
    this.groundMaterial.color.setScalar(1 - w * 0.17);
  }

  private buildGround(): THREE.Group {
    const { map } = this.terrain;
    const sizeX = map.width + map.margin * 2;
    const sizeZ = map.height + map.margin * 2;
    const group = new THREE.Group();
    group.name = 'terrain';
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.groundMaterial = material;
    const tileX = sizeX / TILES;
    const tileZ = sizeZ / TILES;
    for (let tz = 0; tz < TILES; tz++) {
      for (let tx = 0; tx < TILES; tx++) {
        const x0 = -map.margin + tx * tileX;
        const z0 = -map.margin + tz * tileZ;
        const mesh = new THREE.Mesh(this.buildTile(x0, z0, tileX, tileZ), material);
        mesh.receiveShadow = true;
        mesh.name = `terrain-${tx}-${tz}`;
        group.add(mesh);
      }
    }
    return group;
  }

  private buildTile(x0: number, z0: number, sizeX: number, sizeZ: number): THREE.BufferGeometry {
    const { map } = this.terrain;
    const geo = new THREE.PlaneGeometry(sizeX, sizeZ, Math.round(sizeX / STEP), Math.round(sizeZ / STEP));
    geo.rotateX(-Math.PI / 2);
    geo.translate(x0 + sizeX / 2, 0, z0 + sizeZ / 2);
    const pos = geo.attributes.position;
    const normals = geo.attributes.normal;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const tmp = new THREE.Color();
    const cols = {
      grass: new THREE.Color(PALETTE.grass),
      grassDark: new THREE.Color(PALETTE.grassDark),
      forest: new THREE.Color(PALETTE.forestFloor),
      meadow: new THREE.Color(PALETTE.meadow),
      dirt: new THREE.Color(PALETTE.dirt),
      sand: new THREE.Color(PALETTE.sand),
      bed: new THREE.Color(PALETTE.seabed),
      rock: new THREE.Color(PALETTE.rock),
      rockDark: new THREE.Color(PALETTE.rockDark),
      snow: new THREE.Color(PALETTE.snow),
      clay: new THREE.Color(PALETTE.clayEarth),
    };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.terrain.heightAt(x, z);
      pos.setY(i, h);
      // Analytic normals from the height field: identical on both sides of a tile seam.
      const e = STEP;
      const nx = this.terrain.heightAt(x - e, z) - this.terrain.heightAt(x + e, z);
      const nz = this.terrain.heightAt(x, z - e) - this.terrain.heightAt(x, z + e);
      const len = Math.hypot(nx, 2 * e, nz);
      normals.setXYZ(i, nx / len, (2 * e) / len, nz / len);
      const slope = Math.max(
        Math.abs(this.terrain.heightAt(x + 0.5, z) - this.terrain.heightAt(x - 0.5, z)),
        Math.abs(this.terrain.heightAt(x, z + 0.5) - this.terrain.heightAt(x, z - 0.5)),
      );
      const n = fbm(x * 0.15, z * 0.15, map.seed + 3, 3) * 0.5 + 0.5;
      c.copy(cols.grass).lerp(cols.grassDark, smoothstep(0.35, 0.75, n));
      const jx = x + fbm(x * 0.4, z * 0.4, 9, 2) * 1.2;
      const jz = z + fbm(x * 0.4, z * 0.4, 13, 2) * 1.2;
      if (inForest(map, jx, jz)) c.lerp(cols.forest, 0.75);
      if (map.meadows.some((m) => pointInPolygon(jx, jz, m))) c.lerp(cols.meadow, 0.55 + n * 0.2);
      let clayD = Infinity;
      for (const [cx, cz] of map.clayDeposits) clayD = Math.min(clayD, Math.hypot(x - cx, z - cz));
      c.lerp(cols.clay, (1 - smoothstep(0.4, 1.5, clayD)) * 0.45);
      const p = this.terrain.pathAt(x, z) + fbm(x * 0.9, z * 0.9, 77, 2) * 0.22;
      if (p > 0.1) c.lerp(tmp.copy(cols.dirt).multiplyScalar(0.94 + n * 0.1), smoothstep(0.15, 0.7, p));
      // Rocky slopes and mountains.
      const rockiness = Math.max(smoothstep(0.35, 0.8, slope), smoothstep(1.9, 3.2, h));
      c.lerp(tmp.copy(cols.rock).lerp(cols.rockDark, n), rockiness * 0.85);
      if (h > 7) c.lerp(cols.snow, smoothstep(7, 9.5, h));
      // Banks and lake bed.
      const sdf = this.terrain.waterSdfAt(x, z);
      c.lerp(cols.sand, (1 - smoothstep(0.1, 1.3, sdf)) * 0.9);
      if (h < WATER_LEVEL) c.lerp(cols.bed, smoothstep(WATER_LEVEL, WATER_LEVEL - 0.6, h));
      // Gently mute the land outside the playable square.
      const out = Math.max(-x, x - map.width, -z, z - map.height, 0);
      if (out > 0) c.multiplyScalar(1 - Math.min(0.12, out * 0.02));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }

  private buildGridOverlay(): { overlay: THREE.Mesh; texture: THREE.DataTexture; data: Uint8Array } {
    const { width, height } = this.terrain.map;
    const geo = new THREE.PlaneGeometry(width, height, width * 2, height * 2);
    geo.rotateX(-Math.PI / 2);
    geo.translate(width / 2, 0, height / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.terrain.groundHeightAt(pos.getX(i), pos.getZ(i)) + 0.04);
    geo.computeVertexNormals();
    const data = new Uint8Array(width * height * 4);
    const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uCells: { value: texture }, uSize: { value: new THREE.Vector2(width, height) } },
      vertexShader: `
        varying vec2 vCell;
        void main() {
          vCell = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uCells;
        uniform vec2 uSize;
        varying vec2 vCell;
        void main() {
          vec4 cell = texture2D(uCells, (floor(vCell) + 0.5) / uSize);
          vec2 f = fract(vCell);
          float edge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
          float line = 1.0 - smoothstep(0.02, 0.06, edge);
          vec3 col = mix(cell.rgb, vec3(1.0), line * 0.6);
          float a = cell.a * (0.35 + line * 0.5);
          if (a < 0.01) discard;
          gl_FragColor = vec4(col, a);
        }`,
    });
    const overlay = new THREE.Mesh(geo, material);
    overlay.visible = false;
    overlay.renderOrder = 2;
    return { overlay, texture, data };
  }

  /** Colours the placement grid: soft white where buildable, faint red where not. */
  refreshGrid(): void {
    const { grid } = this;
    const d = this.gridData;
    for (let cz = 0; cz < grid.height; cz++) {
      for (let cx = 0; cx < grid.width; cx++) {
        const i = grid.index(cx, cz);
        const o = i * 4;
        const buildable = grid.terrainBuildable[i] && grid.occupancy[i] === 0 && grid.nodeAt[i] === 0;
        if (buildable) {
          d[o] = 255;
          d[o + 1] = 255;
          d[o + 2] = 240;
          d[o + 3] = 110;
        } else if (grid.terrainWalkable[i]) {
          d[o] = 220;
          d[o + 1] = 90;
          d[o + 2] = 80;
          d[o + 3] = grid.occupancy[i] ? 0 : 60;
        } else {
          d[o + 3] = 0;
        }
      }
    }
    this.gridTexture.needsUpdate = true;
  }
}
