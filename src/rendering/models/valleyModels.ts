import * as THREE from 'three';
import type { ValleyBuildingDef } from '../../config/valley';
import { createRng } from '../../world/noise';
import { PALETTE, mat } from '../materials';
import { box, cyl, door, emptyModel, gableRoof, levelPennant, mergeStatic, windowPane, type BuildingModel } from './buildingModels';

/**
 * Procedural models for the Valley's communal buildings. Same conventions as village
 * buildings (origin at the footprint centre, front facing +z, 1 unit = 1 tile), but
 * built bigger: these are landmarks seen from across the Valley. Each building has a
 * ruined form (before restoration), scaffolding while builders work, and visible levels.
 */

export type ValleyVisualStage = 'ruin' | 'restored';

/** Footprint half-sizes (x, z) per model kind; used for plinths, scaffolds and hitboxes. */
export const VALLEY_MODEL_SIZE: Record<ValleyBuildingDef['model'], { hx: number; hz: number; height: number }> = {
  hall: { hx: 4.1, hz: 3.1, height: 6.2 },
  guild: { hx: 2.6, hz: 2.1, height: 4.4 },
};

function plinth(r: THREE.Object3D, hx: number, hz: number, color: string): void {
  // A deep skirt so the building sits cleanly on gently sloping ground.
  box(r, hx * 2 + 0.2, 1.1, hz * 2 + 0.2, mat(PALETTE.stoneDark, { flat: true }), 0, -0.35, 0);
  box(r, hx * 2, 0.4, hz * 2, mat(color, { flat: true }), 0, 0.2, 0);
}

function banner(m: BuildingModel, color: string, x: number, y: number, z: number, h = 1.1): void {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const cloth = box(pivot, 0.5, h, 0.03, mat(color, { side: THREE.DoubleSide }), 0, -h / 2, 0);
  cloth.castShadow = true;
  box(pivot, 0.56, 0.06, 0.06, mat(PALETTE.woodDark), 0, 0, 0);
  box(pivot, 0.18, 0.18, 0.04, mat(PALETTE.gold), 0, -h * 0.45, 0.02);
  m.root.add(pivot);
  m.wavers.push({ obj: pivot, amp: 0.1, speed: 1.4 + x * 0.13, base: 0 });
}

function chimney(m: BuildingModel, x: number, y: number, z: number, h = 1.3): void {
  box(m.root, 0.42, h, 0.42, mat(PALETTE.stoneDark, { flat: true }), x, y + h / 2, z);
  box(m.root, 0.52, 0.1, 0.52, mat(PALETTE.stone), x, y + h, z);
  m.smoke.push(new THREE.Vector3(x, y + h + 0.15, z));
}

/** Round crest board above a guild door, painted in the guild's colour. */
function crest(r: THREE.Object3D, color: string, x: number, y: number, z: number): void {
  const rim = new THREE.Mesh(new THREE.CircleGeometry(0.42, 18), mat(PALETTE.gold));
  rim.position.set(x, y, z);
  r.add(rim);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.34, 18), mat(color));
  face.position.set(x, y, z + 0.01);
  r.add(face);
  const star = new THREE.Mesh(new THREE.CircleGeometry(0.13, 5), mat('#fff8ea'));
  star.position.set(x, y, z + 0.02);
  r.add(star);
}

// ---------------------------------------------------------------------------
// Hearth Hall
// ---------------------------------------------------------------------------

