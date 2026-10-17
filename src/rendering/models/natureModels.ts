import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, paint } from '../materials';

/**
 * Procedural, vertex-coloured nature geometry. Each function returns one merged
 * BufferGeometry so it can be drawn with a single InstancedMesh. Shapes are faceted
 * (flat-shaded) but organic: primitives are nudged by a smooth, position-keyed wobble (so
 * shared corners move together and nothing cracks), and coloured with a soft fall of light
 * from top to bottom so each piece reads as round without any texture.
 */

function at(geo: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  geo.applyMatrix4(m);
  return geo;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('merge failed');
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** A repeatable pseudo-random value in [-1, 1] for a point (same point, same value). */
function hash3(x: number, y: number, z: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 19.19) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/**
 * Pushes every vertex in or out along its direction from `centre` by up to `amount`,
 * keyed on its (rounded) position so the copies of a shared corner move together.
 */
function wobble(geo: THREE.BufferGeometry, amount: number, seed: number, centre = new THREE.Vector3()): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = hash3(Math.round(v.x * 1000), Math.round(v.y * 1000), Math.round(v.z * 1000), seed) * amount;
    const dir = v.clone().sub(centre);
    const len = dir.length();
    if (len > 1e-6) v.addScaledVector(dir, k / len);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

/** Darkens a painted part towards its bottom (and lightens its top) between y0 and y1: light from above. */
function shade(geo: THREE.BufferGeometry, y0: number, y1: number, dark = 0.3, light = 0.08): THREE.BufferGeometry {
  const p = geo.attributes.position;
  const c = geo.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, (p.getY(i) - y0) / (y1 - y0)));
    const k = 1 - dark + (dark + light) * t;
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  return geo;
}

/** A blob of leaves: a wobbled icosphere, painted and shaded, its centre at (x, y, z). */
function foliage(r: number, x: number, y: number, z: number, color: string, seed: number, detail: number, squash = 0.88, wob = 0.14): THREE.BufferGeometry {
  const g = wobble(at(new THREE.IcosahedronGeometry(r, detail), x, y, z, 1, squash, 1), r * wob, seed, new THREE.Vector3(x, y, z));
  return shade(paint(g, color, 0.05, seed), y - r * squash, y + r * squash, 0.32, 0.1);
}

/** A rock: a wobbled, slightly flattened stone, lighter on top. */
function rock(r: number, x: number, y: number, z: number, color: string, seed: number, sx = 1.15, sy = 0.78, sz = 1, detail = 1, ry = 0): THREE.BufferGeometry {
  const g = wobble(at(new THREE.IcosahedronGeometry(r, detail), x, y, z, sx, sy, sz, ry), r * 0.22, seed, new THREE.Vector3(x, y, z));
  return shade(paint(g, color, 0.045, seed), y - r * sy, y + r * sy, 0.28, 0.12);
}

/** A mossy cap draped over the top of a rock. */
function moss(r: number, x: number, y: number, z: number, seed: number): THREE.BufferGeometry {
  const g = wobble(at(new THREE.SphereGeometry(r, 9, 4, 0, Math.PI * 2, 0, Math.PI * 0.42), x, y, z, 1.2, 0.5, 1.05), r * 0.12, seed, new THREE.Vector3(x, y, z));
  return shade(paint(g, PALETTE.grassDark, 0.05, seed), y, y + r * 0.5, 0.15, 0.12);
}

/**
 * Rounded broadleaf tree, ~2.7 units tall: a flared trunk with a forked limb and a crown of
 * overlapping leaf clusters, deeper green underneath. `detail` 1 for trees you can interact
 * with, 0 for distant scenery (far fewer triangles, same silhouette).
 */
