import * as THREE from 'three';
import { sharedUniforms } from './wind';

export type SmokeKind = 'chimney' | 'steam';

/** Puffs looping per emitter (one instanced quad each). */
const PUFFS = 14;
/** Longest puff lifetime (chimney smoke) in seconds; interpolated into the shader. */
const MAX_LIFE = 4.6;
/** A removed emitter's slot is reused only once every puff it spawned has died. */
const DRAIN = MAX_LIFE + 0.5;

const VERTEX = /* glsl */ `
  #include <fog_pars_vertex>
  uniform float uTime;
  uniform vec2 uWind;
  attribute vec4 aEmitter;  // xyz: world position, w: kind (0 chimney, 1 steam) — one per emitter
  attribute vec3 aLevels;   // intensity for puffs born before t1 / between t1 and t2 / after t2
  attribute vec2 aTimes;    // t1, t2 (seconds on the uTime clock)
  attribute vec2 aPuff;     // x: phase offset in cycles, y: seed — one per puff
  varying vec2 vCorner;
  varying vec2 vNoiseUv;
  varying float vAlpha;
  varying float vAge;
  varying float vSeed;
  varying float vSteam;

  float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
  }

  void main() {
    float steam = aEmitter.w;
    float life = mix(${MAX_LIFE.toFixed(2)}, 1.7, steam);
    float cyc = uTime / life + aPuff.x;
    float cycle = floor(cyc);
    float t = cyc - cycle;               // 0..1 through this puff's current life
    float age = t * life;                // seconds since birth
    float birth = (cycle - aPuff.x) * life;

    // Intensity is latched at birth, so a change only affects puffs spawned after it:
    // turning an emitter off lets the puffs already in the air drift away and fade.
    float level = birth < aTimes.x ? aLevels.x : (birth < aTimes.y ? aLevels.y : aLevels.z);
    float r0 = hash11(aPuff.y * 61.7 + cycle * 7.13);
    float density = clamp(level * 0.65, 0.0, 1.0);
    if (level <= 0.0 || r0 >= density) {
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0); // outside the clip volume: nothing drawn
      return;
    }
    float r1 = hash11(r0 * 13.7 + aPuff.y);
    float r2 = hash11(r1 * 17.3 + 0.5);
    float r3 = hash11(r2 * 23.1 + 0.25);

    // Rise with a decaying speed: y = v0 / k * (1 - e^(-k t)).
    float v0 = mix(0.55, 0.75, steam) * mix(0.85, 1.15, r1);
    float k = mix(0.35, 0.9, steam);
    float rise = v0 / k * (1.0 - exp(-k * age));

    vec3 p = aEmitter.xyz;
    float a0 = r2 * 6.2831853;
    p.xz += vec2(cos(a0), sin(a0)) * mix(0.05, 0.04, steam) * r3;
    p.y += rise;
    // Wind carries a puff more once it clears the roof; the gust is sampled at birth so the trail bends.
    float gust = 0.8 + 0.2 * sin((uTime - age) * 0.37 + aEmitter.x * 0.1);
    p.xz += uWind * gust * (age * 0.35 + rise * 0.45) * mix(1.0, 0.4, steam);
    // Curl: layered sines that grow with age.
    float sway = t * mix(0.22, 0.08, steam);
    float h = p.y;
    p.x += sin(age * 1.3 + r1 * 6.2831853 + h * 1.7) * sway;
    p.z += cos(age * 1.1 + r2 * 6.2831853 + h * 1.3) * sway;
    p.y += sin(age * 1.7 + r3 * 6.2831853) * sway * 0.35;

    float grow = 1.0 - (1.0 - t) * (1.0 - t);
    float size = mix(mix(0.2, 0.1, steam), mix(0.85, 0.36, steam), grow);
    size *= mix(0.8, 1.2, r3) * (0.55 + 0.45 * smoothstep(0.0, 0.15, t));
    size *= clamp(0.85 + 0.15 * level, 0.85, 1.15);

    // Camera-facing billboard: offset the corner in view space from the puff centre.
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    mvPosition.xy += position.xy * size;
    gl_Position = projectionMatrix * mvPosition;

    // The round silhouette is rotation-invariant, so only the noise pattern spins.
    float rot = r1 * 6.2831853 + age * (r2 - 0.5) * 1.2;
    float c = cos(rot);
    float s = sin(rot);
    vCorner = position.xy * 2.0;
    vNoiseUv = vec2(c * vCorner.x - s * vCorner.y, s * vCorner.x + c * vCorner.y);
    float fadeIn = smoothstep(0.0, 0.08, t);
    float fadeOut = 1.0 - smoothstep(mix(0.35, 0.3, steam), 1.0, t);
    vAlpha = mix(0.5, 0.42, steam) * fadeIn * fadeOut * clamp(0.75 + 0.25 * level, 0.0, 1.2);
    vAge = t;
    vSeed = r0 * 17.0 + r1 * 5.0;
    vSteam = steam;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  #include <fog_pars_fragment>
  uniform vec3 uSmokeLit;
  uniform vec3 uSmokeShade;
  uniform vec3 uSteamLit;
  uniform vec3 uSteamShade;
  varying vec2 vCorner;
  varying vec2 vNoiseUv;
  varying float vAlpha;
  varying float vAge;
  varying float vSeed;
  varying float vSteam;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  void main() {
    float r = length(vCorner);
    if (r >= 1.0) discard;
    vec2 q = vNoiseUv * 1.6 + vec2(vSeed, vSeed * 0.7);
    q.y -= vAge * 1.2;
    float n = vnoise(q) * 0.65 + vnoise(q * 2.3 + 4.1) * 0.35;
    // Ragged edge that frays as the puff ages.
    float edge = r + (n - 0.5) * 0.45 * (0.5 + vAge);
    float body = (1.0 - smoothstep(0.35, 0.95, edge)) * (0.8 + 0.4 * n);
    float alpha = body * vAlpha;
    if (alpha < 0.003) discard;

    // Warm light on top, cool shade underneath, so a flat puff reads as a lit volume.
    float light = clamp(0.55 + 0.5 * vCorner.y + (n - 0.5) * 0.3, 0.0, 1.0);
    vec3 col = mix(mix(uSmokeShade, uSteamShade, vSteam), mix(uSmokeLit, uSteamLit, vSteam), light);
    // Fresh chimney smoke is a touch greyer and pales as it thins.
    col *= mix(mix(0.9, 1.0, smoothstep(0.0, 0.5, vAge)), 1.0, vSteam);
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * GPU chimney smoke and cauldron steam in a single draw call. Every emitter owns
 * PUFFS instanced quads whose motion, growth and fade are pure functions of uTime
 * in the vertex shader, so per-frame CPU cost is nil; attributes change only when
 * emitters are added, moved, removed or change intensity.
 */
export class SmokeSystem {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private capacity = 0;
  private emitterAttr!: THREE.InstancedBufferAttribute;
  private levelAttr!: THREE.InstancedBufferAttribute;
  private timeAttr!: THREE.InstancedBufferAttribute;
  private used = new Uint8Array(0);
  /** Time from which a free slot may be reused (its old puffs are gone). */
  private freeAt = new Float64Array(0);
  private readonly slotOf = new Map<number, number>();
  private nextHandle = 1;

  constructor(initialEmitters = 48) {
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uWind: { value: new THREE.Vector2(0.24, 0.07) },
          uSmokeLit: { value: new THREE.Color('#fff4e6') },
          uSmokeShade: { value: new THREE.Color('#aeb4c4') },
          uSteamLit: { value: new THREE.Color('#ffffff') },
          uSteamShade: { value: new THREE.Color('#d9e3ec') },
        },
      ]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    });
    material.uniforms.uTime = sharedUniforms.uTime;
    this.mesh = new THREE.Mesh(new THREE.InstancedBufferGeometry(), material);
    this.mesh.name = 'smoke';
    // Instances are positioned in the shader, so bounds are meaningless.
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => {};
    this.mesh.renderOrder = 2;
    this.resize(Math.max(1, initialEmitters));
  }

  addEmitter(position: THREE.Vector3, kind: SmokeKind, intensity: number): number {
    const now = sharedUniforms.uTime.value;
    let slot = -1;
    for (let s = 0; s < this.capacity; s++) {
      if (!this.used[s] && this.freeAt[s] <= now) {
        slot = s;
        break;
      }
    }
    if (slot < 0) {
      slot = this.capacity;
      this.resize(this.capacity * 2);
    }
    this.used[slot] = 1;
    const e = this.emitterAttr.array as Float32Array;
    e[slot * 4] = position.x;
    e[slot * 4 + 1] = position.y;
    e[slot * 4 + 2] = position.z;
    e[slot * 4 + 3] = kind === 'steam' ? 1 : 0;
    this.touch(this.emitterAttr, slot);
    // Puffs born before now stay invisible, so a new emitter starts from the chimney top.
    this.writeLevels(slot, 0, 0, Math.max(0, intensity), now, now);
    const handle = this.nextHandle++;
    this.slotOf.set(handle, slot);
    this.refreshCount();
    return handle;
  }

  /** 0 turns the emitter off; puffs already in the air finish their life. ~1 is a normal chimney. */
  setIntensity(handle: number, value: number): void {
    const slot = this.slotOf.get(handle);
    if (slot === undefined) return;
    this.pushLevel(slot, Math.max(0, value));
  }

  setPosition(handle: number, position: THREE.Vector3): void {
    const slot = this.slotOf.get(handle);
    if (slot === undefined) return;
    const e = this.emitterAttr.array as Float32Array;
    e[slot * 4] = position.x;
    e[slot * 4 + 1] = position.y;
    e[slot * 4 + 2] = position.z;
    this.touch(this.emitterAttr, slot);
  }

  /** Stops spawning; the remaining puffs drift off and the slot is recycled once they are gone. */
  removeEmitter(handle: number): void {
    const slot = this.slotOf.get(handle);
    if (slot === undefined) return;
    this.slotOf.delete(handle);
    this.pushLevel(slot, 0);
    this.used[slot] = 0;
    this.freeAt[slot] = sharedUniforms.uTime.value + DRAIN;
    this.refreshCount();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  /** Records a new intensity for puffs born from now on, keeping up to three epochs so in-flight puffs keep theirs. */
  private pushLevel(slot: number, value: number): void {
    const now = sharedUniforms.uTime.value;
    const l = this.levelAttr.array as Float32Array;
    const t = this.timeAttr.array as Float32Array;
    const l0 = l[slot * 3];
    const l1 = l[slot * 3 + 1];
    const l2 = l[slot * 3 + 2];
    const t1 = t[slot * 2];
    const t2 = t[slot * 2 + 1];
    if (l2 === Math.fround(value)) return;
    if (now - t2 >= MAX_LIFE) {
      // Every living puff was born in the latest epoch.
      this.writeLevels(slot, l2, l2, value, now, now);
    } else if (now - t1 >= MAX_LIFE || l0 === l1) {
      // The oldest epoch has no living puffs left (or matches the next one): fold it away.
      this.writeLevels(slot, l1, l2, value, t2, now);
    } else if (t1 === t2 || l1 === l2) {
      // The middle epoch is empty or matches the latest: fold it away.
      this.writeLevels(slot, l0, l2, value, t1, now);
    } else {
      // Three distinct changes within one lifetime: merge the two oldest epochs (the oldest puffs may pop).
      this.writeLevels(slot, l1, l2, value, t2, now);
    }
  }

  private writeLevels(slot: number, l0: number, l1: number, l2: number, t1: number, t2: number): void {
    const l = this.levelAttr.array as Float32Array;
    const t = this.timeAttr.array as Float32Array;
    l[slot * 3] = l0;
    l[slot * 3 + 1] = l1;
    l[slot * 3 + 2] = l2;
    t[slot * 2] = t1;
    t[slot * 2 + 1] = t2;
    this.touch(this.levelAttr, slot);
    this.touch(this.timeAttr, slot);
  }

  private touch(attr: THREE.InstancedBufferAttribute, slot: number): void {
    attr.addUpdateRange(slot * attr.itemSize, attr.itemSize);
    attr.needsUpdate = true;
  }

  /** Draw only up to the highest slot that is in use or still draining. */
  private refreshCount(): void {
    const now = sharedUniforms.uTime.value;
    let top = 0;
    for (let s = this.capacity - 1; s >= 0; s--) {
      if (this.used[s] || this.freeAt[s] > now) {
        top = s + 1;
        break;
      }
    }
    this.mesh.geometry.instanceCount = top * PUFFS;
  }

  /** (Re)allocates the pool, keeping existing emitters. A fresh geometry avoids leaking GPU buffers. */
  private resize(capacity: number): void {
    const old = this.capacity;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);

    const emitters = new Float32Array(capacity * 4);
    const levels = new Float32Array(capacity * 3);
    const times = new Float32Array(capacity * 2);
    const puffs = new Float32Array(capacity * PUFFS * 2);
    if (old > 0) {
      emitters.set(this.emitterAttr.array as Float32Array);
      levels.set(this.levelAttr.array as Float32Array);
      times.set(this.timeAttr.array as Float32Array);
      puffs.set(this.mesh.geometry.getAttribute('aPuff').array as Float32Array);
    }
    for (let i = old * PUFFS; i < capacity * PUFFS; i++) {
      // Evenly staggered phases with a little jitter so puffs don't march in lockstep.
      puffs[i * 2] = ((i % PUFFS) + (Math.random() - 0.5) * 0.6) / PUFFS;
      puffs[i * 2 + 1] = Math.random() * 100;
    }
    this.emitterAttr = new THREE.InstancedBufferAttribute(emitters, 4, false, PUFFS).setUsage(THREE.DynamicDrawUsage);
    this.levelAttr = new THREE.InstancedBufferAttribute(levels, 3, false, PUFFS).setUsage(THREE.DynamicDrawUsage);
    this.timeAttr = new THREE.InstancedBufferAttribute(times, 2, false, PUFFS).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aEmitter', this.emitterAttr);
    geo.setAttribute('aLevels', this.levelAttr);
    geo.setAttribute('aTimes', this.timeAttr);
    geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(puffs, 2));

    const used = new Uint8Array(capacity);
    used.set(this.used);
    const freeAt = new Float64Array(capacity);
    freeAt.set(this.freeAt);
    this.used = used;
    this.freeAt = freeAt;
    this.capacity = capacity;

    const prev = this.mesh.geometry;
    this.mesh.geometry = geo;
    prev.dispose();
    this.refreshCount();
  }
}
