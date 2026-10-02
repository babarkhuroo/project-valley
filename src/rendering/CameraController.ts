import * as THREE from 'three';

/**
 * Three-quarter strategy camera: orbits a ground target at a pitch that eases from
 * ~34° (close, to watch villagers) to ~56° (far, to read the whole village).
 * All motion is damped; nothing snaps.
 */
export class CameraController {
  readonly target = new THREE.Vector3();
  distance = 24;
  yaw = 0;
  readonly minDistance: number;
  readonly maxDistance: number;
  private readonly goalTarget = new THREE.Vector3();
  private goalDistance = 24;
  private goalYaw = 0;
  private readonly velocity = new THREE.Vector2();
  private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly ray = new THREE.Raycaster();
  /** Set while the user drags so inertia and focus animations don't fight them. */
  dragging = false;

  constructor(
    readonly camera: THREE.PerspectiveCamera,
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    start: THREE.Vector3,
    /** Terrain height lookup so the camera never dips into hills. */
    private readonly groundHeight: (x: number, z: number) => number = () => 0,
    zoom: { min: number; max: number } = { min: 7, max: 62 },
  ) {
    this.minDistance = zoom.min;
    this.maxDistance = zoom.max;
    this.bounds = bounds;
    this.target.copy(start);
    this.goalTarget.copy(start);
    this.apply();
  }

  pitchFor(distance: number): number {
    const t = (distance - this.minDistance) / (this.maxDistance - this.minDistance);
    return THREE.MathUtils.lerp(0.6, 0.98, Math.max(0, Math.min(1, t)));
  }

  /** Ground point under a normalised device coordinate. */
  groundAt(ndc: THREE.Vector2, y = 0): THREE.Vector3 | null {
    this.ray.setFromCamera(ndc, this.camera);
    this.plane.constant = -y;
    const out = new THREE.Vector3();
    return this.ray.ray.intersectPlane(this.plane, out);
  }

  panBy(dx: number, dz: number): void {
    this.goalTarget.x += dx;
    this.goalTarget.z += dz;
    this.clampGoal();
    this.target.x += dx;
    this.target.z += dz;
    this.clampTarget();
  }

  setVelocity(vx: number, vz: number): void {
    this.velocity.set(vx, vz);
  }

  zoomBy(factor: number, focus?: THREE.Vector3 | null): void {
    const before = this.goalDistance;
    this.goalDistance = THREE.MathUtils.clamp(this.goalDistance * factor, this.minDistance, this.maxDistance);
    if (focus) {
      // Zoom towards the cursor so the point under it stays put.
      const k = 1 - this.goalDistance / before;
      this.goalTarget.x += (focus.x - this.goalTarget.x) * k;
      this.goalTarget.z += (focus.z - this.goalTarget.z) * k;
      this.clampGoal();
    }
  }

  rotateBy(radians: number): void {
    this.goalYaw += radians;
  }

  focusOn(point: THREE.Vector3, distance?: number): void {
    this.goalTarget.set(point.x, 0, point.z);
    this.clampGoal();
    if (distance !== undefined) this.goalDistance = THREE.MathUtils.clamp(distance, this.minDistance, this.maxDistance);
    this.velocity.set(0, 0);
  }

  private clampGoal(): void {
    this.goalTarget.x = THREE.MathUtils.clamp(this.goalTarget.x, this.bounds.minX, this.bounds.maxX);
    this.goalTarget.z = THREE.MathUtils.clamp(this.goalTarget.z, this.bounds.minZ, this.bounds.maxZ);
  }

  private clampTarget(): void {
    this.target.x = THREE.MathUtils.clamp(this.target.x, this.bounds.minX, this.bounds.maxX);
    this.target.z = THREE.MathUtils.clamp(this.target.z, this.bounds.minZ, this.bounds.maxZ);
  }

  update(dt: number): void {
    if (!this.dragging && this.velocity.lengthSq() > 1e-4) {
      this.panBy(this.velocity.x * dt, this.velocity.y * dt);
      this.velocity.multiplyScalar(Math.exp(-dt * 4.5));
    }
    const k = 1 - Math.exp(-dt * 8);
    if (!this.dragging) this.target.lerp(this.goalTarget, k);
    else this.goalTarget.copy(this.target);
    this.distance += (this.goalDistance - this.distance) * k;
    this.yaw += (this.goalYaw - this.yaw) * k;
    this.apply();
  }

  private apply(): void {
    const pitch = this.pitchFor(this.distance);
    const horizontal = Math.cos(pitch) * this.distance;
    const pos = this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horizontal,
      this.target.y + Math.sin(pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * horizontal,
    );
    // Lift the camera if the line of sight to the target would pass through terrain.
    let lift = pos.y;
    for (const t of [0.35, 0.6, 0.8, 1]) {
      const x = this.target.x + (pos.x - this.target.x) * t;
      const z = this.target.z + (pos.z - this.target.z) * t;
      const need = this.groundHeight(x, z) + 2.2;
      const lineY = this.target.y + (pos.y - this.target.y) * t;
      if (lineY < need) lift = Math.max(lift, this.target.y + (need - this.target.y) / t);
    }
    pos.y = lift;
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
