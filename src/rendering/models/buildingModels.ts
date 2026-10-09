import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BuildingId } from '../../config/buildings';
import type { ResourceId } from '../../config/resources';
import { PALETTE, glowMat, mat } from '../materials';
import { logGeometry } from './natureModels';
import { fieldModel, granaryModel, type CropRows } from './farmModels';

/**
 * Procedural building models. Local origin is the footprint centre on the ground and
 * the front door faces +z. Models expose anchors (chimneys, animated parts, storage
 * fill items) so the view can bring them to life without knowing their layout.
 */
export interface BuildingModel {
  root: THREE.Group;
  smoke: THREE.Vector3[];
  steam: THREE.Vector3[];
  spinners: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[];
  wavers: { obj: THREE.Object3D; amp: number; speed: number; base: number }[];
  flames: THREE.Object3D[];
  /** Storage props shown in proportion to how full that resource's storage is. */
  fills: { resource: ResourceId; items: THREE.Object3D[] }[];
  /** Parts that only move while someone works here (e.g. a saw blade). */
  busy: { obj: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[];
  /** A field's crop rows, grown and harvested by the view. */
  crops?: CropRows;
  /**
   * Custom motion for several parts at once. `busy` eases between 0 (nobody working
   * here) and 1; `objects` stay out of static merging.
   */
  animate: { objects: THREE.Object3D[]; fn: (time: number, busy: number) => void }[];
}

export function box(parent: THREE.Object3D, w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

export function cyl(parent: THREE.Object3D, rt: number, rb: number, h: number, material: THREE.Material, x: number, y: number, z: number, seg = 12): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

/** Triangular prism roof. `span` is the width across the slope, `length` runs along the ridge. */
export function gableRoof(parent: THREE.Object3D, span: number, height: number, length: number, material: THREE.Material, y: number, ridgeAlongX: boolean, x = 0, z = 0): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(-span / 2, 0);
  shape.lineTo(span / 2, 0);
  shape.lineTo(0, height);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: length, bevelEnabled: false });
  geo.translate(0, 0, -length / 2);
  if (ridgeAlongX) geo.rotateY(Math.PI / 2);
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

export function door(parent: THREE.Object3D, x: number, z: number, w = 0.46, h = 0.78, base = 0.2): void {
  const wood = mat(PALETTE.woodDark);
  box(parent, w, h - w / 2, 0.06, wood, x, base + (h - w / 2) / 2, z);
  // Half-disc arch over the door, facing out of the wall (+z).
  const arch = new THREE.Mesh(new THREE.CircleGeometry(w / 2, 14, 0, Math.PI), wood);
  arch.position.set(x, base + h - w / 2, z + 0.031);
  parent.add(arch);
  box(parent, 0.05, 0.05, 0.03, mat(PALETTE.gold), x + w * 0.28, base + h * 0.42, z + 0.04);
}

export function windowPane(parent: THREE.Object3D, x: number, y: number, z: number, w = 0.3, h = 0.3, rotY = 0): void {
  const g = new THREE.Group();
  box(g, w + 0.08, h + 0.08, 0.04, mat(PALETTE.woodDark), 0, 0, 0);
  box(g, w, h, 0.05, glowMat(), 0, 0, 0.005);
  box(g, 0.03, h, 0.06, mat(PALETTE.woodDark), 0, 0, 0.01);
  box(g, w, 0.03, 0.06, mat(PALETTE.woodDark), 0, 0, 0.01);
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  parent.add(g);
}

export function barrel(parent: THREE.Object3D, x: number, z: number, y = 0): void {
  cyl(parent, 0.16, 0.16, 0.36, mat(PALETTE.wood), x, y + 0.18, z, 10);
  cyl(parent, 0.165, 0.165, 0.03, mat(PALETTE.iron), x, y + 0.08, z, 10);
  cyl(parent, 0.165, 0.165, 0.03, mat(PALETTE.iron), x, y + 0.28, z, 10);
}

export function emptyModel(): BuildingModel {
  return { root: new THREE.Group(), smoke: [], steam: [], spinners: [], wavers: [], flames: [], fills: [], busy: [], animate: [] };
}

function cookhouse(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  box(r, 2.7, 0.22, 2.5, mat(PALETTE.stone), 0, 0.11, -0.15);
  box(r, 2.2, 1.25, 1.85, mat(PALETTE.plaster), 0, 0.845, -0.2);
  const beam = mat(PALETTE.woodDark);
  for (const [x, z] of [[-1.1, 0.72], [1.1, 0.72], [-1.1, -1.12], [1.1, -1.12]]) box(r, 0.13, 1.27, 0.13, beam, x, 0.845, z);
  box(r, 2.34, 0.12, 0.12, beam, 0, 1.46, 0.73);
  gableRoof(r, 2.55, 1.05, 2.75, mat(PALETTE.terracotta, { flat: true }), 1.46, true, 0, -0.2);
  cyl(r, 0.06, 0.06, 2.8, mat('#b8543b'), 0, 2.5, -0.2, 6).rotation.z = Math.PI / 2;
  box(r, 0.38, 1.25, 0.38, mat(PALETTE.stoneDark, { flat: true }), 0.72, 2.1, -0.55);
  box(r, 0.48, 0.1, 0.48, mat(PALETTE.stone), 0.72, 2.75, -0.55);
  m.smoke.push(new THREE.Vector3(0.72, 2.9, -0.55));
  door(r, 0.55, 0.74);
  windowPane(r, -0.5, 0.95, 0.75, 0.36, 0.3);
  windowPane(r, -1.13, 0.95, -0.2, 0.3, 0.28, -Math.PI / 2);
  // Outdoor pot where the cook works.
  const pot = new THREE.Group();
  pot.position.set(-0.15, 0, 1.3);
  r.add(pot);
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(PALETTE.iron));
  bowl.position.y = 0.42;
  pot.add(bowl);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.03, 6, 16), mat(PALETTE.iron));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.42;
  pot.add(rim);
  cyl(pot, 0.27, 0.27, 0.02, mat(PALETTE.stew, { emissive: '#8a3c10', emissiveIntensity: 0.25 }), 0, 0.39, 0, 14);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = cyl(pot, 0.025, 0.025, 0.3, mat(PALETTE.iron), Math.cos(a) * 0.22, 0.15, Math.sin(a) * 0.22, 5);
    leg.rotation.z = Math.cos(a) * 0.2;
  }
  for (let i = 0; i < 3; i++) {
    const log = cyl(pot, 0.04, 0.04, 0.34, mat(PALETTE.bark), 0, 0.05, 0, 6);
    log.rotation.set(Math.PI / 2, (i / 3) * Math.PI, 0);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 6), mat('#ff9a3c', { emissive: '#ff7a1a', emissiveIntensity: 1 }));
  flame.position.y = 0.14;
  pot.add(flame);
  m.flames.push(flame);
  m.steam.push(new THREE.Vector3(-0.15, 0.55, 1.3));
  barrel(r, 1.05, 1.1);
  barrel(r, 0.72, 1.28);
  box(r, 0.5, 0.3, 0.35, mat(PALETTE.wood), -1.05, 0.15, 1.15);
  return m;
}

