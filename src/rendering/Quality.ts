import * as THREE from 'three';
import type { EffectsLevel } from './PostFX';

export type QualityPreset = 'auto' | 'high' | 'balanced' | 'low';

interface Level {
  /** Device-pixel-ratio cap. */
  pixelRatio: number;
  /** Shadow map size, or 0 for no shadows. */
  shadows: number;
}

const LEVELS: Record<Exclude<QualityPreset, 'auto'>, Level> = {
  high: { pixelRatio: 2, shadows: 2048 },
  balanced: { pixelRatio: 1.5, shadows: 1024 },
  low: { pixelRatio: 1, shadows: 0 },
};

/** Frame-time targets for the automatic preset (ms). */
const SLOW_MS = 26;
const FAST_MS = 15;
const MIN_SCALE = 0.6;

/**
 * Rendering quality: a fixed preset, or `auto`, which watches frame times and trades
 * resolution for smoothness — dropping render scale when frames run long (phones,
 * old laptops) and creeping back up when there's headroom. Shadows switch with the
 * preset; `auto` keeps them unless resolution alone can't recover the frame rate.
 */
export class QualityGovernor {
  preset: QualityPreset = 'auto';
  /** Current render scale applied on top of the preset's pixel-ratio cap (auto only). */
  scale = 1;
  private applied = '';
  private window: number[] = [];
  private calm = 0;
  private shadowsOff = false;
  /**
   * The lowest scale that has run too slow, and for how many more windows it stays off
   * limits — so `auto` doesn't climb back into it and re-allocate its render targets
   * every few seconds (each change is a visible hitch on phones).
   */
  private ceiling = 1;
  private ceilingWindows = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly sun: THREE.DirectionalLight,
    private readonly onResize: () => void,
  ) {}

  private level(): Level {
    if (this.preset !== 'auto') return LEVELS[this.preset];
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    return { pixelRatio: (coarse ? 1.5 : 2) * this.scale, shadows: this.shadowsOff ? 0 : coarse ? 1024 : 2048 };
  }

  private apply(): void {
    const l = this.level();
    const ratio = Math.max(0.5, Math.min(window.devicePixelRatio || 1, l.pixelRatio));
    const key = `${ratio.toFixed(2)}|${l.shadows}`;
    if (key === this.applied) return;
    this.applied = key;
    this.renderer.setPixelRatio(ratio);
    const shadows = l.shadows > 0;
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    if (shadows && this.sun.shadow.mapSize.x !== l.shadows) {
      this.sun.shadow.mapSize.set(l.shadows, l.shadows);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.onResize();
  }

  /**
   * Post-processing for this preset: everything on High, no tilt-shift blur on
   * Balanced, none on Low. Automatic steps down with the resolution it is already
   * trading away, and drops post-processing entirely before it drops shadows.
   */
  get effects(): EffectsLevel {
    switch (this.preset) {
      case 'high':
        return 'full';
      case 'balanced':
        return 'light';
      case 'low':
        return 'off';
      default:
        return this.shadowsOff || this.scale <= MIN_SCALE + 0.01 ? 'off' : this.scale < 0.9 ? 'light' : 'full';
    }
  }

  /** Call once per frame with the real frame time (seconds). */
  update(realDt: number): void {
    if (this.preset === 'auto' && realDt > 0 && realDt < 0.5) {
      this.window.push(realDt * 1000);
      if (this.window.length >= 90) {
        const sorted = [...this.window].sort((a, b) => a - b);
        const typical = sorted[Math.floor(sorted.length * 0.5)];
        this.window = [];
        if (this.ceilingWindows > 0 && --this.ceilingWindows === 0) this.ceiling = 1;
        if (typical > SLOW_MS) {
          this.calm = 0;
          this.ceiling = Math.min(this.ceiling, this.scale - 0.01);
          this.ceilingWindows = 40;
          if (this.scale > MIN_SCALE + 0.01) this.scale = Math.max(MIN_SCALE, this.scale - 0.15);
          else this.shadowsOff = true;
        } else if (typical < FAST_MS && ++this.calm >= 4) {
          this.calm = 0;
          if (this.shadowsOff) this.shadowsOff = false;
          else if (this.scale + 0.1 <= this.ceiling) this.scale = Math.min(1, this.scale + 0.1);
        }
      }
    }
    this.apply();
  }
}
