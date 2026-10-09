import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { BUILDINGS } from '../config/buildings';
import type { GameState } from '../sim/types';
import { villagerPosition, frontSpot } from '../sim/villagerAI';
import type { World } from '../sim/world';

/**
 * A few hens scratching about the village: a pair for the Cookhouse and for each
 * home. Purely cosmetic and never saved — they peck, scratch, wander a little way
 * from their yard, scatter with a flap when someone walks through, and settle down
 * by their door at night. Two instanced meshes (bodies, heads) for every hen.
 */

const MAX_HENS = 20;
const PER_YARD = 2;
const YARD_RADIUS = 2.4;
const COLORS = ['#f6f0e4', '#b5713f', '#3d3837', '#d9a55c'];
const TAU = Math.PI * 2;

type Mode = 'peck' | 'walk' | 'scratch' | 'look' | 'flee' | 'roost';

interface Hen {
  yard: number;
  homeX: number;
  homeZ: number;
  x: number;
  z: number;
  heading: number;
  mode: Mode;
  timer: number;
  toX: number;
  toZ: number;
  seed: number;
  phase: number;
  scale: number;
}

function shaded(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = geo.attributes.position.count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (geo.attributes.uv) geo.deleteAttribute('uv');
  return geo.index ? geo.toNonIndexed() : geo;
}

/** Plump body, tail fan and folded wings; white vertices take the instance colour, dark ones stay dark. */
function bodyGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.11, 10, 8);
  body.scale(0.85, 0.8, 1.15);
  body.translate(0, 0.14, 0);
  const tail = new THREE.SphereGeometry(0.07, 8, 6);
  tail.scale(0.4, 1.05, 0.75);
  tail.rotateX(-0.55);
  tail.translate(0, 0.22, -0.1);
  const wingL = new THREE.SphereGeometry(0.06, 8, 6);
  wingL.scale(0.35, 0.7, 1.2);
  wingL.translate(-0.085, 0.15, -0.01);
  const wingR = wingL.clone();
  wingR.translate(0.17, 0, 0);
  const legMat = '#e0a83a';
  const legL = new THREE.CylinderGeometry(0.008, 0.008, 0.06, 4);
  legL.translate(-0.035, 0.03, 0.01);
  const legR = legL.clone();
  legR.translate(0.07, 0, 0);
  const geo = mergeGeometries([shaded(body, '#ffffff'), shaded(tail, '#e8e8e8'), shaded(wingL, '#dcdcdc'), shaded(wingR, '#dcdcdc'), shaded(legL, legMat), shaded(legR, legMat)], false)!;
  geo.computeBoundingSphere();
  return geo;
}

/** Head (pivoting at the neck, origin) with comb, wattle, beak and eyes, facing +z. */
function headGeometry(): THREE.BufferGeometry {
  const head = new THREE.SphereGeometry(0.05, 8, 6);
  head.translate(0, 0.05, 0.03);
  const comb = new THREE.SphereGeometry(0.025, 6, 4);
  comb.scale(0.5, 1, 1.4);
  comb.translate(0, 0.1, 0.03);
  const wattle = new THREE.SphereGeometry(0.014, 6, 4);
  wattle.translate(0, 0.015, 0.07);
  const beak = new THREE.ConeGeometry(0.016, 0.04, 4);
  beak.rotateX(Math.PI / 2);
  beak.translate(0, 0.045, 0.09);
  const eyeL = new THREE.SphereGeometry(0.008, 4, 3);
  eyeL.translate(-0.035, 0.06, 0.055);
  const eyeR = eyeL.clone();
  eyeR.translate(0.07, 0, 0);
  const geo = mergeGeometries([shaded(head, '#ffffff'), shaded(comb, '#d8443a'), shaded(wattle, '#d8443a'), shaded(beak, '#e8b23a'), shaded(eyeL, '#1d1a1a'), shaded(eyeR, '#1d1a1a')], false)!;
  geo.computeBoundingSphere();
  return geo;
}

function hash(n: number): number {
  const s = Math.sin(n * 91.7 + 17.3) * 43758.5453;
  return s - Math.floor(s);
}

