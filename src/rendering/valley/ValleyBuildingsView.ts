import * as THREE from 'three';
import { VALLEY_BUILDING_ORDER, VALLEY_BUILDINGS, type ValleyBuildingId } from '../../config/valley';
import type { ValleyBuildingState, ValleySnapshot } from '../../valley/types';
import { WATER_LEVEL, type Terrain } from '../../world/terrain';
import type { BuildingModel } from '../models/buildingModels';
import { paintCrops } from '../models/farmModels';
import { now } from '../../game/clock';
import { VALLEY_MODEL_SIZE, createScaffold, createValleyModel } from '../models/valleyModels';
import type { SmokeSystem } from '../SmokeSystem';

interface Visual {
  id: ValleyBuildingId;
  key: string;
  group: THREE.Group;
  model: BuildingModel;
  scaffold: THREE.Group | null;
  hitbox: THREE.Mesh;
  smokeHandles: number[];
  level: number;
}

const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
const scratch = new THREE.Vector3();

/** One visual per communal building, rebuilt whenever its level or stage changes. */
export class ValleyBuildingsView {
  readonly group = new THREE.Group();
  private readonly visuals = new Map<ValleyBuildingId, Visual>();
  /** Called when a building gains a level while the Valley is on screen. */
  onRestored: ((id: ValleyBuildingId, at: THREE.Vector3) => void) | null = null;

  constructor(
    private readonly terrain: Terrain,
    private readonly smoke: SmokeSystem,
  ) {}

  get hitboxes(): THREE.Object3D[] {
    return [...this.visuals.values()].map((v) => v.hitbox);
  }

  idFor(obj: THREE.Object3D): ValleyBuildingId | null {
    return (obj.userData.valleyBuilding as ValleyBuildingId | undefined) ?? null;
  }

  groundY(id: ValleyBuildingId): number {
    const def = VALLEY_BUILDINGS[id];
    const { hx, hz } = VALLEY_MODEL_SIZE[def.model];
    let sum = 0;
    let n = 0;
    for (const dx of [-hx, 0, hx]) {
      for (const dz of [-hz, 0, hz]) {
        sum += this.terrain.heightAt(def.x + dx, def.z + dz);
        n++;
      }
    }
    return sum / n;
  }

  /** Top-centre of a building, for labels and effects. */
  topOf(id: ValleyBuildingId, out = new THREE.Vector3()): THREE.Vector3 {
    const def = VALLEY_BUILDINGS[id];
    const v = this.visuals.get(id);
    const h = v && v.level > 0 ? VALLEY_MODEL_SIZE[def.model].height : 2.6;
    return out.set(def.x, this.groundY(id) + h, def.z);
  }

  sync(snapshot: ValleySnapshot | null): void {
    this.sowing = snapshot?.sowing ?? null;
    for (const id of VALLEY_BUILDING_ORDER) {
      const b: Pick<ValleyBuildingState, 'level' | 'status'> = snapshot?.buildings[id] ?? { level: 0, status: 'locked' };
      const key = `${b.level}|${b.status}`;
      const cur = this.visuals.get(id);
      if (cur && cur.key === key) continue;
      const gained = !!cur && b.level > cur.level;
      if (cur) this.remove(cur);
      this.visuals.set(id, this.build(id, b.level, b.status, key));
      if (gained) this.onRestored?.(id, this.topOf(id));
    }
  }

  private build(id: ValleyBuildingId, level: number, status: ValleyBuildingState['status'], key: string): Visual {
    const def = VALLEY_BUILDINGS[id];
    const size = VALLEY_MODEL_SIZE[def.model];
    const group = new THREE.Group();
    group.position.set(def.x, this.groundY(id), def.z);
    group.rotation.y = def.facing;
    const model = createValleyModel(def, level, WATER_LEVEL + 0.32 - group.position.y);
    group.add(model.root);
    let scaffold: THREE.Group | null = null;
    if (status === 'building') {
      scaffold = createScaffold(def, level > 0 ? size.height : size.height * 0.7);
      group.add(scaffold);
    }
    const hitbox = new THREE.Mesh(new THREE.BoxGeometry(size.hx * 2, size.height, size.hz * 2), hitMaterial);
    hitbox.position.y = size.height / 2;
    hitbox.userData.valleyBuilding = id;
    group.add(hitbox);
    this.group.add(group);
    group.updateMatrixWorld(true);
    const smokeHandles = level > 0 ? model.smoke.map((p) => this.smoke.addEmitter(model.root.localToWorld(scratch.copy(p)), 'chimney', 1)) : [];
    return { id, key, group, model, scaffold, hitbox, smokeHandles, level };
  }

  private remove(v: Visual): void {
    for (const h of v.smokeHandles) this.smoke.removeEmitter(h);
    v.model.crops?.material.dispose();
    this.group.remove(v.group);
    v.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }

  private sowing: ValleySnapshot['sowing'] = null;

  /**
   * The Commons' plots follow the sowing round: bare between rounds, seedlings once
   * someone has sown, growing green to gold until the harvest.
   */
  private growCommons(m: BuildingModel, now: number): void {
    if (!m.crops) return;
    const s = this.sowing;
    if (!s || Object.keys(s.seed).length === 0) {
      paintCrops(m.crops, 0, 0);
      return;
    }
    const g = now < s.closesAt ? 0.06 : (now - s.closesAt) / Math.max(1, s.ripeAt - s.closesAt);
    paintCrops(m.crops, g, m.crops.rows.length);
  }

  update(dt: number, realTime: number): void {
    const t = now();
    for (const v of this.visuals.values()) {
      const m = v.model;
      if (v.id === 'goldfurrowCommons' && v.level > 0) this.growCommons(m, t);
      for (const sp of m.spinners) sp.obj.rotation[sp.axis] += sp.speed * dt;
      for (const w of m.wavers) w.obj.rotation.x = w.base + Math.sin(realTime * w.speed) * w.amp;
      for (const fl of m.flames) fl.scale.setScalar(1 + Math.sin(realTime * 9 + fl.position.x * 5) * 0.06);
      const jib = v.scaffold?.children.find((c) => c.userData.jib)?.userData.jib as THREE.Object3D | undefined;
      if (jib) jib.rotation.y = Math.sin(realTime * 0.25) * 0.9;
    }
  }

  dispose(): void {
    for (const v of this.visuals.values()) this.remove(v);
    this.visuals.clear();
  }
}
