import * as THREE from 'three';
import type { Particles } from './Particles';

/**
 * One-off flourishes for the big moments, layered over the particle confetti:
 * a ring that sweeps out across the ground when a building is finished, a column of
 * light over the Academy when research completes, golden glints for an upgrade, and
 * fireworks over the village on a level-up. Each piece lives a few seconds, is drawn
 * additively (so the bloom makes it glow) and frees itself.
 */

const RING_VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RING_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uProgress;
varying vec2 vUv;
void main() {
  // A soft band whose leading edge is bright, fading out as the ring grows.
  float r = length(vUv - 0.5) * 2.0;
  float band = smoothstep(uProgress - 0.13, uProgress, r) * (1.0 - smoothstep(uProgress, uProgress + 0.03, r));
  gl_FragColor = vec4(uColor, band * (1.0 - uProgress) * 0.9);
}`;

const BEAM_VS = /* glsl */ `
varying float vH;
varying float vFacing;
void main() {
  vH = uv.y;
  // Bright where the column faces the camera, soft at its silhouette: reads as light, not a tube.
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;

const BEAM_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uTime;
varying float vH;
varying float vFacing;
void main() {
  float shimmer = 0.75 + 0.25 * sin(vH * 30.0 - uTime * 8.0);
  gl_FragColor = vec4(uColor, uAlpha * (1.0 - vH) * shimmer * pow(vFacing, 2.0));
}`;

interface Flourish {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  tick: (k: number, age: number) => void;
}

interface Rocket {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  color: THREE.Color;
  delay: number;
}

const FIREWORK_COLORS = ['#ffcf5a', '#ff7a9a', '#7fd0ff', '#a6ff7a', '#d8a0ff', '#ffffff'];

export class Effects {
  readonly group = new THREE.Group();
  private readonly live: Flourish[] = [];
  private readonly rockets: Rocket[] = [];
  /** A firework bursts (for its pop) or launches (for its whistle). */
  onFirework: ((kind: 'launch' | 'burst', at: THREE.Vector3) => void) | null = null;
  private readonly ringGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private readonly beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);

  constructor(private readonly particles: Particles) {}

  /** A soft ring sweeping out across the ground from `at`. */
  ring(at: THREE.Vector3, color: string, radius: number, seconds = 1.4): void {
    const material = new THREE.ShaderMaterial({
      vertexShader: RING_VS,
      fragmentShader: RING_FS,
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(1.8) }, uProgress: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(this.ringGeo, material);
    mesh.position.copy(at).setY(at.y + 0.06);
    mesh.scale.setScalar(radius * 2);
    mesh.renderOrder = 2;
    this.add(mesh, seconds, (k) => {
      material.uniforms.uProgress.value = 1 - Math.pow(1 - k, 2.2);
    });
  }

  /** A column of light rising from `at` and fading. */
  beam(at: THREE.Vector3, color: string, height: number, seconds = 2.6): void {
    const material = new THREE.ShaderMaterial({
      vertexShader: BEAM_VS,
      fragmentShader: BEAM_FS,
      uniforms: { uColor: { value: new THREE.Color(color).multiplyScalar(1.6) }, uAlpha: { value: 0 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.beamGeo, material);
    mesh.position.copy(at);
    mesh.renderOrder = 2;
    this.add(mesh, seconds, (k, age) => {
      // Shoots up quickly, holds, then thins away.
      const rise = Math.min(1, k * 5);
      mesh.scale.set(0.55 * (1 - k * 0.6), height * rise, 0.55 * (1 - k * 0.6));
      material.uniforms.uAlpha.value = Math.min(1, k * 8) * (1 - k) * 0.8;
      material.uniforms.uTime.value = age;
      if (Math.random() < 0.5) this.particles.emit('glint', mesh.position.clone().setY(mesh.position.y + Math.random() * height * rise), 1, 0.4);
    });
  }

  /** Golden glints rising off a building that just levelled up. */
  glints(at: THREE.Vector3, spread: number, count = 26): void {
    this.particles.emit('glint', at, count, spread);
  }

  /** A short show over `center`: rockets from around it, bursting in colours. */
  fireworks(center: THREE.Vector3, rockets = 7, radius = 6): void {
    for (let i = 0; i < rockets; i++) {
      const a = (i / rockets) * Math.PI * 2 + Math.random();
      const r = radius * (0.3 + Math.random() * 0.7);
      this.rockets.push({
        pos: new THREE.Vector3(center.x + Math.cos(a) * r, center.y, center.z + Math.sin(a) * r),
        vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, 9.5 + Math.random() * 2.5, (Math.random() - 0.5) * 1.5),
        color: new THREE.Color(FIREWORK_COLORS[i % FIREWORK_COLORS.length]),
        delay: i * 0.42 + Math.random() * 0.25,
      });
    }
  }

  private add(mesh: THREE.Mesh, life: number, tick: Flourish['tick']): void {
    this.group.add(mesh);
    this.live.push({ mesh, age: 0, life, tick });
    tick(0, 0);
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      f.age += dt;
      if (f.age >= f.life) {
        this.group.remove(f.mesh);
        (f.mesh.material as THREE.Material).dispose();
        this.live.splice(i, 1);
        continue;
      }
      f.tick(f.age / f.life, f.age);
    }
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      if (r.delay > 0) {
        r.delay -= dt;
        if (r.delay <= 0) this.onFirework?.('launch', r.pos);
        continue;
      }
      r.vel.y -= 9 * dt;
      r.pos.addScaledVector(r.vel, dt);
      this.particles.emit('flare', r.pos, 1, 0.05);
      if (r.vel.y <= 2) {
        this.particles.emitColored('spark', r.pos, r.color, 95, 6.5);
        this.particles.emitColored('spark', r.pos, new THREE.Color('#ffffff'), 12, 2.5);
        this.onFirework?.('burst', r.pos);
        this.rockets.splice(i, 1);
      }
    }
  }
}
