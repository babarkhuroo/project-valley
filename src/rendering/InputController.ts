import * as THREE from 'three';
import type { CameraController } from './CameraController';

export type PickTarget = { kind: 'villager'; id: number } | { kind: 'building'; id: number } | { kind: 'node'; id: number };

export interface PickResult {
  target: PickTarget | null;
  ground: THREE.Vector3 | null;
}

export interface InteractionHandler {
  onHover(target: PickTarget | null): void;
  onClick(result: PickResult, touch: boolean): void;
  onGroundMove(ground: THREE.Vector3 | null): void;
  onCancel(): void;
  onRotate(): void;
}

interface Picker {
  pick(ndc: THREE.Vector2): PickResult;
  groundAt(ndc: THREE.Vector2): THREE.Vector3 | null;
}

interface PointerInfo {
  x: number;
  y: number;
  startX: number;
  startY: number;
  button: number;
}

const CLICK_SLOP = 7;

/**
 * Turns mouse, touch and keyboard input into camera motion and world clicks.
 * Drag = pan (the grabbed ground point stays under the finger), wheel/pinch = zoom
 * towards the cursor, right-drag or Q/E = rotate, WASD/arrows = pan.
 */
export class InputController {
  private readonly pointers = new Map<number, PointerInfo>();
  private dragging = false;
  private anchor: THREE.Vector3 | null = null;
  private pinchDistance = 0;
  private pinchAnchor: THREE.Vector3 | null = null;
  private readonly keys = new Set<string>();
  private readonly recent: { t: number; x: number; z: number }[] = [];
  private hoverPending: { x: number; y: number } | null = null;
  private readonly ndc = new THREE.Vector2();
  private readonly listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: CameraController,
    private readonly picker: Picker,
    private readonly handler: InteractionHandler,
  ) {
    this.listen(canvas, 'pointerdown', (e) => this.onDown(e as PointerEvent));
    this.listen(canvas, 'pointermove', (e) => this.onMove(e as PointerEvent));
    this.listen(canvas, 'pointerup', (e) => this.onUp(e as PointerEvent));
    this.listen(canvas, 'pointercancel', (e) => this.onUp(e as PointerEvent, true));
    this.listen(canvas, 'pointerleave', () => {
      if (this.pointers.size === 0) this.handler.onHover(null);
    });
    this.listen(canvas, 'wheel', (e) => this.onWheel(e as WheelEvent), { passive: false });
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.listen(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.listen(window, 'blur', () => this.keys.clear());
  }

  private listen(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.listeners.push([target, type, fn, opts]);
  }

  dispose(): void {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
  }

  private toNdc(x: number, y: number): THREE.Vector2 {
    const r = this.canvas.getBoundingClientRect();
    return this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1).clone();
  }

  private onDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, button: e.button });
    this.camera.setVelocity(0, 0);
    this.recent.length = 0;
    if (this.pointers.size === 1) {
      this.dragging = false;
      this.anchor = this.camera.groundAt(this.toNdc(e.clientX, e.clientY));
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      this.pinchAnchor = this.camera.groundAt(this.toNdc((a.x + b.x) / 2, (a.y + b.y) / 2));
      this.dragging = true;
    }
  }

  private onMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      this.hoverPending = { x: e.clientX, y: e.clientY };
      return;
    }
    const prevX = p.x;
    p.x = e.clientX;
    p.y = e.clientY;
    if (this.pointers.size === 2) {
      this.handlePinch();
      return;
    }
    if (!this.dragging && Math.hypot(p.x - p.startX, p.y - p.startY) > CLICK_SLOP) {
      this.dragging = true;
      this.camera.dragging = true;
    }
    if (!this.dragging) {
      this.hoverPending = { x: e.clientX, y: e.clientY };
      return;
    }
    if (p.button === 2) {
      this.camera.rotateBy(-(p.x - prevX) * 0.006);
      return;
    }
    if (this.anchor) {
      const now = this.camera.groundAt(this.toNdc(p.x, p.y));
      if (now) {
        const dx = this.anchor.x - now.x;
        const dz = this.anchor.z - now.z;
        this.camera.panBy(dx, dz);
        this.recent.push({ t: performance.now(), x: dx, z: dz });
        if (this.recent.length > 6) this.recent.shift();
      }
    }
  }

  private handlePinch(): void {
    const [a, b] = [...this.pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (this.pinchDistance > 0 && dist > 0) this.camera.zoomBy(this.pinchDistance / dist, this.pinchAnchor);
    this.pinchDistance = dist;
    if (this.pinchAnchor) {
      const mid = this.camera.groundAt(this.toNdc((a.x + b.x) / 2, (a.y + b.y) / 2));
      if (mid) this.camera.panBy(this.pinchAnchor.x - mid.x, this.pinchAnchor.z - mid.z);
    }
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.pointers.size > 0) {
      // Finishing a pinch: re-anchor the remaining finger so the pan continues smoothly.
      const rest = [...this.pointers.values()][0];
      this.anchor = this.camera.groundAt(this.toNdc(rest.x, rest.y));
      return;
    }
    this.camera.dragging = false;
    if (this.dragging) {
      const now = performance.now();
      const recent = this.recent.filter((r) => now - r.t < 90);
      if (recent.length > 1) {
        const span = Math.max(16, now - recent[0].t) / 1000;
        const vx = recent.reduce((s, r) => s + r.x, 0) / span;
        const vz = recent.reduce((s, r) => s + r.z, 0) / span;
        this.camera.setVelocity(vx * 0.6, vz * 0.6);
      }
    } else if (!cancelled && p.button !== 2) {
      this.handler.onClick(this.picker.pick(this.toNdc(e.clientX, e.clientY)), e.pointerType === 'touch');
    }
    this.dragging = false;
    this.anchor = null;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const focus = this.camera.groundAt(this.toNdc(e.clientX, e.clientY));
    this.camera.zoomBy(Math.exp(delta * 0.0014), focus);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (down) {
      if (k === 'escape') this.handler.onCancel();
      if (k === 'r' && !e.repeat) this.handler.onRotate();
      if (k === 'q') this.camera.rotateBy(Math.PI / 4);
      if (k === 'e') this.camera.rotateBy(-Math.PI / 4);
      if (k === '+' || k === '=') this.camera.zoomBy(0.85);
      if (k === '-' || k === '_') this.camera.zoomBy(1 / 0.85);
      this.keys.add(k);
    } else {
      this.keys.delete(k);
    }
  }

  /** Per-frame work: keyboard panning and throttled hover picking. */
  update(dt: number): void {
    let fx = 0;
    let fz = 0;
    if (this.keys.has('w') || this.keys.has('arrowup')) fz -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) fz += 1;
    if (this.keys.has('a') || this.keys.has('arrowleft')) fx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) fx += 1;
    if (fx || fz) {
      const speed = this.camera.distance * 1.1 * dt;
      const yaw = this.camera.yaw;
      const dx = (fx * Math.cos(yaw) + fz * Math.sin(yaw)) * speed;
      const dz = (-fx * Math.sin(yaw) + fz * Math.cos(yaw)) * speed;
      this.camera.panBy(dx, dz);
    }
    if (this.hoverPending && !this.dragging) {
      const ndc = this.toNdc(this.hoverPending.x, this.hoverPending.y);
      this.hoverPending = null;
      const result = this.picker.pick(ndc);
      this.handler.onHover(result.target);
      this.handler.onGroundMove(result.ground ?? this.picker.groundAt(ndc));
    }
  }
}
