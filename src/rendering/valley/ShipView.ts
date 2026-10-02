import * as THREE from 'three';
import { MERCHANTS } from '../../config/trade';
import type { MerchantShip } from '../../sim/types';
import { WATER_LEVEL } from '../../world/terrain';
import { PALETTE, mat } from '../materials';
import { box, cyl } from '../models/buildingModels';

/** Where ships tie up (beside the Trading Post pier) and where they appear from. */
const BERTH = new THREE.Vector3(22.7, 0, 108.6);
const OFFING = new THREE.Vector3(10, 0, 128);
const SAIL_SECONDS = 6;

function hullShape(length: number, beam: number): THREE.Shape {
  const s = new THREE.Shape();
  const h = length / 2;
  const w = beam / 2;
  s.moveTo(-w * 0.8, -h);
  s.lineTo(w * 0.8, -h);
  s.quadraticCurveTo(w, -h * 0.4, w, 0.1 * h);
  s.quadraticCurveTo(w * 0.9, h * 0.65, 0, h);
  s.quadraticCurveTo(-w * 0.9, h * 0.65, -w, 0.1 * h);
  s.quadraticCurveTo(-w, -h * 0.4, -w * 0.8, -h);
  return s;
}

/** A small two-masted merchant ship; the sails wear the merchant's colour. */
function createShip(color: string): { root: THREE.Group; sails: THREE.Object3D[]; flag: THREE.Object3D } {
  const root = new THREE.Group();
  const hull = new THREE.ExtrudeGeometry(hullShape(6, 2.2), { depth: 1.0, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.12, bevelSegments: 2, curveSegments: 10 });
  hull.rotateX(Math.PI / 2);
  hull.translate(0, 0.45, 0);
  const hullMesh = new THREE.Mesh(hull, mat(PALETTE.woodDark, { flat: true }));
  root.add(hullMesh);
  const deck = new THREE.Mesh(new THREE.ShapeGeometry(hullShape(5.6, 1.9)), mat(PALETTE.woodLight));
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = 0.5;
  root.add(deck);
  box(root, 2.3, 0.08, 0.1, mat(color), 0, 0.2, 1.0).rotation.y = Math.PI / 2;
  // Cabin at the stern.
  box(root, 1.3, 0.6, 1.1, mat(PALETTE.wood), 0, 0.8, -2.0);
  box(root, 1.45, 0.08, 1.25, mat(PALETTE.woodDark), 0, 1.12, -2.0);
  // Cargo on deck.
  for (const [x, z] of [[-0.4, 0.6], [0.35, 0.3], [0, -0.7]]) box(root, 0.45, 0.4, 0.45, mat(PALETTE.wood), x, 0.7, z);
  const sails: THREE.Object3D[] = [];
  for (const [z, h] of [[1.2, 3.4], [-0.6, 4.2]] as const) {
    cyl(root, 0.06, 0.08, h, mat(PALETTE.barkDark), 0, 0.5 + h / 2, z, 6);
    const yard = cyl(root, 0.04, 0.04, 1.9, mat(PALETTE.barkDark), 0, 0.5 + h - 0.35, z + 0.08, 6);
    yard.rotation.z = Math.PI / 2;
    const sail = new THREE.Group();
    sail.position.set(0, 0.5 + h - 0.4, z + 0.12);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.8, h * 0.62, 4, 4), mat('#fff8ea', { side: THREE.DoubleSide }));
    const pos = cloth.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, 0.25 * (1 - (x / 0.9) ** 2));
    }
    cloth.geometry.computeVertexNormals();
    cloth.position.y = -h * 0.31;
    sail.add(cloth);
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(1.82, 0.28), mat(color, { side: THREE.DoubleSide }));
    stripe.position.set(0, -h * 0.31, 0.26);
    sail.add(stripe);
    root.add(sail);
    sails.push(sail);
  }
  const flag = new THREE.Group();
  flag.position.set(0, 4.75, -0.6);
  box(flag, 0.02, 0.24, 0.5, mat(color, { side: THREE.DoubleSide }), 0, 0, -0.25);
  root.add(flag);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { root, sails, flag };
}

/**
 * The player's current merchant ship at Saltreach Harbour. Ships sail in from the
 * open bay when they arrive and out again when they leave; in between they bob at
 * the berth beside the Trading Post pier.
 */
export class ShipView {
  readonly group = new THREE.Group();
  readonly hitbox: THREE.Mesh;
  private ship: ReturnType<typeof createShip> | null = null;
  private shipId: number | null = null;
  private phase: 'in' | 'moored' | 'out' = 'moored';
  private t = 0;

  constructor() {
    this.hitbox = new THREE.Mesh(new THREE.BoxGeometry(2.4, 5, 6.4), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = 2;
    this.hitbox.userData.valleyBuilding = 'tradingPost';
  }

  update(dt: number, realTime: number, ship: MerchantShip | null): void {
    if (ship && ship.id !== this.shipId) {
      this.remove();
      this.ship = createShip(MERCHANTS[ship.merchant].color);
      this.ship.root.add(this.hitbox);
      this.group.add(this.ship.root);
      this.shipId = ship.id;
      this.phase = 'in';
      this.t = 0;
    } else if (!ship && this.ship && this.phase !== 'out') {
      this.phase = 'out';
      this.t = 0;
    }
    if (!this.ship) return;
    this.t += dt;
    const k = Math.min(1, this.t / SAIL_SECONDS);
    const ease = k * k * (3 - 2 * k);
    const root = this.ship.root;
    if (this.phase === 'in') {
      root.position.lerpVectors(OFFING, BERTH, ease);
      if (k >= 1) this.phase = 'moored';
    } else if (this.phase === 'out') {
      root.position.lerpVectors(BERTH, OFFING, ease);
      if (k >= 1) {
        this.remove();
        return;
      }
    } else root.position.copy(BERTH);
    const heading = this.phase === 'in' ? Math.atan2(BERTH.x - OFFING.x, BERTH.z - OFFING.z) : this.phase === 'out' ? Math.atan2(OFFING.x - BERTH.x, OFFING.z - BERTH.z) : Math.PI;
    root.rotation.y = this.phase === 'moored' ? Math.PI : heading;
    root.position.y = WATER_LEVEL - 0.25 + Math.sin(realTime * 1.3) * 0.05;
    root.rotation.z = Math.sin(realTime * 0.9) * 0.025;
    root.rotation.x = Math.sin(realTime * 0.7 + 1) * 0.015;
    const furled = this.phase === 'moored' ? 0.35 : 1;
    for (const s of this.ship.sails) s.scale.y += (furled - s.scale.y) * Math.min(1, dt * 2);
    this.ship.flag.rotation.y = Math.sin(realTime * 3) * 0.3;
  }

  get pickables(): THREE.Object3D[] {
    return this.ship && this.phase === 'moored' ? [this.hitbox] : [];
  }

  private remove(): void {
    if (!this.ship) return;
    this.group.remove(this.ship.root);
    this.ship.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh !== this.hitbox) mesh.geometry.dispose();
    });
    this.ship = null;
    this.shipId = null;
  }
}