function lodge(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  box(r, 2.85, 0.18, 1.85, mat(PALETTE.stoneDark), 0, 0.09, 0);
  box(r, 2.5, 1.0, 1.35, mat(PALETTE.wood), 0, 0.68, -0.05);
  const logMat = mat(PALETTE.woodDark);
  for (const y of [0.32, 0.56, 0.8, 1.04]) {
    const log = cyl(r, 0.05, 0.05, 2.56, logMat, 0, y, 0.63, 6);
    log.rotation.z = Math.PI / 2;
  }
  for (const x of [-1.25, 1.25]) box(r, 0.16, 1.02, 1.42, logMat, x, 0.68, -0.05);
  gableRoof(r, 2.0, 1.15, 3.05, mat(PALETTE.thatch, { flat: true }), 1.17, true, 0, -0.05);
  const ridge = cyl(r, 0.09, 0.09, 3.1, mat(PALETTE.thatchDark), 0, 2.3, -0.05, 6);
  ridge.rotation.z = Math.PI / 2;
  box(r, 0.3, 0.9, 0.3, mat(PALETTE.stoneDark, { flat: true }), -0.8, 2.0, -0.35);
  m.smoke.push(new THREE.Vector3(-0.8, 2.55, -0.35));
  door(r, 0, 0.68, 0.44, 0.74, 0.18);
  windowPane(r, -0.78, 0.72, 0.68);
  windowPane(r, 0.78, 0.72, 0.68);
  // Bench and flower pots by the door.
  box(r, 0.6, 0.05, 0.2, mat(PALETTE.woodLight), 0.78, 0.26, 0.86);
  box(r, 0.05, 0.24, 0.18, mat(PALETTE.woodDark), 0.54, 0.12, 0.86);
  box(r, 0.05, 0.24, 0.18, mat(PALETTE.woodDark), 1.02, 0.12, 0.86);
  for (const [x, c] of [[-0.45, '#e86b8a'], [-1.05, '#f2c14e']] as const) {
    cyl(r, 0.1, 0.08, 0.16, mat(PALETTE.terracotta), x, 0.26, 0.86, 8);
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), mat(c, { flat: true }));
    f.position.set(x, 0.4, 0.86);
    r.add(f);
  }
  return m;
}

function timberYard(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  box(r, 1.85, 0.1, 1.85, mat(PALETTE.wood), 0, 0.05, 0);
  const post = mat(PALETTE.woodDark);
  // Tall back posts carry a lean-to roof over the rear third; the front stays open so the stacks read from the camera.
  for (const x of [-0.84, 0.84]) {
    box(r, 0.1, 1.75, 0.1, post, x, 0.875, -0.84);
    box(r, 0.1, 1.2, 0.1, post, x, 0.6, 0.84);
    box(r, 0.08, 0.08, 1.75, post, x, 0.25, 0);
  }
  const roof = box(r, 2.05, 0.07, 0.95, mat(PALETTE.woodLight, { flat: true }), 0, 1.72, -0.62);
  roof.rotation.x = 0.35;
  for (let i = -3; i <= 3; i++) {
    const slat = box(r, 0.03, 0.02, 0.95, mat(PALETTE.woodDark), i * 0.28, 1.76, -0.62);
    slat.rotation.x = 0.35;
  }
  box(r, 1.75, 0.08, 0.08, post, 0, 1.2, 0.84);
  const logGeo = logGeometry();
  const logMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const items: THREE.Object3D[] = [];
  const layers = [[-0.55, -0.18, 0.18, 0.55], [-0.37, 0, 0.37], [-0.18, 0.18], [0]];
  for (const sx of [-0.4, 0.4]) {
    layers.forEach((row, li) => {
      for (const z of row) {
        const log = new THREE.Mesh(logGeo, logMat);
        log.position.set(sx, 0.2 + li * 0.18, z);
        log.scale.set(1.03, 1, 1);
        r.add(log);
        items.push(log);
      }
    });
  }
  items.sort((a, b) => a.position.y - b.position.y);
  m.fills.push({ resource: 'timber', items });
  return m;
}

function clayShed(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  box(r, 1.85, 0.1, 1.85, mat(PALETTE.stone), 0, 0.05, 0);
  const brick = mat('#c7825b', { flat: true });
  box(r, 1.8, 1.2, 0.16, brick, 0, 0.7, -0.82);
  box(r, 0.16, 1.2, 1.7, brick, -0.82, 0.7, -0.05);
  box(r, 0.16, 1.2, 1.7, brick, 0.82, 0.7, -0.05);
  for (const x of [-0.82, 0.82]) box(r, 0.14, 1.25, 0.14, mat(PALETTE.woodDark), x, 0.7, 0.82);
  box(r, 1.8, 0.12, 0.12, mat(PALETTE.woodDark), 0, 1.3, 0.82);
  gableRoof(r, 2.1, 0.7, 2.05, mat(PALETTE.terracotta, { flat: true }), 1.3, true);
  const shelf = mat(PALETTE.woodLight);
  box(r, 1.45, 0.05, 0.4, shelf, 0, 0.5, -0.55);
  box(r, 1.45, 0.05, 0.4, shelf, 0, 0.9, -0.55);
  const clay = mat(PALETTE.clay, { flat: true });
  const clayDark = mat(PALETTE.clayDark, { flat: true });
  const items: THREE.Object3D[] = [];
  const rows: [number, number, number][] = [];
  for (const y of [0.18, 0.58, 0.98]) for (const x of [-0.5, -0.17, 0.17, 0.5]) rows.push([x, y, -0.55]);
  for (const x of [-0.45, -0.1, 0.25]) rows.push([x, 0.18, -0.05]);
  for (const x of [-0.28, 0.08]) rows.push([x, 0.32, -0.05]);
  rows.forEach(([x, y, z], i) => {
    const b = box(r, 0.28, 0.14, 0.2, i % 3 === 0 ? clayDark : clay, x, y, z);
    b.rotation.y = (i % 5) * 0.08 - 0.1;
    items.push(b);
  });
  m.fills.push({ resource: 'clay', items });
  const pot = new THREE.Mesh(
    new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.14, 0.02), new THREE.Vector2(0.17, 0.16), new THREE.Vector2(0.09, 0.32), new THREE.Vector2(0.1, 0.36)], 12),
    mat(PALETTE.terracotta),
  );
  pot.position.set(0.7, 0.1, 1.0);
  r.add(pot);
  return m;
}

