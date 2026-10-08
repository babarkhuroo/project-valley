import * as THREE from 'three';
import type { VillageMapDef } from '../config/villageMap';
import { WATER_LEVEL, type Terrain } from '../world/terrain';
import { createRng } from '../world/noise';
import { mat, PALETTE } from './materials';
import {
  BIRD_INNER_SPAN,
  birdBeakGeometry,
  birdBodyGeometry,
  birdInnerWingGeometry,
  birdOuterWingGeometry,
  butterflyBodyGeometry,
  butterflyWingGeometry,
  dragonflyBodyGeometry,
  dragonflyWingGeometry,
} from './models/wildlifeModels';

const TAU = Math.PI * 2;
const BIRD_COUNT = 6;
const BUTTERFLY_COUNT = 10;
const DRAGONFLY_COUNT = 5;

/** Fraction of a wingbeat spent on the (powered) downstroke. */
const DOWNSTROKE = 0.4;

const BIRD_PALETTES: { body: string; wing: string; tip: string }[] = [
  { body: '#f4efe6', wing: '#e9e3d7', tip: '#5d5a66' }, // gull
  { body: '#5a6682', wing: '#4b5673', tip: '#363d52' }, // swallow
  { body: '#b08660', wing: '#9a714c', tip: '#6b4b32' }, // sparrow
  { body: '#474250', wing: '#403b48', tip: '#2d2933' }, // crow
];
const BUTTERFLY_COLORS = ['#f2c14e', '#ffffff', '#e86b8a', '#7fb2f0', '#f08a4b'];
const DRAGONFLY_COLORS = ['#3fb6c9', '#4a7fe0', '#d9573b', '#6fbf4a', '#3fb6c9'];

interface Bird {
  cx: number;
  cz: number;
  /** 0 = wandering epicycle loops, 1 = figure-eight. */
  kind: 0 | 1;
  r: number;
  ecc: number;
  /** Secondary loop: frequency ratio, radius and phase. */
  k2: number;
  r2: number;
  p2: number;
  wobble: number;
  cosA: number;
  sinA: number;
  /** Signed path angular speed (rad/s). */
  w: number;
  p: number;
  h: number;
  hAmp: number;
  hW: number;
  drift: number;
  scale: number;
  flapW: number;
  flapP: number;
  glideW: number;
  glideP: number;
  glideBias: number;
}

const enum Mode {
  Fly,
  Land,
  Perch,
}

interface Butterfly {
  homeX: number;
  homeZ: number;
  radius: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  speed: number;
  scale: number;
  seed: number;
  flap: number;
  flapRate: number;
  mode: Mode;
  timer: number;
  roll: number;
  pitch: number;
}

interface Dragonfly {
  homeX: number;
  homeZ: number;
  fromX: number;
  fromY: number;
  fromZ: number;
  toX: number;
  toY: number;
  toZ: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  darting: boolean;
  k: number;
  dur: number;
  timer: number;
  seed: number;
  scale: number;
}

function stroke(phase: number): number {
  // Asymmetric wingbeat: +1 = wings fully up, -1 = fully down. The downstroke takes
  // DOWNSTROKE of the cycle, the recovery upstroke the rest; both ends ease (C1).
  const x = phase / TAU - Math.floor(phase / TAU);
  return x < DOWNSTROKE ? Math.cos((Math.PI * x) / DOWNSTROKE) : -Math.cos((Math.PI * (x - DOWNSTROKE)) / (1 - DOWNSTROKE));
}

function upstroke(phase: number): number {
  const x = phase / TAU - Math.floor(phase / TAU);
  return x < DOWNSTROKE ? 0 : Math.sin((Math.PI * (x - DOWNSTROKE)) / (1 - DOWNSTROKE));
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function wrapAngle(a: number): number {
  return a - TAU * Math.round(a / TAU);
}

function makeInstanced(geo: THREE.BufferGeometry, material: THREE.Material, count: number, castShadow: boolean): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, material, count);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Creatures roam, so the bounding sphere is refreshed every frame in update() and the
  // mesh is frustum-culled as a whole (e.g. no birds drawn when they are all off-screen).
  m.frustumCulled = true;
  m.castShadow = castShadow;
  m.receiveShadow = false;
  return m;
}

