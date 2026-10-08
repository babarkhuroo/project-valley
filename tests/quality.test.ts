import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { QualityGovernor } from '../src/rendering/Quality';

function fake() {
  (globalThis as unknown as { window: object }).window = { devicePixelRatio: 2, matchMedia: () => ({ matches: false }) };
  const renderer = { ratio: 0, setPixelRatio(r: number) { this.ratio = r; }, shadowMap: { enabled: true } };
  const sun = { castShadow: true, shadow: { mapSize: new THREE.Vector2(2048, 2048), map: null } };
  let resized = 0;
  const q = new QualityGovernor(renderer as unknown as THREE.WebGLRenderer, sun as unknown as THREE.DirectionalLight, () => resized++);
  const frames = (ms: number, n: number) => {
    for (let i = 0; i < n; i++) q.update(ms / 1000);
  };
  return { q, renderer, sun, frames, resized: () => resized };
}

describe('quality governor', () => {
  it('fixed presets set resolution and shadows', () => {
    const { q, renderer, sun } = fake();
    q.preset = 'low';
    q.update(0.016);
    expect(renderer.ratio).toBe(1);
    expect(renderer.shadowMap.enabled).toBe(false);
    q.preset = 'high';
    q.update(0.016);
    expect(renderer.ratio).toBe(2);
    expect(sun.castShadow).toBe(true);
  });

  it('auto drops resolution, then shadows, when frames run slow — and recovers', () => {
    const { q, renderer, frames } = fake();
    frames(16, 90);
    expect(renderer.ratio).toBe(2);
    frames(40, 90 * 4);
    expect(q.scale).toBeCloseTo(0.6);
    expect(renderer.ratio).toBeCloseTo(1.2);
    frames(40, 90);
    expect(renderer.shadowMap.enabled).toBe(false);
    frames(10, 90 * 4);
    expect(renderer.shadowMap.enabled).toBe(true);
    frames(10, 90 * 4 * 5);
    expect(q.scale).toBeCloseTo(1);
  });
});
