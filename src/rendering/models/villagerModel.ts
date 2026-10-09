import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ToolId } from '../../config/jobs';
import type { Appearance } from '../../config/villagers';
import { PALETTE, mat, paint } from '../materials';

/** Job clothing, shown only while the villager does that kind of work. */
export type Accessory = 'apron' | 'leatherApron' | 'satchel' | 'toolBelt';

/**
 * A chunky, friendly villager built from primitives and drawn as one skinned mesh:
 * every part is rigidly bound to a bone, so the whole body is a single draw call
 * while the animation layer bends elbows and knees, blinks the eyelids, opens the
 * mouth and swings the hair. Hidden details (eyelids, job aprons) are bones scaled
 * to nothing until needed. Tools and carried loads are separate small meshes on the
 * hand and body bones. There is no skeletal animation to load: poses are procedural.
 */
export interface VillagerRig {
  root: THREE.Group;
  /** The skinned body (one draw call). */
  mesh: THREE.SkinnedMesh;
  /** Hips level: bobs, leans and crouches. Tools and loads hang off its children. */
  body: THREE.Bone;
  spine: THREE.Bone;
  head: THREE.Bone;
  armL: THREE.Bone;
  armR: THREE.Bone;
  elbowL: THREE.Bone;
  elbowR: THREE.Bone;
  legL: THREE.Bone;
  legR: THREE.Bone;
  kneeL: THREE.Bone;
  kneeR: THREE.Bone;
  /** Eyelids: scale y 0 = open, 1 = shut. */
  lids: THREE.Bone;
  /** Mouth: scale y ≈ 1 closed smile, larger = open (talking, yawning). */
  mouth: THREE.Bone;
  /** Bun, ponytails or long hair: swings with movement. */
  hair: THREE.Bone;
  accessories: Record<Accessory, THREE.Bone>;
  tools: Record<ToolId, THREE.Object3D>;
  loads: { timber: THREE.Object3D; clay: THREE.Object3D; grain: THREE.Object3D };
  hitbox: THREE.Mesh;
}

/** Bone-local lengths shared with the animation layer (hip → knee → sole, shoulder → elbow → hand). */
export const RIG = { hipHeight: 0.25, thigh: 0.115, shin: 0.135, upperArm: 0.115, forearm: 0.105 } as const;

const G = {
  thigh: new THREE.CapsuleGeometry(0.054, 0.05, 3, 8),
  shin: new THREE.CapsuleGeometry(0.05, 0.045, 3, 8),
  foot: new THREE.BoxGeometry(0.1, 0.06, 0.15),
  upperArm: new THREE.CapsuleGeometry(0.047, 0.06, 3, 8),
  forearm: new THREE.CapsuleGeometry(0.043, 0.05, 3, 8),
  hand: new THREE.SphereGeometry(0.048, 8, 6),
  head: new THREE.SphereGeometry(0.17, 18, 14),
  eye: new THREE.SphereGeometry(0.022, 8, 6),
  lid: new THREE.SphereGeometry(0.0265, 8, 6),
  cheek: new THREE.SphereGeometry(0.03, 8, 6),
  nose: new THREE.SphereGeometry(0.028, 8, 6),
  mouth: new THREE.SphereGeometry(0.022, 10, 6),
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
    case 'hoe': {
      g.add(mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.62, 6), handle, 0, -0.25, 0));
      const blade = mesh(new THREE.BoxGeometry(0.14, 0.02, 0.09), metal, 0, -0.56, 0.05);
      blade.rotation.x = 0.35;
      g.add(blade);
      break;
    }
    case 'sickle': {
      g.add(mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.14, 6), handle, 0, -0.06, 0));
      const blade = mesh(new THREE.TorusGeometry(0.12, 0.014, 4, 12, Math.PI * 1.1), mat('#cfd6df', { flat: true }), 0, -0.14, 0.12);
      blade.rotation.set(Math.PI / 2, 0, -Math.PI / 2);
      g.add(blade);
      break;
    }
    case 'seeds': {
      const pouch = mesh(new THREE.SphereGeometry(0.08, 8, 6), mat('#cdb487'), 0, -0.04, 0.03);
      pouch.scale.set(1, 0.8, 1);
      g.add(pouch);
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.04, 6), mat(PALETTE.woodDark), 0, 0.03, 0.03));
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