function academy(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  const stone = mat('#e2d9c6');
  box(r, 2.8, 0.22, 2.7, mat(PALETTE.stone), 0, 0.11, -0.1);
  box(r, 2.3, 1.15, 2.05, stone, 0, 0.8, -0.15);
  box(r, 2.45, 0.1, 2.2, mat(PALETTE.woodDark), 0, 1.42, -0.15);
  box(r, 2.35, 0.85, 2.1, mat(PALETTE.plaster), 0, 1.9, -0.15);
  const beam = mat(PALETTE.woodDark);
  for (const x of [-1.15, -0.4, 0.4, 1.15]) box(r, 0.1, 0.85, 0.08, beam, x, 1.9, 0.92);
  gableRoof(r, 2.55, 1.05, 2.7, mat(PALETTE.slate, { flat: true }), 2.32, true, 0, -0.15);
  // Star-watching tower.
  cyl(r, 0.44, 0.48, 3.2, stone, 0.95, 1.82, -0.85, 14);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.0, 12), mat(PALETTE.slateDark, { flat: true }));
  cone.position.set(0.95, 3.92, -0.85);
  r.add(cone);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), mat(PALETTE.gold));
  finial.position.set(0.95, 4.48, -0.85);
  r.add(finial);
  windowPane(r, 0.95, 2.9, -0.4, 0.2, 0.3);
  const scope = new THREE.Group();
  scope.position.set(0.95, 3.35, -0.85);
  const tube = cyl(scope, 0.05, 0.07, 0.7, mat('#c9a14a'), 0, 0, 0.42, 10);
  tube.rotation.x = Math.PI / 2 - 0.5;
  r.add(scope);
  m.spinners.push({ obj: scope, axis: 'y', speed: 0.12 });
  door(r, 0, 0.88, 0.52, 0.9, 0.22);
  windowPane(r, -0.72, 0.85, 0.88, 0.3, 0.46);
  windowPane(r, 0.72, 0.85, 0.88, 0.3, 0.46);
  windowPane(r, -0.78, 1.9, 0.92, 0.28, 0.28);
  windowPane(r, 0, 1.9, 0.92, 0.28, 0.28);
  windowPane(r, 0.78, 1.9, 0.92, 0.28, 0.28);
  // Banners.
  for (const x of [-1.25, 1.25]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 2.25, 0.98);
    const cloth = box(pivot, 0.3, 0.6, 0.02, mat(PALETTE.cloth, { side: THREE.DoubleSide }), 0, -0.3, 0);
    box(pivot, 0.12, 0.12, 0.03, mat(PALETTE.gold), 0, -0.34, 0.01);
    cloth.castShadow = true;
    r.add(pivot);
    m.wavers.push({ obj: pivot, amp: 0.12, speed: 1.6 + x * 0.2, base: 0 });
  }
  // Lectern where the scholar reads.
  const lectern = new THREE.Group();
  lectern.position.set(-0.35, 0, 1.28);
  cyl(lectern, 0.04, 0.06, 0.7, mat(PALETTE.woodDark), 0, 0.35, 0, 6);
  const top = box(lectern, 0.36, 0.04, 0.28, mat(PALETTE.wood), 0, 0.72, 0);
  top.rotation.x = 0.4;
  const pages = box(lectern, 0.3, 0.02, 0.22, mat('#fbf4e2'), 0, 0.75, 0.01);
  pages.rotation.x = 0.4;
  r.add(lectern);
  return m;
}

const COTTAGE_ROOFS = [PALETTE.thatch, PALETTE.terracotta, PALETTE.slate, '#7aa35a'];

function cottage(variant: number): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  cyl(r, 0.86, 0.9, 0.14, mat(PALETTE.stone), 0, 0.07, 0, 16);
  cyl(r, 0.7, 0.72, 1.0, mat(PALETTE.plaster), 0, 0.64, 0, 18);
  cyl(r, 0.73, 0.73, 0.08, mat(PALETTE.woodDark), 0, 1.12, 0, 18);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.0, 1.15, 10), mat(COTTAGE_ROOFS[variant % COTTAGE_ROOFS.length], { flat: true }));
  roof.position.y = 1.72;
  roof.rotation.y = 0.3;
  r.add(roof);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat(PALETTE.woodDark));
  tip.position.y = 2.32;
  r.add(tip);
  box(r, 0.2, 0.6, 0.2, mat(PALETTE.stoneDark, { flat: true }), 0.38, 1.85, -0.3);
  m.smoke.push(new THREE.Vector3(0.38, 2.2, -0.3));
  door(r, 0, 0.7, 0.36, 0.66, 0.14);
  windowPane(r, -0.5, 0.72, 0.5, 0.22, 0.22, -0.78);
  windowPane(r, 0.52, 0.72, 0.48, 0.22, 0.22, 0.82);
  const planter = new THREE.Group();
  planter.position.set(-0.53, 0.53, 0.56);
  planter.rotation.y = -0.78;
  box(planter, 0.34, 0.08, 0.1, mat(PALETTE.wood), 0, 0, 0);
  ['#e86b8a', '#f2c14e', '#ffffff'].forEach((c, i) => {
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), mat(c, { flat: true }));
    f.position.set(-0.1 + i * 0.1, 0.07, 0);
    planter.add(f);
  });
  r.add(planter);
  return m;
}

function flowerBed(variant: number): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  box(r, 0.82, 0.12, 0.82, mat(PALETTE.wood), 0, 0.06, 0);
  box(r, 0.7, 0.1, 0.7, mat('#6b4a32'), 0, 0.09, 0);
  const colors = ['#e86b8a', '#f2c14e', '#ffffff', '#b58be0', '#f08a4b'];
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4 + variant;
    const d = i === 0 ? 0 : 0.22;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    cyl(r, 0.012, 0.012, 0.2, mat(PALETTE.grassDark), x, 0.22, z, 4);
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), mat(colors[(i + variant) % colors.length], { flat: true }));
    f.position.set(x, 0.34, z);
    r.add(f);
  }
  return m;
}

function lantern(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  cyl(r, 0.12, 0.14, 0.1, mat(PALETTE.stoneDark), 0, 0.05, 0, 8);
  cyl(r, 0.035, 0.045, 1.45, mat(PALETTE.iron), 0, 0.78, 0, 6);
  box(r, 0.2, 0.26, 0.2, glowMat(), 0, 1.55, 0);
  box(r, 0.24, 0.03, 0.24, mat(PALETTE.iron), 0, 1.42, 0);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.16, 4), mat(PALETTE.iron, { flat: true }));
  cap.position.y = 1.76;
  cap.rotation.y = Math.PI / 4;
  r.add(cap);
  return m;
}

