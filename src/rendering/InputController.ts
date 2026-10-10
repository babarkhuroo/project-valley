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
  touch: boolean;
}

/** What the fingers are holding: a ground point that stays under them, plus pinch and twist. */
interface Gesture {
  anchor: THREE.Vector3;
  /** Ground distance between the two fingers when this hold began (pinch zoom keeps it). */
  groundSpread: number;
  /** Finger spread and camera distance when this hold began. */
  spread: number;
  distance: number;
  /** Finger angle and camera yaw when twisting began (two-finger rotate). */
  angle: number;
  yaw: number;
  twisting: boolean;
  fingers: number;
}

const CLICK_SLOP = 7;
const TOUCH_SLOP = 10;
/** A two-finger twist past this angle (radians) starts rotating the view. */
const TWIST_START = 0.22;

/**
 * Turns mouse, touch and keyboard input into camera motion and world clicks.
 * Drag = pan (the grabbed ground point stays under the finger), wheel/pinch = zoom
 * towards the cursor, two-finger twist / right-drag / Q/E = rotate, WASD/arrows = pan.
 *
 * Pointer events only record where the fingers are; the camera is solved once per
 * frame (`update`) from those positions, so several move events between frames — touch
 * screens often sample at 120 Hz+ — can't pile up pans computed from a stale camera.
 */
export class InputController {
  private readonly pointers = new Map<number, PointerInfo>();
  private dragging = false;
  private gesture: Gesture | null = null;
  private moved = false;
  private readonly keys = new Set<string>();
  /** Recent camera targets while dragging, for the fling on release. */
  private readonly trail: { t: number; x: number; z: number }[] = [];
  private hoverPending: { x: number; y: number } | null = null;
  private rect: DOMRect | null = null;
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
    this.listen(canvas, 'pointerleave', (e) => {
      if (this.pointers.size === 0 && (e as PointerEvent).pointerType !== 'touch') this.handler.onHover(null);
    });
    this.listen(canvas, 'wheel', (e) => this.onWheel(e as WheelEvent), { passive: false });
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
    this.listen(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.listen(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.listen(window, 'blur', () => this.keys.clear());
    this.listen(window, 'resize', () => (this.rect = null));
  }

  private listen(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.listeners.push([target, type, fn, opts]);
  }

  /** Whether a finger or the mouse is moving the view right now. */
  get active(): boolean {
    return this.dragging;
  }

  dispose(): void {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
  }

  private toNdc(x: number, y: number): THREE.Vector2 {
    // Reading layout on every move forces style recalculation; the canvas only moves on resize.
    const r = (this.rect ??= this.canvas.getBoundingClientRect());
    return this.ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1).clone();
  }