function hall(def: ValleyBuildingDef, level: number): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  const { hx, hz } = VALLEY_MODEL_SIZE.hall;
  plinth(r, hx, hz, PALETTE.stone);
  const plaster = mat(PALETTE.plaster);
  const beam = mat(PALETTE.woodDark);
  const stone = mat('#e2d9c6', { flat: true });
  // Stone ground storey, timber-framed upper storey.
  box(r, 6.6, 1.5, 4.4, stone, 0, 1.15, -0.4);
  box(r, 6.8, 1.4, 4.6, plaster, 0, 2.6, -0.4);
  box(r, 7.0, 0.14, 4.8, beam, 0, 1.92, -0.4);
  for (const x of [-3.35, -2.2, -1.1, 1.1, 2.2, 3.35]) box(r, 0.14, 1.4, 0.12, beam, x, 2.6, 1.86);
  for (const x of [-2.75, -1.65, 1.65, 2.75]) {
    const brace = box(r, 0.1, 1.5, 0.1, beam, x, 2.6, 1.87);
    brace.rotation.z = x > 0 ? 0.6 : -0.6;
  }
  gableRoof(r, 5.4, 2.2, 7.4, mat(PALETTE.terracotta, { flat: true }), 3.3, true, 0, -0.4);
  // Bell tower over the great door.
  box(r, 1.8, 4.4, 1.8, stone, 0, 2.6, 1.7);
  box(r, 2.0, 0.14, 2.0, beam, 0, 4.85, 1.7);
  for (const [x, z] of [[-0.8, 0.9], [0.8, 0.9], [-0.8, 2.5], [0.8, 2.5]]) box(r, 0.16, 1.1, 0.16, beam, x, 5.45, z);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.36, 0.5, 12, 1, true), mat(PALETTE.gold, { side: THREE.DoubleSide }));
  bell.position.set(0, 5.45, 1.7);
  const bellPivot = new THREE.Group();
  bellPivot.position.set(0, 5.75, 1.7);
  bell.position.set(0, -0.3, 0);
  bellPivot.add(bell);
  r.add(bellPivot);
  m.wavers.push({ obj: bellPivot, amp: 0.08, speed: 0.9, base: 0 });
  const spire = new THREE.Mesh(new THREE.ConeGeometry(1.45, 2.0, 4), mat(level >= 3 ? PALETTE.gold : PALETTE.slateDark, { flat: true }));
  spire.rotation.y = Math.PI / 4;
  spire.position.set(0, 7.0, 1.7);
  r.add(spire);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), mat(PALETTE.gold));
  finial.position.set(0, 8.1, 1.7);
  r.add(finial);
  door(r, 0, 2.62, 1.0, 1.6, 0.4);
  box(r, 2.4, 0.2, 0.9, mat(PALETTE.stone), 0, 0.3, 3.1);
  box(r, 2.0, 0.2, 0.6, mat(PALETTE.stone), 0, 0.1, 3.5);
  windowPane(r, 0, 3.4, 2.62, 0.5, 0.6);
  for (const x of [-2.6, -1.6, 1.6, 2.6]) {
    windowPane(r, x, 1.15, 1.81, 0.4, 0.55);
    windowPane(r, x, 2.6, 1.91, 0.34, 0.4);
  }
  banner(m, def.color, -1.15, 3.1, 2.64, 1.4);
  banner(m, def.color, 1.15, 3.1, 2.64, 1.4);
  chimney(m, -2.4, 4.2, -1.3, 1.4);
  chimney(m, 2.4, 4.2, -1.3, 1.4);
  // Lanterns flanking the steps.
  for (const x of [-1.5, 1.5]) {
    cyl(r, 0.05, 0.06, 1.3, mat(PALETTE.iron), x, 1.05, 3.3, 6);
    const glass = box(r, 0.22, 0.26, 0.22, mat(PALETTE.glow, { emissive: '#ffb347', emissiveIntensity: 0.9 }), x, 1.8, 3.3);
    m.flames.push(glass);
  }
  if (level >= 2) {
    // West wing: the Valley storehouse.
    box(r, 2.2, 2.2, 3.2, stone, -4.2, 1.5, -0.6);
    gableRoof(r, 3.6, 1.3, 2.4, mat(PALETTE.terracotta, { flat: true }), 2.6, false, -4.2, -0.6);
    door(r, -4.2, 1.01, 0.7, 1.1, 0.4);
    for (let i = 0; i < 3; i++) box(r, 0.55, 0.55, 0.55, mat(PALETTE.wood), -3.3 + i * 0.2, 0.68, 1.6 + (i % 2) * 0.5);
    levelPennant(m, level, 3.6, 2.2, 4.4);
  }
  if (level >= 3) {
    // East wing: the feast hall, with its own oven chimney.
    box(r, 2.2, 2.2, 3.2, stone, 4.2, 1.5, -0.6);
    gableRoof(r, 3.6, 1.3, 2.4, mat(PALETTE.terracotta, { flat: true }), 2.6, false, 4.2, -0.6);
    windowPane(r, 4.2, 1.5, 1.01, 0.6, 0.6);
    chimney(m, 4.6, 3.4, -1.4, 1.0);
    for (const x of [-3.6, 3.6]) {
      const lamp = box(r, 0.25, 0.3, 0.25, mat(PALETTE.glow, { emissive: '#ffb347', emissiveIntensity: 0.9 }), x, 2.0, 2.0);
      m.flames.push(lamp);
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Guild halls
// ---------------------------------------------------------------------------

function guild(def: ValleyBuildingDef, level: number): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  const { hx, hz } = VALLEY_MODEL_SIZE.guild;
  plinth(r, hx, hz, PALETTE.stone);
  const beam = mat(PALETTE.woodDark);
  box(r, 4.2, 1.4, 3.2, mat('#e2d9c6', { flat: true }), 0, 1.1, -0.2);
  box(r, 4.5, 1.2, 3.5, mat(PALETTE.plaster), 0, 2.4, -0.2);
  box(r, 4.6, 0.12, 3.6, beam, 0, 1.82, -0.2);
  for (const x of [-2.2, -1.1, 0, 1.1, 2.2]) box(r, 0.12, 1.2, 0.1, beam, x, 2.4, 1.56);
  gableRoof(r, 4.1, 1.7, 5.0, mat(PALETTE.slate, { flat: true }), 3.0, true, 0, -0.2);
  door(r, 0, 1.41, 0.8, 1.25, 0.4);
  crest(r, def.color, 0, 2.45, 1.57);
  windowPane(r, -1.4, 1.1, 1.41, 0.42, 0.5);
  windowPane(r, 1.4, 1.1, 1.41, 0.42, 0.5);
  windowPane(r, -1.4, 2.4, 1.56, 0.36, 0.38);
  windowPane(r, 1.4, 2.4, 1.56, 0.36, 0.38);
  banner(m, def.color, -2.05, 2.9, 1.62, 1.0);
  banner(m, def.color, 2.05, 2.9, 1.62, 1.0);
  chimney(m, 1.3, 3.6, -1.0, 1.1);
  box(r, 1.6, 0.18, 0.7, mat(PALETTE.stone), 0, 0.3, 2.3);
  if (level >= 2) {
    // A covered workyard where members practise.
    const awning = box(r, 1.6, 0.06, 2.4, mat(def.color, { flat: true }), 3.1, 1.75, 0.2);
    awning.rotation.z = -0.25;
    for (const z of [-0.8, 1.2]) box(r, 0.08, 1.6, 0.08, beam, 3.7, 0.95, z);
    box(r, 0.9, 0.5, 0.6, mat(PALETTE.wood), 3.0, 0.55, 0.3);
    levelPennant(m, level, -2.4, -1.9, 4.4);
  }
  if (level >= 3) {
    // A slender tower crowned in the guild's colour.
    cyl(r, 0.55, 0.62, 3.6, mat('#e2d9c6'), -2.0, 2.2, -1.4, 10);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.4, 10), mat(def.color, { flat: true }));
    cap.position.set(-2.0, 4.7, -1.4);
    r.add(cap);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), mat(PALETTE.gold));
    ball.position.set(-2.0, 5.45, -1.4);
    r.add(ball);
    windowPane(r, -2.0, 3.2, -0.82, 0.22, 0.32);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Ruins and scaffolding