export function roundTreeGeometry(detail: 0 | 1 = 1): THREE.BufferGeometry {
  const seg = detail ? 8 : 5;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(shade(paint(at(new THREE.CylinderGeometry(0.1, 0.17, 1.15, seg, 2), 0, 0.575, 0), PALETTE.bark, 0.04, 3), 0, 1.1, 0.25, 0.05));
  // Roots spreading into the ground.
  const roots = detail ? 5 : 3;
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + 0.4;
    // Tip outwards and a little down, thick end against the trunk.
    parts.push(paint(at(new THREE.ConeGeometry(0.1, 0.3, 5), Math.cos(a) * 0.13, 0.05, Math.sin(a) * 0.13, 1, 1, 0.65, -a, 0, -(Math.PI / 2 + 0.45)), PALETTE.barkDark, 0.03, 5 + i));
  }
  // A limb forking off towards the crown.
  parts.push(paint(at(new THREE.CylinderGeometry(0.045, 0.07, 0.55, 5), 0.17, 1.12, 0.05, 1, 1, 1, 0, 0, -0.75), PALETTE.bark, 0.03, 9));
  // The crown: a big central mass, clusters round it, a lighter top catching the sun.
  const d = detail ? 1 : 0;
  parts.push(foliage(0.66, 0, 1.6, 0, PALETTE.leaf, 11, d));
  parts.push(foliage(0.46, 0.5, 1.4, 0.2, PALETTE.leaf, 13, d));
  parts.push(foliage(0.44, -0.46, 1.42, -0.18, PALETTE.leaf, 17, d));
  if (detail) {
    parts.push(foliage(0.4, 0.06, 1.38, 0.52, PALETTE.leaf, 37, 1));
    parts.push(foliage(0.38, -0.12, 1.42, -0.5, '#56933f', 41, 1));
    parts.push(foliage(0.32, 0.42, 1.9, -0.22, PALETTE.leafLight, 43, 1));
  }
  parts.push(foliage(0.44, 0.04, 2.08, 0.04, PALETTE.leafLight, 19, d));
  return merge(parts);
}

/**
 * Layered conifer, ~3 units tall: drooping tiers with ragged rims, each darker beneath
 * and catching light on its upper slope.
 */
export function pineTreeGeometry(detail: 0 | 1 = 1): THREE.BufferGeometry {
  const seg = detail ? 9 : 6;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(shade(paint(at(new THREE.CylinderGeometry(0.08, 0.15, 0.95, 6), 0, 0.475, 0), PALETTE.barkDark, 0.03, 7), 0, 0.9, 0.25, 0.05));
  const tiers = detail
    ? [[0.86, 0.85, 0.95], [0.72, 0.8, 1.4], [0.58, 0.72, 1.82], [0.43, 0.62, 2.2], [0.27, 0.5, 2.55]]
    : [[0.84, 1.0, 1.05], [0.6, 0.9, 1.7], [0.36, 0.75, 2.3]];
  tiers.forEach(([r, h, y], i) => {
    const cone = at(new THREE.ConeGeometry(r, h, seg, 1), 0, y, 0, 1, 1, 1, i * 0.37);
    // Ragged rim: only the lower ring moves, so the point stays a point.
    const g = cone.index ? cone.toNonIndexed() : cone;
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) {
      if (p.getY(k) > y - h / 2 + 1e-3) continue;
      const x = p.getX(k), z = p.getZ(k);
      const n = hash3(Math.round(x * 1000), 0, Math.round(z * 1000), 21 + i);
      p.setXYZ(k, x * (1 + n * 0.12), p.getY(k) - Math.abs(n) * 0.08, z * (1 + n * 0.12));
    }
    const color = i >= tiers.length - 2 ? PALETTE.pineLight : PALETTE.pine;
    parts.push(shade(paint(g, color, 0.05, 23 + i), y - h / 2, y + h / 2, 0.38, 0.1));
  });
  return merge(parts);
}

