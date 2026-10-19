import * as THREE from 'three';
import { mat } from './materials';
import { readyRequests } from '../sim/requests';
import { findPath } from '../sim/pathfinding';
import { buildingCenter } from '../sim/grid';
import type { World } from '../sim/world';
import type { GameState, Vec2 } from '../sim/types';
import type { Particles } from './Particles';

const SPEED = 2.8;

type Phase = 'arriving' | 'parked' | 'leaving';

interface Cart {
  requestId: number;
  node: THREE.Group;
  donkey: THREE.Group;
  wheels: THREE.Object3D[];
  legs: THREE.Object3D[];
  path: THREE.Vector3[];
  along: number;
  phase: Phase;
  spot: number;
  /** Seconds before it sets off (carts arriving together come one behind another). */
  wait: number;
}

/**
 * Visitor carts: each request on the board arrives in person. When a request appears, a little
 * donkey cart rolls in along the road and parks near the Cookhouse; when it's delivered or
 * turned down, the cart heads back out the way it came. Purely a picture of the requests board —
 * tapping a cart opens it.
 */
export class CartsView {
  readonly group = new THREE.Group();
  private readonly carts = new Map<number, Cart>();
  private entry: Vec2 | null = null;
  private parking: Vec2[] = [];
  private first = true;
  private routeIn = 0;
  /** A cart reached its spot (a new request has come in person). */
  onArrive: ((at: THREE.Vector3) => void) | null = null;

  constructor(
    private readonly world: World,
    private readonly particles: Particles,
  ) {
    this.group.name = 'Carts';
  }

  /** The request whose cart is under this ground point, if any. */
  cartAt(x: number, z: number): number | null {
    for (const c of this.carts.values()) if (c.phase !== 'leaving' && c.wait <= 0 && Math.hypot(c.node.position.x - x, c.node.position.z - z) < 1.1) return c.requestId;
    return null;
  }

  /** Parked carts and where they stand (for their bubbles). */
  parked(): { requestId: number; at: THREE.Vector3 }[] {
    return [...this.carts.values()].filter((c) => c.phase === 'parked').map((c) => ({ requestId: c.requestId, at: c.node.position }));
  }

  private ground(p: Vec2): THREE.Vector3 {
    return new THREE.Vector3(p.x, this.world.terrain.groundHeightAt(p.x, p.z), p.z);
  }

  private route(from: Vec2, to: Vec2): THREE.Vector3[] | null {
    return findPath(this.world.grid, from, to)?.map((p) => this.ground(p)) ?? null;
  }

  update(state: GameState, dt: number, time: number): void {
    const ready = new Set(readyRequests(state).map((r) => r.id));
    if ((ready.size > 0 || this.carts.size > 0) && (this.routeIn -= dt) <= 0) {
      this.routeIn = 3;
      this.ensureRoute(state);
    }
    for (const c of this.carts.values()) {
      if (ready.has(c.requestId) || c.phase === 'leaving') continue;
      c.phase = 'leaving';
      c.path = (this.entry && this.route({ x: c.node.position.x, z: c.node.position.z }, this.entry)) || [c.node.position.clone()];
      c.along = 0;
    }
    for (const id of ready) {
      if (this.carts.has(id) || !this.entry) continue;
      const spot = this.parking.findIndex((_, i) => ![...this.carts.values()].some((c) => c.spot === i && c.phase !== 'leaving'));
      if (spot < 0) continue;
      const good = Object.keys(state.requests?.slots.find((r) => r.id === id)?.wants ?? {})[0];
      const cart = build(id, good);
      cart.spot = spot;
      const path = this.first ? null : this.route(this.entry, this.parking[spot]);
      if (!path || path.length < 2) {
        cart.phase = 'parked';
        cart.node.position.copy(this.ground(this.parking[spot]));
        cart.node.rotation.y = spot * 1.3;
      } else {
        cart.phase = 'arriving';
        cart.path = path;
        cart.node.position.copy(path[0]);
        cart.wait = 1.8 * [...this.carts.values()].filter((c) => c.phase === 'arriving' && (c.wait > 0 || c.along < 5)).length;
        cart.node.visible = cart.wait <= 0;
      }
      this.group.add(cart.node);
      this.carts.set(id, cart);
    }
    this.first = false;
    for (const c of [...this.carts.values()]) this.move(c, dt, time);
  }