/**
 * Purely decorative wildlife: birds wheeling high overhead, butterflies over the meadows
 * and dragonflies darting above the water. All parts are InstancedMeshes (8 draw calls,
 * plus 4 shadow-pass draws for the birds); per-frame work reuses scratch objects only.
 */
export class AmbientLife {
  readonly group = new THREE.Group();
  private readonly birds: Bird[] = [];
  private readonly butterflies: Butterfly[] = [];
  private readonly dragonflies: Dragonfly[] = [];

  private readonly birdBody: THREE.InstancedMesh;
  private readonly birdBeak: THREE.InstancedMesh;
  private readonly birdInner: THREE.InstancedMesh;
  private readonly birdOuter: THREE.InstancedMesh;
  private readonly flyBody: THREE.InstancedMesh;
  private readonly flyWing: THREE.InstancedMesh;
  private readonly dragonBody: THREE.InstancedMesh;
  private readonly dragonWing: THREE.InstancedMesh;

  /** Runtime randomness (perch timers, dart targets); seeded so a session replays the same. */
  private readonly rng: () => number;
  private lastTime = Number.NaN;
  private culled: THREE.InstancedMesh[] = [];

  // Scratch objects — nothing is allocated per frame.
  private readonly base = new THREE.Matrix4();
  private readonly local = new THREE.Matrix4();
  private readonly joint = new THREE.Matrix4();
  private readonly out = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p0 = new THREE.Vector3();
  private readonly p1 = new THREE.Vector3();
  private readonly p2 = new THREE.Vector3();

