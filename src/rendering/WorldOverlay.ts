import * as THREE from 'three';

interface Badge {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  html: string;
  className: string;
  seen: boolean;
  x: number;
  y: number;
}

interface Floater {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  born: number;
  life: number;
}

const tmp = new THREE.Vector3();

/**
 * Crisp HTML labels pinned to world positions: villager status badges, construction
 * progress, floating "+4" numbers and the tutorial pointer. Positions are projected
 * every frame and written as transforms only (no layout work).
 */
export class WorldOverlay {
  private readonly badges = new Map<string, Badge>();
  private readonly floaters: Floater[] = [];
  private width = 1;
  private height = 1;

  constructor(private readonly root: HTMLElement, private readonly camera: THREE.Camera) {
    this.resize();
  }

  resize(): void {
    this.width = this.root.clientWidth || window.innerWidth;
    this.height = this.root.clientHeight || window.innerHeight;
  }

  beginFrame(): void {
    for (const b of this.badges.values()) b.seen = false;
  }

  badge(key: string, pos: THREE.Vector3, html: string, className: string): void {
    let b = this.badges.get(key);
    if (!b) {
      const el = document.createElement('div');
      this.root.appendChild(el);
      b = { el, pos: new THREE.Vector3(), html: '', className: '', seen: true, x: NaN, y: NaN };
      this.badges.set(key, b);
    }
    b.seen = true;
    b.pos.copy(pos);
    if (b.html !== html) {
      b.el.innerHTML = html;
      b.html = html;
    }
    if (b.className !== className) {
      b.el.className = `wo ${className}`;
      b.className = className;
    }
  }

  float(pos: THREE.Vector3, html: string, className = 'wo-float', life = 1.6): void {
    const el = document.createElement('div');
    el.className = `wo ${className}`;
    el.innerHTML = html;
    this.root.appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), born: performance.now(), life: life * 1000 });
  }

  private project(pos: THREE.Vector3): { x: number; y: number; visible: boolean } {
    tmp.copy(pos).project(this.camera);
    const visible = tmp.z < 1 && tmp.x > -1.2 && tmp.x < 1.2 && tmp.y > -1.2 && tmp.y < 1.2;
    return { x: (tmp.x * 0.5 + 0.5) * this.width, y: (-tmp.y * 0.5 + 0.5) * this.height, visible };
  }

  endFrame(): void {
    for (const [key, b] of this.badges) {
      if (!b.seen) {
        b.el.remove();
        this.badges.delete(key);
        continue;
      }
      const p = this.project(b.pos);
      if (!p.visible) {
        b.el.style.display = 'none';
        continue;
      }
      b.el.style.display = '';
      const x = Math.round(p.x * 2) / 2;
      const y = Math.round(p.y * 2) / 2;
      if (x !== b.x || y !== b.y) {
        b.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        b.x = x;
        b.y = y;
      }
    }
    const now = performance.now();
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      const t = (now - f.born) / f.life;
      if (t >= 1) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      const p = this.project(f.pos);
      f.el.style.display = p.visible ? '' : 'none';
      f.el.style.transform = `translate3d(${p.x}px, ${p.y - t * 46}px, 0)`;
      f.el.style.opacity = String(t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3);
    }
  }
}
