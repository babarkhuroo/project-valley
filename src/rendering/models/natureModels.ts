import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, paint } from '../materials';

/**
 * Procedural, vertex-coloured nature geometry. Each function returns one merged
 * BufferGeometry so it can be drawn with a single InstancedMesh.
 */

function at(geo: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
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

/**
 * Rounded broadleaf tree, ~2.6 units tall. `detail` 1 for trees you can interact with,
 * 0 for distant scenery (a quarter of the triangles).
 */
export function roundTreeGeometry(detail: 0 | 1 = 1): THREE.BufferGeometry {
  const seg = detail ? 7 : 5;
  const trunk = paint(at(new THREE.CylinderGeometry(0.11, 0.17, 1.1, seg), 0, 0.55, 0), PALETTE.bark, 0.04, 3);
  const root = paint(at(new THREE.CylinderGeometry(0.2, 0.26, 0.12, seg), 0, 0.06, 0), PALETTE.barkDark, 0.02, 5);
  const blobs = [
    paint(at(new THREE.IcosahedronGeometry(0.72, detail), 0, 1.55, 0, 1, 0.9, 1), PALETTE.leaf, 0.07, 11),
    paint(at(new THREE.IcosahedronGeometry(0.52, 0), 0.42, 1.28, 0.18, 1, 0.9, 1), PALETTE.leaf, 0.07, 13),
    paint(at(new THREE.IcosahedronGeometry(0.5, 0), -0.38, 1.35, -0.22, 1, 0.9, 1), PALETTE.leaf, 0.07, 17),
    paint(at(new THREE.IcosahedronGeometry(0.46, detail), 0.08, 2.05, -0.05, 1, 0.9, 1), PALETTE.leafLight, 0.06, 19),
  ];
  return merge([trunk, root, ...blobs]);
}

/** Layered conifer, ~3 units tall. */
export function pineTreeGeometry(detail: 0 | 1 = 1): THREE.BufferGeometry {
  const seg = detail ? 7 : 5;
  const trunk = paint(at(new THREE.CylinderGeometry(0.09, 0.15, 0.9, 5), 0, 0.45, 0), PALETTE.barkDark, 0.03, 7);
  const tiers = [
    paint(at(new THREE.ConeGeometry(0.78, 1.0, seg), 0, 1.05, 0), PALETTE.pine, 0.06, 21),
    paint(at(new THREE.ConeGeometry(0.62, 0.9, seg), 0, 1.6, 0, 1, 1, 1, 0.4), PALETTE.pine, 0.06, 23),
    paint(at(new THREE.ConeGeometry(0.44, 0.8, seg), 0, 2.12, 0, 1, 1, 1, 0.8), PALETTE.pineLight, 0.06, 29),
    paint(at(new THREE.ConeGeometry(0.22, 0.45, 5), 0, 2.55, 0), PALETTE.pineLight, 0.04, 31),
  ];
  return merge([trunk, ...tiers]);
}

export function stumpGeometry(): THREE.BufferGeometry {
  const body = paint(at(new THREE.CylinderGeometry(0.16, 0.2, 0.22, 8), 0, 0.11, 0), PALETTE.bark, 0.03, 41);
  const top = paint(at(new THREE.CylinderGeometry(0.155, 0.155, 0.02, 8), 0, 0.225, 0), PALETTE.woodLight, 0, 43);
  const chip1 = paint(at(new THREE.BoxGeometry(0.1, 0.03, 0.05), 0.28, 0.02, 0.1, 1, 1, 1, 0.6), PALETTE.woodLight, 0, 47);
  const chip2 = paint(at(new THREE.BoxGeometry(0.08, 0.03, 0.05), -0.22, 0.02, 0.2, 1, 1, 1, 1.9), PALETTE.woodLight, 0, 53);
  return merge([body, top, chip1, chip2]);
}

/** Clay bank: a soft reddish mound with a few dug-out lumps. */
export function clayGeometry(): THREE.BufferGeometry {
  const mound = paint(at(new THREE.IcosahedronGeometry(0.55, 1), 0, 0.02, 0, 1.25, 0.42, 1.05), PALETTE.clay, 0.08, 61);
  const lumpA = paint(at(new THREE.IcosahedronGeometry(0.2, 0), 0.52, 0.08, 0.3, 1, 0.7, 1), PALETTE.clayDark, 0.05, 67);
  const lumpB = paint(at(new THREE.IcosahedronGeometry(0.16, 0), -0.48, 0.06, 0.34, 1, 0.7, 1), PALETTE.clay, 0.05, 71);
  const lumpC = paint(at(new THREE.IcosahedronGeometry(0.14, 0), 0.1, 0.05, -0.55, 1, 0.7, 1), PALETTE.clayDark, 0.05, 73);
  const wet = paint(at(new THREE.CylinderGeometry(0.34, 0.34, 0.02, 10), 0.05, 0.22, 0.02, 1, 1, 0.8), '#b35a36', 0, 79);
  return merge([mound, lumpA, lumpB, lumpC, wet]);
}

export function boulderGeometry(): THREE.BufferGeometry {
  const a = paint(at(new THREE.DodecahedronGeometry(0.6, 0), 0, 0.3, 0, 1.2, 0.8, 1), PALETTE.rock, 0.08, 83);
  const b = paint(at(new THREE.DodecahedronGeometry(0.34, 0), 0.62, 0.15, 0.25, 1, 0.8, 1), PALETTE.rockDark, 0.06, 89);
  const moss = paint(at(new THREE.IcosahedronGeometry(0.25, 0), -0.2, 0.62, 0.05, 1.4, 0.35, 1.2), PALETTE.grassDark, 0.05, 97);
  return merge([a, b, moss]);
}

export function pebbleGeometry(): THREE.BufferGeometry {
  return merge([paint(at(new THREE.DodecahedronGeometry(0.14, 0), 0, 0.05, 0, 1.3, 0.7, 1), PALETTE.rock, 0.1, 101)]);
}

export function bushGeometry(berries: boolean): THREE.BufferGeometry {
  const parts = [
    paint(at(new THREE.IcosahedronGeometry(0.34, 1), 0, 0.26, 0, 1.2, 0.9, 1), PALETTE.grassDark, 0.07, 103),
    paint(at(new THREE.IcosahedronGeometry(0.26, 1), 0.28, 0.2, 0.08, 1, 0.9, 1), PALETTE.leaf, 0.07, 107),
    paint(at(new THREE.IcosahedronGeometry(0.24, 1), -0.24, 0.2, -0.1, 1, 0.9, 1), PALETTE.leaf, 0.07, 109),
  ];
  if (berries) {
    const spots = [[0.2, 0.4, 0.2], [-0.1, 0.45, 0.25], [0.32, 0.3, -0.08], [-0.3, 0.3, 0.12], [0.02, 0.5, -0.12]];
    for (const [x, y, z] of spots) parts.push(paint(at(new THREE.IcosahedronGeometry(0.05, 0), x, y, z), '#d6455a', 0, 113));
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
