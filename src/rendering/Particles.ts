import * as THREE from 'three';

export type ParticleKind = 'smoke' | 'steam' | 'dust' | 'sparkle' | 'chips' | 'clods' | 'rubble' | 'confetti' | 'leaves' | 'knowledge' | 'seeds' | 'soil' | 'chaff';

interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  grow: number;
  gravity: number;
  drag: number;
  spin: number;
  rot: number;
  color: THREE.Color;
}

interface Pool {
  mesh: THREE.InstancedMesh;
  items: Particle[];
  cursor: number;
}

const COLORS: Record<ParticleKind, string[]> = {
  smoke: ['#efeae2', '#e4ded4', '#f6f2ec'],
  steam: ['#ffffff', '#f4f8fb'],
  dust: ['#dcc49a', '#cfb487'],
  sparkle: ['#ffe07a', '#fff3b8', '#ffd24a'],
  chips: ['#d7a86e', '#b07a4b', '#8a5a3b'],
  clods: ['#c7643c', '#a84e2e', '#d0673f'],
  rubble: ['#a7adb7', '#8f97a3', '#c4c8cf'],
  confetti: ['#e86b8a', '#f2c14e', '#6fc3e0', '#8fd16b', '#b58be0'],
  leaves: ['#6fae4f', '#8cc265', '#5f9748'],
  knowledge: ['#9fb6ff', '#c9d6ff', '#7f9cf5'],
  seeds: ['#e6c25a', '#c9a040', '#f0d27a'],
  soil: ['#7a5a3a', '#8d6a45', '#5f4630'],
  chaff: ['#e2c26a', '#f0dc94', '#c8a24a'],
};

const PUFF_KINDS = new Set<ParticleKind>(['smoke', 'steam', 'dust']);

/**
 * Pooled, instanced particles in two shapes: soft low-poly puffs (smoke, steam, dust)
 * and small bits (chips, sparkles, confetti). Fading is done by shrinking, which suits
 * the chunky art style and keeps everything in two opaque draw calls.
 */
export class Particles {
  readonly group = new THREE.Group();
  private puffs: Pool;
  private bits: Pool;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();

  constructor(capacity = 420) {
    this.puffs = this.makePool(new THREE.IcosahedronGeometry(0.5, 1), capacity, false);
    this.bits = this.makePool(new THREE.BoxGeometry(0.1, 0.1, 0.1), capacity, true);
  }

