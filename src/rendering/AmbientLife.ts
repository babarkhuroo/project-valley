import * as THREE from 'three';
import type { VillageMapDef } from '../config/villageMap';
import type { Terrain } from '../world/terrain';
import { createRng } from '../world/noise';
import { mat } from './materials';

interface Bird {
  root: THREE.Group;
  wingL: THREE.Object3D;
  wingR: THREE.Object3D;
  cx: number;
  cz: number;
  r: number;
  h: number;
  speed: number;
  phase: number;
}

interface Butterfly {
  root: THREE.Group;
  wingL: THREE.Object3D;
  wingR: THREE.Object3D;
  home: THREE.Vector2;
  seed: number;
}

/** Purely decorative wildlife: birds circling high overhead and butterflies over the meadows. */
export class AmbientLife {
  readonly group = new THREE.Group();
  private readonly birds: Bird[] = [];
  private readonly butterflies: Butterfly[] = [];

  constructor(private readonly terrain: Terrain, map: VillageMapDef) {
    const rng = createRng(map.seed ^ 0xb1d);
    const wingGeo = new THREE.BoxGeometry(0.42, 0.02, 0.16);
    wingGeo.translate(0.21, 0, 0);
    for (let i = 0; i < 6; i++) {
      const root = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.18, 3, 6), mat(i % 2 ? '#f4efe6' : '#5a5560'));
      body.rotation.x = Math.PI / 2;
      root.add(body);
      const wm = mat(i % 2 ? '#e7e1d6' : '#4a4550');
      const wingR = new THREE.Mesh(wingGeo, wm);
      const wingL = new THREE.Mesh(wingGeo, wm);
      wingL.rotation.y = Math.PI;
      root.add(wingL, wingR);
      root.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.group.add(root);
      this.birds.push({
        root,
        wingL,
        wingR,
        cx: 10 + rng() * (map.width - 20),
        cz: 10 + rng() * (map.height - 20),
        r: 6 + rng() * 10,
        h: 8 + rng() * 5,
        speed: (0.18 + rng() * 0.12) * (rng() < 0.5 ? -1 : 1),
        phase: rng() * Math.PI * 2,
      });
    }
    const colors = ['#f2c14e', '#ffffff', '#e86b8a', '#7fb2f0', '#f08a4b'];
    const wing = new THREE.CircleGeometry(0.09, 6);
    wing.translate(0.08, 0, 0);
    for (let i = 0; i < 10; i++) {
      const meadow = map.meadows[i % map.meadows.length];
      const [x, z] = meadow[Math.floor(rng() * meadow.length)];
      const cx = (x + meadow.reduce((s, p) => s + p[0], 0) / meadow.length) / 2;
      const cz = (z + meadow.reduce((s, p) => s + p[1], 0) / meadow.length) / 2;
      const root = new THREE.Group();
      const wm = mat(colors[i % colors.length], { side: THREE.DoubleSide });
      const wingR = new THREE.Mesh(wing, wm);
      const wingL = new THREE.Mesh(wing, wm);
      wingR.rotation.x = -Math.PI / 2;
      wingL.rotation.set(-Math.PI / 2, Math.PI, 0);
      const pivotL = new THREE.Group();
      const pivotR = new THREE.Group();
      pivotL.add(wingL);
      pivotR.add(wingR);
      root.add(pivotL, pivotR);
      this.group.add(root);
      this.butterflies.push({ root, wingL: pivotL, wingR: pivotR, home: new THREE.Vector2(cx, cz), seed: rng() * 100 });
    }
  }

  update(time: number): void {
    for (const b of this.birds) {
      const a = b.phase + time * b.speed;
      const x = b.cx + Math.cos(a) * b.r;
      const z = b.cz + Math.sin(a) * b.r;
      b.root.position.set(x, b.h + Math.sin(time * 0.7 + b.phase) * 0.4, z);
      b.root.rotation.y = Math.atan2(-Math.sin(a) * Math.sign(b.speed), Math.cos(a) * Math.sign(b.speed));
      b.root.rotation.z = Math.sign(b.speed) * 0.25;
      const flapping = Math.sin(time * 0.6 + b.phase) > -0.3;
      const f = flapping ? Math.sin(time * 11 + b.phase) * 0.7 : 0.1;
      b.wingR.rotation.z = f;
      b.wingL.rotation.z = -f;
    }
    for (const bf of this.butterflies) {
      const t = time * 0.35 + bf.seed;
      const x = bf.home.x + Math.sin(t) * 2.5 + Math.sin(t * 2.3) * 0.8;
      const z = bf.home.y + Math.cos(t * 0.8) * 2.5 + Math.cos(t * 1.9) * 0.8;
      const y = this.terrain.heightAt(x, z) + 0.55 + Math.sin(time * 3 + bf.seed) * 0.2;
      bf.root.position.set(x, y, z);
      bf.root.rotation.y = t * 1.3;
      const flap = Math.sin(time * 18 + bf.seed) * 1.1;
      bf.wingR.rotation.z = flap;
      bf.wingL.rotation.z = -flap;
    }
  }
}
