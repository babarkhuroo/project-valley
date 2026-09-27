import * as THREE from 'three';

/**
 * Shared, cached materials. Every model pulls colours from here so the whole world
 * shares a small set of materials (fewer state changes, consistent look).
 */
export const PALETTE = {
  grass: '#8cc265',
  grassDark: '#6fab4f',
  forestFloor: '#5f9748',
  meadow: '#a8cf68',
  dirt: '#cfa66b',
  sand: '#e6d39a',
  seabed: '#9c9a6a',
  rock: '#a9a08f',
  rockDark: '#8a8374',
  snow: '#eeeae0',
  clayEarth: '#b98a62',
  bark: '#8a5a3b',
  barkDark: '#6b4128',
  leaf: '#5fa048',
  leafLight: '#7cbf57',
  pine: '#3f7f4a',
  pineLight: '#4f9657',
  wood: '#b07a4b',
  woodDark: '#7a5234',
  woodLight: '#d7a86e',
  plaster: '#f3e5c8',
  stone: '#c9c0af',
  stoneDark: '#9f9687',
  thatch: '#e2b85c',
  thatchDark: '#c49a45',
  terracotta: '#d4674a',
  slate: '#5d7fb8',
  slateDark: '#476699',
  clay: '#c86a45',
  clayDark: '#9c4f33',
  iron: '#3b3b44',
  gold: '#e7b94a',
  glow: '#ffd98a',
  cloth: '#6f8fe0',
  stew: '#d98b3a',
  white: '#ffffff',
} as const;

const cache = new Map<string, THREE.MeshLambertMaterial>();

export interface MatOptions {
  flat?: boolean;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  vertexColors?: boolean;
}

export function mat(color: string, opts: MatOptions = {}): THREE.MeshLambertMaterial {
  const key = `${color}|${opts.flat ? 1 : 0}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? ''}|${opts.transparent ? opts.opacity : ''}|${opts.side ?? ''}|${opts.vertexColors ? 1 : 0}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color,
      flatShading: opts.flat ?? false,
      emissive: opts.emissive ?? '#000000',
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
      vertexColors: opts.vertexColors ?? false,
    });
    cache.set(key, m);
  }
  return m;
}

/** Glowing window/lantern material. */
export function glowMat(): THREE.MeshLambertMaterial {
  return mat(PALETTE.glow, { emissive: '#ffc15a', emissiveIntensity: 0.9 });
}

/** Adds a flat colour attribute to a geometry so several parts can be merged into one mesh. */
export function paint(geo: THREE.BufferGeometry, color: string, jitter = 0, seed = 1): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const count = g.attributes.position.count;
  const colors = new Float32Array(count * 3);
  let s = seed;
  for (let i = 0; i < count; i += 3) {
    s = (s * 16807) % 2147483647;
    const j = jitter ? ((s / 2147483647) - 0.5) * jitter : 0;
    for (let k = 0; k < 3 && i + k < count; k++) {
      colors[(i + k) * 3] = Math.max(0, c.r + j);
      colors[(i + k) * 3 + 1] = Math.max(0, c.g + j);
      colors[(i + k) * 3 + 2] = Math.max(0, c.b + j);
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}
