import type { Terrain } from '../world/terrain';

const RING = [
  [0, 0],
  [6, 0],
  [-6, 0],
  [0, 6],
  [0, -6],
  [4, 4],
  [-4, 4],
  [4, -4],
  [-4, -4],
];

/**
 * How close the camera's focus is to open water (0–1), softened when zoomed out —
 * drives the volume of the running-water ambience.
 */
export function waterNearby(terrain: Terrain, at: { x: number; z: number }, distance: number): number {
  let nearest = Infinity;
  for (const [dx, dz] of RING) nearest = Math.min(nearest, terrain.waterSdfAt(at.x + dx, at.z + dz));
  const close = Math.max(0, Math.min(1, 1 - nearest / 10));
  const zoom = Math.max(0.3, Math.min(1, 1 - (distance - 15) / 70));
  return close * zoom;
}
