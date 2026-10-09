import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, mat } from '../materials';
import { box, cyl, emptyModel, gableRoof, type BuildingModel } from './buildingModels';

/**
 * Farm models: the Grain Field (tilled rows whose crop the view grows, ripens and cuts
 * down from the field's state) and the Granary.
 */

/** Crop rows of a field: one mesh per row so a harvest can clear them row by row. */
export interface CropRows {
  rows: THREE.Mesh[];
  /** Per-field material: its colour runs from sprout green to ripe gold. */
  material: THREE.MeshLambertMaterial;
}

const ROWS = 5;
const PER_ROW = 8;
const SPROUT = new THREE.Color('#86b84e');
const RIPE = new THREE.Color('#e2b54a');

/**
 * Shows a crop at `growth` (0 sprouts … 1 ripe, green turning gold) with the first
 * `rowsLeft` rows standing; the rest have been cut (or never sown).
 */
export function paintCrops(crops: CropRows, growth: number, rowsLeft: number): void {
  const g = Math.max(0, Math.min(1, growth));
  const height = 0.12 + 0.88 * (g * g * (3 - 2 * g));
  crops.rows.forEach((row, i) => {
    row.visible = i < rowsLeft;
    row.scale.set(1, height, 1);
  });
  crops.material.color.copy(SPROUT).lerp(RIPE, Math.max(0, (g - 0.55) / 0.45));
}

/** Material for a crop that ripens as one (a field, or all the Commons' plots). */
export function cropMaterial(): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: '#86b84e', vertexColors: true, flatShading: true });
}

/** Tilled rows of crop on a ~3×3 plot centred at (x, z) under `parent`, swaying in the wind. */
export function cropPlot(m: BuildingModel, parent: THREE.Object3D, material: THREE.Material, x: number, z: number, seed: number): THREE.Mesh[] {
  const ridge = mat('#8d6a45', { flat: true });
  const rows: THREE.Mesh[] = [];
  for (let i = 0; i < ROWS; i++) {
    const rz = z - 1.1 + (i / (ROWS - 1)) * 2.2;
    box(parent, 2.5, 0.07, 0.22, ridge, x, 0.08, rz);
    const row = new THREE.Mesh(cropRowGeometry(97 + i * 31 + seed * 7), material);
    row.position.set(x, 0.1, rz);
    parent.add(row);
    rows.push(row);
    m.wavers.push({ obj: row, amp: 0.035, speed: 1.1 + i * 0.23 + seed * 0.1, base: 0 });
  }
  return rows;
}

/** One row of grain stalks with ears, standing on y = 0 (so scaling y grows it). */
function cropRowGeometry(seed: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const stalk = new THREE.CylinderGeometry(0.012, 0.018, 0.5, 4).translate(0, 0.25, 0);
  const ear = new THREE.IcosahedronGeometry(0.05, 0).scale(0.7, 1.6, 0.7).translate(0, 0.54, 0);
  const leaf = new THREE.BoxGeometry(0.14, 0.012, 0.035).translate(0.06, 0.2, 0);
  for (let i = 0; i < PER_ROW; i++) {
    const x = -1.1 + (i / (PER_ROW - 1)) * 2.2 + (rnd() - 0.5) * 0.1;
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(x + (rnd() - 0.5) * 0.14, 0, (rnd() - 0.5) * 0.14),
        new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.25, rnd() * Math.PI, (rnd() - 0.5) * 0.25)),
        new THREE.Vector3(1, 0.8 + rnd() * 0.4, 1),
      );
      // Stalk and leaves a little darker than the ears; the material tints both.
      for (const [g, shade] of [[stalk, 0.78], [leaf, 0.72], [ear, 1]] as const) {
        const geo = g.clone().applyMatrix4(m);
        const n = geo.attributes.position.count;
        const colors = new Float32Array(n * 3).fill(shade);
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.deleteAttribute('uv');
        parts.push(geo.index ? geo.toNonIndexed() : geo);
      }
    }
  }
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  return merged;
}

export function fieldModel(variant: number): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  // Tilled soil.
  box(r, 2.86, 0.06, 2.86, mat('#7a5a3a'), 0, 0.03, 0);
  // Low split-rail fence on three sides; the front stays open for the farmers.
  const rail = mat(PALETTE.woodLight);
  const post = mat(PALETTE.woodDark);
  for (const [w, d, x, z] of [[2.9, 0.05, 0, -1.43], [0.05, 2.9, 1.43, 0], [0.05, 2.9, -1.43, 0]] as const) {
    box(r, w, 0.05, d, rail, x, 0.28, z);
    box(r, w, 0.05, d, rail, x, 0.14, z);
  }
  for (const [x, z] of [[-1.43, -1.43], [0, -1.43], [1.43, -1.43], [-1.43, 0], [1.43, 0], [-1.43, 1.43], [1.43, 1.43]]) box(r, 0.08, 0.42, 0.08, post, x, 0.21, z);

  // The crop: per-field material so each field ripens on its own.
  const material = cropMaterial();
  m.crops = { rows: cropPlot(m, r, material, 0, 0, variant), material };

  // A scarecrow in the back corner, and a basket by the gate.
  const crow = new THREE.Group();
  crow.position.set(1.05, 0.06, -1.05);
  crow.rotation.y = -0.6 + variant * 0.3;
  cyl(crow, 0.025, 0.03, 1.15, post, 0, 0.58, 0, 5);
  box(crow, 0.62, 0.04, 0.04, post, 0, 0.92, 0);
  box(crow, 0.3, 0.32, 0.16, mat(['#b8554a', '#4f7fb8', '#6f9a4a', '#c08a3a'][variant % 4]), 0, 0.88, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), mat('#e8d39a'));
  head.position.y = 1.15;
  crow.add(head);
  cyl(crow, 0.2, 0.2, 0.025, mat(PALETTE.thatch), 0, 1.23, 0, 10);
  cyl(crow, 0.08, 0.11, 0.1, mat(PALETTE.thatchDark), 0, 1.29, 0, 8);
  r.add(crow);
  m.wavers.push({ obj: crow, amp: 0.03, speed: 0.9, base: 0 });
  cyl(r, 0.16, 0.12, 0.16, mat(PALETTE.thatchDark), -1.15, 0.08, 1.2, 10);
  return m;
}

