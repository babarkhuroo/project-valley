import * as THREE from 'three';
import type { VillageMapDef } from '../config/villageMap';
import { createRng } from '../world/noise';
import { pointInPolygon, polygonBounds } from '../world/geometry';
import type { Terrain } from '../world/terrain';

const COUNT = 70;

interface Fly {
  x: number;
  z: number;
  y: number;
  r: number;
  w: number;
  p: number;
  blink: number;
}

/**
 * Evening fireflies over meadows and clearings: one additive instanced mesh whose
 * lights drift on slow loops and blink. Fades in with the night (DayCycle.night).
 */
export class Fireflies {
  readonly mesh: THREE.InstancedMesh;
  private readonly flies: Fly[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  constructor(terrain: Terrain, map: VillageMapDef) {
    const rng = createRng(map.seed ^ 0xf1ee);
    const areas = [...map.meadows];
    const c = map.clearing;
    areas.push([
      [c.x - c.r, c.z - c.r],
      [c.x + c.r, c.z - c.r],
      [c.x + c.r, c.z + c.r],
      [c.x - c.r, c.z + c.r],
    ]);
    for (let attempt = 0; attempt < COUNT * 20 && this.flies.length < COUNT; attempt++) {
      const poly = areas[Math.floor(rng() * areas.length) % areas.length];
      const b = polygonBounds(poly);
      const x = b.minX + rng() * (b.maxX - b.minX);
      const z = b.minZ + rng() * (b.maxZ - b.minZ);
      if (!pointInPolygon(x, z, poly) || terrain.waterSdfAt(x, z) < 0.5) continue;
      this.flies.push({ x, z, y: terrain.heightAt(x, z) + 0.5 + rng() * 1.2, r: 0.4 + rng() * 1.2, w: 0.15 + rng() * 0.35, p: rng() * 10, blink: 0.6 + rng() * 1.4 });
    }
    const material = new THREE.MeshBasicMaterial({ color: '#e9ff8a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 6, 4), material, this.flies.length);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  update(time: number, night: number): void {
    const strength = Math.max(0, (night - 0.4) / 0.6);
    this.mesh.visible = strength > 0.01;
    if (!this.mesh.visible) return;
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = strength;
    this.flies.forEach((f, i) => {
      const u = time * f.w + f.p;
      const glow = Math.max(0, Math.sin(time * f.blink + f.p * 3));
      this.v.set(f.x + Math.cos(u) * f.r, f.y + Math.sin(u * 1.7) * 0.3, f.z + Math.sin(u * 0.8) * f.r);
      this.mesh.setMatrixAt(i, this.m.compose(this.v, this.q, this.s.setScalar(0.4 + glow * 1.4)));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
