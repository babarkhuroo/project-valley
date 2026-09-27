import * as THREE from 'three';
import { BUILDINGS } from '../config/buildings';
import { JOBS } from '../config/jobs';
import { capacity } from '../sim/economy';
import { buildingCenter, rotatedSize } from '../sim/grid';
import { constructionFraction } from '../sim/selectors';
import type { BuildingInstance, GameState } from '../sim/types';
import { jobTypeOf } from '../sim/villagerAI';
import type { Terrain } from '../world/terrain';
import { PALETTE, mat } from './materials';
import { createBuildingModel, type BuildingModel } from './models/buildingModels';
import type { Particles } from './Particles';

interface ConstructionParts {
  foundation: THREE.Group;
  scaffold: THREE.Group;
  plane: THREE.Plane;
  materials: THREE.Material[];
}

interface Visual {
  id: number;
  key: string;
  group: THREE.Group;
  model: BuildingModel;
  hitbox: THREE.Mesh;
  construction: ConstructionParts | null;
  baseY: number;
  bounce: number;
  smokeClock: number;
  steamClock: number;
  sparkleClock: number;
  lastFill: number;
}

const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });

/** Keeps one visual per building in sync with state: placement, construction stages, storage fill and ambient life. */
export class BuildingsView {
  readonly group = new THREE.Group();
  private readonly visuals = new Map<number, Visual>();
  private hiddenId: number | null = null;

  constructor(private readonly terrain: Terrain, private readonly particles: Particles) {}

  get hitboxes(): THREE.Object3D[] {
    return [...this.visuals.values()].filter((v) => v.group.visible).map((v) => v.hitbox);
  }

  buildingIdFor(obj: THREE.Object3D): number | null {
    const id = obj.userData.buildingId;
    return typeof id === 'number' ? id : null;
  }

  /** Hide one building (while it is being moved). */
  setHidden(id: number | null): void {
    this.hiddenId = id;
    for (const v of this.visuals.values()) v.group.visible = v.id !== id;
  }

  groundYFor(b: Pick<BuildingInstance, 'defId' | 'cellX' | 'cellZ' | 'rotation'>): number {
    const { w, d } = rotatedSize(b.defId, b.rotation);
    let sum = 0;
    let n = 0;
    for (let z = 0; z <= d; z++) {
      for (let x = 0; x <= w; x++) {
        sum += this.terrain.heightAt(b.cellX + x, b.cellZ + z);
        n++;
      }
    }
    return sum / n;
  }

  private keyFor(b: BuildingInstance): string {
    return `${b.defId}:${b.status}:${b.cellX}:${b.cellZ}:${b.rotation}:${b.level}`;
  }

  private create(b: BuildingInstance): Visual {
    const def = BUILDINGS[b.defId];
    const model = createBuildingModel(b.defId, b.variant);
    const group = new THREE.Group();
    const c = buildingCenter(b);
    const baseY = this.groundYFor(b);
    group.position.set(c.x, baseY, c.z);
    group.rotation.y = (b.rotation * Math.PI) / 2;
    group.add(model.root);

    const { w, d } = def.footprint;
    if (def.category !== 'decor') {
      // A skirt hides gaps where the ground dips under the footprint.
      const skirt = new THREE.Mesh(new THREE.BoxGeometry(w - 0.12, 0.7, d - 0.12), mat(PALETTE.stoneDark));
      skirt.position.y = -0.33;
      skirt.receiveShadow = true;
      group.add(skirt);
    }
    const hitbox = new THREE.Mesh(new THREE.BoxGeometry(w * 0.95, Math.max(0.6, def.height), d * 0.95), hitMaterial);
    hitbox.position.y = Math.max(0.6, def.height) / 2;
    hitbox.userData.buildingId = b.id;
    group.add(hitbox);

    let construction: ConstructionParts | null = null;
    if (b.status === 'construction') construction = this.decorateConstruction(group, model, w, d, def.height);

    this.group.add(group);
    return {
      id: b.id,
      key: this.keyFor(b),
      group,
      model,
      hitbox,
      construction,
      baseY,
      bounce: 0,
      smokeClock: Math.random(),
      steamClock: Math.random(),
      sparkleClock: Math.random(),
      lastFill: -1,
    };
  }

