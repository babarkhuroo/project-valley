import type { NavGrid } from './grid';
import type { Route, Vec2 } from './types';

const SQRT2 = Math.SQRT2;
const MIN_COST = 0.75;
const MAX_EXPANSIONS = 30000;

/** Reusable scratch buffers so repeated searches do not allocate. */
class Scratch {
  g: Float32Array;
  parent: Int32Array;
  stamp: Uint32Array;
  closed: Uint32Array;
  heap: Int32Array;
  f: Float32Array;
  generation = 0;

  constructor(size: number) {
    this.g = new Float32Array(size);
    this.parent = new Int32Array(size);
    this.stamp = new Uint32Array(size);
    this.closed = new Uint32Array(size);
    this.heap = new Int32Array(size * 2);
    this.f = new Float32Array(size);
  }
}

const scratchBySize = new Map<number, Scratch>();

function scratchFor(size: number): Scratch {
  let s = scratchBySize.get(size);
  if (!s) {
    s = new Scratch(size);
    scratchBySize.set(size, s);
  }
  s.generation++;
  return s;
}

function octile(ax: number, az: number, bx: number, bz: number): number {
  const dx = Math.abs(ax - bx);
  const dz = Math.abs(az - bz);
  return (Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz)) * MIN_COST;
}

/**
 * A* over the tile grid with 8-way movement (no corner cutting), followed by
 * line-of-sight smoothing that keeps villagers on roads when they are on one.
 * Returns world-space waypoints from `from` to `to`, or null when unreachable.
 */
export function findPath(grid: NavGrid, from: Vec2, to: Vec2): Vec2[] | null {
  const startCell = grid.walkableAt(from) ? { x: from.x, z: from.z } : grid.nearestWalkable(from);
  const goalCell = grid.walkableAt(to) ? { x: to.x, z: to.z } : grid.nearestWalkable(to);
  if (!startCell || !goalCell) return null;
  const sx = Math.floor(startCell.x);
  const sz = Math.floor(startCell.z);
  const gx = Math.floor(goalCell.x);
  const gz = Math.floor(goalCell.z);
  const W = grid.width;
  const start = sz * W + sx;
  const goal = gz * W + gx;
  const endPoint = grid.walkableAt(to) ? to : goalCell;

  if (start === goal) {
    return dedupe([from, startCell, endPoint]);
  }

  const s = scratchFor(W * grid.height);
  const gen = s.generation;
  let heapSize = 0;

  const push = (idx: number): void => {
    let i = heapSize++;
    s.heap[i] = idx;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (s.f[s.heap[p]] <= s.f[s.heap[i]]) break;
      const tmp = s.heap[p];
      s.heap[p] = s.heap[i];
      s.heap[i] = tmp;
      i = p;
    }
  };
  const pop = (): number => {
    const top = s.heap[0];
    heapSize--;
    if (heapSize > 0) {
      s.heap[0] = s.heap[heapSize];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heapSize && s.f[s.heap[l]] < s.f[s.heap[m]]) m = l;
        if (r < heapSize && s.f[s.heap[r]] < s.f[s.heap[m]]) m = r;
        if (m === i) break;
        const tmp = s.heap[m];
        s.heap[m] = s.heap[i];
        s.heap[i] = tmp;
        i = m;
      }
    }
    return top;
  };

  s.stamp[start] = gen;
  s.g[start] = 0;
  s.parent[start] = -1;
  s.f[start] = octile(sx, sz, gx, gz);
  push(start);

  let found = false;
  let expansions = 0;
  while (heapSize > 0 && expansions++ < MAX_EXPANSIONS) {
    const cur = pop();
    if (s.closed[cur] === gen) continue;
    s.closed[cur] = gen;
    if (cur === goal) {
      found = true;
      break;
    }
    const cx = cur % W;
    const cz = (cur - cx) / W;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        const nx = cx + dx;
        const nz = cz + dz;
        if (!grid.walkable(nx, nz)) continue;
        if (dx !== 0 && dz !== 0 && (!grid.walkable(cx + dx, cz) || !grid.walkable(cx, cz + dz))) continue;
        const ni = nz * W + nx;
        if (s.closed[ni] === gen) continue;
        const step = (dx !== 0 && dz !== 0 ? SQRT2 : 1) * grid.moveCost[ni];
        const ng = s.g[cur] + step;
        if (s.stamp[ni] !== gen || ng < s.g[ni]) {
          s.stamp[ni] = gen;
          s.g[ni] = ng;
          s.parent[ni] = cur;
          s.f[ni] = ng + octile(nx, nz, gx, gz);
          push(ni);
        }
      }
    }
  }
  if (!found) return null;

  const cells: Vec2[] = [];
  for (let i = goal; i !== -1; i = s.parent[i]) {
    const cx = i % W;
    cells.push({ x: cx + 0.5, z: (i - cx) / W + 0.5 });
  }
  cells.reverse();
  cells[0] = { x: from.x, z: from.z };
  cells.push({ x: endPoint.x, z: endPoint.z });
  return dedupe(smooth(grid, cells));
}