/** Reputation Road reward: a tall pole flying the Valley's colours. */
function valleyBanner(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  cyl(r, 0.16, 0.2, 0.14, mat(PALETTE.stone), 0, 0.07, 0, 8);
  cyl(r, 0.035, 0.04, 2.5, mat(PALETTE.woodDark), 0, 1.3, 0, 6);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), mat(PALETTE.gold));
  ball.position.y = 2.6;
  r.add(ball);
  const pivot = new THREE.Group();
  pivot.position.set(0.03, 2.4, 0);
  const colours = ['#d9544a', '#5fae4f', '#6f8fe0'];
  colours.forEach((c, i) => box(pivot, 0.55, 0.16, 0.02, mat(c, { side: THREE.DoubleSide }), 0.28, -i * 0.16, 0));
  r.add(pivot);
  m.wavers.push({ obj: pivot, amp: 0.2, speed: 2.1, base: 0 });
  return m;
}

/** Festival reward: paper lanterns strung between two posts. */
function festivalLanterns(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  for (const x of [-0.85, 0.85]) {
    cyl(r, 0.1, 0.12, 0.12, mat(PALETTE.stone), x, 0.06, 0, 8);
    cyl(r, 0.04, 0.05, 2.0, mat(PALETTE.woodDark), x, 1.05, 0, 6);
  }
  const colours = ['#d9544a', '#f4b83e', '#6f8fe0', '#5fae4f', '#d97a9a'];
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.5) / 5;
    const x = -0.85 + t * 1.7;
    const y = 1.95 - Math.sin(t * Math.PI) * 0.35;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), mat(colours[i], { emissive: colours[i], emissiveIntensity: 0.45 }));
    lamp.scale.y = 1.25;
    lamp.position.set(x, y - 0.12, 0);
    r.add(lamp);
    m.flames.push(lamp);
  }
  box(r, 1.7, 0.015, 0.015, mat(PALETTE.woodDark), 0, 1.8, 0);
  return m;
}

/** Reputation Road reward: a carved stone fountain with a gently spilling basin. */
function fountain(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  const stone = mat(PALETTE.stone, { flat: true });
  cyl(r, 0.95, 1.0, 0.36, stone, 0, 0.18, 0, 16);
  cyl(r, 0.82, 0.82, 0.04, mat('#7fc8e8', { emissive: '#2a6f8f', emissiveIntensity: 0.15 }), 0, 0.35, 0, 16);
  cyl(r, 0.14, 0.2, 0.9, stone, 0, 0.75, 0, 10);
  cyl(r, 0.42, 0.3, 0.14, stone, 0, 1.2, 0, 14);
  cyl(r, 0.36, 0.36, 0.03, mat('#9ad6ef'), 0, 1.28, 0, 14);
  cyl(r, 0.05, 0.08, 0.3, stone, 0, 1.42, 0, 8);
  const spray = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat('#d8f2fb', { transparent: true, opacity: 0.75 }));
  spray.position.y = 1.56;
  r.add(spray);
  m.spinners.push({ obj: spray, axis: 'y', speed: 1.5 });
  return m;
}

function bench(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  const wood = mat(PALETTE.woodLight);
  box(r, 0.85, 0.06, 0.3, wood, 0, 0.32, 0.05);
  box(r, 0.85, 0.2, 0.05, wood, 0, 0.55, -0.1).rotation.x = -0.15;
  for (const x of [-0.35, 0.35]) {
    box(r, 0.06, 0.32, 0.26, mat(PALETTE.woodDark), x, 0.16, 0.05);
    box(r, 0.05, 0.3, 0.05, mat(PALETTE.woodDark), x, 0.45, -0.1);
  }
  return m;
}

function stoneYard(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  // Flagstone floor with a little colour variation per slab.
  const slabs = [mat('#b9b2a6', { flat: true }), mat('#aaa397', { flat: true }), mat('#c4bdb0', { flat: true })];
  for (let ix = 0; ix < 3; ix++) {
    for (let iz = 0; iz < 3; iz++) box(r, 0.58, 0.1, 0.58, slabs[(ix * 2 + iz) % 3], -0.6 + ix * 0.6, 0.05, -0.6 + iz * 0.6);
  }
  // A-frame hoist at the back.
  const wood = mat(PALETTE.woodDark);
  for (const x of [-0.75, 0.75]) {
    const a = box(r, 0.09, 1.9, 0.09, wood, x, 0.95, -0.72);
    a.rotation.x = 0.12;
  }
  box(r, 1.65, 0.1, 0.1, wood, 0, 1.86, -0.62);
  cyl(r, 0.012, 0.012, 0.75, mat(PALETTE.iron), 0.25, 1.45, -0.6, 4);
  box(r, 0.1, 0.12, 0.1, mat(PALETTE.iron), 0.25, 1.05, -0.6);
  // Cut-stone blocks stacked in tiers; they appear as the yard fills.
  const stoneMats = [mat('#a7adb7', { flat: true }), mat('#959ba6', { flat: true }), mat('#b8bdc6', { flat: true })];
  const items: THREE.Object3D[] = [];
  const tiers: [number, number][][] = [
    [[-0.5, -0.25], [-0.05, -0.25], [0.4, -0.25], [-0.5, 0.25], [-0.05, 0.25], [0.4, 0.25], [-0.3, 0.7], [0.2, 0.7]],
    [[-0.28, -0.25], [0.18, -0.25], [-0.28, 0.25], [0.18, 0.25], [-0.05, 0.7]],
    [[-0.05, -0.25], [-0.05, 0.25]],
    [[-0.05, 0]],
  ];
  tiers.forEach((tier, ti) => {
    for (const [x, z] of tier) {
      const b = box(r, 0.4, 0.2, 0.36, stoneMats[(items.length * 7) % 3], x, 0.2 + ti * 0.21, z);
      b.rotation.y = ((items.length * 37) % 9) * 0.02 - 0.08;
      items.push(b);
    }
  });
  m.fills.push({ resource: 'stone', items });
  return m;
}

/** Stacks of boards on low trestles; each stack is one fill item. */
function plankStacks(m: BuildingModel, parent: THREE.Object3D, spots: [number, number][], rotY = 0): void {
  const board = mat(PALETTE.woodLight, { flat: true });
  const edge = mat('#c08a52', { flat: true });
  const items: THREE.Object3D[] = [];
  for (const [x, z] of spots) {
    for (let layer = 0; layer < 3; layer++) {
      const stack = new THREE.Group();
      stack.position.set(x, 0.14 + layer * 0.09, z);
      stack.rotation.y = rotY + (layer % 2) * 0.05;
      box(stack, 0.95, 0.04, 0.16, board, 0, 0, -0.09);
      box(stack, 0.95, 0.04, 0.16, layer % 2 ? board : edge, 0, 0, 0.09);
      parent.add(stack);
      items.push(stack);
    }
  }
  items.sort((a, b) => a.position.y - b.position.y);
  m.fills.push({ resource: 'planks', items });
}

