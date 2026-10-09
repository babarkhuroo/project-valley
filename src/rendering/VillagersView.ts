import * as THREE from 'three';
import { JOBS, type JobType, type ToolId, type WorkAnim } from '../config/jobs';
import { buildingCenter } from '../sim/grid';
import { sampleRoute } from '../sim/pathfinding';
import type { GameState, Villager } from '../sim/types';
import { findBuilding, findNode, jobTypeOf, villagerPosition, workRate } from '../sim/villagerAI';
import { farmTask } from '../sim/farming';
import type { Terrain } from '../world/terrain';
import { createVillagerFarMesh, createVillagerRig, HIDDEN, RIG, type Accessory, type VillagerRig } from './models/villagerModel';

type Anim = WorkAnim | 'idle' | 'walk' | 'carry' | 'carryIdle' | 'wait' | 'celebrate';

type FarmTask = ReturnType<typeof farmTask>;

export interface ImpactEvent {
  villagerId: number;
  anim: WorkAnim;
  /** What a farmer was doing (farm impacts only). */
  task: FarmTask | null;
  position: THREE.Vector3;
  nodeId: number | null;
}

/** Beyond this camera distance villagers swap to their single-mesh far model. */
const FAR_LOD_DISTANCE = 46;
/** Seconds to blend from one animation into the next. */
const BLEND_SECONDS = 0.22;

/**
 * A pose is a flat list of joint values, so any two can be blended. Signs: shoulders
 * and hips rotate negative-x to swing forward; elbows flex with negative x, knees with
 * positive x; a left shoulder's negative z (a right one's positive z) lifts the arm out.
 */
const KEYS = [
  'bx', 'by', 'bz',
  'srx', 'sry', 'srz', 'breathe',
  'hrx', 'hry', 'hrz',
  'lsx', 'lsy', 'lsz', 'le',
  'rsx', 'rsy', 'rsz', 're',
  'lhx', 'lhz', 'lk',
  'rhx', 'rhz', 'rk',
  'hair', 'hairZ',
] as const;
type Key = (typeof KEYS)[number];
type Pose = Record<Key, number>;

function newPose(): Pose {
  return Object.fromEntries(KEYS.map((k) => [k, 0])) as Pose;
}

function rest(p: Pose): void {
  for (const k of KEYS) p[k] = 0;
  p.breathe = 1;
  p.lsz = -0.1;
  p.rsz = 0.1;
  p.le = -0.15;
  p.re = -0.15;
  p.lk = 0.04;
  p.rk = 0.04;
}

/** Bends both knees by `a` (hips forward, shins back) and lowers the body to keep the feet down. */
function crouch(p: Pose, a: number): void {
  p.lhx -= a;
  p.rhx -= a;
  p.lk += 2 * a;
  p.rk += 2 * a;
  p.by -= (RIG.thigh + RIG.shin) * (1 - Math.cos(a));
  // Lean the chest forward a little for balance.
  p.srx += a * 0.35;
}

function mix(p: Pose, k: Key, value: number, w: number): void {
  p[k] += (value - p[k]) * w;
}

/** Cycle length (seconds) and impact moment (0..1) for each work animation. */
const WORK_CYCLE: Record<WorkAnim, { period: number; impact: number | null }> = {
  chop: { period: 1.1, impact: 0.66 },
  dig: { period: 1.3, impact: 0.55 },
  mine: { period: 1.25, impact: 0.62 },
  farm: { period: 1.3, impact: 0.6 },
  craft: { period: 0.8, impact: 0.5 },
  cook: { period: 1.8, impact: null },
  research: { period: 3.2, impact: null },
  build: { period: 0.6, impact: 0.5 },
};

/** Clothing worn for a kind of work. */
const OUTFIT: Partial<Record<JobType, Accessory>> = { cook: 'apron', craft: 'leatherApron', study: 'satchel', build: 'toolBelt' };

type Fidget = 'look' | 'stretch' | 'scratch' | 'yawn' | 'shuffle';