function dedupe(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last.x - p.x, last.z - p.z) > 1e-4) out.push(p);
  }
  if (out.length === 1) out.push({ ...out[0] });
  return out;
}

/** Greedy string-pulling: skip waypoints while the straight line stays walkable and on the same surface. */
function smooth(grid: NavGrid, pts: Vec2[]): Vec2[] {
  if (pts.length <= 2) return pts;
  const out: Vec2[] = [pts[0]];
  let anchor = 0;
  while (anchor < pts.length - 1) {
    let next = anchor + 1;
    while (next + 1 < pts.length && lineClear(grid, pts[anchor], pts[next + 1])) next++;
    out.push(pts[next]);
    anchor = next;
  }
  return out;
}

const CROSS: readonly (readonly [number, number])[] = [[0, 0], [0.22, 0], [-0.22, 0], [0, 0.22], [0, -0.22]];

/** Walks every tile the segment touches; requires them walkable and of one movement-cost class. */
export function lineClear(grid: NavGrid, a: Vec2, b: Vec2): boolean {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(dist / 0.2));
  const firstCost = grid.moveCost[grid.index(Math.floor(a.x), Math.floor(a.z))] ?? 1;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    // Sample a small cross so smoothed paths keep clear of building corners.
    for (const [ox, oz] of CROSS) {
      if (!grid.walkable(Math.floor(x + ox), Math.floor(z + oz))) return false;
    }
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    if (Math.abs(grid.moveCost[grid.index(cx, cz)] - firstCost) > 1e-3) return false;
  }
  return true;
}

export function pathLength(points: Vec2[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  return len;
}

/**
 * Converts waypoints into a time-parameterised route. Segments on roads and bridges
 * are walked faster, so arrival times are exact and reproducible offline.
 */
export function buildRoute(grid: NavGrid, points: Vec2[], startTime: number, speed: number, roadMult: number): Route {
  const times = [startTime];
  let t = startTime;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const mx = Math.floor((a.x + b.x) / 2);
    const mz = Math.floor((a.z + b.z) / 2);
    const onRoad = grid.inBounds(mx, mz) && grid.moveCost[grid.index(mx, mz)] < 1;
    t += len / (speed * (onRoad ? roadMult : 1));
    times.push(t);
  }
  return { points, times };
}

export function routeEnd(route: Route): number {
  return route.times[route.times.length - 1];
}

export interface RouteSample {
  x: number;
  z: number;
  /** Heading in radians (atan2 of dx, dz) of the current segment. */
  heading: number;
  /** 0..1 progress through the whole route. */
  t: number;
}

export function sampleRoute(route: Route, time: number): RouteSample {
  const { points, times } = route;
  const last = points.length - 1;
  if (time <= times[0]) {
    const h = points.length > 1 ? Math.atan2(points[1].x - points[0].x, points[1].z - points[0].z) : 0;
    return { x: points[0].x, z: points[0].z, heading: h, t: 0 };
  }
  if (time >= times[last]) {
    const h = last > 0 ? Math.atan2(points[last].x - points[last - 1].x, points[last].z - points[last - 1].z) : 0;
    return { x: points[last].x, z: points[last].z, heading: h, t: 1 };
  }
  let i = 1;
  while (i < last && times[i] < time) i++;
  const a = points[i - 1];
  const b = points[i];
  const span = times[i] - times[i - 1];
  const f = span > 0 ? (time - times[i - 1]) / span : 1;
  return {
    x: a.x + (b.x - a.x) * f,
    z: a.z + (b.z - a.z) * f,
    heading: Math.atan2(b.x - a.x, b.z - a.z),
    t: (time - times[0]) / (times[last] - times[0]),
  };
}