  constructor(private readonly terrain: Terrain, map: VillageMapDef) {
    const rng = createRng(map.seed ^ 0xb1d);
    this.rng = createRng(map.seed ^ 0x1f5ec7);
    const color = new THREE.Color();

    // ---- Birds ---------------------------------------------------------------------
    const wingMat = mat('#ffffff', { side: THREE.DoubleSide });
    this.birdBody = makeInstanced(birdBodyGeometry(), mat('#ffffff', { vertexColors: true }), BIRD_COUNT, true);
    this.birdBeak = makeInstanced(birdBeakGeometry(), mat(PALETTE.gold), BIRD_COUNT, true);
    this.birdInner = makeInstanced(birdInnerWingGeometry(), wingMat, BIRD_COUNT * 2, true);
    this.birdOuter = makeInstanced(birdOuterWingGeometry(), wingMat, BIRD_COUNT * 2, true);
    for (let i = 0; i < BIRD_COUNT; i++) {
      const pal = BIRD_PALETTES[i % BIRD_PALETTES.length];
      this.birdBody.setColorAt(i, color.set(pal.body));
      this.birdInner.setColorAt(i * 2, color.set(pal.wing));
      this.birdInner.setColorAt(i * 2 + 1, color);
      this.birdOuter.setColorAt(i * 2, color.set(pal.tip));
      this.birdOuter.setColorAt(i * 2 + 1, color);

      const kind: 0 | 1 = rng() < 0.35 ? 1 : 0;
      const r = 5 + rng() * 6;
      const k2 = 1.7 + rng() * 1.6;
      const speed = 2.1 + rng() * 1.4; // world units / s
      const angle = rng() * TAU;
      const scale = 0.85 + rng() * 0.4;
      this.birds.push({
        cx: 16 + rng() * (map.width - 32),
        cz: 16 + rng() * (map.height - 32),
        kind,
        r,
        ecc: 0.65 + rng() * 0.35,
        k2,
        r2: ((r * 0.45) / k2) * (0.4 + rng() * 0.6),
        p2: rng() * TAU,
        wobble: r * (0.1 + rng() * 0.2),
        cosA: Math.cos(angle),
        sinA: Math.sin(angle),
        w: (speed / r) * (kind === 1 ? 0.8 : 1) * (rng() < 0.5 ? -1 : 1),
        p: rng() * TAU,
        h: 8 + rng() * 5,
        hAmp: 0.3 + rng() * 0.6,
        hW: 0.15 + rng() * 0.2,
        drift: rng() * 100,
        scale,
        flapW: (17 - scale * 5) * (0.9 + rng() * 0.2),
        flapP: rng() * TAU,
        glideW: 0.22 + rng() * 0.2,
        glideP: rng() * TAU,
        glideBias: -0.2 + rng() * 0.5,
      });
    }

    // ---- Butterflies ---------------------------------------------------------------
    this.flyBody = makeInstanced(butterflyBodyGeometry(), mat('#3a3040', { vertexColors: true }), BUTTERFLY_COUNT, false);
    this.flyWing = makeInstanced(
      butterflyWingGeometry(),
      mat('#ffffff', { side: THREE.DoubleSide, vertexColors: true }),
      BUTTERFLY_COUNT * 2,
      false,
    );
    for (let i = 0; i < BUTTERFLY_COUNT; i++) {
      const meadow = map.meadows[i % map.meadows.length];
      let mx = 0;
      let mz = 0;
      for (const [px, pz] of meadow) {
        mx += px / meadow.length;
        mz += pz / meadow.length;
      }
      const [vx, vz] = meadow[Math.floor(rng() * meadow.length)];
      const t = 0.2 + rng() * 0.35;
      const homeX = mx + (vx - mx) * t;
      const homeZ = mz + (vz - mz) * t;
      const c = BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length];
      this.flyWing.setColorAt(i * 2, color.set(c));
      this.flyWing.setColorAt(i * 2 + 1, color);
      const x = homeX + (rng() - 0.5) * 2;
      const z = homeZ + (rng() - 0.5) * 2;
      this.butterflies.push({
        homeX,
        homeZ,
        radius: 2.5 + rng() * 1.8,
        x,
        y: terrain.heightAt(x, z) + 0.6,
        z,
        heading: rng() * TAU,
        speed: 0.65 + rng() * 0.4,
        scale: 0.85 + rng() * 0.35,
        seed: rng() * 100,
        flap: rng() * TAU,
        flapRate: 24 + rng() * 8,
        mode: Mode.Fly,
        timer: 3 + rng() * 9,
        roll: 0,
        pitch: 0,
      });
    }

