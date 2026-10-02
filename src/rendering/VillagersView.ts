import * as THREE from 'three';
import { JOBS, type ToolId, type WorkAnim } from '../config/jobs';
import { buildingCenter } from '../sim/grid';
import { sampleRoute } from '../sim/pathfinding';
import type { GameState, Villager } from '../sim/types';
import { findBuilding, findNode, jobTypeOf, villagerPosition, workRate } from '../sim/villagerAI';
import type { Terrain } from '../world/terrain';
import { createVillagerFarMesh, createVillagerRig, type VillagerRig } from './models/villagerModel';

type Anim = WorkAnim | 'idle' | 'walk' | 'carry' | 'carryIdle' | 'celebrate';

export interface ImpactEvent {
  villagerId: number;
  anim: WorkAnim;
  position: THREE.Vector3;
  nodeId: number | null;
}

/** Beyond this camera distance villagers swap to their single-mesh far model. */
const FAR_LOD_DISTANCE = 46;

interface Visual {
  rig: VillagerRig;
  far: THREE.Mesh;
  isFar: boolean;
  heading: number;
  phase: number;
  lastPhase: number;
  seed: number;
  celebrateUntil: number;
}

/** Cycle length (seconds) and impact moment (0..1) for each work animation. */
const WORK_CYCLE: Record<WorkAnim, { period: number; impact: number | null }> = {
  chop: { period: 1.1, impact: 0.66 },
  dig: { period: 1.3, impact: 0.55 },
  mine: { period: 1.25, impact: 0.62 },
  cook: { period: 1.8, impact: null },
  research: { period: 3.2, impact: null },
  build: { period: 0.6, impact: 0.5 },
};

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Villager visuals driven entirely by simulation state: position and heading come
 * from the time-parameterised route, the pose from activity and job. Animation never
 * feeds back into the simulation — impacts are purely cosmetic callbacks.
 */
export class VillagersView {
  readonly group = new THREE.Group();
  private readonly visuals = new Map<number, Visual>();
  onImpact: ((e: ImpactEvent) => void) | null = null;

  constructor(private readonly terrain: Terrain) {}

