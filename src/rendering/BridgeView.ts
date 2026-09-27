import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from '../world/terrain';
import { PALETTE, paint } from './materials';

/**
 * Wooden footbridges along the map's bridge polylines. Plank heights follow the
 * walkable ground height, so decks ramp up from the banks and sit level over water.
 */
export function createBridges(terrain: Terrain): THREE.Mesh | null {
  const parts: THREE.BufferGeometry[] = [];
  let seed = 1;
  const place = (geo: THREE.BufferGeometry, x: number, y: number, z: number, yaw: number, color: string, jitter = 0.04) => {
    geo.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1)));
    parts.push(paint(geo, color, jitter, seed++));
  };
  for (const bridge of terrain.map.bridges) {
    const pts = bridge.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / len;
      const dz = (bz - az) / len;
      const yaw = Math.atan2(dx, dz);
      const half = bridge.width / 2 + 0.1;
      const deckY = (t: number) => terrain.groundHeightAt(ax + dx * t, az + dz * t) + 0.04;
      // Planks run across the direction of travel.
      for (let t = 0.15; t < len; t += 0.3) {
        const x = ax + dx * t;
        const z = az + dz * t;
        place(new THREE.BoxGeometry(bridge.width + 0.3, 0.07, 0.26), x, deckY(t), z, yaw, PALETTE.woodLight);
      }
      // Side beams, posts and rails.
      for (const side of [-1, 1]) {
        const ox = dz * half * side;
        const oz = -dx * half * side;
        for (let t = 0.2; t < len; t += 1.1) {
          const x = ax + dx * t + ox;
          const z = az + dz * t + oz;
          const y = deckY(t);
          place(new THREE.BoxGeometry(0.1, 0.62, 0.1), x, y + 0.28, z, yaw, PALETTE.woodDark, 0.02);
          place(new THREE.BoxGeometry(0.12, 0.5, 0.12), x, y - 0.3, z, yaw, PALETTE.woodDark, 0.02);
        }
        for (let t = 0; t < len - 0.3; t += 1.1) {
          const t2 = Math.min(len - 0.1, t + 1.1);
          const mid = (t + t2) / 2;
          const y1 = deckY(t);
          const y2 = deckY(t2);
          const rail = new THREE.BoxGeometry(0.08, 0.08, t2 - t);
          rail.rotateX(-Math.atan2(y2 - y1, t2 - t));
          place(rail, ax + dx * mid + ox, (y1 + y2) / 2 + 0.55, az + dz * mid + oz, yaw, PALETTE.wood, 0.02);
        }
      }
    }
  }
  if (parts.length === 0) return null;
  const geo = mergeGeometries(parts, false);
  if (!geo) return null;
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'bridges';
  return mesh;
}