// ---------------------------------------------------------------------------

/** Tumbledown walls, fallen beams and rubble on the old foundations, plus a call-for-help sign. */
function ruin(def: ValleyBuildingDef): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  const { hx, hz } = VALLEY_MODEL_SIZE[def.model];
  const rng = createRng(def.x * 131 + def.z * 17);
  plinth(r, hx, hz, PALETTE.stoneDark);
  const wall = mat('#d8ccb4', { flat: true });
  const ix = hx - 0.6;
  const iz = hz - 0.6;
  // Wall stubs along the perimeter, with gaps.
  const segs: [number, number, number, boolean][] = [];
  for (let x = -ix; x <= ix; x += 1.1) segs.push([x, -iz, 0, true], [x, iz, 0, true]);
  for (let z = -iz + 1.1; z <= iz - 1.1; z += 1.1) segs.push([-ix, z, 0, false], [ix, z, 0, false]);
  for (const [x, z, , alongX] of segs) {
    if (rng() < 0.28) continue;
    const h = 0.3 + rng() * rng() * 2.2;
    box(r, alongX ? 1.1 : 0.36, h, alongX ? 0.36 : 1.1, wall, x, 0.4 + h / 2, z);
  }
  // Fallen beams and rubble.
  const beam = mat(PALETTE.barkDark);
  for (let i = 0; i < 5; i++) {
    const b = box(r, 0.18, 0.18, 1.6 + rng() * 1.6, beam, (rng() - 0.5) * hx * 1.4, 0.55, (rng() - 0.5) * hz * 1.4);
    b.rotation.set(rng() * 0.3, rng() * Math.PI, rng() * 0.25);
  }
  const rubble = mat(PALETTE.stone, { flat: true });
  for (let i = 0; i < 14; i++) {
    const s = 0.18 + rng() * 0.3;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rubble);
    rock.position.set((rng() - 0.5) * hx * 1.7, 0.4 + s * 0.5, (rng() - 0.5) * hz * 1.7);
    rock.rotation.set(rng() * 3, rng() * 3, rng() * 3);
    r.add(rock);
  }
  // Weeds pushing through.
  const weed = mat('#6fab4f', { flat: true });
  for (let i = 0; i < 16; i++) {
    const tuft = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35 + rng() * 0.3, 4), weed);
    tuft.position.set((rng() - 0.5) * hx * 1.8, 0.55, (rng() - 0.5) * hz * 1.8);
    r.add(tuft);
  }
  if (def.model === 'hall') {
    // The broken bell tower still stands, roofless.
    box(r, 1.8, 2.6, 1.8, wall, 0, 1.7, 1.7);
    const crack = box(r, 1.0, 0.8, 1.8, wall, -0.4, 3.3, 1.7);
    crack.rotation.z = 0.25;
  }
  // Sign asking every village to lend a hand.
  const sign = new THREE.Group();
  sign.position.set(hx - 0.8, 0.4, hz + 0.45);
  box(sign, 0.1, 1.3, 0.1, mat(PALETTE.woodDark), -0.35, 0.65, 0);
  box(sign, 0.1, 1.3, 0.1, mat(PALETTE.woodDark), 0.35, 0.65, 0);
  box(sign, 1.0, 0.6, 0.06, mat(PALETTE.woodLight), 0, 1.05, 0.04);
  box(sign, 0.7, 0.14, 0.02, mat(def.color), 0, 1.15, 0.08);
  box(sign, 0.5, 0.08, 0.02, mat(PALETTE.woodDark), 0, 0.95, 0.08);
  r.add(sign);
  banner(m, def.color, -hx + 0.8, 1.5, hz + 0.3, 0.9);
  cyl(r, 0.04, 0.05, 1.6, mat(PALETTE.woodDark), -hx + 0.8, 0.8, hz + 0.3, 6);
  return m;
}