  private makePool(geo: THREE.BufferGeometry, n: number, flat: boolean): Pool {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ flatShading: flat }), n);
    mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) mesh.setColorAt(i, new THREE.Color('#ffffff'));
    mesh.count = 0;
    this.group.add(mesh);
    const items: Particle[] = Array.from({ length: n }, () => ({
      alive: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      age: 0,
      life: 1,
      size: 0.1,
      grow: 0,
      gravity: 0,
      drag: 0,
      spin: 0,
      rot: 0,
      color: new THREE.Color(),
    }));
    return { mesh, items, cursor: 0 };
  }

  /** Share of requested particles actually spawned (reduced motion lowers it). */
  amount = 1;

  emit(kind: ParticleKind, at: THREE.Vector3, requested = 1, spread = 0.15): void {
    const count = requested <= 2 ? requested : Math.max(1, Math.round(requested * this.amount));
    const pool = PUFF_KINDS.has(kind) ? this.puffs : this.bits;
    const palette = COLORS[kind];
    for (let n = 0; n < count; n++) {
      const i = pool.cursor;
      pool.cursor = (pool.cursor + 1) % pool.items.length;
      const p = pool.items[i];
      p.alive = true;
      p.age = 0;
      p.pos.set(at.x + (Math.random() - 0.5) * spread, at.y + (Math.random() - 0.5) * spread * 0.5, at.z + (Math.random() - 0.5) * spread);
      p.rot = Math.random() * 6;
      p.spin = (Math.random() - 0.5) * 6;
      switch (kind) {
        case 'smoke':
          p.vel.set(0.12 + Math.random() * 0.08, 0.38 + Math.random() * 0.15, (Math.random() - 0.5) * 0.08);
          p.life = 3.2 + Math.random();
          p.size = 0.16;
          p.grow = 0.2;
          p.gravity = 0;
          p.drag = 0.2;
          break;
        case 'steam':
          p.vel.set((Math.random() - 0.5) * 0.1, 0.45 + Math.random() * 0.2, (Math.random() - 0.5) * 0.1);
          p.life = 1.3 + Math.random() * 0.4;
          p.size = 0.08;
          p.grow = 0.12;
          p.gravity = 0;
          p.drag = 0.4;
          break;
        case 'dust': {
          const a = Math.random() * Math.PI * 2;
          p.vel.set(Math.cos(a) * 0.9, 0.25 + Math.random() * 0.3, Math.sin(a) * 0.9);
          p.life = 0.7 + Math.random() * 0.4;
          p.size = 0.12;
          p.grow = 0.25;
          p.gravity = 0.2;
          p.drag = 2.5;
          break;
        }
        case 'sparkle':
        case 'knowledge':
          p.vel.set((Math.random() - 0.5) * 0.5, 0.8 + Math.random() * 0.6, (Math.random() - 0.5) * 0.5);
          p.life = 0.9 + Math.random() * 0.5;
          p.size = kind === 'knowledge' ? 0.7 : 0.6;
          p.grow = 0;
          p.gravity = -0.2;
          p.drag = 1.2;
          break;
        case 'confetti': {
          const a = Math.random() * Math.PI * 2;
          const sp = 1 + Math.random() * 1.8;
          p.vel.set(Math.cos(a) * sp, 3 + Math.random() * 2, Math.sin(a) * sp);
          p.life = 1.6 + Math.random() * 0.6;
          p.size = 0.8;
          p.grow = 0;
          p.gravity = 6;
          p.drag = 1.1;
          break;
        }
        case 'leaves':
        case 'chaff':
          p.vel.set((Math.random() - 0.5) * 0.8, 0.2 + Math.random() * 0.4, (Math.random() - 0.5) * 0.8);
          p.life = 1.4 + Math.random() * 0.6;
          p.size = 0.7;
          p.grow = 0;
          p.gravity = 0.8;
          p.drag = 1.6;
          break;
        default: {
          // chips / clods
          const a = Math.random() * Math.PI * 2;
          p.vel.set(Math.cos(a) * 1.2, 1.4 + Math.random() * 1.2, Math.sin(a) * 1.2);
          p.life = 0.6 + Math.random() * 0.4;
          p.size = kind === 'chips' ? 0.75 : kind === 'seeds' ? 0.45 : 0.9;
          p.grow = 0;
          p.gravity = 7;
          p.drag = 0.6;
        }
      }
      p.color.set(palette[Math.floor(Math.random() * palette.length)]);
    }
  }

  update(dt: number): void {
    this.step(this.puffs, dt, true);
    this.step(this.bits, dt, false);
  }

  private step(pool: Pool, dt: number, puff: boolean): void {
    // Live particles are packed into the first N instance slots so the GPU only draws those.
    let n = 0;
    for (const p of pool.items) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vel.multiplyScalar(k);
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (!puff && p.pos.y < -0.5) p.vel.y = Math.abs(p.vel.y) * 0.3;
      p.rot += p.spin * dt;
      const t = p.age / p.life;
      const size = puff ? (p.size + p.grow * t) * Math.min(1, t * 6) * (1 - Math.pow(t, 3)) : p.size * (1 - Math.pow(t, 4));
      this.e.set(p.rot, p.rot * 0.7, 0);
      this.q.setFromEuler(this.e);
      this.s.setScalar(Math.max(0, size));
      this.m.compose(p.pos, this.q, this.s);
      pool.mesh.setMatrixAt(n, this.m);
      pool.mesh.setColorAt(n, p.color);
      n++;
    }
    pool.mesh.count = n;
    if (n > 0) {
      pool.mesh.instanceMatrix.needsUpdate = true;
      if (pool.mesh.instanceColor) pool.mesh.instanceColor.needsUpdate = true;
    }
  }
}
