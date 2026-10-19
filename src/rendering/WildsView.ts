import * as THREE from 'three';
import { mat } from './materials';
import { readyWilds } from '../sim/wilds';
import type { GameState, WildKind } from '../sim/types';
import type { Terrain } from '../world/terrain';
import type { Particles } from './Particles';

/**
 * The wild finds on the ground (sim/wilds.ts): small berry bushes, mushroom rings and herb
 * tufts that sway a little and glint now and then so a passing eye catches them. They pop up
 * when they appear and are gone the moment they're gathered.
 */
export class WildsView {
  readonly group = new THREE.Group();
  private readonly shown = new Map<number, { node: THREE.Group; phase: number; born: number }>();
  private glintIn = 0;

  constructor(
    private readonly terrain: Terrain,
    private readonly particles: Particles,
  ) {
    this.group.name = 'Wilds';
  }

  /** The find under a ground point, if any. */
  spotAt(x: number, z: number, state: GameState): number | null {
    let best: number | null = null;
    let bestD = 0.75;
    for (const s of readyWilds(state)) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bestD) {
        bestD = d;
        best = s.id;
      }
    }
    return best;
  }

  update(state: GameState, dt: number, time: number, calm: boolean): void {
    const ready = new Map(readyWilds(state).map((s) => [s.id, s]));
    for (const [id, s] of this.shown) {
      if (ready.has(id)) continue;
      this.group.remove(s.node);
      this.shown.delete(id);
    }
    for (const [id, spot] of ready) {
      if (this.shown.has(id)) continue;
      const node = build(spot.kind, id);
      node.position.set(spot.x, this.terrain.groundHeightAt(spot.x, spot.z), spot.z);
      node.rotation.y = ((id * 67) % 360) * (Math.PI / 180);
      this.group.add(node);
      this.shown.set(id, { node, phase: id * 1.7, born: calm ? -10 : time });
    }
    for (const s of this.shown.values()) {
      // Pop up, then a gentle sway.
      const grow = Math.min(1, (time - s.born) / 0.45);
      const back = 1 + 2.2 * Math.pow(grow - 1, 3) + 1.2 * Math.pow(grow - 1, 2);
      s.node.scale.setScalar(Math.max(0.01, grow >= 1 ? 1 : back));
      s.node.rotation.x = Math.sin(time * 1.3 + s.phase) * 0.04;
      s.node.rotation.z = Math.cos(time * 1.1 + s.phase) * 0.04;
    }
    this.glintIn -= dt;
    if (this.glintIn <= 0 && this.shown.size > 0) {
      this.glintIn = 2.2;
      const all = [...this.shown.values()];
      const pick = all[Math.floor(time * 7) % all.length];
      this.particles.emit('glint', pick.node.position.clone().add(new THREE.Vector3(0, 0.45, 0)), 3, 0.25);
    }
  }
}

/** A small seeded random stream for a find's shape. */
function rng(seed: number): () => number {
  let s = (seed * 7919) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function part(g: THREE.Group, geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
  return m;
}

function build(kind: WildKind, seed: number): THREE.Group {
  const g = new THREE.Group();
  const R = rng(seed);
  const range = (a: number, b: number) => a + R() * (b - a);
  if (kind === 'berries') {
    for (const [x, z, r] of [[0, 0, 0.26], [0.2, 0.08, 0.2], [-0.17, 0.1, 0.19], [0.02, -0.18, 0.18]]) {
      const m = part(g, new THREE.SphereGeometry(r, 10, 6), r > 0.22 ? '#4f9a43' : '#5fae4f', x, r * 0.75, z);
      m.scale.y = 0.85;
    }
    for (let i = 0; i < 9; i++) {
      const a = range(0, Math.PI * 2);
      const d = range(0.16, 0.27);
      part(g, new THREE.SphereGeometry(0.045, 6, 4), i % 3 === 0 ? '#8e3a8c' : '#d9384a', Math.cos(a) * d, range(0.12, 0.42), Math.sin(a) * d);
    }
  } else if (kind === 'mushrooms') {
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7 + range(-0.3, 0.3);
      const d = i === 0 ? 0 : range(0.14, 0.24);
      const s = i === 0 ? 1.2 : range(0.7, 1);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      part(g, new THREE.CylinderGeometry(0.035 * s, 0.045 * s, 0.16 * s, 8), '#f3ead8', x, 0.08 * s, z);
      const cap = part(g, new THREE.SphereGeometry(0.1 * s, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), i % 2 === 0 ? '#d9544a' : '#c98a4a', x, 0.155 * s, z);
      cap.scale.y = 0.6;
      if (i % 2 === 0) for (let k = 0; k < 3; k++) part(g, new THREE.SphereGeometry(0.017, 5, 3), '#fff8ea', x + Math.cos(k * 2.1) * 0.055 * s, 0.21 * s, z + Math.sin(k * 2.1) * 0.055 * s);
    }
  } else {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + range(-0.2, 0.2);
      const lean = range(0.15, 0.35);
      const h = range(0.26, 0.4);
      const blade = part(g, new THREE.ConeGeometry(0.028, h, 4), i % 2 === 0 ? '#6ab04c' : '#83c35e', Math.cos(a) * 0.05, h / 2, Math.sin(a) * 0.05);
      blade.rotation.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean);
    }
    for (let i = 0; i < 5; i++) {
      const a = range(0, Math.PI * 2);
      const d = range(0.06, 0.16);
      part(g, new THREE.SphereGeometry(0.035, 6, 4), i % 2 === 0 ? '#9c7ae0' : '#f2f0ff', Math.cos(a) * d, range(0.3, 0.42), Math.sin(a) * d);
    }
  }
  return g;
}
