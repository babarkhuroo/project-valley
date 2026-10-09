import * as THREE from 'three';
import { setNightGlow } from './materials';
import { sharedUniforms } from './wind';

/**
 * A gentle day/night ambience on the player's local clock (or held at noon). It only
 * changes how things look — sky, fog, sun and fill light, exposure, stars and how
 * brightly windows and lanterns glow — never anything the simulation reads. Nights are
 * a soft blue, never dark enough to make the village hard to read.
 */

interface Key {
  hour: number;
  sky: string;
  sun: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  ambient: number;
  exposure: number;
  /** 0 = lamps off, 1 = full evening glow. */
  glow: number;
  /** Multiplies unlit shaders (water, smoke). */
  tint: string;
}

const KEYS: Key[] = [
  { hour: 0, sky: '#2f3d63', sun: '#b9c8ff', sunIntensity: 0.55, hemiSky: '#7d8fc4', hemiGround: '#2f3d3a', hemiIntensity: 0.75, ambient: 0.32, exposure: 1.0, glow: 1, tint: '#7f8fbf' },
  { hour: 4.5, sky: '#34446b', sun: '#b9c8ff', sunIntensity: 0.55, hemiSky: '#7d8fc4', hemiGround: '#2f3d3a', hemiIntensity: 0.75, ambient: 0.32, exposure: 1.0, glow: 1, tint: '#808fbd' },
  { hour: 6.2, sky: '#f0c7a6', sun: '#ffcf9e', sunIntensity: 1.4, hemiSky: '#ffe2c4', hemiGround: '#5f6f50', hemiIntensity: 1.05, ambient: 0.25, exposure: 1.02, glow: 0.45, tint: '#f6d8c4' },
  { hour: 8.5, sky: '#cfe7ea', sun: '#fff0d8', sunIntensity: 2.2, hemiSky: '#fff7e6', hemiGround: '#6e8a5a', hemiIntensity: 1.35, ambient: 0.25, exposure: 1.05, glow: 0, tint: '#ffffff' },
  { hour: 16.5, sky: '#cfe7ea', sun: '#fff0d8', sunIntensity: 2.2, hemiSky: '#fff7e6', hemiGround: '#6e8a5a', hemiIntensity: 1.35, ambient: 0.25, exposure: 1.05, glow: 0, tint: '#ffffff' },
  { hour: 18.8, sky: '#f2b98c', sun: '#ffb070', sunIntensity: 1.5, hemiSky: '#ffd8b8', hemiGround: '#5d6248', hemiIntensity: 1.05, ambient: 0.26, exposure: 1.04, glow: 0.55, tint: '#f7d3b8' },
  { hour: 20.6, sky: '#55628f', sun: '#c7b8ff', sunIntensity: 0.7, hemiSky: '#8e98cc', hemiGround: '#3a4440', hemiIntensity: 0.85, ambient: 0.3, exposure: 1.0, glow: 1, tint: '#8f9acb' },
  { hour: 24, sky: '#2f3d63', sun: '#b9c8ff', sunIntensity: 0.55, hemiSky: '#7d8fc4', hemiGround: '#2f3d3a', hemiIntensity: 0.75, ambient: 0.32, exposure: 1.0, glow: 1, tint: '#7f8fbf' },
];

const c1 = new THREE.Color();
const c2 = new THREE.Color();

function lerpColor(a: string, b: string, t: number, out: THREE.Color): THREE.Color {
  return out.copy(c1.set(a)).lerp(c2.set(b), t);
}

export type TimeOfDayMode = 'clock' | 'day';

/** Hours (0–24) on the local clock. */
export function localHour(date = new Date()): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