/** Grain sacks and sheaves stacked by the Granary, shown as it fills. */
function grainStores(m: BuildingModel, parent: THREE.Object3D): void {
  const sack = mat('#d9c28e');
  const tie = mat(PALETTE.woodDark);
  const sheaf = mat(PALETTE.thatch, { flat: true });
  const items: THREE.Object3D[] = [];
  const spots: [number, number, number, boolean][] = [
    [-0.55, 0.0, 0.95, false], [-0.25, 0.0, 1.0, false], [0.55, 0.0, 0.95, true], [-0.4, 0.26, 0.97, false],
    [0.8, 0.0, 0.6, true], [0.8, 0.0, 0.25, true], [-0.82, 0.0, 0.55, false], [-0.82, 0.0, 0.2, false],
  ];
  for (const [x, y, z, isSheaf] of spots) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    if (isSheaf) {
      cyl(g, 0.11, 0.08, 0.42, sheaf, 0, 0.21, 0, 7);
      cyl(g, 0.085, 0.085, 0.04, tie, 0, 0.24, 0, 7);
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.16, 7), sheaf);
      top.position.y = 0.48;
      g.add(top);
    } else {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), sack);
      body.scale.set(1, 1.15, 0.85);
      body.position.y = 0.15;
      g.add(body);
      cyl(g, 0.04, 0.06, 0.06, tie, 0, 0.31, 0, 6);
    }
    parent.add(g);
    items.push(g);
  }
  m.fills.push({ resource: 'grain', items });
}

export function granaryModel(): BuildingModel {
  const m = emptyModel();
  const r = m.root;
  // Staddle stones lift the floor away from damp and mice.
  const stone = mat(PALETTE.stone, { flat: true });
  for (const x of [-0.6, 0.6]) {
    for (const z of [-0.6, 0.35]) {
      cyl(r, 0.06, 0.1, 0.36, stone, x, 0.18, z, 7);
      cyl(r, 0.17, 0.15, 0.07, stone, x, 0.39, z, 8);
    }
  }
  box(r, 1.6, 0.08, 1.4, mat(PALETTE.woodDark), 0, 0.46, -0.12);
  // Weatherboarded walls and a steep thatched roof.
  const boards = mat(PALETTE.wood);
  box(r, 1.45, 0.95, 1.25, boards, 0, 0.98, -0.12);
  const batten = mat(PALETTE.woodDark);
  for (const x of [-0.72, 0.72]) for (const z of [-0.74, 0.5]) box(r, 0.08, 1.0, 0.08, batten, x, 0.98, z);
  for (const y of [0.72, 1.0, 1.28]) box(r, 1.48, 0.03, 0.02, batten, 0, y, 0.515);
  gableRoof(r, 1.95, 1.1, 1.65, mat(PALETTE.thatch, { flat: true }), 1.45, false, 0, -0.12);
  box(r, 0.1, 0.1, 1.7, mat(PALETTE.thatchDark), 0, 2.53, -0.12);
  // Door with a short ladder of steps up to it.
  box(r, 0.42, 0.6, 0.05, batten, 0.25, 0.86, 0.53);
  box(r, 0.04, 0.04, 0.04, mat(PALETTE.gold), 0.38, 0.86, 0.56);
  const ladder = new THREE.Group();
  ladder.position.set(0.25, 0, 0.72);
  ladder.rotation.x = -0.35;
  for (const x of [-0.15, 0.15]) box(ladder, 0.04, 0.6, 0.04, mat(PALETTE.woodLight), x, 0.28, 0);
  for (let i = 0; i < 3; i++) box(ladder, 0.3, 0.03, 0.05, mat(PALETTE.woodLight), 0, 0.1 + i * 0.17, 0);
  r.add(ladder);
  // A small round vent under the gable.
  const vent = new THREE.Mesh(new THREE.CircleGeometry(0.1, 10), mat('#3b2f2a'));
  vent.position.set(0, 1.72, 0.71);
  r.add(vent);
  grainStores(m, r);
  return m;
}