    // ---- Dragonflies ---------------------------------------------------------------
    this.dragonBody = makeInstanced(dragonflyBodyGeometry(), mat('#ffffff', { vertexColors: true }), DRAGONFLY_COUNT, false);
    this.dragonWing = makeInstanced(
      dragonflyWingGeometry(),
      mat('#e4f2ff', { side: THREE.DoubleSide, transparent: true, opacity: 0.55 }),
      DRAGONFLY_COUNT * 4,
      false,
    );
    const spots: [number, number][] = [];
    const pts = map.creek.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const x = (pts[i][0] + pts[i + 1][0]) / 2;
      const z = (pts[i][1] + pts[i + 1][1]) / 2;
      if (x > 2 && x < map.width - 2 && z > 2 && z < map.height - 2 && terrain.waterSdfAt(x, z) < -0.2) spots.push([x, z]);
    }
    for (const l of map.lake) {
      if (l.x > 2 && l.x < map.width - 2 && l.z > 2 && l.z < map.height - 2 && terrain.waterSdfAt(l.x, l.z) < -0.2) spots.push([l.x, l.z]);
    }
    for (let i = 0; i < DRAGONFLY_COUNT && spots.length > 0; i++) {
      // Spread across the available water: interleave creek and lake spots.
      const [hx, hz] = spots[Math.floor(((i + rng() * 0.8) * spots.length) / DRAGONFLY_COUNT) % spots.length];
      const y = this.waterY(hx, hz) + 0.35 + rng() * 0.25;
      this.dragonBody.setColorAt(i, color.set(DRAGONFLY_COLORS[i % DRAGONFLY_COLORS.length]));
      this.dragonflies.push({
        homeX: hx,
        homeZ: hz,
        fromX: hx,
        fromY: y,
        fromZ: hz,
        toX: hx,
        toY: y,
        toZ: hz,
        x: hx,
        y,
        z: hz,
        yaw: rng() * TAU,
        darting: false,
        k: 0,
        dur: 0.4,
        timer: rng() * 2,
        seed: rng() * 100,
        scale: 0.9 + rng() * 0.25,
      });
    }
    this.dragonBody.count = this.dragonflies.length;
    this.dragonWing.count = this.dragonflies.length * 4;

    this.group.add(
      this.birdBody,
      this.birdBeak,
      this.birdInner,
      this.birdOuter,
      this.flyBody,
      this.flyWing,
      this.dragonBody,
      this.dragonWing,
    );
    this.culled = [this.birdBody, this.birdBeak, this.birdInner, this.birdOuter, this.flyBody, this.flyWing, this.dragonBody, this.dragonWing];
    this.update(0);
  }

  /** `night` (0–1, from DayCycle): birds, butterflies and dragonflies are day creatures. */
  update(time: number, night = 0): void {
    const dt = Number.isNaN(this.lastTime) ? 0 : Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const awake = night < 0.6;
    this.group.visible = awake;
    if (!awake) return;
    for (let i = 0; i < this.birds.length; i++) this.updateBird(i, time);
    for (let i = 0; i < this.butterflies.length; i++) this.updateButterfly(i, time, dt);
    for (let i = 0; i < this.dragonflies.length; i++) this.updateDragonfly(i, time, dt);
    this.birdBody.instanceMatrix.needsUpdate = true;
    this.birdBeak.instanceMatrix.needsUpdate = true;
    this.birdInner.instanceMatrix.needsUpdate = true;
    this.birdOuter.instanceMatrix.needsUpdate = true;
    this.flyBody.instanceMatrix.needsUpdate = true;
    this.flyWing.instanceMatrix.needsUpdate = true;
    this.dragonBody.instanceMatrix.needsUpdate = true;
    this.dragonWing.instanceMatrix.needsUpdate = true;
    for (const m of this.culled) m.computeBoundingSphere();
  }

  // ---------------------------------------------------------------------------------
  // Matrix helpers
  // ---------------------------------------------------------------------------------

  /** Creature root: yaw about Y, then pitch, then roll (forward is +Z). */
  private setBase(x: number, y: number, z: number, yaw: number, pitch: number, roll: number, scale: number): void {
    this.q.setFromEuler(this.e.set(pitch, yaw, roll, 'YXZ'));
    this.base.compose(this.v.set(x, y, z), this.q, this.s.setScalar(scale));
  }

  /** Joint transform: sweep about Y first, then flap about Z (the body axis). */
  private setLocal(target: THREE.Matrix4, x: number, y: number, z: number, sweep: number, flap: number): void {
    this.q.setFromEuler(this.e.set(0, sweep, flap, 'ZYX'));
    target.compose(this.v.set(x, y, z), this.q, this.one);
  }

  private waterY(x: number, z: number): number {
    return Math.max(WATER_LEVEL, this.terrain.heightAt(x, z));
  }

  // ---------------------------------------------------------------------------------
  // Birds
  // ---------------------------------------------------------------------------------

  /** 0 = gliding, 1 = flapping. Smooth in time so the flight path stays differentiable. */
  private flapEnvelope(b: Bird, t: number): number {
    const c = Math.sin(t * b.glideW + b.glideP) + 0.5 * Math.sin(t * b.glideW * 2.7 + b.glideP * 1.7) + b.glideBias;
    return smooth(-0.35, 0.35, c);
  }

  private birdPath(b: Bird, t: number, out: THREE.Vector3): void {
    const u = b.p + t * b.w;
    let lx: number;
    let lz: number;
    if (b.kind === 0) {
      // A big loop with a smaller epicycle riding on it: wandering, never-quite-repeating curls.
      lx = Math.cos(u) * b.r + Math.cos(u * b.k2 + b.p2) * b.r2;
      lz = Math.sin(u) * b.r * b.ecc + Math.sin(u * b.k2 + b.p2) * b.r2;
    } else {
      // Figure-eight (lemniscate-ish).
      lx = Math.sin(u) * b.r * 1.2;
      lz = Math.sin(2 * u) * b.r * 0.55 * b.ecc;
    }
    lx += Math.sin(u * 0.37 + b.p2) * b.wobble;
    lz += Math.cos(u * 0.29 + b.p) * b.wobble;
    const cx = b.cx + Math.sin(t * 0.017 + b.drift) * 4;
    const cz = b.cz + Math.cos(t * 0.013 + b.drift * 1.3) * 4;
    const env = this.flapEnvelope(b, t);
    out.set(
      cx + lx * b.cosA - lz * b.sinA,
      b.h + Math.sin(t * b.hW + b.drift) * b.hAmp + (env - 0.5) * 0.9,
      cz + lx * b.sinA + lz * b.cosA,
    );
  }

  private updateBird(i: number, t: number): void {
    const b = this.birds[i];
    const h = 0.08;
    this.birdPath(b, t - h, this.p0);
    this.birdPath(b, t, this.p1);
    this.birdPath(b, t + h, this.p2);
    const vx = (this.p2.x - this.p0.x) / (2 * h);
    const vy = (this.p2.y - this.p0.y) / (2 * h);
    const vz = (this.p2.z - this.p0.z) / (2 * h);
    const ax = (this.p2.x - 2 * this.p1.x + this.p0.x) / (h * h);
    const az = (this.p2.z - 2 * this.p1.z + this.p0.z) / (h * h);
    const hs2 = Math.max(1e-4, vx * vx + vz * vz);
    const hs = Math.sqrt(hs2);
    const yaw = Math.atan2(vx, vz);
    const yawRate = (vz * ax - vx * az) / hs2;
    // Bank into the turn (stylised: much stronger than real centripetal banking).
    const bank = -Math.max(-0.75, Math.min(0.75, hs * yawRate * 0.32));

    const env = this.flapEnvelope(b, t);
    const phase = t * b.flapW + b.flapP;
    const s = stroke(phase);
    const up = upstroke(phase);
    const sLag = stroke(phase - 0.95);
    const glideWobble = Math.sin(t * 1.3 + b.drift) * 0.04;

    // Body bobs against the stroke: pushed up on the downstroke, sagging on recovery.
    const bob = -env * 0.05 * s * b.scale;
    const pitch = -Math.atan2(vy, hs) * 0.7 + env * 0.06 * s;
    this.setBase(this.p1.x, this.p1.y + bob, this.p1.z, yaw, pitch, bank + glideWobble * (1 - env), b.scale);
    this.out.copy(this.base);
    this.birdBody.setMatrixAt(i, this.out);
    this.birdBeak.setMatrixAt(i, this.out);

    // Inner wing: big asymmetric stroke while flapping, slight dihedral while gliding.
    const inner = env * (0.12 + 0.68 * s) + (1 - env) * (0.1 + glideWobble);
    const innerSweep = env * 0.2 * up;
    // Outer wing lags the inner (bent up on the downstroke, trailing down/folded on recovery).
    const outer = env * (0.6 * (sLag - s) - 0.1 * up) + (1 - env) * (0.06 - glideWobble * 0.5);
    const outerSweep = env * 0.5 * up + (1 - env) * 0.12;

    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1;
      const idx = i * 2 + side;
      this.setLocal(this.local, sign * 0.045, 0.03, 0.035, innerSweep, side === 0 ? inner : Math.PI - inner);
      this.joint.multiplyMatrices(this.base, this.local);
      this.birdInner.setMatrixAt(idx, this.joint);
      this.setLocal(this.local, BIRD_INNER_SPAN, 0, 0, outerSweep, side === 0 ? outer : -outer);
      this.out.multiplyMatrices(this.joint, this.local);
      this.birdOuter.setMatrixAt(idx, this.out);
    }
  }

  // ---------------------------------------------------------------------------------
  // Butterflies
  // ---------------------------------------------------------------------------------

  private updateButterfly(i: number, t: number, dt: number): void {
    const f = this.butterflies[i];
    const sd = f.seed;
    const ground = this.terrain.heightAt(f.x, f.z);
    let wing: number;
    let bob = 0;
    let targetPitch = 0;
    let targetRoll = 0;

    if (f.mode === Mode.Perch) {
      // Resting on a flower: wings slowly open and close.
      f.flap += dt * 2.1;
      wing = 0.3 + 1.1 * (0.5 + 0.5 * Math.sin(f.flap));
      f.y += (ground + 0.1 - f.y) * Math.min(1, dt * 6);
      f.timer -= dt;
      if (f.timer <= 0) {
        f.mode = Mode.Fly;
        f.timer = 6 + this.rng() * 10;
        f.heading += (this.rng() - 0.5) * 2;
      }
    } else {
      // Erratic but smooth wander: layered sines drive the turn rate.
      const turn = Math.sin(t * 1.3 + sd) * 1.7 + Math.sin(t * 2.9 + sd * 1.7) * 1.1 + Math.sin(t * 5.3 + sd * 2.3) * 0.6;
      f.heading += turn * dt;
      const dx = f.homeX - f.x;
      const dz = f.homeZ - f.z;
      const dist = Math.hypot(dx, dz);
      const toHome = Math.atan2(dx, dz);
      if (dist > f.radius) f.heading += wrapAngle(toHome - f.heading) * Math.min(1, dt * 1.2 * (dist - f.radius));
      const sh = Math.sin(f.heading);
      const ch = Math.cos(f.heading);
      if (this.terrain.waterSdfAt(f.x + sh * 0.7, f.z + ch * 0.7) < 0.4) {
        f.heading += wrapAngle(toHome - f.heading) * Math.min(1, dt * 4);
      }
      const glide = f.mode === Mode.Fly ? smooth(0.55, 0.85, Math.sin(t * 0.45 + sd) * 0.6 + Math.sin(t * 1.13 + sd * 3.1) * 0.4) : 0;
      const landing = f.mode === Mode.Land;
      const speed = f.speed * (0.75 + 0.25 * Math.sin(t * 0.9 + sd)) * (1 + glide * 0.15) * (landing ? 0.45 : 1);
      f.x += Math.sin(f.heading) * speed * dt;
      f.z += Math.cos(f.heading) * speed * dt;

      f.flap += dt * f.flapRate * (0.85 + 0.3 * Math.sin(t * 1.7 + sd));
      const w = 0.5 + 0.5 * Math.sin(f.flap);
      const flutter = -0.3 + 1.65 * w * w * (3 - 2 * w);
      wing = flutter * (1 - glide) + (0.28 + 0.05 * Math.sin(t * 3 + sd)) * glide;
      bob = 0.03 * Math.cos(f.flap) * (1 - glide) * f.scale;
      targetPitch = -0.25;
      targetRoll = -turn * 0.1;

      if (landing) {
        const perchY = ground + 0.1;
        f.y += (perchY - f.y) * Math.min(1, dt * 2.5);
        if (f.y - perchY < 0.03) {
          f.mode = Mode.Perch;
          f.timer = 1.5 + this.rng() * 3;
          f.flap = -Math.PI / 2; // touch down with wings spread, then slowly fold
        }
      } else {
        const hover = 0.3 + 0.35 * (1 + Math.sin(t * 0.7 + sd) * 0.8 + Math.sin(t * 1.9 + sd * 0.6) * 0.2);
        f.y += (ground + hover - glide * 0.12 - f.y) * Math.min(1, dt * 3);
        f.timer -= dt;
        if (f.timer <= 0) {
          if (this.terrain.waterSdfAt(f.x, f.z) > 0.6 && dist < f.radius) {
            f.mode = Mode.Land;
          } else {
            f.timer = 1 + this.rng() * 2;
          }
        }
      }
    }

    f.pitch += (targetPitch - f.pitch) * Math.min(1, dt * 4);
    f.roll += (targetRoll - f.roll) * Math.min(1, dt * 4);
    this.setBase(f.x, f.y + bob, f.z, f.heading, f.pitch, f.roll, f.scale);
    this.flyBody.setMatrixAt(i, this.base);
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1;
      this.setLocal(this.local, sign * 0.006, 0.008, 0.012, 0, side === 0 ? wing : Math.PI - wing);
      this.out.multiplyMatrices(this.base, this.local);
      this.flyWing.setMatrixAt(i * 2 + side, this.out);
    }
  }

  // ---------------------------------------------------------------------------------
  // Dragonflies
  // ---------------------------------------------------------------------------------

  private updateDragonfly(i: number, t: number, dt: number): void {
    const d = this.dragonflies[i];
    const sd = d.seed;
    let pitch = 0;
    let targetYaw = d.yaw;
    if (d.darting) {
      d.k = Math.min(1, d.k + dt / d.dur);
      const k = d.k * d.k * d.k * (d.k * (d.k * 6 - 15) + 10); // smootherstep
      d.x = d.fromX + (d.toX - d.fromX) * k;
      d.y = d.fromY + (d.toY - d.fromY) * k;
      d.z = d.fromZ + (d.toZ - d.fromZ) * k;
      targetYaw = Math.atan2(d.toX - d.fromX, d.toZ - d.fromZ);
      pitch = 0.3 * Math.sin(Math.PI * d.k);
      if (d.k >= 1) {
        d.darting = false;
        d.timer = 0.8 + this.rng() * 2.4;
      }
    } else {
      d.timer -= dt;
      targetYaw = d.yaw + Math.sin(t * 0.8 + sd) * 0.3 * dt;
      if (d.timer <= 0) this.pickDart(d);
    }
    d.yaw += wrapAngle(targetYaw - d.yaw) * Math.min(1, dt * 14);

    // Hover jitter on top of the anchor position.
    const jx = Math.sin(t * 3.1 + sd) * 0.025 + Math.sin(t * 7.3 + sd * 2) * 0.01;
    const jy = Math.sin(t * 2.3 + sd * 1.3) * 0.03;
    const jz = Math.cos(t * 2.7 + sd * 0.7) * 0.025;
    this.setBase(d.x + jx, d.y + jy, d.z + jz, d.yaw, pitch, Math.sin(t * 1.9 + sd) * 0.06, d.scale);
    this.dragonBody.setMatrixAt(i, this.base);
    for (let w = 0; w < 4; w++) {
      const hind = w >= 2;
      const right = w % 2 === 0;
      const flap = 0.12 + 0.34 * Math.sin(t * 46 + sd + (hind ? 1.9 : 0));
      this.setLocal(this.local, right ? 0.008 : -0.008, 0.016, hind ? -0.002 : 0.026, hind ? 0.22 : -0.12, right ? flap : Math.PI - flap);
      this.out.multiplyMatrices(this.base, this.local);
      this.dragonWing.setMatrixAt(i * 4 + w, this.out);
    }
  }

  private pickDart(d: Dragonfly): void {
    let tx = d.x;
    let tz = d.z;
    for (let attempt = 0; attempt < 6; attempt++) {
      const a = this.rng() * TAU;
      const r = 0.6 + this.rng() * 2.2;
      const cx = d.homeX + Math.sin(a) * r;
      const cz = d.homeZ + Math.cos(a) * r;
      if (this.terrain.waterSdfAt(cx, cz) < -0.15) {
        tx = cx;
        tz = cz;
        break;
      }
    }
    d.fromX = d.x;
    d.fromY = d.y;
    d.fromZ = d.z;
    d.toX = tx;
    d.toZ = tz;
    d.toY = this.waterY(tx, tz) + 0.25 + this.rng() * 0.4;
    const dist = Math.hypot(tx - d.x, tz - d.z);
    d.dur = Math.min(0.8, Math.max(0.25, dist / (4 + this.rng() * 2)));
    d.k = 0;
    d.darting = true;
  }
}