  private move(c: Cart, dt: number, time: number): void {
    if (c.wait > 0) {
      c.wait -= dt;
      c.node.visible = c.wait <= 0;
      return;
    }
    const moving = c.phase !== 'parked' && c.path.length > 1;
    if (moving) {
      c.along += SPEED * dt;
      let left = c.along;
      let i = 0;
      while (i < c.path.length - 1 && left > c.path[i].distanceTo(c.path[i + 1])) {
        left -= c.path[i].distanceTo(c.path[i + 1]);
        i++;
      }
      if (i >= c.path.length - 1) {
        c.node.position.copy(c.path[c.path.length - 1]);
        if (c.phase === 'leaving') {
          this.group.remove(c.node);
          this.carts.delete(c.requestId);
          return;
        }
        c.phase = 'parked';
        this.particles.emit('dust', c.node.position.clone().add(new THREE.Vector3(0, 0.2, 0)), 6, 0.5);
        this.onArrive?.(c.node.position);
      } else {
        const a = c.path[i];
        const b = c.path[i + 1];
        c.node.position.lerpVectors(a, b, left / Math.max(0.001, a.distanceTo(b)));
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        if (dx * dx + dz * dz > 1e-4) c.node.rotation.y = Math.atan2(dx, dz);
      }
    }
    // Wheels roll and the donkey's legs step while moving; parked, it shuffles now and then.
    const spin = moving ? (SPEED * dt) / 0.28 : 0;
    for (const w of c.wheels) w.rotateX(spin);
    c.legs.forEach((leg, k) => (leg.rotation.x = moving ? Math.sin(time * 9 + k * Math.PI) * 0.45 : 0));
    c.donkey.position.y = moving ? Math.abs(Math.sin(time * 9)) * 0.04 : 0;
    c.donkey.rotation.y = moving ? 0 : Math.sin(time * 0.7 + c.requestId) * 0.08;
  }

  /** Where carts come from (the road a little way out) and where they park (open road a few steps from the Cookhouse). */
  private ensureRoute(state: GameState): void {
    const g = this.world.grid;
    const kitchen = state.buildings.find((b) => b.defId === 'cookhouse');
    const heart = kitchen ? buildingCenter(kitchen) : { x: g.width / 2, z: g.height / 2 };
    const open = (p: Vec2) => g.walkable(Math.floor(p.x), Math.floor(p.z));
    if (this.parking.length === 3 && this.parking.every(open) && this.entry && open(this.entry)) return;
    const road: { p: Vec2; d: number }[] = [];
    for (let cz = 1; cz < g.height - 1; cz++)
      for (let cx = 1; cx < g.width - 1; cx++) {
        if (!g.walkable(cx, cz) || this.world.terrain.pathAt(cx + 0.5, cz + 0.5) < 0.5) continue;
        const p = { x: cx + 0.5, z: cz + 0.5 };
        road.push({ p, d: Math.hypot(p.x - heart.x, p.z - heart.z) });
      }
    if (road.length === 0) return;
    const near = road.filter((r) => r.d <= 24);
    this.entry = (near.length > 0 ? near : road).reduce((a, b) => (b.d > a.d ? b : a)).p;
    this.parking = [];
    for (const { p } of road.filter((r) => r.d > 4.5 && r.d < 10).sort((a, b) => a.d - b.d)) {
      if (this.parking.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 2.6)) continue;
      if (!findPath(g, this.entry, p)) continue;
      this.parking.push(p);
      if (this.parking.length === 3) break;
    }
  }
}

function box(g: THREE.Object3D, w: number, h: number, d: number, color: string, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
  return m;
}