  private decorateConstruction(group: THREE.Group, model: BuildingModel, w: number, d: number, height: number): ConstructionParts {
    const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    const materials: THREE.Material[] = [];
    const cloned = new Map<THREE.Material, THREE.Material>();
    model.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.Material;
      let m = cloned.get(src);
      if (!m) {
        m = src.clone();
        m.clippingPlanes = [plane];
        m.clipShadows = true;
        cloned.set(src, m);
        materials.push(m);
      }
      mesh.material = m;
    });
    const foundation = new THREE.Group();
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w - 0.15, 0.14, d - 0.15), mat(PALETTE.stone));
    slab.position.y = 0.07;
    slab.receiveShadow = true;
    foundation.add(slab);
    const stakeMat = mat(PALETTE.woodLight);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const stake = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.06), stakeMat);
      stake.position.set((sx * w) / 2, 0.2, (sz * d) / 2);
      foundation.add(stake);
    }
    // A little pile of materials waiting on site.
    for (let i = 0; i < 3; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 7), mat(PALETTE.bark));
      log.rotation.z = Math.PI / 2;
      log.position.set(w / 2 + 0.05 - 0.3, 0.07 + (i === 2 ? 0.12 : 0), d / 2 + 0.2 + (i === 2 ? 0 : (i - 0.5) * 0.15));
      log.castShadow = true;
      foundation.add(log);
    }
    group.add(foundation);

    const scaffold = new THREE.Group();
    const pole = mat(PALETTE.woodLight);
    const plank = mat(PALETTE.wood);
    const h = height * 0.85;
    const hw = w / 2 + 0.08;
    const hd = d / 2 + 0.08;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1]]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, h, 5), pole);
      p.position.set(sx * hw, h / 2, sz * hd);
      p.castShadow = true;
      scaffold.add(p);
    }
    for (const y of [h * 0.45, h * 0.9]) {
      for (const sz of [-1, 1]) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(w + 0.25, 0.04, 0.18), plank);
        board.position.set(0, y, sz * (hd + 0.05));
        board.castShadow = true;
        scaffold.add(board);
      }
      for (const sx of [-1, 1]) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, d + 0.25), plank);
        board.position.set(sx * (hw + 0.05), y, 0);
        scaffold.add(board);
      }
    }
    scaffold.visible = false;
    group.add(scaffold);
    return { foundation, scaffold, plane, materials };
  }

  /** Reconciles visuals with state; returns ids of buildings that just finished. */
  sync(state: GameState): number[] {
    const finished: number[] = [];
    const seen = new Set<number>();
    for (const b of state.buildings) {
      seen.add(b.id);
      const existing = this.visuals.get(b.id);
      const key = this.keyFor(b);
      if (existing && existing.key === key) continue;
      const wasConstruction = existing?.construction !== null && existing !== undefined;
      if (existing) this.dispose(existing);
      const v = this.create(b);
      if (wasConstruction && b.status === 'complete') {
        v.bounce = 1;
        finished.push(b.id);
      }
      v.group.visible = b.id !== this.hiddenId;
      this.visuals.set(b.id, v);
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        this.dispose(v);
        this.visuals.delete(id);
      }
    }
    return finished;
  }

  private dispose(v: Visual): void {
    this.group.remove(v.group);
    if (v.construction) for (const m of v.construction.materials) m.dispose();
    v.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }

  worldPosition(id: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    const v = this.visuals.get(id);
    if (!v) return null;
    return out.copy(v.group.position);
  }

  update(state: GameState, dt: number, realTime: number): void {
    const working = new Map<number, string>();
    for (const vill of state.villagers) {
      if (vill.activity !== 'working' || !vill.job || vill.job.kind === 'gather') continue;
      const jt = jobTypeOf(state, vill.job);
      if (jt) working.set(vill.job.buildingId, JOBS[jt].anim);
    }
    const fills: Record<string, number> = {};
    for (const b of state.buildings) {
      const v = this.visuals.get(b.id);
      if (!v) continue;
      const group = v.group;
      // Construction stages: foundation → frame → walls rising → finished.
      if (v.construction) {
        const f = constructionFraction(state, b);
        const def = BUILDINGS[b.defId];
        const top = v.baseY + (f < 0.1 ? -1 : ((f - 0.1) / 0.9) * (def.height + 0.4));
        v.construction.plane.constant = top;
        v.construction.scaffold.visible = f > 0.04;
        v.model.root.visible = f >= 0.1;
      }
      if (v.bounce > 0) {
        v.bounce = Math.max(0, v.bounce - dt * 1.6);
        const k = v.bounce;
        const s = 1 + Math.sin((1 - k) * Math.PI * 3) * 0.08 * k;
        group.scale.set(2 - s, s, 2 - s);
      } else if (group.scale.y !== 1) {
        group.scale.set(1, 1, 1);
      }
      if (b.status !== 'complete') continue;
      const model = v.model;
      for (const sp of model.spinners) sp.obj.rotation[sp.axis] += sp.speed * dt;
      for (const w of model.wavers) w.obj.rotation.x = w.base + Math.sin(realTime * w.speed) * w.amp;
      for (const fl of model.flames) {
        const s = 0.85 + Math.sin(realTime * 13 + b.id) * 0.12 + Math.sin(realTime * 7.3) * 0.08;
        fl.scale.set(s, 1 + (s - 1) * 2, s);
      }
      const activeJob = working.get(b.id);
      // Chimney smoke: homes always, the cookhouse harder while someone cooks.
      if (model.smoke.length > 0) {
        const rate = activeJob === 'cook' ? 0.28 : 0.6;
        v.smokeClock -= dt;
        if (v.smokeClock <= 0) {
          v.smokeClock = rate + Math.random() * 0.2;
          for (const p of model.smoke) this.particles.emit('smoke', model.root.localToWorld(p.clone()), 1, 0.08);
        }
      }
      if (model.steam.length > 0 && activeJob === 'cook') {
        v.steamClock -= dt;
        if (v.steamClock <= 0) {
          v.steamClock = 0.18 + Math.random() * 0.1;
          for (const p of model.steam) this.particles.emit('steam', model.root.localToWorld(p.clone()), 1, 0.3);
        }
      }
      if (activeJob === 'research') {
        v.sparkleClock -= dt;
        if (v.sparkleClock <= 0) {
          v.sparkleClock = 0.5 + Math.random() * 0.5;
          this.particles.emit('knowledge', model.root.localToWorld(new THREE.Vector3(-0.35, 1.1, 1.28)), 1, 0.2);
        }
      }
      if (model.fill) {
        const r = model.fill.resource;
        if (fills[r] === undefined) {
          const cap = capacity(state, r);
          fills[r] = cap > 0 ? Math.min(1, state.resources[r] / cap) : 0;
        }
        const fill = fills[r];
        if (Math.abs(fill - v.lastFill) > 0.001) {
          v.lastFill = fill;
          const shown = Math.round(fill * model.fill.items.length);
          model.fill.items.forEach((item, i) => (item.visible = i < shown));
        }
      }
    }
  }
}