function buildLoads(): { timber: THREE.Object3D; clay: THREE.Object3D; grain: THREE.Object3D } {
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

  // A tied sheaf of grain carried across both arms.
  const grain = new THREE.Group();
  const straw = mat(PALETTE.thatch, { flat: true });
  const sheaf = mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.5, 8), straw, 0, 0, 0);
  sheaf.rotation.z = Math.PI / 2;
  const ears = mesh(new THREE.ConeGeometry(0.14, 0.2, 8), mat('#e6c25a', { flat: true }), 0.33, 0, 0);
  ears.rotation.z = -Math.PI / 2;
  const band = mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.05, 8), mat(PALETTE.woodDark), 0, 0, 0);
  band.rotation.z = Math.PI / 2;
  grain.add(sheaf, ears, band);
  grain.position.set(0, 1.02, 0.04);
  grain.visible = false;
  return { timber, clay, grain };
}

/**
 * How each tool sits in the fist, as a tilt from "along the forearm": negative points
 * it ahead of the knuckles (an axe or hammer handle), positive back towards the body
 * (a ladle dipping into the pot when the forearm reaches forward).
 */
const GRIP: Record<ToolId, number> = { axe: -1.35, pickaxe: -1.35, hoe: -1.25, hammer: -1.4, sickle: -1.3, saw: -0.9, shovel: 0.55, ladle: 1.2, seeds: 0, book: 0 };

/** A bone at a local position, attached to its parent. */
function bone(parent: THREE.Object3D | null, x: number, y: number, z: number, name: string): THREE.Bone {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, z);
  parent?.add(b);
  return b;
}

const skinMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });

/** Scale that hides a bone's parts (collapsed to its origin, inside the body). */
export const HIDDEN = 1e-4;