  get hitboxes(): THREE.Object3D[] {
    return [...this.visuals.values()].map((v) => v.rig.hitbox);
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
      vis = { rig, far, isFar: false, heading: 0, phase: Math.random(), lastPhase: 0, seed: (v.id * 0.618) % 1, celebrateUntil: 0 };
      this.visuals.set(v.id, vis);
    }
    return vis;
  }

  update(state: GameState, dt: number, realTime: number, speed: number, camera: THREE.Vector3, lod = true): void {
    const seen = new Set<number>();
    for (const v of state.villagers) {
      seen.add(v.id);
      const vis = this.ensure(v);
      this.pose(state, v, vis, dt, realTime, speed);
      // Distance LOD with a little hysteresis so villagers don't flicker at the boundary.
      const d = vis.rig.root.position.distanceTo(camera);
      const far = lod && (vis.isFar ? d > FAR_LOD_DISTANCE * 0.94 : d > FAR_LOD_DISTANCE);
      if (far !== vis.isFar) {
        vis.isFar = far;
        vis.rig.body.visible = !far;
        vis.far.visible = far;
      }
      if (far) vis.far.position.y = vis.rig.body.position.y;
    }
    for (const [id, vis] of this.visuals) {
      if (!seen.has(id)) {
        this.group.remove(vis.rig.root);
        this.visuals.delete(id);
      }
    }
  }

  private pose(state: GameState, v: Villager, vis: Visual, dt: number, realTime: number, speed: number): void {
    const { rig } = vis;
    const p = villagerPosition(v, state.time);
    rig.root.position.set(p.x, this.terrain.groundHeightAt(p.x, p.z), p.z);

    const jt = v.job ? jobTypeOf(state, v.job) : null;
    const jobDef = jt ? JOBS[jt] : null;
    let anim: Anim = 'idle';
    let targetHeading = vis.heading;
    if (v.activity === 'walking' && v.route) {
      anim = v.carrying ? 'carry' : 'walk';
      targetHeading = sampleRoute(v.route, state.time).heading;
    } else if (v.activity === 'working' && jobDef) {
      anim = jobDef.anim;
      const target = this.jobTarget(state, v);
      if (target) targetHeading = Math.atan2(target.x - p.x, target.z - p.z);
    } else if (v.activity === 'blocked' && v.carrying) {
      anim = 'carryIdle';
    }
    if (vis.celebrateUntil > realTime && v.activity !== 'walking') anim = 'celebrate';
    vis.heading = lerpAngle(vis.heading, targetHeading, 1 - Math.exp(-dt * 10));
    rig.root.rotation.y = vis.heading;

    // Tools and loads.
    let tool: ToolId | null = null;
    if (jobDef && !v.carrying && anim !== 'celebrate') tool = jobDef.tool;
    for (const [id, obj] of Object.entries(rig.tools)) obj.visible = id === tool && (anim !== 'idle' || v.activity === 'blocked');
    rig.loads.timber.visible = v.carrying?.resource === 'timber';
    rig.loads.clay.visible = v.carrying?.resource === 'clay';

    // Reset to the neutral pose, then layer the current animation on top.
    rig.body.position.set(0, 0, 0);
    rig.body.rotation.set(0, 0, 0);
    rig.head.rotation.set(0, 0, 0);
    rig.legL.rotation.set(0, 0, 0);
    rig.legR.rotation.set(0, 0, 0);
    rig.armL.rotation.set(0, 0, 0.12);
    rig.armR.rotation.set(0, 0, -0.12);
    rig.torso.scale.set(1, 1, 1);

    const hungry = v.hungry && jobDef?.consumesFood;
    const workSpeed = jt ? Math.max(0.25, workRate(state, v, jt)) : 1;
    const t = realTime + vis.seed * 10;
    switch (anim) {
      case 'walk':
      case 'carry': {
        const ph = t * 9 * Math.min(3, speed);
        rig.legL.rotation.x = Math.sin(ph) * 0.65;
        rig.legR.rotation.x = -Math.sin(ph) * 0.65;
        rig.body.position.y = Math.abs(Math.sin(ph)) * 0.035;
        rig.body.rotation.x = 0.06;
        if (anim === 'carry') {
          rig.armL.rotation.set(-2.85, 0, 0.3);
          rig.armR.rotation.set(-2.85, 0, -0.3);
          rig.body.rotation.x = -0.02;
        } else {
          rig.armL.rotation.x = -Math.sin(ph) * 0.55;
          rig.armR.rotation.x = Math.sin(ph) * 0.55;
        }
        break;
      }
      case 'carryIdle':
        rig.armL.rotation.set(-2.85, 0, 0.3);
        rig.armR.rotation.set(-2.85, 0, -0.3);
        rig.body.position.y = Math.sin(t * 2) * 0.01;
        rig.head.rotation.y = Math.sin(t * 0.8) * 0.4;
        break;
      case 'celebrate': {
        const ph = t * 9;
        rig.body.position.y = Math.abs(Math.sin(ph)) * 0.2;
        rig.armL.rotation.set(-2.9, 0, 0.5 + Math.sin(ph * 2) * 0.3);
        rig.armR.rotation.set(-2.9, 0, -0.5 - Math.sin(ph * 2) * 0.3);
        rig.head.rotation.x = -0.2;
        break;
      }
      case 'idle': {
        rig.torso.scale.y = 1 + Math.sin(t * 2.1) * 0.02;
        const look = Math.sin(t * 0.45) + Math.sin(t * 0.21) * 0.6;
        rig.head.rotation.y = Math.abs(look) > 0.9 ? Math.sign(look) * 0.45 : look * 0.2;
        rig.armL.rotation.x = Math.sin(t * 1.3) * 0.05;
        rig.armR.rotation.x = -Math.sin(t * 1.3) * 0.05;
        break;
      }
      default:
        this.work(anim, vis, rig, dt * workSpeed * (hungry ? 0.7 : 1), t, v);
    }
    if (hungry) {
      rig.head.rotation.x += 0.22;
      rig.body.rotation.x += 0.05;
    }
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

  private work(anim: WorkAnim, vis: Visual, rig: VillagerRig, dt: number, t: number, v: Villager): void {
    const cycle = WORK_CYCLE[anim];
    vis.lastPhase = vis.phase;
    vis.phase = (vis.phase + dt / cycle.period) % 1;
    const ph = vis.phase;
    if (cycle.impact !== null) {
      const crossed = vis.lastPhase < cycle.impact && ph >= cycle.impact;
      const wrapped = vis.lastPhase > ph && (cycle.impact > vis.lastPhase || cycle.impact <= ph);
      if ((crossed || wrapped) && this.onImpact) {
        const pos = rig.root.localToWorld(new THREE.Vector3(0, 0.1, 0.45));
        this.onImpact({ villagerId: v.id, anim, position: pos, nodeId: v.job?.kind === 'gather' ? v.job.nodeId : null });
      }
    }
    switch (anim) {
      case 'chop': {
        let a: number;
        if (ph < 0.55) a = -2.5 * ease(ph / 0.55);
        else if (ph < 0.68) a = -2.5 + 2.0 * ((ph - 0.55) / 0.13);
        else a = -0.5 * (1 - ease((ph - 0.68) / 0.32));
        rig.armR.rotation.x = a;
        rig.armL.rotation.x = a * 0.8;
        rig.armL.rotation.z = -0.25;
        rig.armR.rotation.z = 0.05;
        rig.body.rotation.y = ph < 0.55 ? -0.25 * ease(ph / 0.55) : -0.25 + 0.35 * Math.min(1, (ph - 0.55) / 0.13);
        rig.body.rotation.x = ph > 0.55 && ph < 0.8 ? 0.15 : 0.02;
        rig.legL.rotation.x = -0.15;
        rig.legR.rotation.x = 0.2;
        break;
      }
      case 'mine': {
        // Two-handed overhead swing, body following through into the strike.
        let a: number;
        if (ph < 0.5) a = -2.7 * ease(ph / 0.5);
        else if (ph < 0.62) a = -2.7 + 2.3 * ((ph - 0.5) / 0.12);
        else a = -0.4 * (1 - ease((ph - 0.62) / 0.38));
        rig.armR.rotation.x = a;
        rig.armL.rotation.x = a * 0.95;
        rig.armL.rotation.z = -0.35;
        rig.armR.rotation.z = 0.15;
        rig.body.rotation.x = ph > 0.5 && ph < 0.75 ? 0.25 : -0.05;
        rig.body.position.y = ph < 0.5 ? 0.02 * ease(ph / 0.5) : 0;
        rig.legL.rotation.x = -0.2;
        rig.legR.rotation.x = 0.2;
        break;
      }
      case 'dig': {
        const s = Math.sin(ph * Math.PI * 2);
        rig.body.rotation.x = 0.3 + s * 0.15;
        rig.armR.rotation.x = -0.9 + s * 0.45;
        rig.armL.rotation.x = -0.7 + s * 0.4;
        rig.armL.rotation.z = -0.2;
        rig.legL.rotation.x = -0.25;
        rig.legR.rotation.x = 0.1;
        break;
      }
      case 'cook': {
        const a = ph * Math.PI * 2;
        rig.armR.rotation.x = -1.05 + Math.sin(a) * 0.22;
        rig.armR.rotation.z = -0.25 + Math.cos(a) * 0.25;
        rig.armL.rotation.x = -0.3;
        rig.body.rotation.x = 0.18;
        rig.head.rotation.x = 0.25;
        rig.head.rotation.z = Math.sin(t * 1.2) * 0.08;
        break;
      }
      case 'research': {
        rig.armL.rotation.set(-1.15, 0, 0.45);
        rig.armR.rotation.set(-1.15, 0, -0.45);
        rig.head.rotation.x = 0.35 + Math.sin(t * 1.6) * 0.04;
        rig.head.rotation.y = Math.sin(ph * Math.PI * 2) * 0.12;
        rig.body.position.y = Math.sin(t * 2) * 0.008;
        // Occasional thoughtful nod.
        if (ph > 0.85) rig.head.rotation.x -= Math.sin(((ph - 0.85) / 0.15) * Math.PI) * 0.3;
        break;
      }
      case 'build': {
        const k = Math.sin(ph * Math.PI);
        rig.armR.rotation.x = -2.0 + k * 1.3;
        rig.armL.rotation.x = -0.8;
        rig.armL.rotation.z = -0.3;
        rig.body.rotation.x = 0.22;
        rig.legL.rotation.x = -0.35;
        rig.legR.rotation.x = 0.35;
        break;
      }
    }
  }
}
