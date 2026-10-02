import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ToolId } from '../../config/jobs';
import type { Appearance } from '../../config/villagers';
import { PALETTE, mat, paint } from '../materials';

/**
 * A chunky, friendly villager built from primitives. The rig exposes pivots that the
 * animation layer rotates procedurally; there is no skeletal animation to load.
 */
export interface VillagerRig {
  root: THREE.Group;
  /** Everything above the feet; bobs and leans. */
  body: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  tools: Record<ToolId, THREE.Object3D>;
  loads: { timber: THREE.Object3D; clay: THREE.Object3D };
  hitbox: THREE.Mesh;
}

const G = {
  leg: new THREE.CapsuleGeometry(0.052, 0.13, 3, 8),
  foot: new THREE.BoxGeometry(0.1, 0.06, 0.15),
  arm: new THREE.CapsuleGeometry(0.045, 0.17, 3, 8),
  hand: new THREE.SphereGeometry(0.048, 8, 6),
  head: new THREE.SphereGeometry(0.17, 18, 14),
  eye: new THREE.SphereGeometry(0.022, 8, 6),
  cheek: new THREE.SphereGeometry(0.03, 8, 6),
  nose: new THREE.SphereGeometry(0.028, 8, 6),
  hairCap: new THREE.SphereGeometry(0.182, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52),
  bun: new THREE.SphereGeometry(0.08, 10, 8),
  longHair: new THREE.CapsuleGeometry(0.13, 0.12, 4, 10),
  tail: new THREE.SphereGeometry(0.065, 10, 8),
  brim: new THREE.CylinderGeometry(0.29, 0.3, 0.025, 20),
  crown: new THREE.CylinderGeometry(0.14, 0.17, 0.12, 16),
  beanie: new THREE.SphereGeometry(0.19, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45),
  pom: new THREE.SphereGeometry(0.05, 8, 6),
  belt: new THREE.TorusGeometry(0.155, 0.018, 6, 20),
  hit: new THREE.CylinderGeometry(0.34, 0.34, 1.15, 8),
};

const torsoGeometry = (() => {
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.15, 0.01),
    new THREE.Vector2(0.175, 0.07),
    new THREE.Vector2(0.16, 0.18),
    new THREE.Vector2(0.13, 0.27),
    new THREE.Vector2(0.08, 0.31),
    new THREE.Vector2(0.0, 0.32),
  ];
  return new THREE.LatheGeometry(pts, 16);
})();

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function buildTool(id: ToolId): THREE.Object3D {
  const g = new THREE.Group();
  const handle = mat(PALETTE.woodLight);
  const metal = mat('#8d95a3', { flat: true });
  switch (id) {
    case 'axe': {
      g.add(mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.42, 6), handle, 0, -0.16, 0));
      const head = mesh(new THREE.BoxGeometry(0.03, 0.1, 0.13), metal, 0, -0.33, 0.05);
      g.add(head);
      break;
    }
    case 'saw': {
      g.add(mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), handle, 0, -0.04, 0));
      const blade = new THREE.Shape();
      blade.moveTo(0, 0);
      blade.lineTo(0.07, 0);
      blade.lineTo(0.03, -0.42);
      blade.lineTo(0, -0.42);
      blade.closePath();
      const plate = mesh(new THREE.ShapeGeometry(blade), mat('#cfd6df', { side: THREE.DoubleSide }), -0.02, -0.08, 0.01);
      g.add(plate);
      break;
    }
    case 'pickaxe': {
      g.add(mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.46, 6), handle, 0, -0.18, 0));
      const head = new THREE.Group();
      head.position.set(0, -0.4, 0.0);
      const spike = new THREE.ConeGeometry(0.028, 0.17, 5);
      const front = mesh(spike, metal, 0, 0, 0.09);
      front.rotation.x = Math.PI / 2;
      const back = mesh(spike, metal, 0, 0, -0.09);
      back.rotation.x = -Math.PI / 2;
      head.add(front, back, mesh(new THREE.BoxGeometry(0.05, 0.05, 0.06), metal));
      g.add(head);
      break;
    }
    case 'shovel': {
      g.add(mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.55, 6), handle, 0, -0.22, 0));
      g.add(mesh(new THREE.BoxGeometry(0.12, 0.14, 0.02), metal, 0, -0.52, 0));
      break;
    }
    case 'ladle': {
      g.add(mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.4, 6), handle, 0, -0.16, 0));
      g.add(mesh(new THREE.SphereGeometry(0.05, 8, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(PALETTE.woodDark), 0, -0.36, 0));
      break;
    }
    case 'book': {
      const cover = mesh(new THREE.BoxGeometry(0.16, 0.2, 0.04), mat('#6f5ac2'), 0, -0.06, 0.06);
      cover.rotation.x = -0.9;
      g.add(cover);
      const pages = mesh(new THREE.BoxGeometry(0.15, 0.19, 0.03), mat('#fbf4e2'), 0, -0.05, 0.075);
      pages.rotation.x = -0.9;
      g.add(pages);
      break;
    }
    case 'hammer': {
      g.add(mesh(new THREE.CylinderGeometry(0.015, 0.017, 0.3, 6), handle, 0, -0.12, 0));
      g.add(mesh(new THREE.BoxGeometry(0.06, 0.06, 0.13), metal, 0, -0.26, 0.02));
      break;
    }
  }
  g.visible = false;
  return g;
}