export function createVillagerRig(a: Appearance): VillagerRig {
  const root = new THREE.Group();
  const skin = mat(a.skin);
  const shirt = mat(a.shirt);
  const trousers = mat(a.trousers);
  const hair = mat(a.hair);
  const shoe = mat(PALETTE.barkDark);

  // Skeleton, in the bind pose. Parts are first attached to bones as ordinary meshes,
  // then baked into one skinned geometry below.
  const body = bone(null, 0, 0, 0, 'body');
  const makeLeg = (x: number, side: string): [THREE.Bone, THREE.Bone] => {
    const hip = bone(body, x, RIG.hipHeight, 0, `hip${side}`);
    hip.add(mesh(G.thigh, trousers, 0, -0.05, 0));
    const knee = bone(hip, 0, -RIG.thigh, 0, `knee${side}`);
    knee.add(mesh(G.shin, trousers, 0, -0.045, 0));
    knee.add(mesh(G.foot, shoe, 0, -0.105, 0.025));
    return [hip, knee];
  };
  const [legL, kneeL] = makeLeg(-0.075, 'L');
  const [legR, kneeR] = makeLeg(0.075, 'R');

  const spine = bone(body, 0, 0.2, 0, 'spine');
  spine.add(mesh(torsoGeometry, shirt, 0, 0, 0));
  const belt = mesh(G.belt, mat(PALETTE.woodDark), 0, 0.07, 0);
  belt.rotation.x = Math.PI / 2;
  spine.add(belt);

  const makeArm = (x: number, side: string): [THREE.Bone, THREE.Bone] => {
    const shoulder = bone(spine, x, 0.26, 0, `shoulder${side}`);
    shoulder.add(mesh(G.upperArm, shirt, 0, -0.055, 0));
    const elbow = bone(shoulder, 0, -RIG.upperArm, 0, `elbow${side}`);
    elbow.add(mesh(G.forearm, shirt, 0, -0.04, 0));
    elbow.add(mesh(G.hand, skin, 0, -RIG.forearm, 0));
    return [shoulder, elbow];
  };
  const [armL, elbowL] = makeArm(-0.19, 'L');
  const [armR, elbowR] = makeArm(0.19, 'R');

  const head = bone(spine, 0, 0.49, 0, 'head');
  head.add(mesh(G.head, skin));
  const eyeMat = mat('#2b2a3a');
  head.add(mesh(G.eye, eyeMat, -0.06, 0.02, 0.155), mesh(G.eye, eyeMat, 0.06, 0.02, 0.155));
  // Eye shines make the face read at a distance.
  const shine = mat('#ffffff');
  head.add(mesh(new THREE.SphereGeometry(0.007, 6, 4), shine, -0.053, 0.03, 0.174), mesh(new THREE.SphereGeometry(0.007, 6, 4), shine, 0.067, 0.03, 0.174));
  const blush = mat('#f19a8f');
  const cheekL = mesh(G.cheek, blush, -0.1, -0.04, 0.125);
  const cheekR = mesh(G.cheek, blush, 0.1, -0.04, 0.125);
  cheekL.scale.set(1, 0.6, 0.5);
  cheekR.scale.set(1, 0.6, 0.5);
  head.add(cheekL, cheekR);
  head.add(mesh(G.nose, skin, 0, -0.015, 0.17));

  // Eyelids (skin-coloured caps over the eyes) live on their own bone, collapsed until a blink.
  const lids = bone(head, 0, 0.02, 0.15, 'lids');
  for (const x of [-0.06, 0.06]) {
    const lid = mesh(G.lid, skin, x, 0.004, 0.006);
    lid.scale.set(1.05, 1, 0.9);
    lids.add(lid);
  }
  const mouth = bone(head, 0, -0.072, 0.152, 'mouth');
  const lips = mesh(G.mouth, mat('#7a3b34'), 0, 0, 0);
  lips.scale.set(1.25, 0.32, 0.55);
  mouth.add(lips);

  const cap = mesh(G.hairCap, hair, 0, 0.012, -0.012);
  cap.rotation.x = -0.25;
  head.add(cap);
  const hairBone = bone(head, 0, 0.06, -0.12, 'hair');
  switch (a.hairStyle) {
    case 1:
      hairBone.add(mesh(G.bun, hair, 0, 0.06, -0.02));
      break;
    case 2: {
      const back = mesh(G.longHair, hair, 0, -0.14, 0.02);
      back.scale.set(1.1, 1, 0.7);
      hairBone.add(back);
      break;
    }
    case 3:
      hairBone.add(mesh(G.tail, hair, -0.17, -0.11, 0.08), mesh(G.tail, hair, 0.17, -0.11, 0.08));
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

  // Job clothing: each on a bone at the chest's centre, hidden until that job.
  const accessory = (name: Accessory): THREE.Bone => bone(spine, 0, 0.12, 0, name);
  const accessories: Record<Accessory, THREE.Bone> = {
    apron: accessory('apron'),
    leatherApron: accessory('leatherApron'),
    satchel: accessory('satchel'),
    toolBelt: accessory('toolBelt'),
  };
  // Aprons wrap the front of the body: a curved bib over the chest and a flared skirt below the belt.
  const apronParts = (b: THREE.Bone, color: string, strap: string) => {
    const cloth = mat(color, { side: THREE.DoubleSide });
    const front = (r0: number, r1: number, h: number, arc: number) => new THREE.CylinderGeometry(r0, r1, h, 12, 1, true, -arc / 2, arc);
    // Spine-local heights: the bone sits 0.12 up the torso.
    b.add(mesh(front(0.166, 0.188, 0.15, 1.5), cloth, 0, 0.0, 0.004));
    b.add(mesh(front(0.18, 0.215, 0.2, 1.9), cloth, 0, -0.18, 0.004));
    const tie = mesh(new THREE.TorusGeometry(0.168, 0.012, 4, 18), mat(strap), 0, -0.05, 0);
    tie.rotation.x = Math.PI / 2;
    // Neck strap.
    const neck = mesh(new THREE.TorusGeometry(0.075, 0.01, 4, 12, Math.PI), mat(strap), 0, 0.075, 0.07);
    neck.rotation.x = -0.6;
    b.add(tie, neck);
  };
  apronParts(accessories.apron, '#f6f1e6', '#d9cbb0');
  apronParts(accessories.leatherApron, '#8a5a3b', '#5c3a24');
  {
    const strap = mesh(new THREE.TorusGeometry(0.2, 0.012, 4, 24), mat('#6b4a2e'), 0, 0.02, 0);
    strap.rotation.set(0, Math.PI / 2, 0.75);
    const bag = mesh(new THREE.BoxGeometry(0.06, 0.13, 0.15), mat('#9a6a3e'), 0.17, -0.12, 0.02);
    const flap = mesh(new THREE.BoxGeometry(0.065, 0.05, 0.155), mat('#7d5230'), 0.172, -0.07, 0.02);
    accessories.satchel.add(strap, bag, flap);
  }
  {
    const strap = mesh(new THREE.TorusGeometry(0.162, 0.02, 4, 20), mat('#5c3a24'), 0, -0.06, 0);
    strap.rotation.x = Math.PI / 2;
    const pouchMat = mat('#9a6a3e');
    accessories.toolBelt.add(strap, mesh(new THREE.BoxGeometry(0.07, 0.07, 0.05), pouchMat, 0.11, -0.09, 0.12), mesh(new THREE.BoxGeometry(0.06, 0.06, 0.05), pouchMat, -0.12, -0.09, 0.11));
    // A spare hammer handle poking out of the pouch.
    accessories.toolBelt.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 5), mat(PALETTE.woodLight), 0.13, -0.04, 0.13));
  }

  root.add(body);
  const bones = [body, legL, kneeL, legR, kneeR, spine, armL, elbowL, armR, elbowR, head, lids, mouth, hairBone, ...Object.values(accessories)];
  const skinned = bakeSkin(root, bones);
  for (const b of [lids, ...Object.values(accessories)]) b.scale.setScalar(HIDDEN);

  // Tools are held in the right hand; the book in front with both hands.
  const tools = {
    axe: buildTool('axe'),
    pickaxe: buildTool('pickaxe'),
    hoe: buildTool('hoe'),
    sickle: buildTool('sickle'),
    seeds: buildTool('seeds'),
    saw: buildTool('saw'),
    shovel: buildTool('shovel'),
    ladle: buildTool('ladle'),
    book: buildTool('book'),
    hammer: buildTool('hammer'),
  } as Record<ToolId, THREE.Object3D>;
  for (const [id, t] of Object.entries(tools) as [ToolId, THREE.Object3D][]) {
    t.position.set(0, -RIG.forearm, 0.02);
    t.rotation.x = GRIP[id];
    elbowR.add(t);
  }
  elbowR.remove(tools.book);
  tools.book.position.set(0, 0.16, 0.2);
  spine.add(tools.book);

  const loads = buildLoads();
  body.add(loads.timber, loads.clay, loads.grain);

  const hitbox = new THREE.Mesh(G.hit, new THREE.MeshBasicMaterial({ visible: false }));
  hitbox.position.y = 0.55;
  root.add(hitbox);

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== hitbox) (o as THREE.Mesh).castShadow = true;
  });
  return { root, mesh: skinned, body, spine, head, armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR, lids, mouth, hair: hairBone, accessories, tools, loads, hitbox };
}