export function stumpGeometry(): THREE.BufferGeometry {
  const body = shade(paint(at(new THREE.CylinderGeometry(0.16, 0.21, 0.24, 9), 0, 0.12, 0), PALETTE.bark, 0.03, 41), 0, 0.24, 0.25, 0.05);
  const top = paint(at(new THREE.CylinderGeometry(0.152, 0.152, 0.02, 9), 0, 0.245, 0), PALETTE.woodLight, 0, 43);
  // Growth rings on the cut.
  const ring = paint(at(new THREE.TorusGeometry(0.09, 0.008, 3, 14), 0, 0.256, 0, 1, 1, 1, 0, Math.PI / 2), '#b88a55', 0, 44);
  const heart = paint(at(new THREE.CylinderGeometry(0.03, 0.03, 0.01, 6), 0, 0.257, 0), '#b88a55', 0, 45);
  const parts = [body, top, ring, heart];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.7;
    parts.push(paint(at(new THREE.ConeGeometry(0.08, 0.24, 5), Math.cos(a) * 0.16, 0.04, Math.sin(a) * 0.16, 1, 1, 0.65, -a, 0, -(Math.PI / 2 + 0.45)), PALETTE.barkDark, 0.03, 46 + i));
  }
  parts.push(paint(at(new THREE.BoxGeometry(0.1, 0.03, 0.05), 0.32, 0.015, 0.12, 1, 1, 1, 0.6), PALETTE.woodLight, 0, 47));
  parts.push(paint(at(new THREE.BoxGeometry(0.08, 0.03, 0.05), -0.26, 0.015, 0.22, 1, 1, 1, 1.9), PALETTE.woodLight, 0, 53));
  return merge(parts);
}

/**
 * Clay bank: a soft reddish mound with dug-out steps of wetter clay, lumps set aside, a
 * little puddle where it was cut, and grass creeping round its foot.
 */
export function clayGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const mound = wobble(at(new THREE.IcosahedronGeometry(0.56, 2), 0, 0.0, 0, 1.25, 0.44, 1.08), 0.05, 61, new THREE.Vector3(0, 0, 0));
  parts.push(shade(paint(mound, PALETTE.clay, 0.06, 61), -0.05, 0.25, 0.25, 0.1));
  // Two cut steps, darker and wetter where the spade went in.
  parts.push(shade(paint(wobble(at(new THREE.CylinderGeometry(0.3, 0.36, 0.08, 9), 0.18, 0.2, 0.12, 1, 1, 0.8), 0.02, 62, new THREE.Vector3(0.18, 0.2, 0.12)), PALETTE.clayDark, 0.04, 62), 0.16, 0.24, 0.2, 0.05));
  parts.push(shade(paint(wobble(at(new THREE.CylinderGeometry(0.2, 0.24, 0.07, 8), 0.24, 0.26, 0.14, 1, 1, 0.8), 0.015, 63, new THREE.Vector3(0.24, 0.26, 0.14)), '#b35a36', 0.03, 63), 0.22, 0.3, 0.15, 0.05));
  // Lumps dug out and left by the bank.
  parts.push(rock(0.17, 0.58, 0.07, 0.34, PALETTE.clayDark, 67, 1, 0.65, 1, 0));
  parts.push(rock(0.13, -0.52, 0.05, 0.36, PALETTE.clay, 71, 1, 0.65, 1, 0));
  parts.push(rock(0.12, 0.14, 0.05, -0.6, PALETTE.clayDark, 73, 1, 0.65, 1, 0));
  parts.push(rock(0.08, -0.32, 0.03, 0.58, '#d07a52', 74, 1, 0.65, 1, 0));
  // A puddle in the cut.
  parts.push(paint(at(new THREE.CylinderGeometry(0.16, 0.16, 0.01, 10), -0.18, 0.2, 0.3, 1.2, 1, 0.8), '#8fb8c4', 0, 79));
  // Grass creeping round the edge.
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const r = 0.66 + (i % 2) * 0.06;
    parts.push(paint(at(new THREE.ConeGeometry(0.035, 0.18 + (i % 3) * 0.04, 3), Math.cos(a) * r, 0.07, Math.sin(a) * r * 0.9, 1, 1, 1, a, 0.2, 0), i % 2 ? PALETTE.grassDark : PALETTE.leafLight, 0.03, 80 + i));
  }
  return merge(parts);
}

/**
 * Quarriable rock outcrop: a cluster of grey stones in rough layers, with pale freshly split
 * faces, rubble at its foot and moss on its shoulder.
 */