/** Neat brick piles; each pile is one fill item. */
function brickPiles(m: BuildingModel, parent: THREE.Object3D, spots: [number, number][]): void {
  const brick = mat(PALETTE.terracotta, { flat: true });
  const brickDark = mat('#a8452f', { flat: true });
  const items: THREE.Object3D[] = [];
  for (const [x, z] of spots) {
    for (let layer = 0; layer < 3; layer++) {
      const pile = new THREE.Group();
      pile.position.set(x, 0.12 + layer * 0.1, z);
      for (let i = 0; i < 3; i++) box(pile, 0.22, 0.09, 0.11, (i + layer) % 2 ? brick : brickDark, (i - 1) * 0.24, 0, layer % 2 ? 0.06 : -0.06);
      parent.add(pile);
      items.push(pile);
    }
  }
  items.sort((a, b) => a.position.y - b.position.y);
  m.fills.push({ resource: 'bricks', items });
}

function sawmill(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  box(r, 2.85, 0.12, 1.85, mat(PALETTE.wood), 0, 0.06, 0);
  // Open-sided shed over the saw bench (back half), plank racks in front.
  const post = mat(PALETTE.woodDark);
  for (const [x, z] of [[-1.3, -0.8], [1.3, -0.8], [-1.3, 0.1], [1.3, 0.1]]) box(r, 0.12, 1.9, 0.12, post, x, 0.95, z);
  gableRoof(r, 1.4, 0.65, 3.0, mat(PALETTE.woodLight, { flat: true }), 1.9, true, 0, -0.35);
  box(r, 1.4, 0.55, 0.36, mat(PALETTE.wood), -0.3, 0.4, -0.35);
  box(r, 0.12, 0.6, 0.12, post, -0.95, 0.3, -0.35);
  // Circular saw blade spinning in a slot of the bench.
  const blade = new THREE.Group();
  blade.position.set(-0.3, 0.68, -0.35);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 14), mat('#cfd6df', { flat: true }));
  disc.rotation.x = Math.PI / 2;
  blade.add(disc);
  for (let i = 0; i < 7; i++) {
    const tooth = box(blade, 0.05, 0.05, 0.022, mat('#9aa4b1'), Math.cos((i / 7) * Math.PI * 2) * 0.27, Math.sin((i / 7) * Math.PI * 2) * 0.27, 0);
    tooth.rotation.z = (i / 7) * Math.PI * 2;
  }
  r.add(blade);
  m.busy.push({ obj: blade, axis: 'z', speed: 14 });
  // Log waiting to be sawn, sawdust heap.
  const log = cyl(r, 0.14, 0.14, 1.0, mat(PALETTE.bark), 0.75, 0.62, -0.35, 8);
  log.rotation.z = Math.PI / 2;
  const dust = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat('#e6c48f', { flat: true }));
  dust.scale.y = 0.4;
  dust.position.set(-1.0, 0.12, 0.45);
  r.add(dust);
  plankStacks(m, r, [[-0.55, 0.55], [0.55, 0.55]]);
  return m;
}

function brickworks(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  box(r, 2.85, 0.1, 1.85, mat(PALETTE.stone), 0, 0.05, 0);
  // Beehive kiln with a stubby chimney.
  const kilnMat = mat('#b5654a', { flat: true });
  cyl(r, 0.7, 0.78, 0.7, kilnMat, -0.75, 0.45, -0.25, 12);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), kilnMat);
  dome.position.set(-0.75, 0.8, -0.25);
  r.add(dome);
  box(r, 0.36, 0.36, 0.06, mat('#2b2220'), -0.75, 0.35, 0.5);
  const glow = box(r, 0.26, 0.2, 0.05, mat('#ff9a3c', { emissive: '#ff6a1a', emissiveIntensity: 1 }), -0.75, 0.3, 0.52);
  m.flames.push(glow);
  cyl(r, 0.14, 0.16, 0.6, mat(PALETTE.stoneDark, { flat: true }), -0.75, 1.75, -0.25, 8);
  m.smoke.push(new THREE.Vector3(-0.75, 2.1, -0.25));
  // Drying racks under a small roof, with finished brick piles in front.
  const post = mat(PALETTE.woodDark);
  for (const [x, z] of [[0.25, -0.8], [1.3, -0.8], [0.25, 0.0], [1.3, 0.0]]) box(r, 0.09, 1.45, 0.09, post, x, 0.72, z);
  const roof = box(r, 1.35, 0.06, 1.05, mat(PALETTE.terracotta, { flat: true }), 0.78, 1.5, -0.4);
  roof.rotation.x = 0.15;
  for (const y of [0.45, 0.85]) {
    box(r, 1.05, 0.04, 0.6, mat(PALETTE.woodLight), 0.78, y, -0.4);
    for (let i = 0; i < 5; i++) box(r, 0.16, 0.07, 0.09, mat('#c98a6a', { flat: true }), 0.38 + i * 0.2, y + 0.06, -0.4);
  }
  brickPiles(m, r, [[0.35, 0.6], [1.0, 0.6]]);
  // Clay waiting in a trough.
  box(r, 0.6, 0.18, 0.35, mat(PALETTE.woodDark), -1.05, 0.15, 0.62);
  box(r, 0.5, 0.06, 0.26, mat(PALETTE.clay, { flat: true }), -1.05, 0.25, 0.62);
  return m;
}

function warehouse(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  box(r, 2.8, 0.2, 2.7, mat(PALETTE.stoneDark), 0, 0.1, -0.05);
  // Tall plank barn, open at the front so its racks show.
  const plank = mat(PALETTE.wood, { flat: true });
  box(r, 2.5, 1.9, 0.12, plank, 0, 1.15, -1.2);
  box(r, 0.12, 1.9, 2.3, plank, -1.2, 1.15, -0.1);
  box(r, 0.12, 1.9, 2.3, plank, 1.2, 1.15, -0.1);
  for (const x of [-1.2, 1.2]) box(r, 0.14, 2.0, 0.14, mat(PALETTE.woodDark), x, 1.1, 1.05);
  box(r, 2.5, 0.16, 0.14, mat(PALETTE.woodDark), 0, 2.1, 1.05);
  gableRoof(r, 2.8, 1.25, 2.85, mat('#8c5e3a', { flat: true }), 2.1, false, 0, -0.1);
  windowPane(r, 0, 2.6, 1.32, 0.34, 0.34);
  // A hay-door hoist beam over the entrance.
  box(r, 0.1, 0.1, 0.6, mat(PALETTE.woodDark), 0, 2.95, 1.25);
  plankStacks(m, r, [[-0.6, -0.65], [-0.6, -0.15], [-0.6, 0.35]], Math.PI / 2);
  brickPiles(m, r, [[0.55, -0.6], [0.55, -0.05], [0.55, 0.5]]);
  return m;
}