export class Hens {
  readonly group = new THREE.Group();
  private readonly bodies: THREE.InstancedMesh;
  private readonly heads: THREE.InstancedMesh;
  private hens: Hen[] = [];
  private yardsKey = '';
  /** A hen scattered with a flap (for a cluck). */
  onScatter: ((at: { x: number; y: number; z: number }) => void) | null = null;
  private readonly m = new THREE.Matrix4();
  private readonly h = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();

  constructor(private readonly world: World) {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.bodies = new THREE.InstancedMesh(bodyGeometry(), material, MAX_HENS);
    this.heads = new THREE.InstancedMesh(headGeometry(), material, MAX_HENS);
    for (const mesh of [this.bodies, this.heads]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      for (let i = 0; i < MAX_HENS; i++) mesh.setColorAt(i, new THREE.Color(COLORS[i % COLORS.length]));
      this.group.add(mesh);
    }
  }

  /** Re-homes the flock when the Cookhouse or homes change (built, moved). */
  private syncYards(state: GameState): void {
    const yards = state.buildings.filter((b) => b.status === 'complete' && (b.defId === 'cookhouse' || (BUILDINGS[b.defId].housing ?? 0) > 0));
    const key = yards.map((b) => `${b.id}:${b.cellX},${b.cellZ},${b.rotation}`).join('|');
    if (key === this.yardsKey) return;
    this.yardsKey = key;
    const old = this.hens;
    this.hens = [];
    yards.forEach((b, yard) => {
      const door = frontSpot(this.world, b);
      for (let k = 0; k < PER_YARD && this.hens.length < MAX_HENS; k++) {
        const seed = hash(b.id * 7 + k);
        const prev = old.find((h) => h.yard === yard && Math.abs(h.seed - seed) < 1e-9);
        const a = seed * TAU;
        const x = door.x + Math.cos(a) * 1.2;
        const z = door.z + Math.sin(a) * 1.2;
        this.hens.push(prev ?? { yard, homeX: door.x, homeZ: door.z, x, z, heading: a, mode: 'peck', timer: 1 + seed * 2, toX: x, toZ: z, seed, phase: seed * 10, scale: 0.9 + seed * 0.25 });
        const hen = this.hens[this.hens.length - 1];
        hen.homeX = door.x;
        hen.homeZ = door.z;
      }
    });
    this.bodies.count = this.hens.length;
    this.heads.count = this.hens.length;
  }

  private pickSpot(hen: Hen): void {
    for (let i = 0; i < 6; i++) {
      const a = hash(hen.seed * 31 + hen.phase + i) * TAU;
      const r = 0.4 + hash(hen.seed * 17 + hen.phase * 3 + i) * YARD_RADIUS;
      const x = hen.homeX + Math.cos(a) * r;
      const z = hen.homeZ + Math.sin(a) * r;
      if (this.world.grid.walkableAt({ x, z })) {
        hen.toX = x;
        hen.toZ = z;
        return;
      }
    }
    hen.toX = hen.homeX;
    hen.toZ = hen.homeZ;
  }

