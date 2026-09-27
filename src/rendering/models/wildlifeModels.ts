import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Low-poly ambient wildlife geometry: birds, butterflies and dragonflies. Everything is
 * built from spheres, cones, capsules and flat shape silhouettes (no boxes) and is laid
 * out with the creature facing +Z, up +Y. Wing geometries start at the shoulder (x = 0)
 * and extend along +X, lying flat in the XZ plane; the left wing is the same geometry
 * rotated by PI about Z at draw time, so one InstancedMesh serves both sides.
 */

function place(geo: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  geo.scale(sx, sy, sz);
  geo.translate(x, y, z);
  return geo;
}

/** Adds a per-vertex grey level (multiplied with instance colour at draw time). */
function shade(geo: THREE.BufferGeometry, fn: (x: number, y: number, z: number, ny: number) => number): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = fn(pos.getX(i), pos.getY(i), pos.getZ(i), nrm ? nrm.getY(i) : 0);
    colors[i * 3] = v;
    colors[i * 3 + 1] = v;
    colors[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const p of parts) if (p.attributes.uv) p.deleteAttribute('uv');
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('wildlife merge failed');
  g.computeBoundingSphere();
  return g;
}

/** Flat silhouette in the XZ plane. Author the shape with x = outward, y = distance *behind* the leading point. */
function flat(shape: THREE.Shape, segments: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shape, segments);
  g.rotateX(-Math.PI / 2); // shape +Y -> world -Z (backwards), normal -> +Y
  g.deleteAttribute('uv');
  return g;
}

// ---------------------------------------------------------------------------------------
// Bird (~0.5 long, ~0.9 wingspan at scale 1)
// ---------------------------------------------------------------------------------------

/** Rounded body + head + fanned tail, vertex-shaded so the back reads a touch darker than the belly. */
export function birdBodyGeometry(): THREE.BufferGeometry {
  const body = place(new THREE.SphereGeometry(0.075, 12, 8), 0, 0, 0, 0.95, 0.85, 1.9);
  const head = place(new THREE.SphereGeometry(0.05, 10, 7), 0, 0.03, 0.145);
  const tail = new THREE.ConeGeometry(0.065, 0.16, 7);
  tail.rotateX(Math.PI / 2); // tip -> +Z (into the body), wide base trailing
  place(tail, 0, 0.012, -0.2, 1.25, 0.2, 1);
  const g = merge([body, head, tail]);
  return shade(g, (_x, _y, _z, ny) => 1 - 0.2 * Math.max(0, ny));
}

export function birdBeakGeometry(): THREE.BufferGeometry {
  const beak = new THREE.ConeGeometry(0.017, 0.055, 6);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0.026, 0.205);
  beak.deleteAttribute('uv');
  return beak;
}

/** Inner wing (shoulder to wrist): broad, rounded leading edge. Joint at x = 0.2. */
export const BIRD_INNER_SPAN = 0.2;
export function birdInnerWingGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -0.03);
  s.quadraticCurveTo(0.1, -0.052, BIRD_INNER_SPAN, -0.036);
  s.lineTo(BIRD_INNER_SPAN + 0.004, 0.062);
  s.quadraticCurveTo(0.1, 0.105, 0, 0.09);
  s.closePath();
  return flat(s, 5);
}

/** Outer wing (wrist to tip): tapers back to a rounded point. */
export function birdOuterWingGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.004, -0.036);
  s.quadraticCurveTo(0.14, -0.045, 0.235, 0.022);
  s.quadraticCurveTo(0.215, 0.062, 0.13, 0.072);
  s.quadraticCurveTo(0.05, 0.078, -0.004, 0.062);
  s.closePath();
  return flat(s, 5);
}

// ---------------------------------------------------------------------------------------
// Butterfly (~0.3 wingspan)
// ---------------------------------------------------------------------------------------

export function butterflyBodyGeometry(): THREE.BufferGeometry {
  const body = new THREE.CapsuleGeometry(0.011, 0.075, 3, 6);
  body.rotateX(Math.PI / 2);
  body.translate(0, 0, -0.012);
  const head = place(new THREE.SphereGeometry(0.014, 7, 5), 0, 0.002, 0.043);
  const antennae: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const a = new THREE.CylinderGeometry(0.0022, 0.0022, 0.055, 3);
    a.translate(0, 0.0275, 0);
    a.rotateX(0.95); // lean forward
    a.rotateZ(-side * 0.35); // splay outwards
    a.translate(side * 0.005, 0.01, 0.05);
    antennae.push(a);
  }
  const g = merge([body, head, ...antennae]);
  return shade(g, () => 1);
}

/** One lobed wing: a large rounded forewing and a smaller hindwing lobe behind it. */
export function butterflyWingGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -0.018);
  s.bezierCurveTo(0.035, -0.095, 0.135, -0.125, 0.158, -0.07); // forewing leading edge to tip
  s.bezierCurveTo(0.172, -0.03, 0.115, -0.004, 0.075, 0.004); // outer edge in to the notch
  s.bezierCurveTo(0.125, 0.03, 0.118, 0.105, 0.065, 0.108); // hindwing lobe
  s.bezierCurveTo(0.03, 0.11, 0.008, 0.07, 0, 0.032);
  s.closePath();
  const g = flat(s, 7);
  // Soft two-tone: a darker root and darker wing tips around a bright middle.
  return shade(g, (x, _y, z) => {
    const r = Math.hypot(x, z);
    const tip = THREE.MathUtils.smoothstep(r, 0.1, 0.16);
    const root = 1 - THREE.MathUtils.smoothstep(r, 0.0, 0.05);
    return 1 - 0.45 * tip - 0.3 * root - (z < -0.005 ? 0.08 : 0);
  });
}

// ---------------------------------------------------------------------------------------
// Dragonfly (~0.33 long)
// ---------------------------------------------------------------------------------------

export function dragonflyBodyGeometry(): THREE.BufferGeometry {
  const abdomen = new THREE.CapsuleGeometry(0.0085, 0.19, 3, 6);
  abdomen.rotateX(Math.PI / 2);
  abdomen.translate(0, 0, -0.11);
  const thorax = place(new THREE.SphereGeometry(0.02, 8, 6), 0, 0.003, 0.012, 1, 1, 1.45);
  const head = place(new THREE.SphereGeometry(0.019, 8, 6), 0, 0.004, 0.05, 1.35, 1, 0.9);
  const g = merge([abdomen, thorax, head]);
  return shade(g, (_x, _y, z) => (z > 0.035 ? 0.62 : z > -0.015 ? 0.8 : 1 - 0.12 * Math.max(0, Math.sin(z * 90))));
}

/** Thin elliptical wing, root at x = 0. */
export function dragonflyWingGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(1, 14);
  g.deleteAttribute('uv');
  g.scale(0.078, 0.016, 1);
  g.translate(0.078, 0, 0);
  g.rotateX(-Math.PI / 2);
  return g;
}