export function stoneOutcropGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(rock(0.55, 0, 0.32, 0, '#9aa1ab', 211, 1.12, 0.9, 1));
  parts.push(rock(0.38, 0.56, 0.2, 0.18, '#8a919c', 223, 1, 0.85, 1.1));
  parts.push(rock(0.32, -0.48, 0.17, -0.3, '#a9afb8', 227, 1.1, 0.8, 1));
  parts.push(rock(0.26, 0.12, 0.72, -0.08, '#a3aab3', 228, 1.1, 0.75, 1));
  // Split faces: flat, pale slabs where stone has been taken.
  parts.push(shade(paint(at(new THREE.BoxGeometry(0.34, 0.22, 0.3), -0.36, 0.11, 0.42, 1, 1, 1, 0.4), '#d6d9de', 0.03, 229), 0, 0.22, 0.12, 0.05));
  parts.push(shade(paint(at(new THREE.BoxGeometry(0.2, 0.3, 0.06), 0.24, 0.34, 0.5, 1, 1, 1, -0.3), '#cfd3d9', 0.03, 230), 0.2, 0.5, 0.12, 0.05));
  // Rubble.
  parts.push(rock(0.09, 0.32, 0.04, 0.66, '#c8ccd2', 233, 1.2, 0.6, 1, 0));
  parts.push(rock(0.07, -0.05, 0.03, 0.72, '#b7bcc4', 234, 1.2, 0.6, 1, 0));
  parts.push(rock(0.06, 0.62, 0.03, 0.52, '#c8ccd2', 235, 1.2, 0.6, 1, 0));
  parts.push(moss(0.24, 0.0, 0.84, -0.12, 239));
  parts.push(moss(0.18, 0.6, 0.42, 0.06, 241));
  return merge(parts);
}

export function boulderGeometry(): THREE.BufferGeometry {
  return merge([
    rock(0.6, 0, 0.3, 0, PALETTE.rock, 83, 1.2, 0.8, 1),
    rock(0.34, 0.64, 0.15, 0.25, PALETTE.rockDark, 89, 1, 0.75, 1),
    rock(0.16, -0.62, 0.06, 0.3, PALETTE.rock, 91, 1.2, 0.6, 1, 0),
    moss(0.3, -0.12, 0.56, 0.02, 97),
  ]);
}

export function pebbleGeometry(): THREE.BufferGeometry {
  return merge([rock(0.14, 0, 0.05, 0, PALETTE.rock, 101, 1.3, 0.6, 1, 0), rock(0.07, 0.17, 0.02, 0.06, PALETTE.rockDark, 102, 1.2, 0.6, 1, 0)]);
}

/** A rounded shrub of overlapping leaf clusters; the berry bush adds clusters of red fruit. */
export function bushGeometry(berries: boolean): THREE.BufferGeometry {
  const parts = [
    foliage(0.34, 0, 0.28, 0, PALETTE.grassDark, 103, 1, 0.85),
    foliage(0.27, 0.3, 0.22, 0.1, PALETTE.leaf, 107, 1, 0.85),
    foliage(0.25, -0.27, 0.22, -0.08, PALETTE.leaf, 109, 1, 0.85),
    foliage(0.22, 0.05, 0.2, 0.3, '#5d9a45', 110, 1, 0.85),
    foliage(0.2, 0.1, 0.45, -0.08, PALETTE.leafLight, 111, 1, 0.85),
  ];
  if (berries) {
    const spots = [[0.22, 0.42, 0.22], [-0.12, 0.47, 0.25], [0.36, 0.32, -0.04], [-0.33, 0.33, 0.12], [0.04, 0.55, -0.12], [0.12, 0.33, 0.42], [-0.22, 0.42, -0.24]];
    spots.forEach(([x, y, z], i) => {
      // Two or three berries together, glossy red.
      for (const [dx, dy, dz] of [[0, 0, 0], [0.045, -0.02, 0.02], [-0.03, -0.03, 0.035]].slice(0, 2 + (i % 2))) {
        parts.push(shade(paint(at(new THREE.IcosahedronGeometry(0.042, 1), x + dx, y + dy, z + dz), '#d6455a', 0.04, 113 + i), y + dy - 0.04, y + dy + 0.04, 0.3, 0.2));
      }
    });
  }
  return merge(parts);
}

