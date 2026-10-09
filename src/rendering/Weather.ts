import * as THREE from 'three';
import type { Terrain } from '../world/terrain';
import type { Particles } from './Particles';
import { sharedUniforms } from './wind';
import { rainAt, sinceShower } from './weatherSchedule';

/**
 * Weather and atmosphere, all cosmetic: passing showers on the shared wall-clock
 * schedule (`weatherSchedule.ts`), a rainbow as a daytime shower clears, and warm
 * motes drifting in the sunlight on fine days. The renderer reads `rain` and
 * `overcast` to dim the sun, grey the sky, darken the ground and play the rain.
 *
 * Rain is one instanced draw call animated entirely on the GPU: each streak's
 * position is a function of time, wrapped into a box that follows the camera.
 */

const STREAKS = 2600;
const BOX = new THREE.Vector3(38, 22, 38);
const MOTES = 70;

const RAIN_VS = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uVel;
uniform float uLen;
uniform float uWidth;
varying float vEnd;
varying float vNear;
void main() {
  // position.x: -1/+1 across the streak, position.y: 0 at the head, 1 at the tail.
  vec3 lo = uCenter - uBox * 0.5;
  vec3 head = aSeed * uBox + uVel * uTime * (0.85 + aSeed.x * 0.3);
  head = mod(head - lo, uBox) + lo;
  vec3 dir = normalize(uVel);
  vec3 p = head - dir * uLen * position.y;
  vec3 side = normalize(cross(dir, cameraPosition - p));
  p += side * uWidth * position.x;
  vEnd = position.y;
  // Drops right in front of the lens would be huge smears: fade them.
  vNear = smoothstep(3.0, 9.0, distance(p, cameraPosition));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const RAIN_FS = /* glsl */ `
uniform float uOpacity;
uniform vec3 uDayTint;
varying float vEnd;
varying float vNear;
void main() {
  gl_FragColor = vec4(vec3(0.82, 0.88, 0.95) * uDayTint, uOpacity * (1.0 - vEnd * 0.8) * vNear);
}`;

const RAINBOW_VS = /* glsl */ `
varying float vR;
varying float vRise;
void main() {
  vR = length(position.xy);
  vRise = position.y / max(vR, 1e-3);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RAINBOW_FS = /* glsl */ `
uniform float uInner;
uniform float uOuter;
uniform float uAlpha;
varying float vR;
varying float vRise;
vec3 hue(float t) {
  // Red outside, violet inside.
  return clamp(vec3(abs(t * 6.0 - 3.0) - 1.0, 2.0 - abs(t * 6.0 - 2.0), 2.0 - abs(t * 6.0 - 4.0)), 0.0, 1.0);
}
void main() {
  float t = clamp((vR - uInner) / (uOuter - uInner), 0.0, 1.0);
  vec3 c = hue(0.83 * (1.0 - t));
  float edge = sin(t * 3.14159);
  // The feet dissolve into the haze.
  float rise = smoothstep(0.15, 0.75, vRise);
  gl_FragColor = vec4(c, uAlpha * edge * rise * 0.3);
}`;

function hash(n: number): number {
  const s = Math.sin(n * 53.13 + 1.7) * 43758.5453;
  return s - Math.floor(s);
}

export class Weather {
  readonly group = new THREE.Group();
  /** 0..1, eased: how hard it's raining. */
  rain = 0;
  /** 0..1, eased more slowly: cloud cover and wet ground linger after the rain. */
  overcast = 0;
  /** Player preference: weather can be switched off (always fine). */
  enabled = true;
  /** Dev override. */
  force: 'rain' | 'clear' | null = null;
  /** Fewer streaks and splashes (reduced motion). */
  amount = 1;

  private readonly streaks: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly rainUniforms;
  private readonly rainbow: THREE.Mesh;
  private readonly rainbowUniforms;
  private readonly motes: THREE.InstancedMesh;
  private readonly moteMaterial: THREE.MeshBasicMaterial;
  private splashBudget = 0;
  /** A proper shower happened and has been easing off for this many seconds (-1: none). */
  private afterRain = -1;
  private readonly m = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();

  constructor(
    private readonly terrain: Terrain,
    private readonly particles: Particles,
  ) {
    // Rain streaks: one thin camera-facing strip per drop, positions computed in the shader.
    const seeds = new Float32Array(STREAKS * 3);
    for (let i = 0; i < STREAKS; i++) seeds.set([hash(i * 3.1), hash(i * 7.7 + 1), hash(i * 1.3 + 2)], i * 3);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    geo.instanceCount = 0;
    this.rainUniforms = {
      uTime: sharedUniforms.uTime,
      uDayTint: sharedUniforms.uDayTint,
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: BOX.clone() },
      uVel: { value: new THREE.Vector3(1.6, -15, 0.9) },
      uLen: { value: 0.85 },
      uWidth: { value: 0.012 },
      uOpacity: { value: 0 },
    };
    this.streaks = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: RAIN_VS, fragmentShader: RAIN_FS, uniforms: this.rainUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.streaks.frustumCulled = false;
    this.streaks.visible = false;
    this.group.add(this.streaks);

    // A rainbow: a half ring, coloured by radius in the shader.
    this.rainbowUniforms = { uInner: { value: 38 }, uOuter: { value: 44 }, uAlpha: { value: 0 } };
    this.rainbow = new THREE.Mesh(
      new THREE.RingGeometry(38, 44, 96, 1, 0, Math.PI),
      new THREE.ShaderMaterial({ vertexShader: RAINBOW_VS, fragmentShader: RAINBOW_FS, uniforms: this.rainbowUniforms, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.rainbow.frustumCulled = false;
    this.rainbow.renderOrder = 10;
    this.rainbow.visible = false;
    this.group.add(this.rainbow);

    // Sunlit motes: tiny warm specks drifting about the camera's focus on fine days.
    this.moteMaterial = new THREE.MeshBasicMaterial({ color: '#fff1c4', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.motes = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 5, 3), this.moteMaterial, MOTES);
    this.motes.frustumCulled = false;
    this.motes.visible = false;
    this.group.add(this.motes);
  }

  /** Target rain right now: the schedule, the dev override, or nothing if switched off. */
  private wanted(nowMs: number): number {
    if (this.force === 'rain') return 0.9;
    if (this.force === 'clear' || !this.enabled) return 0;
    return rainAt(nowMs);
  }

  /** @param focus the camera's ground target */
  update(dt: number, time: number, nowMs: number, focus: THREE.Vector3, camera: THREE.Camera, night: number): void {
    const want = this.wanted(nowMs);
    this.rain += (want - this.rain) * Math.min(1, dt * 0.6);
    const cloud = Math.max(want, this.force === 'clear' || !this.enabled ? 0 : Math.max(0, 1 - sinceShower(nowMs) / 240) * 0.6);
    this.overcast += (Math.max(cloud, this.rain) - this.overcast) * Math.min(1, dt * 0.25);

    // Rain streaks follow the camera's focus.
    const rain = this.rain;
    this.streaks.visible = rain > 0.02;
    if (this.streaks.visible) {
      this.rainUniforms.uCenter.value.set(focus.x, focus.y + 8, focus.z);
      this.rainUniforms.uOpacity.value = 0.25 + rain * 0.35;
      this.streaks.geometry.instanceCount = Math.floor(STREAKS * Math.min(1, rain * 1.2) * this.amount);
      // Splashes where drops land near the focus.
      this.splashBudget += dt * rain * 70 * this.amount;
      while (this.splashBudget >= 1) {
        this.splashBudget -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 14;
        const x = focus.x + Math.cos(a) * r;
        const z = focus.z + Math.sin(a) * r;
        this.particles.emit('splash', this.v.set(x, this.terrain.groundHeightAt(x, z) + 0.03, z), 1, 0);
      }
    }

    // A rainbow opposite the sun as a daytime shower clears.
    if (rain > 0.4) this.afterRain = 0;
    else if (this.afterRain >= 0 && rain < 0.25) this.afterRain += dt;
    if (this.afterRain > 300) this.afterRain = -1;
    const after = this.afterRain;
    const bow = after >= 0 && rain < 0.25 && this.enabled ? Math.min(1, after / 20) * Math.min(1, (300 - after) / 120) * Math.max(0, 1 - night * 2.5) : 0;
    this.rainbowUniforms.uAlpha.value += (bow - this.rainbowUniforms.uAlpha.value) * Math.min(1, dt * 0.5);
    this.rainbow.visible = this.rainbowUniforms.uAlpha.value > 0.01;
    if (this.rainbow.visible) {
      // The strategy camera looks down at the ground, so there's no sky to hang a real
      // rainbow in. It's drawn instead as a faint arc over the far side of the view,
      // facing the camera and sized to the screen, like light caught in the damp air.
      const cam = camera as THREE.PerspectiveCamera;
      const d = 60;
      const halfH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) * d;
      const radius = halfH * Math.max(1.2, cam.aspect * 1.05);
      this.rainbow.quaternion.copy(cam.quaternion);
      this.rainbow.scale.setScalar(radius / 41);
      const crown = this.v.set(0, halfH * 0.9, -d).applyQuaternion(cam.quaternion).add(cam.position);
      this.rainbow.position.copy(crown).add(this.s.set(0, -radius, 0).applyQuaternion(cam.quaternion));
    }

    // Motes in the sunlight, only on fine days.
    const fine = (1 - night) * (1 - this.overcast);
    this.moteMaterial.opacity = fine * 0.55;
    this.motes.visible = fine > 0.05;
    if (this.motes.visible) {
      for (let i = 0; i < MOTES; i++) {
        const w = 0.05 + hash(i * 2.3) * 0.1;
        const u = time * w + hash(i) * 50;
        // Drift on slow loops inside a box round the focus, wrapping at the edges.
        const bx = ((((hash(i * 9.1) * 20 + Math.sin(u) * 1.5 + time * 0.12) % 20) + 20) % 20) - 10;
        const bz = ((((hash(i * 4.7) * 20 + Math.cos(u * 0.8) * 1.5 + time * 0.07) % 20) + 20) % 20) - 10;
        const x = focus.x + bx;
        const z = focus.z + bz;
        const y = this.terrain.groundHeightAt(x, z) + 0.4 + hash(i * 6.1) * 2.2 + Math.sin(u * 1.3) * 0.25;
        const twinkle = 0.6 + 0.4 * Math.sin(time * (1 + hash(i) * 2) + i);
        this.motes.setMatrixAt(i, this.m.compose(this.v.set(x, y, z), this.q, this.s.setScalar(twinkle)));
      }
      this.motes.instanceMatrix.needsUpdate = true;
    }
  }
}