/** Poles, boards and braces around a footprint, plus a crane for the big jobs. */
export function createScaffold(def: ValleyBuildingDef, height: number): THREE.Group {
  const g = new THREE.Group();
  const { hx, hz } = VALLEY_MODEL_SIZE[def.model];
  const pole = mat(PALETTE.woodLight);
  const board = mat(PALETTE.wood);
  const ex = hx + 0.35;
  const ez = hz + 0.35;
  const posts: [number, number][] = [];
  for (let x = -ex; x <= ex + 0.01; x += (ex * 2) / Math.max(2, Math.round(ex))) posts.push([x, -ez], [x, ez]);
  for (const z of [-ez / 2, 0, ez / 2]) posts.push([-ex, z], [ex, z]);
  for (const [x, z] of posts) box(g, 0.08, height, 0.08, pole, x, height / 2 + 0.3, z);
  for (let y = 1.2; y < height; y += 1.3) {
    box(g, ex * 2 + 0.2, 0.06, 0.3, board, 0, y, ez);
    box(g, ex * 2 + 0.2, 0.06, 0.3, board, 0, y, -ez);
    box(g, 0.3, 0.06, ez * 2, board, ex, y, 0);
    box(g, 0.3, 0.06, ez * 2, board, -ex, y, 0);
  }
  for (const side of [-1, 1]) {
    const brace = box(g, 0.06, height * 0.9, 0.06, pole, side * ex * 0.5, height / 2, ez + 0.05);
    brace.rotation.z = side * 0.5;
  }
  if (def.model === 'hall') {
    const crane = new THREE.Group();
    crane.position.set(-ex - 0.8, 0, ez - 0.5);
    box(crane, 0.2, height + 2.4, 0.2, mat(PALETTE.woodDark), 0, (height + 2.4) / 2, 0);
    const jib = new THREE.Group();
    jib.position.y = height + 2.3;
    box(jib, 4.2, 0.16, 0.16, mat(PALETTE.woodDark), 1.6, 0, 0);
    cyl(jib, 0.012, 0.012, 1.8, mat(PALETTE.iron), 3.4, -0.9, 0, 4);
    box(jib, 0.5, 0.4, 0.5, mat(PALETTE.stone), 3.4, -1.9, 0);
    crane.add(jib);
    crane.userData.jib = jib;
    g.add(crane);
  }
  g.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) mesh.castShadow = true;
  });
  return g;
}

export function createValleyModel(def: ValleyBuildingDef, level: number): BuildingModel {
  const model = level <= 0 ? ruin(def) : def.model === 'hall' ? hall(def, level) : guild(def, level);
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