/** Little leafy sapling built from primitives (woodlot planting). */
function sapling(parent: THREE.Object3D, x: number, z: number, s: number, m: BuildingModel): void {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(s * 0.72);
  cyl(g, 0.05, 0.07, 0.7, mat(PALETTE.bark), 0, 0.35, 0, 6);
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.38, 0), mat(PALETTE.leafLight, { flat: true }));
  crown.position.y = 0.9;
  g.add(crown);
  parent.add(g);
  m.wavers.push({ obj: g, amp: 0.05, speed: 1.2 + x * 0.7, base: 0 });
}

function woodlot(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  // Mulched ground inside a split-rail fence.
  box(r, 2.8, 0.06, 2.8, mat('#6b5a3a'), 0, 0.03, 0);
  const rail = mat(PALETTE.woodLight);
  for (const [w, d, x, z] of [[2.8, 0.06, 0, 1.38], [2.8, 0.06, 0, -1.38], [0.06, 2.8, 1.38, 0], [0.06, 2.8, -1.38, 0]] as const) {
    box(r, w, 0.06, d, rail, x, 0.32, z);
    box(r, w, 0.06, d, rail, x, 0.16, z);
  }
  for (const x of [-1.38, 0, 1.38]) for (const z of [-1.38, 1.38]) box(r, 0.09, 0.5, 0.09, mat(PALETTE.woodDark), x, 0.25, z);
  // Rows of young trees at different ages, a few stumps and a chopping block.
  sapling(r, -0.8, -0.8, 1.2, m);
  sapling(r, 0.1, -0.85, 0.9, m);
  sapling(r, 0.85, -0.6, 1.35, m);
  sapling(r, -0.75, 0.15, 0.7, m);
  sapling(r, 0.8, 0.3, 1.0, m);
  for (const [x, z] of [[0.05, 0.1], [-0.15, 0.85]]) {
    cyl(r, 0.13, 0.16, 0.2, mat(PALETTE.bark), x, 0.1, z, 8);
    cyl(r, 0.12, 0.12, 0.02, mat(PALETTE.woodLight), x, 0.21, z, 8);
  }
  // Tool shed in the corner.
  box(r, 0.6, 0.6, 0.45, mat(PALETTE.wood), 0.9, 0.3, 0.95);
  const roof = box(r, 0.72, 0.05, 0.6, mat(PALETTE.woodDark, { flat: true }), 0.9, 0.65, 0.95);
  roof.rotation.x = 0.25;
  return m;
}

function clayPit(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  // Rim of dug earth around a reddish pit; the pit floor sits just above ground so it reads from above.
  const rim = mat('#9a6a48', { flat: true });
  for (const [w, d, x, z] of [[1.9, 0.3, 0, 0.8], [1.9, 0.3, 0, -0.8], [0.3, 1.3, 0.8, 0], [0.3, 1.3, -0.8, 0]] as const) box(r, w, 0.22, d, rim, x, 0.11, z);
  box(r, 1.3, 0.04, 1.3, mat('#b5603c', { flat: true }), 0, 0.03, 0);
  const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.28, 12), mat('#6aa7b8', { emissive: '#2a5a66', emissiveIntensity: 0.2 }));
  puddle.rotation.x = -Math.PI / 2;
  puddle.position.set(-0.25, 0.06, 0.2);
  r.add(puddle);
  // Ladder leaning on the rim, a sluice board and a heap of fresh clay.
  const ladder = new THREE.Group();
  ladder.position.set(0.45, 0.05, -0.45);
  ladder.rotation.set(-0.5, 0.6, 0);
  for (const x of [-0.12, 0.12]) box(ladder, 0.04, 0.9, 0.04, mat(PALETTE.woodLight), x, 0.45, 0);
  for (let i = 0; i < 4; i++) box(ladder, 0.24, 0.03, 0.03, mat(PALETTE.woodLight), 0, 0.15 + i * 0.2, 0);
  r.add(ladder);
  const heap = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), mat(PALETTE.clay, { flat: true }));
  heap.scale.set(1.2, 0.55, 1);
  heap.position.set(0.55, 0.18, 0.6);
  r.add(heap);
  box(r, 0.7, 0.05, 0.16, mat(PALETTE.wood), -0.55, 0.26, -0.6);
  // A windlass over the pit: the crank turns and a bucket of clay rides up and down while someone digs.
  const post = mat(PALETTE.woodDark);
  for (const x of [-0.42, 0.42]) {
    const p = box(r, 0.07, 0.8, 0.07, post, x, 0.42, -0.05);
    p.rotation.z = x > 0 ? -0.08 : 0.08;
  }
  const axle = new THREE.Group();
  axle.position.set(0, 0.78, -0.05);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8), mat(PALETTE.wood));
  drum.rotation.z = Math.PI / 2;
  axle.add(drum);
  const crank = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.03), post);
  crank.position.set(0.46, -0.07, 0);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 5), mat(PALETTE.woodLight));
  grip.rotation.z = Math.PI / 2;
  grip.position.set(0.51, -0.14, 0);
  axle.add(crank, grip);
  r.add(axle);
  const ropeLen = 0.5;
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1, 4).translate(0, -0.5, 0), mat('#c9b48a'));
  rope.position.set(0, 0.72, -0.05);
  r.add(rope);
  const bucket = new THREE.Group();
  const pail = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.12, 8), mat(PALETTE.wood));
  const load = new THREE.Mesh(new THREE.SphereGeometry(0.075, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), mat(PALETTE.clay, { flat: true }));
  load.position.y = 0.04;
  bucket.add(pail, load);
  r.add(bucket);
  m.animate.push({
    objects: [axle, rope, bucket],
    fn: (time, busy) => {
      // Down empty, up full: the crank turns with the rope, the clay shows on the way up.
      const cycle = (time * 0.35) % 1;
      const depth = busy * (cycle < 0.5 ? cycle * 2 : 2 - cycle * 2);
      const y = 0.72 - 0.12 - ropeLen * 0.4 - depth * 0.3;
      bucket.position.set(0, y, -0.05);
      rope.scale.y = 0.72 - y - 0.06;
      axle.rotation.x = -depth * 9;
      load.visible = cycle > 0.5 || busy < 0.5;
    },
  });
  return m;
}