function buildLoads(): { timber: THREE.Object3D; clay: THREE.Object3D } {
  const timber = new THREE.Group();
  const logMat = mat(PALETTE.bark);
  const endMat = mat(PALETTE.woodLight);
  for (const [x, y] of [[-0.09, 0], [0.09, 0], [0, 0.13]]) {
    const log = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8), logMat, x, y, 0);
    log.rotation.x = Math.PI / 2;
    const ring = mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.01, 8), endMat, x, y, 0.253);
    ring.rotation.x = Math.PI / 2;
    timber.add(log, ring);
  }
  timber.position.set(0, 1.02, 0.02);
  timber.visible = false;

  const clay = new THREE.Group();
  const basket = mesh(new THREE.CylinderGeometry(0.17, 0.13, 0.16, 10, 1, true), mat(PALETTE.thatchDark, { side: THREE.DoubleSide }), 0, 0, 0);
  const lump = mesh(new THREE.IcosahedronGeometry(0.14, 0), mat(PALETTE.clay, { flat: true }), 0, 0.06, 0);
  lump.scale.set(1, 0.6, 1);
  clay.add(basket, lump);
  clay.position.set(0, 1.0, 0);
  clay.visible = false;
  return { timber, clay };
}

export function createVillagerRig(a: Appearance): VillagerRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const skin = mat(a.skin);
  const shirt = mat(a.shirt);
  const trousers = mat(a.trousers);
  const hair = mat(a.hair);
  const shoe = mat(PALETTE.barkDark);

  // Legs pivot at the hip.
  const makeLeg = (x: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.25, 0);
    pivot.add(mesh(G.leg, trousers, 0, -0.1, 0));
    pivot.add(mesh(G.foot, shoe, 0, -0.22, 0.025));
    body.add(pivot);
    return pivot;
  };
  const legL = makeLeg(-0.075);
  const legR = makeLeg(0.075);

  const torso = mesh(torsoGeometry, shirt, 0, 0.2, 0);
  body.add(torso);
  const belt = mesh(G.belt, mat(PALETTE.woodDark), 0, 0.27, 0);
  belt.rotation.x = Math.PI / 2;
  body.add(belt);

  const makeArm = (x: number): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.46, 0);
    pivot.add(mesh(G.arm, shirt, 0, -0.1, 0));
    pivot.add(mesh(G.hand, skin, 0, -0.22, 0));
    body.add(pivot);
    return pivot;
  };
  const armL = makeArm(-0.19);
  const armR = makeArm(0.19);
  armL.rotation.z = 0.12;
  armR.rotation.z = -0.12;

  const head = new THREE.Group();
  head.position.set(0, 0.69, 0);
  body.add(head);
  head.add(mesh(G.head, skin));
  const eyeMat = mat('#2b2a3a');
  head.add(mesh(G.eye, eyeMat, -0.06, 0.02, 0.155), mesh(G.eye, eyeMat, 0.06, 0.02, 0.155));
  const blush = mat('#f19a8f');
  const cheekL = mesh(G.cheek, blush, -0.1, -0.04, 0.125);
  const cheekR = mesh(G.cheek, blush, 0.1, -0.04, 0.125);
  cheekL.scale.set(1, 0.6, 0.5);
  cheekR.scale.set(1, 0.6, 0.5);
  head.add(cheekL, cheekR);
  head.add(mesh(G.nose, skin, 0, -0.015, 0.17));

  const cap = mesh(G.hairCap, hair, 0, 0.012, -0.012);
  cap.rotation.x = -0.25;
  head.add(cap);
  switch (a.hairStyle) {
    case 1:
      head.add(mesh(G.bun, hair, 0, 0.12, -0.14));
      break;
    case 2: {
      const back = mesh(G.longHair, hair, 0, -0.08, -0.1);
      back.scale.set(1.1, 1, 0.7);
      head.add(back);
      break;
    }
    case 3:
      head.add(mesh(G.tail, hair, -0.17, -0.05, -0.04), mesh(G.tail, hair, 0.17, -0.05, -0.04));
      break;
    default:
      break;
  }
  if (a.hat === 1) {
    const hatMat = mat(a.hatColor);
    head.add(mesh(G.brim, mat(PALETTE.thatch), 0, 0.12, 0));
    head.add(mesh(G.crown, hatMat, 0, 0.19, 0));
  } else if (a.hat === 2) {
    const hatMat = mat(a.hatColor);
    head.add(mesh(G.beanie, hatMat, 0, 0.03, -0.01));
    head.add(mesh(G.pom, mat('#fff6e8'), 0, 0.21, -0.02));
  }

  const tools = {
    axe: buildTool('axe'),
    pickaxe: buildTool('pickaxe'),
    saw: buildTool('saw'),
    shovel: buildTool('shovel'),
    ladle: buildTool('ladle'),
    book: buildTool('book'),
    hammer: buildTool('hammer'),
  } as Record<ToolId, THREE.Object3D>;
  for (const t of Object.values(tools)) {
    t.position.set(0, -0.22, 0.02);
    armR.add(t);
  }
  // The book is held in front with both hands.
  armR.remove(tools.book);
  tools.book.position.set(0, 0.36, 0.2);
  body.add(tools.book);

  const loads = buildLoads();
  body.add(loads.timber, loads.clay);

  const hitbox = new THREE.Mesh(G.hit, new THREE.MeshBasicMaterial({ visible: false }));
  hitbox.position.y = 0.55;
  root.add(hitbox);

  // One vertex-coloured mesh per animated pivot keeps each villager to a handful of draw calls.
  const torsoMerged = mergeParts(body, [torso, belt]);
  for (const pivot of [head, armL, armR, legL, legR]) mergeParts(pivot, pivot.children.filter((c) => (c as THREE.Mesh).isMesh) as THREE.Mesh[]);

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== hitbox) (o as THREE.Mesh).castShadow = true;
  });
  return { root, body, torso: torsoMerged, head, armL, armR, legL, legR, tools, loads, hitbox };
}

const partMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

/** Replaces the given child meshes of `parent` with a single merged, vertex-coloured mesh. */
function mergeParts(parent: THREE.Object3D, meshes: THREE.Mesh[]): THREE.Mesh {
  const geos: THREE.BufferGeometry[] = [];
  for (const m of meshes) {
    m.updateMatrix();
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const c = (m.material as THREE.MeshLambertMaterial).color;
    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geos.push(g);
    parent.remove(m);
  }
  const merged = new THREE.Mesh(mergeGeometries(geos, false)!, partMaterial);
  geos.forEach((g) => g.dispose());
  merged.castShadow = true;
  parent.add(merged);
  return merged;
}

const farMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/**
 * Distant-LOD villager: one low-poly, vertex-coloured mesh (a single draw call instead
 * of the rig's ~8) that keeps the silhouette and colours readable from far away.
 */
export function createVillagerFarMesh(a: Appearance): THREE.Mesh {
  const part = (geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number): THREE.BufferGeometry => {
    geo.translate(x, y, z);
    return paint(geo, color);
  };
  const cap = a.hat === 0 ? a.hair : a.hatColor;
  const parts = [
    part(new THREE.CylinderGeometry(0.1, 0.12, 0.26, 6), a.trousers, 0, 0.13, 0),
    part(new THREE.CylinderGeometry(0.13, 0.17, 0.32, 6), a.shirt, 0, 0.4, 0),
    part(new THREE.IcosahedronGeometry(0.17, 1), a.skin, 0, 0.69, 0),
    part(new THREE.SphereGeometry(0.185, 7, 3, 0, Math.PI * 2, 0, Math.PI * 0.5), cap, 0, 0.71, -0.01),
  ];
  if (a.hat === 1) parts.push(part(new THREE.CylinderGeometry(0.29, 0.3, 0.03, 8), PALETTE.thatch, 0, 0.81, 0));
  const geo = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, farMaterial);
  mesh.castShadow = true;
  mesh.visible = false;
  return mesh;
}