function cyl(g: THREE.Object3D, rt: number, rb: number, h: number, color: string, x: number, y: number, z: number, seg = 8): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  g.add(m);
  return m;
}

const CRATES: Record<string, string> = { timber: '#b07a4b', clay: '#c97b4f', stone: '#a9a08f', planks: '#d9a865', bricks: '#b5543c', grain: '#e2b85c' };
const CANOPIES = ['#d9544a', '#4f9fe3', '#f3a447', '#5fae4f', '#b061d6'];

/** A handcart with a striped canopy and a crate of what's wanted, drawn by a donkey (facing +z). */
function build(requestId: number, good: string | undefined): Cart {
  const node = new THREE.Group();
  const canopy = CANOPIES[requestId % CANOPIES.length];
  box(node, 0.9, 0.08, 1.1, '#b07a4b', 0, 0.42, 0);
  for (const x of [-0.45, 0.45]) box(node, 0.05, 0.22, 1.1, '#8a5a3b', x, 0.55, 0);
  box(node, 0.9, 0.22, 0.05, '#8a5a3b', 0, 0.55, -0.55);
  for (const x of [-0.28, 0.28]) box(node, 0.05, 0.05, 0.9, '#7a5234', x, 0.4, 0.9).rotation.x = 0.12;
  for (const [x, z] of [[-0.42, -0.5], [0.42, -0.5], [-0.42, 0.45], [0.42, 0.45]]) cyl(node, 0.02, 0.02, 0.7, '#7a5234', x, 0.8, z, 6);
  box(node, 1.0, 0.05, 1.15, canopy, 0, 1.17, 0);
  box(node, 1.02, 0.06, 0.16, '#fff8ea', 0, 1.18, 0.1);
  box(node, 0.42, 0.3, 0.42, CRATES[good ?? ''] ?? '#c9a978', 0.1, 0.62, -0.15).rotation.y = 0.3;
  box(node, 0.3, 0.22, 0.3, '#e6cd9f', -0.2, 0.58, 0.25).rotation.y = -0.2;
  const wheels: THREE.Object3D[] = [];
  for (const x of [-0.5, 0.5]) {
    const hub = new THREE.Group();
    hub.position.set(x, 0.28, -0.05);
    cyl(hub, 0.28, 0.28, 0.06, '#7a5234', 0, 0, 0, 12).rotation.z = Math.PI / 2;
    box(hub, 0.07, 0.5, 0.05, '#b07a4b', 0, 0, 0);
    node.add(hub);
    wheels.push(hub);
  }
  const donkey = new THREE.Group();
  donkey.position.set(0, 0, 1.05);
  node.add(donkey);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.36, 4, 10), mat('#9c8c7c'));
  body.rotation.x = Math.PI / 2;
  body.position.set(0, 0.58, 0);
  body.castShadow = true;
  donkey.add(body);
  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.18, 3, 8), mat('#9c8c7c'));
  neck.rotation.x = 0.7;
  neck.position.set(0, 0.8, 0.36);
  donkey.add(neck);
  box(donkey, 0.14, 0.13, 0.24, '#8a7a6a', 0, 0.93, 0.52);
  box(donkey, 0.12, 0.08, 0.08, '#e8e0d4', 0, 0.9, 0.64);
  for (const x of [-0.05, 0.05]) {
    const ear = box(donkey, 0.04, 0.2, 0.06, '#8a7a6a', x, 1.07, 0.46);
    ear.rotation.set(-0.25, 0, x * 3);
  }
  const legs: THREE.Object3D[] = [];
  for (const [x, z] of [[-0.1, 0.22], [0.1, -0.22], [0.1, 0.22], [-0.1, -0.22]]) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.48, z);
    cyl(hip, 0.035, 0.03, 0.46, '#7a6a5a', 0, -0.23, 0, 6);
    donkey.add(hip);
    legs.push(hip);
  }
  return { requestId, node, donkey, wheels, legs, path: [], along: 0, phase: 'parked', spot: 0, wait: 0 };
}