/**
 * Bakes every mesh hanging off the bones into one vertex-coloured skinned mesh, each
 * vertex bound wholly to the bone its part hangs from. The part meshes are removed.
 */
function bakeSkin(root: THREE.Group, bones: THREE.Bone[]): THREE.SkinnedMesh {
  root.updateMatrixWorld(true);
  const index = new Map(bones.map((b, i) => [b as THREE.Object3D, i]));
  const geos: THREE.BufferGeometry[] = [];
  const parts: THREE.Mesh[] = [];
  for (const b of bones) {
    for (const child of b.children) {
      const m = child as THREE.Mesh;
      if (!m.isMesh) continue;
      const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      const c = (m.material as THREE.MeshLambertMaterial).color;
      const count = g.attributes.position.count;
      const colors = new Float32Array(count * 3);
      const skinIndex = new Uint16Array(count * 4);
      const skinWeight = new Float32Array(count * 4);
      const bi = index.get(b)!;
      for (let i = 0; i < count; i++) {
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
        skinIndex[i * 4] = bi;
        skinWeight[i * 4] = 1;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
      geos.push(g);
      parts.push(m);
    }
  }
  for (const m of parts) m.removeFromParent();
  const geo = mergeGeometries(geos, false)!;
  geos.forEach((g) => g.dispose());
  const skinned = new THREE.SkinnedMesh(geo, skinMaterial);
  skinned.castShadow = true;
  // Poses move parts well outside the bind-pose bounds; villagers are small, so skip culling.
  skinned.frustumCulled = false;
  root.add(skinned);
  root.updateMatrixWorld(true);
  skinned.bind(new THREE.Skeleton(bones));
  return skinned;
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