export function grassTuftGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const g = new THREE.ConeGeometry(0.04, 0.32 + (i % 2) * 0.1, 3);
    g.rotateZ(Math.cos(a) * 0.35);
    g.rotateX(Math.sin(a) * 0.35);
    blades.push(paint(at(g, Math.cos(a) * 0.06, 0.15, Math.sin(a) * 0.06), i % 2 ? PALETTE.grassDark : PALETTE.leafLight, 0.04, 127 + i));
  }
  return merge(blades);
}

/** White-petalled flower; instance colour tints the petals. */
export function flowerGeometry(): THREE.BufferGeometry {
  const stem = paint(at(new THREE.CylinderGeometry(0.012, 0.015, 0.28, 4), 0, 0.14, 0), PALETTE.grassDark, 0, 131);
  const head = paint(at(new THREE.IcosahedronGeometry(0.07, 0), 0, 0.3, 0, 1, 0.6, 1), '#ffffff', 0.03, 137);
  const leaf = paint(at(new THREE.IcosahedronGeometry(0.05, 0), 0.05, 0.08, 0, 1.4, 0.4, 0.8), PALETTE.leaf, 0, 139);
  return merge([stem, head, leaf]);
}

export function reedGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.07;
    const h = 0.5 + (i % 2) * 0.18;
    parts.push(paint(at(new THREE.CylinderGeometry(0.012, 0.018, h, 4), x, h / 2, (i % 2) * 0.05), '#6f9a4a', 0, 149 + i));
    if (i % 2 === 0) parts.push(paint(at(new THREE.CylinderGeometry(0.03, 0.03, 0.12, 5), x, h - 0.04, (i % 2) * 0.05), '#7a4a2b', 0, 151));
  }
  return merge(parts);
}

export function lilyGeometry(): THREE.BufferGeometry {
  const pad = paint(at(new THREE.CylinderGeometry(0.22, 0.22, 0.015, 9, 1, false, 0.3, Math.PI * 1.8), 0, 0, 0), '#5f9e4a', 0.04, 157);
  const bloom = paint(at(new THREE.IcosahedronGeometry(0.06, 0), 0.06, 0.04, 0.02, 1, 0.7, 1), '#f7c6d9', 0, 163);
  return merge([pad, bloom]);
}

export function mushroomGeometry(): THREE.BufferGeometry {
  const stem = paint(at(new THREE.CylinderGeometry(0.03, 0.04, 0.12, 6), 0, 0.06, 0), '#f1e6cf', 0, 167);
  const cap = paint(at(new THREE.SphereGeometry(0.08, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.11, 0, 1, 0.8, 1), '#d9544a', 0.03, 173);
  const stem2 = paint(at(new THREE.CylinderGeometry(0.02, 0.03, 0.08, 6), 0.1, 0.04, 0.05), '#f1e6cf', 0, 179);
  const cap2 = paint(at(new THREE.SphereGeometry(0.055, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), 0.1, 0.075, 0.05, 1, 0.8, 1), '#d9544a', 0.03, 181);
  return merge([stem, cap, stem2, cap2]);
}

export function logGeometry(): THREE.BufferGeometry {
  const body = paint(new THREE.CylinderGeometry(0.1, 0.1, 0.7, 8).rotateZ(Math.PI / 2), PALETTE.bark, 0.03, 191);
  const endA = paint(at(new THREE.CylinderGeometry(0.095, 0.095, 0.01, 8).rotateZ(Math.PI / 2), 0.352, 0, 0), PALETTE.woodLight, 0, 193);
  const endB = paint(at(new THREE.CylinderGeometry(0.095, 0.095, 0.01, 8).rotateZ(Math.PI / 2), -0.352, 0, 0), PALETTE.woodLight, 0, 197);
  return merge([body, endA, endB]);
}