function quarry(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  // Terraced rock face at the back, a cut-block apron at the front.
  const rock = mat('#9aa1ab', { flat: true });
  const rockDark = mat('#868d98', { flat: true });
  box(r, 2.8, 1.6, 0.9, rock, 0, 0.8, -0.95);
  box(r, 2.8, 0.9, 0.7, rockDark, 0, 0.45, -0.2);
  box(r, 2.8, 0.35, 0.6, rock, 0, 0.175, 0.4);
  for (const [x, y, z] of [[-1.0, 1.65, -1.0], [0.6, 1.62, -0.9], [-0.2, 0.95, -0.25]] as const) {
    const lump = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), rock);
    lump.position.set(x, y, z);
    r.add(lump);
  }
  box(r, 2.8, 0.06, 0.55, mat('#c4c8cf', { flat: true }), 0, 0.03, 1.1);
  for (const [x, z] of [[-0.9, 1.1], [-0.45, 1.15], [0.95, 1.05]] as const) box(r, 0.36, 0.22, 0.3, mat('#b8bdc6', { flat: true }), x, 0.14, z);
  // Timber crane with a slowly swinging jib.
  const post = mat(PALETTE.woodDark);
  box(r, 0.14, 2.6, 0.14, post, 1.15, 1.3, 0.75);
  const jib = new THREE.Group();
  jib.position.set(1.15, 2.55, 0.75);
  box(jib, 1.3, 0.1, 0.1, post, -0.55, 0, 0);
  cyl(jib, 0.012, 0.012, 0.9, mat(PALETTE.iron), -1.1, -0.45, 0, 4);
  box(jib, 0.26, 0.18, 0.22, mat('#b8bdc6', { flat: true }), -1.1, -0.95, 0);
  r.add(jib);
  m.busy.push({ obj: jib, axis: 'y', speed: 0.35 });
  return m;
}

function house(variant: number): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  box(r, 2.75, 0.2, 1.75, mat(PALETTE.stoneDark), 0, 0.1, 0);
  // Brick ground floor, timber-framed upper floor jettied out a little.
  box(r, 2.4, 1.05, 1.4, mat('#c4704f', { flat: true }), 0, 0.72, -0.05);
  box(r, 2.55, 0.1, 1.55, mat(PALETTE.woodDark), 0, 1.29, -0.05);
  box(r, 2.5, 0.85, 1.5, mat(PALETTE.plaster), 0, 1.76, -0.05);
  const beam = mat(PALETTE.woodDark);
  for (const x of [-1.2, -0.4, 0.4, 1.2]) box(r, 0.08, 0.85, 0.06, beam, x, 1.76, 0.71);
  for (const [x, rot] of [[-0.8, 0.6], [0.8, -0.6]] as const) {
    const brace = box(r, 0.06, 0.85, 0.05, beam, x, 1.76, 0.72);
    brace.rotation.z = rot;
  }
  const roofColors = [PALETTE.slate, PALETTE.terracotta, '#7aa35a', PALETTE.slateDark];
  gableRoof(r, 1.95, 1.0, 2.85, mat(roofColors[variant % roofColors.length], { flat: true }), 2.18, true, 0, -0.05);
  box(r, 0.34, 1.3, 0.34, mat('#a8452f', { flat: true }), 0.9, 2.6, -0.35);
  m.smoke.push(new THREE.Vector3(0.9, 3.35, -0.35));
  door(r, -0.45, 0.67, 0.42, 0.74, 0.2);
  windowPane(r, 0.55, 0.75, 0.67, 0.34, 0.3);
  windowPane(r, -0.75, 1.78, 0.73, 0.26, 0.26);
  windowPane(r, 0.05, 1.78, 0.73, 0.26, 0.26);
  windowPane(r, 0.8, 1.78, 0.73, 0.26, 0.26);
  // Window box and a bench by the door.
  box(r, 0.4, 0.08, 0.1, mat(PALETTE.wood), 0.55, 0.52, 0.78);
  ['#e86b8a', '#f2c14e', '#ffffff'].forEach((c, i) => {
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), mat(c, { flat: true }));
    f.position.set(0.43 + i * 0.12, 0.6, 0.78);
    r.add(f);
  });
  return m;
}

/** Small flag that tells the building's level at a glance (blue = 2, gold = 3). */
export function levelPennant(m: BuildingModel, level: number, x: number, z: number, height: number): void {
  const pole = new THREE.Group();
  pole.position.set(x, 0, z);
  cyl(pole, 0.025, 0.03, height, mat(PALETTE.woodDark), 0, height / 2, 0, 6);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(0.42, -0.1);
  shape.lineTo(0, -0.24);
  shape.closePath();
  const flagPivot = new THREE.Group();
  flagPivot.position.set(0.02, height - 0.02, 0);
  const flag = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(level >= 3 ? PALETTE.gold : '#6fa8dc', { side: THREE.DoubleSide }));
  flagPivot.add(flag);
  pole.add(flagPivot);
  for (let i = 0; i < level; i++) box(pole, 0.07, 0.07, 0.07, mat(level >= 3 ? PALETTE.gold : '#e8f1fb'), 0, height - 0.32 - i * 0.12, 0.03);
  m.root.add(pole);
  m.wavers.push({ obj: flagPivot, amp: 0.25, speed: 2.4 + x, base: 0 });
}