interface Visual {
  rig: VillagerRig;
  far: THREE.Mesh;
  isFar: boolean;
  heading: number;
  /** Work-cycle phase 0..1 and its previous value (for impact crossings). */
  phase: number;
  lastPhase: number;
  /** Walk-cycle phase in radians. */
  stride: number;
  seed: number;
  celebrateUntil: number;
  /** Which foot is down, for footstep sounds. */
  foot: boolean;
  /** Blending: the pose being blended away from, how far along, and what's playing. */
  from: Pose;
  out: Pose;
  target: Pose;
  blend: number;
  key: string;
  nextBlink: number;
  blinkAt: number;
  fidget: { kind: Fidget; start: number; dur: number } | null;
  nextFidget: number;
  /** 0..1 how engaged in a chat with a neighbour (eased in and out). */
  chat: number;
  accessory: Accessory | null;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function ease(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** 0 → 1 → 0 over [start, start+dur] with soft edges. */
function envelope(t: number, start: number, dur: number, edge = 0.35): number {
  const x = t - start;
  if (x <= 0 || x >= dur) return 0;
  return ease(Math.min(x / edge, (dur - x) / edge, 1));
}

/** Small deterministic noise per villager so no two idle the same way. */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

interface Chatter {
  id: number;
  x: number;
  z: number;
}

/**
 * Villager visuals driven entirely by simulation state: position and heading come
 * from the time-parameterised route, the pose from activity and job. Each frame
 * builds a target pose (work cycle, walk cycle, idle fidgets, chatting with a
 * neighbour) and blends into it from whatever was playing, so nothing snaps.
 * Animation never feeds back into the simulation — impacts are cosmetic callbacks.
 */
export class VillagersView {
  readonly group = new THREE.Group();
  private readonly visuals = new Map<number, Visual>();
  onImpact: ((e: ImpactEvent) => void) | null = null;
  /** A walking villager's foot touches down (cosmetic, for footstep sounds). */
  onStep: ((position: THREE.Vector3) => void) | null = null;
  /** 0 by day … 1 at night (set by the renderer): idle villagers yawn more after dark. */
  night = 0;

  constructor(private readonly terrain: Terrain) {}

  get hitboxes(): THREE.Object3D[] {
    return [...this.visuals.values()].filter((v) => v.rig.root.visible).map((v) => v.rig.hitbox);
  }

  villagerIdFor(obj: THREE.Object3D): number | null {
    const id = obj.userData.villagerId;
    return typeof id === 'number' ? id : null;
  }

  worldPosition(id: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const v = this.visuals.get(id);
    return v ? out.copy(v.rig.root.position) : null;
  }

  celebrate(ids: number[] | 'all', realTime: number, seconds = 2.2): void {
    for (const [id, v] of this.visuals) if (ids === 'all' || ids.includes(id)) v.celebrateUntil = realTime + seconds;
  }

  private ensure(v: Villager): Visual {
    let vis = this.visuals.get(v.id);
    if (!vis) {
      const rig = createVillagerRig(v.appearance);
      rig.hitbox.userData.villagerId = v.id;
      rig.root.scale.setScalar(1.12);
      const far = createVillagerFarMesh(v.appearance);
      rig.root.add(far);
      this.group.add(rig.root);
      const seed = hash(v.id);
      const out = newPose();
      rest(out);
      vis = {
        rig,
        far,
        isFar: false,
        heading: 0,
        phase: Math.random(),
        lastPhase: 0,
        stride: seed * Math.PI * 2,
        seed,
        celebrateUntil: 0,
        foot: false,
        from: { ...out },
        out,
        target: newPose(),
        blend: 1,
        key: 'idle',
        nextBlink: 1 + seed * 3,
        blinkAt: -10,
        fidget: null,
        nextFidget: 3 + seed * 6,
        chat: 0,
        accessory: null,
      };
      this.visuals.set(v.id, vis);
    }
    return vis;
  }

  update(state: GameState, dt: number, realTime: number, speed: number, camera: THREE.Vector3, lod = true): void {
    const seen = new Set<number>();
    // Idle villagers standing about, for striking up conversations.
    const chatters: Chatter[] = [];
    for (const v of state.villagers) {
      if (!v.job && !v.away && v.activity === 'idle') chatters.push({ id: v.id, ...villagerPosition(v, state.time) });
    }
    for (const v of state.villagers) {
      seen.add(v.id);
      const vis = this.ensure(v);
      // Away training in the Valley: not in the village at all.
      vis.rig.root.visible = v.activity !== 'away';
      if (v.activity === 'away') continue;
      // Distance LOD with a little hysteresis so villagers don't flicker at the boundary.
      const d = vis.rig.root.position.distanceTo(camera);
      const far = lod && (vis.isFar ? d > FAR_LOD_DISTANCE * 0.94 : d > FAR_LOD_DISTANCE);
      if (far !== vis.isFar) {
        vis.isFar = far;
        vis.rig.body.visible = !far;
        vis.rig.mesh.visible = !far;
        vis.far.visible = far;
      }
      this.pose(state, v, vis, dt, realTime, speed, chatters, far);
      if (far) vis.far.position.y = vis.rig.body.position.y;
    }
    for (const [id, vis] of this.visuals) {
      if (!seen.has(id)) {
        this.group.remove(vis.rig.root);
        vis.rig.mesh.skeleton.dispose();
        this.visuals.delete(id);
      }
    }
  }

  private pose(state: GameState, v: Villager, vis: Visual, dt: number, realTime: number, speed: number, chatters: Chatter[], far: boolean): void {
    const { rig } = vis;
    const p = villagerPosition(v, state.time);
    rig.root.position.set(p.x, this.terrain.groundHeightAt(p.x, p.z), p.z);

    const jt = v.job ? jobTypeOf(state, v.job) : null;
    const jobDef = jt ? JOBS[jt] : null;
    const task: FarmTask | null = jt === 'farm' && v.job?.kind === 'operate' ? farmTask(findBuilding(state, v.job.buildingId)) : null;
    let anim: Anim = 'idle';
    let targetHeading = vis.heading;
    if (v.activity === 'walking' && v.route) {
      anim = v.carrying ? 'carry' : 'walk';
      targetHeading = sampleRoute(v.route, state.time).heading;
    } else if (v.activity === 'working' && jobDef) {
      anim = jobDef.anim;
      const target = this.jobTarget(state, v);
      if (target) targetHeading = Math.atan2(target.x - p.x, target.z - p.z);
    } else if (v.activity === 'blocked') {
      anim = v.carrying ? 'carryIdle' : 'wait';
    }
    if (vis.celebrateUntil > realTime && v.activity !== 'walking') anim = 'celebrate';

    // A neighbour to chat with: another idle villager close by.
    let partner: Chatter | null = null;
    if (anim === 'idle' && !v.job) {
      let best = 2.4;
      for (const c of chatters) {
        if (c.id === v.id) continue;
        const dist = Math.hypot(c.x - p.x, c.z - p.z);
        if (dist < best) {
          best = dist;
          partner = c;
        }
      }
    }
    vis.chat = Math.max(0, Math.min(1, vis.chat + (partner ? dt * 2.5 : -dt * 3)));
    if (partner) targetHeading = Math.atan2(partner.x - p.x, partner.z - p.z);

    const before = vis.heading;
    vis.heading = lerpAngle(vis.heading, targetHeading, 1 - Math.exp(-dt * (anim === 'idle' ? 5 : 10)));
    rig.root.rotation.y = vis.heading;
    const turnRate = dt > 0 ? angleDiff(before, vis.heading) / dt : 0;

    // Tools, loads and work clothes. Farmers swap tools with the field's stage.
    let tool: ToolId | null = null;
    if (jobDef && !v.carrying && anim !== 'celebrate') tool = task === 'sow' ? 'seeds' : task === 'harvest' ? 'sickle' : jobDef.tool;
    const showTool = anim !== 'idle' || v.activity === 'blocked';
    for (const [id, obj] of Object.entries(rig.tools)) obj.visible = showTool && id === tool;
    rig.loads.timber.visible = v.carrying?.resource === 'timber';
    rig.loads.clay.visible = v.carrying?.resource === 'clay' || v.carrying?.resource === 'stone';
    rig.loads.grain.visible = v.carrying?.resource === 'grain';
    const outfit = jt ? (OUTFIT[jt] ?? null) : null;
    if (outfit !== vis.accessory) {
      if (vis.accessory) rig.accessories[vis.accessory].scale.setScalar(HIDDEN);
      if (outfit) rig.accessories[outfit].scale.setScalar(1);
      vis.accessory = outfit;
    }
    if (far) return; // nobody can see the pose from here

    const hungry = !!(v.hungry && jobDef?.consumesFood);
    const workSpeed = jt ? Math.max(0.25, workRate(state, v, jt)) : 1;
    const t = realTime + vis.seed * 10;
    const target = vis.target;
    rest(target);
    let mouth = 1;

    switch (anim) {
      case 'walk':
      case 'carry': {
        const carry = anim === 'carry';
        vis.stride += dt * 9 * Math.min(3, speed) * (carry ? 0.85 : 1);
        const ph = vis.stride;
        const s = Math.sin(ph);
        const foot = s >= 0;
        if (foot !== vis.foot) {
          vis.foot = foot;
          this.onStep?.(rig.root.position);
        }
        const swing = carry ? 0.42 : 0.55;
        target.lhx = s * swing;
        target.rhx = -s * swing;
        target.lk = 0.08 + Math.max(0, -Math.cos(ph)) * (carry ? 0.85 : 0.7);
        target.rk = 0.08 + Math.max(0, Math.cos(ph)) * (carry ? 0.85 : 0.7);
        target.by = (1 - Math.abs(s)) * 0.03 - (carry ? 0.015 : 0);
        target.sry = s * 0.08;
        target.hry = -s * 0.05;
        target.srx = carry ? 0.04 : 0.07;
        // Lean into turns.
        target.srz = Math.max(-0.15, Math.min(0.15, -turnRate * 0.05));
        if (carry) {
          target.lsx = -2.75;
          target.rsx = -2.75;
          target.lsz = -0.28;
          target.rsz = 0.28;
          target.le = -0.55;
          target.re = -0.55;
        } else {
          target.lsx = -s * 0.5;
          target.rsx = s * 0.5;
          target.le = -0.25 - Math.max(0, s) * 0.45;
          target.re = -0.25 - Math.max(0, -s) * 0.45;
        }
        target.hair = 0.25 + Math.sin(ph * 2) * 0.08;
        target.hairZ = -s * 0.06;
        break;
      }
      case 'carryIdle':
        target.lsx = -2.75;
        target.rsx = -2.75;
        target.lsz = -0.28;
        target.rsz = 0.28;
        target.le = -0.55;
        target.re = -0.55;
        target.by = Math.sin(t * 2) * 0.008;
        target.hry = Math.sin(t * 0.8) * 0.4;
        crouch(target, 0.06);
        break;
      case 'wait': {
        // Arms folded, tapping a foot, the odd sigh.
        target.lsx = -0.55;
        target.rsx = -0.5;
        target.lsy = 0.75;
        target.rsy = -0.75;
        target.lsz = 0.15;
        target.rsz = -0.15;
        target.le = -1.95;
        target.re = -1.9;
        target.rhx = -0.12;
        target.rk = 0.22 + Math.max(0, Math.sin(t * 7)) * 0.22;
        const sigh = envelope(t % 9, 6.5, 1.8);
        target.hrx = -0.15 * sigh + 0.05;
        target.hrz = Math.sin(t * 0.7) * 0.12;
        target.breathe = 1 + sigh * 0.04;
        mouth = 1 + sigh * 0.6;
        break;
      }
      case 'celebrate': {
        const ph = t * 9;
        const air = Math.abs(Math.sin(ph));
        target.by = air * 0.18;
        target.lk = 0.25 + (1 - air) * 0.5;
        target.rk = target.lk;
        target.lhx = -(1 - air) * 0.25;
        target.rhx = target.lhx;
        target.lsx = -2.9;
        target.rsx = -2.9;
        target.lsz = -0.5 - Math.sin(ph * 2) * 0.3;
        target.rsz = 0.5 + Math.sin(ph * 2) * 0.3;
        target.le = -0.2;
        target.re = -0.2;
        target.hrx = -0.2;
        target.hair = 0.3 * air;
        mouth = 2.2;
        break;
      }
      case 'idle':
        mouth = this.idle(target, vis, t, realTime, partner, v.id);
        break;
      default:
        this.work(anim, task, vis, target, dt * workSpeed * (hungry ? 0.7 : 1), t, v);
    }
    if (hungry) {
      target.hrx += 0.22;
      target.srx += 0.08;
      mouth = 0.6;
    }

    // Blend into the new animation whenever what's playing changes.
    const key = anim === 'farm' ? `farm:${task}` : anim;
    if (key !== vis.key) {
      vis.key = key;
      Object.assign(vis.from, vis.out);
      vis.blend = 0;
    }
    vis.blend = Math.min(1, vis.blend + dt / BLEND_SECONDS);
    const w = ease(vis.blend);
    for (const k of KEYS) vis.out[k] = vis.from[k] + (target[k] - vis.from[k]) * w;
    this.apply(rig, vis.out);

    // Face: blinks (now and then a double), and the mouth.
    if (realTime >= vis.nextBlink) {
      vis.blinkAt = realTime;
      const double = hash(vis.seed * 97 + Math.floor(realTime)) < 0.18;
      vis.nextBlink = realTime + (double ? 0.28 : 2.2 + hash(vis.seed + realTime) * 3.8);
    }
    const lid = envelope(realTime, vis.blinkAt, 0.16, 0.06);
    if (lid > 0.02) rig.lids.scale.set(1, 0.15 + lid * 0.85, 1);
    else rig.lids.scale.setScalar(HIDDEN);
    rig.mouth.scale.set(mouth > 2.5 ? 0.8 : 1, mouth, 1);
  }

  /** Standing about: breathing, shifting weight, the odd fidget, or chatting with a neighbour. Returns mouth openness. */
  private idle(p: Pose, vis: Visual, t: number, realTime: number, partner: Chatter | null, id: number): number {
    p.breathe = 1 + Math.sin(t * 2.1) * 0.018;
    const shift = Math.sin(t * 0.31);
    p.bx = shift * 0.012;
    p.lhz = -0.03 + shift * 0.025;
    p.rhz = 0.03 + shift * 0.025;
    p.lk = 0.04 + Math.max(0, shift) * 0.12;
    p.rk = 0.04 + Math.max(0, -shift) * 0.12;
    p.srz = -shift * 0.03;
    const look = Math.sin(t * 0.45) + Math.sin(t * 0.21) * 0.6;
    p.hry = Math.abs(look) > 0.9 ? Math.sign(look) * 0.45 : look * 0.2;
    p.lsx = Math.sin(t * 1.3) * 0.05;
    p.rsx = -Math.sin(t * 1.3) * 0.05;
    let mouth = 1;

    // Chatting: the pair take turns, the speaker gesturing, the listener nodding.
    if (vis.chat > 0) {
      const w = ease(vis.chat);
      const pair = partner ? Math.min(id, partner.id) * 0.37 + Math.max(id, partner.id) * 0.11 : 0;
      const turn = Math.floor((realTime + pair) / 2.6) % 2;
      const speaking = partner ? (turn === 0) === id < partner.id : false;
      mix(p, 'hry', 0, w);
      if (speaking) {
        const g = Math.sin(realTime * 3.1 + vis.seed * 5);
        mix(p, 'rsx', -0.9 + g * 0.25, w);
        mix(p, 'rsz', 0.35 + Math.max(0, g) * 0.3, w);
        mix(p, 're', -1.1 + g * 0.3, w);
        mix(p, 'lsx', -0.35, w);
        mix(p, 'le', -0.6, w);
        mix(p, 'hrx', Math.sin(realTime * 4.3) * 0.08, w);
        mix(p, 'hrz', Math.sin(realTime * 1.7) * 0.08, w);
        mouth = 1 + w * Math.abs(Math.sin(realTime * 13 + vis.seed * 7)) * 1.4;
      } else {
        // Hands clasped behind the back, nodding along.
        mix(p, 'lsx', 0.35, w);
        mix(p, 'rsx', 0.35, w);
        mix(p, 'le', -0.7, w);
        mix(p, 're', -0.7, w);
        mix(p, 'lsz', 0.1, w);
        mix(p, 'rsz', -0.1, w);
        const nod = Math.max(0, Math.sin(realTime * 5.5)) * envelope(realTime % 2.6, 0.8, 1.2, 0.3);
        mix(p, 'hrx', nod * 0.18, w);
        mix(p, 'hrz', 0.1, w);
      }
      vis.fidget = null;
      return mouth;
    }

    // An occasional fidget, chosen per villager; yawns are likelier after dark.
    if (!vis.fidget && realTime >= vis.nextFidget) {
      const r = hash(vis.seed * 13 + Math.floor(realTime));
      const kinds: Fidget[] = this.night > 0.5 ? ['yawn', 'yawn', 'look', 'stretch', 'shuffle'] : ['look', 'stretch', 'scratch', 'shuffle', 'look', 'yawn'];
      const kind = kinds[Math.floor(r * kinds.length)];
      vis.fidget = { kind, start: realTime, dur: kind === 'look' ? 3.2 : kind === 'shuffle' ? 1.6 : 2.4 };
    }
    const f = vis.fidget;
    if (f) {
      const w = envelope(realTime, f.start, f.dur);
      const x = (realTime - f.start) / f.dur;
      switch (f.kind) {
        case 'look':
          mix(p, 'hry', Math.sin(x * Math.PI * 2) * 0.75, w);
          mix(p, 'hrx', -0.12, w);
          mix(p, 'sry', Math.sin(x * Math.PI * 2) * 0.2, w);
          break;
        case 'stretch':
          mix(p, 'lsx', -2.95, w);
          mix(p, 'rsx', -2.95, w);
          mix(p, 'lsz', 0.25, w);
          mix(p, 'rsz', -0.25, w);
          mix(p, 'le', -0.35, w);
          mix(p, 're', -0.35, w);
          mix(p, 'srx', -0.18, w);
          mix(p, 'hrx', -0.25, w);
          mix(p, 'by', 0.02, w);
          mouth = 1 + w * 1.2;
          break;
        case 'scratch':
          mix(p, 'rsx', -2.4, w);
          mix(p, 'rsz', 0.5, w);
          mix(p, 're', -2.0 + Math.sin(realTime * 18) * 0.12, w);
          mix(p, 'hrz', 0.18, w);
          mix(p, 'hrx', -0.05, w);
          break;
        case 'yawn':
          mix(p, 'lsx', -1.6, w);
          mix(p, 'lsz', -0.6, w);
          mix(p, 'le', -1.4, w);
          mix(p, 'rsx', -0.8, w);
          mix(p, 'rsz', 0.2, w);
          mix(p, 're', -1.9, w);
          mix(p, 'hrx', -0.3, w);
          mix(p, 'srx', -0.1, w);
          mouth = 1 + w * 2.8;
          break;
        case 'shuffle': {
          const step = Math.sin(x * Math.PI * 4);
          mix(p, 'lhx', -Math.max(0, step) * 0.3, w);
          mix(p, 'lk', Math.max(0, step) * 0.5, w);
          mix(p, 'rhx', -Math.max(0, -step) * 0.3, w);
          mix(p, 'rk', Math.max(0, -step) * 0.5, w);
          mix(p, 'by', Math.abs(step) * 0.012, w);
          break;
        }
      }
      if (realTime >= f.start + f.dur) {
        vis.fidget = null;
        vis.nextFidget = realTime + 4 + hash(vis.seed * 7 + realTime) * 7;
      }
    }
    return mouth;
  }

  private apply(rig: VillagerRig, p: Pose): void {
    rig.body.position.set(p.bx, p.by, 0);
    rig.spine.rotation.set(p.srx, p.sry, p.srz);
    rig.spine.scale.set(1, p.breathe, 1);
    rig.head.rotation.set(p.hrx, p.hry, p.hrz);
    rig.armL.rotation.set(p.lsx, p.lsy, p.lsz);
    rig.armR.rotation.set(p.rsx, p.rsy, p.rsz);
    rig.elbowL.rotation.x = p.le;
    rig.elbowR.rotation.x = p.re;
    rig.legL.rotation.set(p.lhx, 0, p.lhz);
    rig.legR.rotation.set(p.rhx, 0, p.rhz);
    rig.kneeL.rotation.x = p.lk;
    rig.kneeR.rotation.x = p.rk;
    rig.hair.rotation.set(p.hair, 0, p.hairZ);
  }

  private jobTarget(state: GameState, v: Villager): { x: number; z: number } | null {
    if (!v.job) return null;
    if (v.job.kind === 'gather') {
      const n = findNode(state, v.job.nodeId);
      return n ? { x: n.x, z: n.z } : null;
    }
    const b = findBuilding(state, v.job.buildingId);
    return b ? buildingCenter(b) : null;
  }

  private work(anim: WorkAnim, task: FarmTask | null, vis: Visual, p: Pose, dt: number, t: number, v: Villager): void {
    const cycle = WORK_CYCLE[anim];
    vis.lastPhase = vis.phase;
    vis.phase = (vis.phase + dt / cycle.period) % 1;
    const ph = vis.phase;
    if (cycle.impact !== null) {
      const crossed = vis.lastPhase < cycle.impact && ph >= cycle.impact;
      const wrapped = vis.lastPhase > ph && (cycle.impact > vis.lastPhase || cycle.impact <= ph);
      if ((crossed || wrapped) && this.onImpact) {
        const pos = vis.rig.root.localToWorld(new THREE.Vector3(0, 0.1, 0.45));
        this.onImpact({ villagerId: v.id, anim, task, position: pos, nodeId: v.job?.kind === 'gather' ? v.job.nodeId : null });
      }
    }
    p.breathe = 1 + Math.sin(t * 3) * 0.015;
    switch (anim) {
      case 'chop':
        this.swing(p, ph, { lift: 2.4, strike: 0.55, len: 0.13, twist: 0.35, knee: 0.18, low: 0.4 });
        break;
      case 'mine':
        this.swing(p, ph, { lift: 2.7, strike: 0.5, len: 0.12, twist: 0.12, knee: 0.3, low: 0.35 });
        break;
      case 'dig': {
        // Drive the shovel in with a crouch, then lever the clay up and out.
        const s = Math.sin(ph * Math.PI * 2);
        const push = ease(ph / 0.55) * (ph < 0.55 ? 1 : 0) + (ph >= 0.55 ? 1 - ease((ph - 0.55) / 0.45) : 0);
        crouch(p, 0.15 + push * 0.25);
        p.rsx = -0.55 + s * 0.35;
        p.re = -0.7 - push * 0.3;
        p.lsx = -1.0 + s * 0.25;
        p.lsz = 0.3;
        p.le = -0.55;
        p.srx += 0.15 + s * 0.12;
        p.hrx = 0.25;
        p.lhx -= 0.25;
        p.rhx += 0.2;
        break;
      }
      case 'craft': {
        // Sawing: the right elbow pumps the saw, the left hand steadies the plank.
        const k = Math.sin(ph * Math.PI * 2);
        crouch(p, 0.12);
        p.rsx = -0.95 + k * 0.3;
        p.re = -1.05 - k * 0.55;
        p.lsx = -0.9;
        p.lsz = 0.3;
        p.le = -1.15;
        p.srx += 0.25 + k * 0.05;
        p.bz = k * 0.015;
        p.hrx = 0.3;
        p.lhx -= 0.2;
        p.rhx += 0.2;
        break;
      }
      case 'cook': {
        // Stirring in circles, a hand on the hip, leaning in to sniff.
        const a = ph * Math.PI * 2;
        p.rsx = -0.85 + Math.sin(a) * 0.18;
        p.rsz = 0.05 + Math.cos(a) * 0.25;
        p.re = -1.0 + Math.cos(a) * 0.2;
        p.lsx = 0.15;
        p.lsz = -0.55;
        p.le = -1.7;
        p.srx = 0.18;
        p.sry = Math.sin(a) * 0.06;
        p.hrx = 0.28;
        p.hrz = Math.sin(t * 1.2) * 0.08;
        p.lhz = -0.05;
        p.rhz = 0.05;
        break;
      }
      case 'research': {
        // Reading with the book in both hands; now and then a page turn and a nod.
        p.lsx = -0.75;
        p.rsx = -0.75;
        p.lsz = 0.28;
        p.rsz = -0.28;
        p.le = -1.15;
        p.re = -1.15;
        p.hrx = 0.38 + Math.sin(t * 1.6) * 0.04;
        p.hry = Math.sin(ph * Math.PI * 2) * 0.12;
        if (ph > 0.78 && ph < 0.92) {
          const k = Math.sin(((ph - 0.78) / 0.14) * Math.PI);
          p.rsz += k * 0.5;
          p.re += k * 0.4;
        }
        if (ph > 0.9) p.hrx -= Math.sin(((ph - 0.9) / 0.1) * Math.PI) * 0.3;
        break;
      }
      case 'build': {
        // Hammering at chest height: the elbow does the work, the left hand holds the nail.
        crouch(p, 0.14);
        let e: number;
        if (ph < 0.5) e = -1.9 * ease(ph / 0.5);
        else if (ph < 0.6) e = -1.9 + 1.6 * ((ph - 0.5) / 0.1);
        else e = -0.3 - 0.2 * (1 - ease((ph - 0.6) / 0.4));
        p.rsx = -1.05 - (e < -1 ? 0.25 : 0);
        p.re = e;
        p.lsx = -1.0;
        p.lsz = 0.28;
        p.le = -0.85;
        p.srx += 0.15;
        p.hrx = 0.3;
        p.lhx -= 0.2;
        p.rhx += 0.25;
        break;
      }
      case 'farm':
        this.farm(p, task ?? 'tend', ph);
        break;
    }
  }

  /** A two-handed overhead swing (axe, pickaxe, hoe): lift, strike, recover. */
  private swing(p: Pose, ph: number, o: { lift: number; strike: number; len: number; twist: number; knee: number; low: number }): void {
    let a: number;
    let elbow: number;
    let twist: number;
    let bend: number;
    const end = o.strike + o.len;
    if (ph < o.strike) {
      const s = ease(ph / o.strike);
      a = -o.low - (o.lift - o.low) * s;
      elbow = -0.25 - 0.65 * s;
      twist = -o.twist * s;
      bend = -0.08 * s;
    } else if (ph < end) {
      const k = (ph - o.strike) / o.len;
      a = -o.lift + (o.lift - o.low) * k;
      elbow = -0.9 + 0.8 * k;
      twist = -o.twist + o.twist * 1.4 * k;
      bend = -0.08 + 0.4 * k;
    } else {
      const k = ease((ph - end) / (1 - end));
      a = -o.low;
      elbow = -0.1 - 0.15 * k;
      twist = o.twist * 0.4 * (1 - k);
      bend = 0.32 * (1 - k);
    }
    crouch(p, o.knee * (0.6 + (bend > 0 ? bend : 0)));
    p.rsx = a;
    p.lsx = a * 0.95;
    p.lsz = 0.35;
    p.rsz = -0.05;
    p.re = elbow;
    p.le = elbow * 0.9;
    p.sry = twist;
    p.srx += bend;
    p.hrx = 0.1 + bend * 0.4;
    p.lhx -= 0.25;
    p.rhx += 0.25;
  }

  /** Sowing casts seed in a wide arc, tending chops a hoe into the furrow, harvesting sweeps a sickle low. */
  private farm(p: Pose, task: FarmTask, ph: number): void {
    switch (task) {
      case 'sow': {
        // Hand dips into the pouch, then flings outward and across.
        const cast = ph < 0.45 ? ease(ph / 0.45) : 1 - ease((ph - 0.45) / 0.55);
        p.rsx = -0.45 - cast * 0.65;
        p.rsz = 0.1 + cast * 1.0;
        p.re = -1.2 + cast * 1.0;
        p.lsx = -0.45;
        p.lsz = 0.25;
        p.le = -1.4;
        p.sry = -0.3 + cast * 0.6;
        p.hry = -0.2 + cast * 0.4;
        p.lhx = -0.15;
        p.rhx = 0.15;
        break;
      }
      case 'tend':
        this.swing(p, ph, { lift: 1.7, strike: 0.5, len: 0.12, twist: 0.1, knee: 0.22, low: 0.3 });
        break;
      case 'harvest': {
        // Bent low: the left hand gathers a handful, the sickle sweeps across under it.
        const sweep = ph < 0.6 ? ease(ph / 0.6) : 1 - ease((ph - 0.6) / 0.4);
        crouch(p, 0.5);
        p.srx += 0.25;
        p.lhx -= 0.2;
        p.rhx += 0.3;
        p.lsx = -1.15;
        p.lsz = 0.3 - sweep * 0.15;
        p.le = -0.45;
        p.rsx = -1.05;
        p.rsz = 0.75 - sweep * 1.45;
        p.re = -0.35;
        p.hrx = 0.2;
        break;
      }
    }
  }
}