export class DayCycle {
  /** 'clock' follows local time; 'day' holds a bright midday. */
  mode: TimeOfDayMode = 'clock';
  /** Dev override (hours), or null. */
  override: number | null = null;
  /** 0 by day … 1 at night; for ambience that reacts (fireflies, crickets). */
  night = 0;
  readonly sky = new THREE.Color();
  /** 0..1 cloud cover (Weather): greys the sky, dims the sun, hides the stars. */
  overcast = 0;
  private readonly stars: THREE.Points;
  private lastHour = -1;
  private lastOvercast = -1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly sun: THREE.DirectionalLight,
    private readonly hemi: THREE.HemisphereLight,
    private readonly ambient: THREE.AmbientLight,
  ) {
    // A dome of stars: drawn behind everything, unaffected by fog, faded in at night.
    const n = 700;
    const pos = new Float32Array(n * 3);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2;
      const e = 0.12 + rnd() * 1.3;
      pos[i * 3] = Math.cos(a) * Math.cos(e) * 380;
      pos[i * 3 + 1] = Math.sin(e) * 380;
      pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 380;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#fff7e0', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.renderOrder = -1;
    this.stars.frustumCulled = false;
    scene.add(this.stars);
  }

  hour(): number {
    if (this.override !== null) return this.override;
    return this.mode === 'day' ? 12 : localHour();
  }

  /** Applies the look for the current hour; `focus` keeps the stars centred on the view. */
  update(focus: THREE.Vector3): void {
    this.stars.position.set(focus.x, 0, focus.z);
    const h = ((this.hour() % 24) + 24) % 24;
    if (Math.abs(h - this.lastHour) < 0.002 && Math.abs(this.overcast - this.lastOvercast) < 0.005) return;
    this.lastHour = h;
    this.lastOvercast = this.overcast;
    const o = this.overcast;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].hour <= h) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = (h - a.hour) / Math.max(0.0001, b.hour - a.hour);
    const k = t * t * (3 - 2 * t);
    lerpColor(a.sky, b.sky, k, this.sky);
    // Cloud: a soft grey by day, a deeper slate at night.
    c1.copy(this.sky);
    this.sky.lerp(c2.set('#8f9aa6').lerp(c1.clone().multiplyScalar(0.7), Math.min(1, a.glow * (1 - k) + b.glow * k)), o * 0.6);
    this.scene.background = this.sky;
    this.renderer.setClearColor(this.sky);
    (this.scene.fog as THREE.Fog).color.copy(this.sky);
    lerpColor(a.sun, b.sun, k, this.sun.color);
    this.sun.intensity = (a.sunIntensity + (b.sunIntensity - a.sunIntensity) * k) * (1 - o * 0.62);
    lerpColor(a.hemiSky, b.hemiSky, k, this.hemi.color);
    lerpColor(a.hemiGround, b.hemiGround, k, this.hemi.groundColor);
    this.hemi.intensity = (a.hemiIntensity + (b.hemiIntensity - a.hemiIntensity) * k) * (1 + o * 0.08);
    this.hemi.color.lerp(c1.set('#c9d3dd'), o * 0.5);
    this.ambient.intensity = a.ambient + (b.ambient - a.ambient) * k;
    this.renderer.toneMappingExposure = (a.exposure + (b.exposure - a.exposure) * k) * (1 - o * 0.12);
    const glow = a.glow + (b.glow - a.glow) * k;
    this.night = glow;
    setNightGlow(glow);
    lerpColor(a.tint, b.tint, k, sharedUniforms.uDayTint.value);
    (this.stars.material as THREE.PointsMaterial).opacity = Math.max(0, glow - 0.35) * 1.4 * (1 - o);
    this.stars.visible = glow > 0.36 && o < 0.95;
  }

  /**
   * Where the light comes from, as an offset from the shadow target: the sun crosses
   * from east (morning) to west (evening), high at midday; at night the moon makes the
   * same trip, lower. It always stays on the camera's side so shadows read well.
   */
  lightOffset(out = new THREE.Vector3()): THREE.Vector3 {
    const h = ((this.hour() % 24) + 24) % 24;
    const day = h >= 6 && h < 20;
    const t = day ? (h - 6) / 14 : ((h + 4) % 24) / 10;
    const height = day ? 22 + Math.sin(t * Math.PI) * 20 : 26 + Math.sin(t * Math.PI) * 8;
    return out.set(30 - 60 * t, height, 16);
  }
}