  /** Centre, spread and angle of the first two fingers (or the one finger). */
  private fingers(): { x: number; y: number; spread: number; angle: number; count: number; a: PointerInfo; b: PointerInfo | undefined } {
    const [a, b] = this.pointers.values();
    if (!b) return { x: a.x, y: a.y, spread: 0, angle: 0, count: 1, a, b };
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(a.x - b.x, a.y - b.y), angle: Math.atan2(b.y - a.y, b.x - a.x), count: 2, a, b };
  }

  /** Ground distance between two screen points with the camera as it is now. */
  private groundSpread(a: PointerInfo, b: PointerInfo): number {
    const pa = this.camera.groundAt(this.toNdc(a.x, a.y));
    const pb = this.camera.groundAt(this.toNdc(b.x, b.y));
    return pa && pb ? Math.hypot(pa.x - pb.x, pa.z - pb.z) : 0;
  }

  /** (Re)starts holding whatever ground is under the fingers now — on drag start and whenever a finger joins or leaves. */
  private hold(useStart = false): void {
    const f = this.fingers();
    let { x, y } = f;
    if (useStart && f.count === 1) {
      // The drag starts where the finger went down, not where it crossed the slop.
      const [p] = this.pointers.values();
      x = p.startX;
      y = p.startY;
    }
    this.camera.beginHold();
    const anchor = this.camera.groundAt(this.toNdc(x, y));
    this.gesture = anchor
      ? { anchor, groundSpread: f.b ? this.groundSpread(f.a, f.b) : 0, spread: f.spread, distance: this.camera.distance, angle: f.angle, yaw: this.camera.yaw, twisting: false, fingers: f.count }
      : null;
    this.trail.length = 0;
    this.moved = true;
  }

  private onDown(e: PointerEvent): void {
    this.canvas.setPointerCapture(e.pointerId);
    this.rect = null;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, button: e.button, touch: e.pointerType === 'touch' });
    this.camera.setVelocity(0, 0);
    if (this.pointers.size === 1) {
      this.dragging = false;
      this.gesture = null;
    } else {
      this.dragging = true;
      this.hold();
    }
  }

  private onMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType !== 'touch') this.hoverPending = { x: e.clientX, y: e.clientY };
      return;
    }
    const prevX = p.x;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!this.dragging && Math.hypot(p.x - p.startX, p.y - p.startY) > (p.touch ? TOUCH_SLOP : CLICK_SLOP)) {
      this.dragging = true;
      if (p.button !== 2) this.hold(true);
    }
    if (!this.dragging) {
      if (!p.touch) this.hoverPending = { x: e.clientX, y: e.clientY };
      return;
    }
    if (p.button === 2 && this.pointers.size === 1) {
      this.camera.rotateBy(-(p.x - prevX) * 0.006);
      return;
    }
    this.moved = true;
  }

  /** Solves the camera for the fingers' current positions (once per frame). */
  private applyGesture(): void {
    const g = this.gesture;
    if (!g || !this.moved) return;
    this.moved = false;
    const f = this.fingers();
    if (f.count !== g.fingers) return;
    if (f.count === 2 && g.spread > 0 && f.spread > 0) {
      let yaw = this.camera.yaw;
      let turn = Math.atan2(Math.sin(f.angle - g.angle), Math.cos(f.angle - g.angle));
      if (!g.twisting && Math.abs(turn) > TWIST_START) {
        g.twisting = true;
        g.angle = f.angle;
        g.yaw = this.camera.yaw;
        turn = 0;
      }
      if (g.twisting) yaw = g.yaw + turn;
      // Zoom so the ground under both fingers stays under them: start from the spread
      // ratio, then correct for the pitch easing with distance.
      let distance = g.distance * (g.spread / f.spread);
      for (let i = 0; i < 3; i++) {
        this.camera.setPose(distance, yaw);
        this.camera.sync();
        const now = g.groundSpread > 0 ? this.groundSpread(f.a, f.b!) : 0;
        if (now <= 0 || Math.abs(now - g.groundSpread) < 1e-3 * g.groundSpread) break;
        distance *= g.groundSpread / now;
      }
    }
    this.camera.holdUnder(g.anchor, this.toNdc(f.x, f.y));
    const t = this.camera.target;
    this.trail.push({ t: performance.now(), x: t.x, z: t.z });
    if (this.trail.length > 10) this.trail.shift();
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.applyGesture();
    this.pointers.delete(e.pointerId);
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (this.pointers.size > 0) {
      // A finger left a pinch: keep holding the ground under the ones still down.
      if (this.dragging) this.hold();
      return;
    }
    if (this.dragging) {
      this.camera.endHold();
      if (this.gesture?.fingers === 1) this.fling();
    } else if (!cancelled && p.button !== 2) {
      this.handler.onClick(this.picker.pick(this.toNdc(e.clientX, e.clientY)), p.touch);
    }
    this.dragging = false;
    this.gesture = null;
  }

  /** Lets the view glide on after a quick swipe. */
  private fling(): void {
    const now = performance.now();
    const last = this.trail[this.trail.length - 1];
    // A finger that paused before lifting shouldn't throw the view.
    if (!last || now - last.t > 60) return;
    const first = this.trail.find((s) => now - s.t < 110);
    if (!first || first === last) return;
    const span = Math.max(0.016, (last.t - first.t) / 1000);
    this.camera.setVelocity(((last.x - first.x) / span) * 0.85, ((last.z - first.z) / span) * 0.85);
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

  /** Per-frame work, before the camera updates: the touch/drag gesture, keyboard panning and throttled hover picking. */
  update(dt: number): void {
    if (this.dragging) this.applyGesture();
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