/** Layers visible improvements onto a base model for each level above 1. */
function addLevelDetails(m: BuildingModel, id: BuildingId, level: number): void {
  if (level < 2) return;
  const r = m.root;
  const stone = mat(PALETTE.stone, { flat: true });
  const stoneDark = mat(PALETTE.stoneDark, { flat: true });
  switch (id) {
    case 'timberYard':
    case 'clayShed':
    case 'stoneYard': {
      // Level 2: a cut-stone footing around the yard.
      for (const [w, d, x, z] of [[2.0, 0.12, 0, 0.94], [2.0, 0.12, 0, -0.94], [0.12, 2.0, 0.94, 0], [0.12, 2.0, -0.94, 0]] as const) {
        box(r, w, 0.16, d, stoneDark, x, 0.08, z);
      }
      levelPennant(m, level, 0.92, -0.92, 2.4);
      if (level >= 3) {
        if (id === 'clayShed') {
          // A little brick kiln for firing the best clay.
          cyl(r, 0.28, 0.34, 0.5, mat('#b5654a', { flat: true }), -0.62, 0.35, 0.7, 8);
          const dome = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat('#a95a40', { flat: true }));
          dome.position.set(-0.62, 0.6, 0.7);
          r.add(dome);
          m.smoke.push(new THREE.Vector3(-0.62, 0.95, 0.7));
        } else {
          // Timber hoist: post, jib and hanging hook.
          const wood = mat(PALETTE.woodDark);
          box(r, 0.1, 2.3, 0.1, wood, -0.85, 1.15, -0.85);
          box(r, 0.9, 0.08, 0.08, wood, -0.45, 2.2, -0.85);
          cyl(r, 0.01, 0.01, 0.6, mat(PALETTE.iron), -0.1, 1.9, -0.85, 4);
        }
      }
      break;
    }
    case 'cookhouse': {
      // Level 2: stone cladding, an awning over the pot and a second chimney.
      box(r, 2.26, 0.45, 1.91, stone, 0, 0.45, -0.2);
      const awning = box(r, 1.3, 0.05, 0.75, mat(PALETTE.terracotta, { flat: true }), -0.15, 1.55, 1.2);
      awning.rotation.x = 0.28;
      for (const x of [-0.75, 0.45]) box(r, 0.07, 1.5, 0.07, mat(PALETTE.woodDark), x, 0.75, 1.52);
      box(r, 0.3, 1.0, 0.3, stoneDark, -0.75, 2.0, -0.7);
      m.smoke.push(new THREE.Vector3(-0.75, 2.6, -0.7));
      levelPennant(m, level, 1.25, -1.2, 3.1);
      if (level >= 3) {
        // Bread oven beside the kitchen.
        const oven = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat('#c98a5e', { flat: true }));
        oven.position.set(1.12, 0.22, 0.75);
        r.add(oven);
        box(r, 0.2, 0.2, 0.05, mat('#3b2f2a'), 1.12, 0.32, 1.15);
        m.smoke.push(new THREE.Vector3(1.12, 0.75, 0.75));
      }
      break;
    }
    case 'academy': {
      // Level 2: gilded weathervane and taller banners; level 3: a second domed observatory.
      cyl(r, 0.02, 0.02, 0.5, mat(PALETTE.gold), 0.95, 4.7, -0.85, 4);
      const vane = box(r, 0.4, 0.05, 0.02, mat(PALETTE.gold), 0.95, 4.92, -0.85);
      m.spinners.push({ obj: vane, axis: 'y', speed: 0.6 });
      levelPennant(m, level, -1.25, -1.15, 3.2);
      if (level >= 3) {
        cyl(r, 0.36, 0.4, 2.2, mat('#e2d9c6'), -0.95, 1.32, -0.95, 12);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(PALETTE.gold, { flat: true }));
        dome.position.set(-0.95, 2.42, -0.95);
        r.add(dome);
        windowPane(r, -0.95, 1.9, -0.55, 0.18, 0.26);
      }
      break;
    }
    case 'lodge': {
      // Level 2: a dormer for the extra bed, a stone chimney and a covered porch.
      const dormer = new THREE.Group();
      dormer.position.set(0.6, 1.55, 0.35);
      box(dormer, 0.55, 0.45, 0.4, mat(PALETTE.wood), 0, 0, 0);
      gableRoof(dormer, 0.7, 0.32, 0.55, mat(PALETTE.thatch, { flat: true }), 0.22, false);
      windowPane(dormer, 0, 0, 0.21, 0.24, 0.22);
      r.add(dormer);
      box(r, 0.32, 1.2, 0.32, stoneDark, 0.95, 1.8, -0.4);
      m.smoke.push(new THREE.Vector3(0.95, 2.5, -0.4));
      const porch = box(r, 1.0, 0.05, 0.4, mat(PALETTE.thatchDark, { flat: true }), 0, 1.05, 0.88);
      porch.rotation.x = 0.25;
      for (const x of [-0.42, 0.42]) box(r, 0.06, 0.9, 0.06, mat(PALETTE.woodDark), x, 0.55, 1.02);
      levelPennant(m, level, -1.3, -0.8, 2.9);
      break;
    }
    default:
      levelPennant(m, level, 0.8, -0.8, 2.2);
  }
}

export function createBuildingModel(id: BuildingId, variant: number, level = 1): BuildingModel {
  let model: BuildingModel;
  switch (id) {
    case 'cookhouse':
      model = cookhouse();
      break;
    case 'lodge':
      model = lodge();
      break;
    case 'timberYard':
      model = timberYard();
      break;
    case 'clayShed':
      model = clayShed();
      break;
    case 'stoneYard':
      model = stoneYard();
      break;
    case 'sawmill':
      model = sawmill();
      break;
    case 'brickworks':
      model = brickworks();
      break;
    case 'warehouse':
      model = warehouse();
      break;
    case 'woodlot':
      model = woodlot();
      break;
    case 'clayPit':
      model = clayPit();
      break;
    case 'quarry':
      model = quarry();
      break;
    case 'house':
      model = house(variant);
      break;
    case 'academy':
      model = academy();
      break;
    case 'cottage':
      model = cottage(variant);
      break;
    case 'flowerBed':
      model = flowerBed(variant);
      break;
    case 'lantern':
      model = lantern();
      break;
    case 'bench':
      model = bench();
      break;
    case 'valleyBanner':
      model = valleyBanner();
      break;
    case 'fountain':
      model = fountain();
      break;
    case 'festivalLanterns':
      model = festivalLanterns();
      break;
    case 'field':
      model = fieldModel(variant);
      break;
    case 'granary':
      model = granaryModel();
      break;
  }
  addLevelDetails(model, id, level);
  mergeStatic(model);
  model.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return model;
}

/**
 * Collapses every non-animated mesh of a model into one mesh per material. Buildings
 * are assembled from dozens of primitives; merging keeps each to a handful of draw calls.
 * Anything referenced by an animation anchor or storage fill stays separate.
 */
export function mergeStatic(model: BuildingModel): void {
  const dynamic = new Set<THREE.Object3D>();
  const keep = (o: THREE.Object3D) => o.traverse((c) => dynamic.add(c));
  model.spinners.forEach((s) => keep(s.obj));
  model.wavers.forEach((w) => keep(w.obj));
  model.flames.forEach(keep);
  model.fills.forEach((f) => f.items.forEach(keep));
  model.busy.forEach((b) => keep(b.obj));
  model.crops?.rows.forEach(keep);
  model.animate.forEach((a) => a.objects.forEach(keep));
  const root = model.root;
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const merged: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || dynamic.has(mesh) || Array.isArray(mesh.material)) return;
    const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
    for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
    const list = groups.get(mesh.material) ?? [];
    list.push(geo);
    groups.set(mesh.material, list);
    merged.push(mesh);
  });
  for (const mesh of merged) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }
  // Prune groups left empty after their meshes were merged away.
  const prune = (o: THREE.Object3D) => {
    for (const child of [...o.children]) {
      prune(child);
      if (child.children.length === 0 && !(child as THREE.Mesh).isMesh && !dynamic.has(child)) child.removeFromParent();
    }
  };
  prune(root);
  for (const [material, geos] of groups) {
    const geo = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!geo) continue;
    root.add(new THREE.Mesh(geo, material));
  }
}