  update(state: GameState, dt: number, time: number, night: number): void {
    this.syncYards(state);
    if (this.hens.length === 0) return;
    const people = state.villagers.filter((v) => v.activity === 'walking').map((v) => villagerPosition(v, state.time));
    const step = Math.min(dt, 0.1);
    this.hens.forEach((hen, i) => {
      hen.phase += step;
      hen.timer -= step;
      // Someone walking right through: scatter away from them.
      if (hen.mode !== 'flee') {
        for (const p of people) {
          const dx = hen.x - p.x;
          const dz = hen.z - p.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.75) {
            hen.mode = 'flee';
            hen.timer = 0.7;
            const away = d > 1e-3 ? Math.atan2(dx, dz) : hen.heading;
            const tx = hen.x + Math.sin(away) * 1.3;
            const tz = hen.z + Math.cos(away) * 1.3;
            hen.toX = this.world.grid.walkableAt({ x: tx, z: tz }) ? tx : hen.homeX;
            hen.toZ = this.world.grid.walkableAt({ x: tx, z: tz }) ? tz : hen.homeZ;
            this.onScatter?.({ x: hen.x, y: this.world.terrain.groundHeightAt(hen.x, hen.z), z: hen.z });
            break;
          }
        }
      }
      if (night > 0.6 && hen.mode !== 'flee' && hen.mode !== 'roost') {
        hen.mode = 'walk';
        hen.toX = hen.homeX + (hash(hen.seed * 5) - 0.5) * 0.8;
        hen.toZ = hen.homeZ + (hash(hen.seed * 9) - 0.5) * 0.8;
      }
      if (hen.timer <= 0 && hen.mode !== 'walk') {
        if (night > 0.6) {
          hen.mode = 'roost';
          hen.timer = 5;
        } else {
          const r = hash(hen.seed * 13 + Math.floor(hen.phase));
          hen.mode = r < 0.4 ? 'peck' : r < 0.7 ? 'walk' : r < 0.85 ? 'scratch' : 'look';
          hen.timer = hen.mode === 'peck' ? 1.5 + r * 2 : hen.mode === 'look' ? 1.2 : 1.4;
          if (hen.mode === 'walk') this.pickSpot(hen);
        }
      }
      let speed = 0;
      if (hen.mode === 'walk' || hen.mode === 'flee') {
        const dx = hen.toX - hen.x;
        const dz = hen.toZ - hen.z;
        const d = Math.hypot(dx, dz);
        speed = hen.mode === 'flee' ? 2.2 : 0.45;
        if (d < 0.05) {
          hen.mode = night > 0.6 ? 'roost' : 'peck';
          hen.timer = 1 + hash(hen.seed + hen.phase) * 2;
          speed = 0;
        } else {
          const want = Math.atan2(dx, dz);
          let turn = want - hen.heading;
          turn -= TAU * Math.round(turn / TAU);
          hen.heading += turn * Math.min(1, step * 8);
          const move = Math.min(d, speed * step);
          hen.x += (dx / d) * move;
          hen.z += (dz / d) * move;
        }
      }
      this.pose(i, hen, time, speed);
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }

  private pose(i: number, hen: Hen, time: number, speed: number): void {
    const t = time + hen.seed * 20;
    const ground = this.world.terrain.groundHeightAt(hen.x, hen.z);
    // Body: a waddle while walking, a hop-flap when fleeing, settled low when roosting.
    let bob = 0;
    let roll = 0;
    let pitch = 0;
    let headPitch = 0;
    let headYaw = 0;
    if (speed > 0) {
      const w = t * (speed > 1 ? 22 : 11);
      bob = Math.abs(Math.sin(w)) * (speed > 1 ? 0.06 : 0.015);
      roll = Math.sin(w) * 0.12;
      headPitch = Math.sin(w * 2) * 0.15;
      pitch = speed > 1 ? -0.25 : 0;
    } else if (hen.mode === 'peck') {
      // Quick jabs at the ground, a pause, again.
      const k = t * 2.3 - Math.floor(t * 2.3);
      headPitch = k < 0.3 ? Math.sin((k / 0.3) * Math.PI) * 1.3 : 0;
      pitch = headPitch * 0.25;
    } else if (hen.mode === 'scratch') {
      roll = Math.sin(t * 9) * 0.08;
      pitch = 0.15;
      headPitch = 0.4;
    } else if (hen.mode === 'look') {
      headYaw = Math.sin(t * 3) * 0.8;
    } else if (hen.mode === 'roost') {
      bob = -0.05;
      headPitch = 0.25;
    }
    this.e.set(pitch, hen.heading, roll, 'YXZ');
    this.q.setFromEuler(this.e);
    this.p.set(hen.x, ground + bob, hen.z);
    this.s.setScalar(hen.scale);
    this.m.compose(this.p, this.q, this.s);
    this.bodies.setMatrixAt(i, this.m);
    // Head on the neck, ahead of and above the body.
    this.h.makeTranslation(0, 0.2, 0.1);
    this.e.set(headPitch, headYaw, 0, 'YXZ');
    this.q.setFromEuler(this.e);
    this.h.multiply(new THREE.Matrix4().makeRotationFromQuaternion(this.q));
    this.m.multiply(this.h);
    this.heads.setMatrixAt(i, this.m);
  }
}
