import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CameraController } from '../src/rendering/CameraController';

const BOUNDS = { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };

function rig(height: (x: number, z: number) => number = () => 0) {
  const cam = new THREE.PerspectiveCamera(45, 375 / 812, 0.5, 400);
  return new CameraController(cam, BOUNDS, new THREE.Vector3(0, 0, 0), height);
}

const screenOf = (c: CameraController, p: THREE.Vector3) => p.clone().project(c.camera);

describe('camera gestures', () => {
  it('holding the ground keeps the grabbed point under the finger, even over hills', () => {
    const c = rig((x, z) => Math.max(0, 6 - Math.hypot(x - 8, z + 4)));
    const ndc = new THREE.Vector2(0.2, -0.3);
    const grabbed = c.groundAt(ndc)!;
    c.beginHold();
    // The finger moves across the screen in uneven steps; the camera follows exactly.
    for (const [x, y] of [[0.25, -0.2], [0.4, 0.1], [0.38, 0.35], [-0.1, 0.5]]) {
      const at = new THREE.Vector2(x, y);
      c.holdUnder(grabbed, at);
      const under = c.groundAt(at)!;
      expect(Math.hypot(under.x - grabbed.x, under.z - grabbed.z)).toBeLessThan(0.01);
    }
    c.endHold();
  });

  it('pinch zoom and twist apply immediately while held', () => {
    const c = rig();
    c.beginHold();
    c.setPose(12, 0.4);
    c.update(1 / 60);
    expect(c.distance).toBeCloseTo(12, 6);
    expect(c.yaw).toBeCloseTo(0.4, 6);
    c.setPose(1, 0.4);
    expect(c.distance).toBe(c.minDistance);
  });

  it('a focus can land above a bottom sheet instead of the centre', () => {
    const c = rig();
    const point = new THREE.Vector3(10, 0, -6);
    c.focusAt.set(0, 0.3);
    c.focusOn(point, 20);
    for (let i = 0; i < 240; i++) c.update(1 / 60);
    const v = screenOf(c, point);
    expect(v.x).toBeCloseTo(0, 2);
    expect(v.y).toBeCloseTo(0.3, 2);
  });

  it('reveal moves the view only when the point is covered', () => {
    const c = rig();
    for (let i = 0; i < 60; i++) c.update(1 / 60);
    const visible = c.groundAt(new THREE.Vector2(0, 0.4))!;
    c.reveal(visible, { top: 0.15, bottom: 0.5, left: 0, right: 0 });
    expect(c.settled).toBe(true);
    const covered = c.groundAt(new THREE.Vector2(0, -0.6))!;
    c.reveal(covered, { top: 0.15, bottom: 0.5, left: 0, right: 0 });
    for (let i = 0; i < 240; i++) c.update(1 / 60);
    const y = screenOf(c, covered).y;
    expect(y).toBeGreaterThan(0.08);
    expect(y).toBeLessThan(0.62);
  });
});
