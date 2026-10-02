import { BALANCE } from '../config/balance';
import { BUILDINGS } from '../config/buildings';
import { JOBS, type JobType } from '../config/jobs';
import { NODES } from '../config/nodes';
import { addResource, bumpStat, capacity, nearestStorage } from './economy';
import type { EventSink } from './events';
import { buildingCenter, frontDirection, perimeterCells, rotatedSize } from './grid';
import { getModifiers, isNodeUnlocked, mealDuration, practiceCap, regrowSeconds } from './modifiers';
import { buildRoute, findPath, routeEnd, sampleRoute } from './pathfinding';
import { practiceSkill, skillMultiplier } from './progression';
import { produceKnowledge } from './research';
import { completeConstruction, completeUpgrade } from './construction';
import { buildingStats, siteWork } from './levels';
import { finishItem, startNextItem } from './crafting';
import { RECIPES } from '../config/recipes';
import type { BuildingInstance, GameState, Job, ResourceNode, Vec2, Villager, WalkPurpose } from './types';
import type { World } from './world';

/**
 * Villager behaviour as an event-driven state machine.
 *
 *   idle ──assign──▶ walking(toWork) ──arrive──▶ working ──batch──▶ walking(toStorage)
 *                          ▲                         │                      │
 *                          └──────── deliver ◀───────┴──── (direct output) ◀┘
 *
 * Every transition happens at an exact simulation time, so the same code drives live
 * play, fast-forwarding and offline catch-up.
 */

export const EPS = 1e-6;

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function findVillager(state: GameState, id: number): Villager | undefined {
  return state.villagers.find((v) => v.id === id);
}

export function findBuilding(state: GameState, id: number): BuildingInstance | undefined {
  return state.buildings.find((b) => b.id === id);
}

export function findNode(state: GameState, id: number): ResourceNode | undefined {
  return state.nodes.find((n) => n.id === id);
}

export function jobTypeOf(state: GameState, job: Job): JobType | null {
  switch (job.kind) {
    case 'gather': {
      const node = findNode(state, job.nodeId);
      return node ? NODES[node.kind].job : null;
    }
    case 'operate': {
      const b = findBuilding(state, job.buildingId);
      return b ? (BUILDINGS[b.defId].operate?.job ?? null) : null;
    }
    case 'construct':
      return 'build';
  }
}

export function villagerPosition(v: Villager, time: number): Vec2 {
  if (v.activity === 'walking' && v.route) {
    const s = sampleRoute(v.route, time);
    return { x: s.x, z: s.z };
  }
  return v.pos;
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

export interface RateFactor {
  label: string;
  mult: number;
}

/** Work units per second for this villager on this job, with a readable breakdown. */
export function workRateBreakdown(state: GameState, v: Villager, jt: JobType, job: Job | null = v.job): { rate: number; factors: RateFactor[] } {
  const def = JOBS[jt];
  const factors: RateFactor[] = [{ label: 'Base work rate', mult: BALANCE.work.baseRate }];
  const skill = v.skills[def.skill];
  const skillMult = skillMultiplier(skill.level);
  if (skillMult !== 1) factors.push({ label: `Skill level ${skill.level}`, mult: skillMult });
  const research = getModifiers(state).jobRate[jt];
  if (research && research.mult !== 1) factors.push({ label: 'Research', mult: research.mult });
  if (job?.kind === 'operate') {
    const b = findBuilding(state, job.buildingId);
    const mult = b ? buildingStats(b.defId, b.level).outputMult : 1;
    if (b && mult !== 1) factors.push({ label: `${BUILDINGS[b.defId].name} level ${b.level}`, mult });
  }
  if (def.consumesFood && v.hungry) factors.push({ label: 'Hungry — no Stew', mult: BALANCE.villager.hungryWorkMult });
  const rate = factors.reduce((acc, f) => acc * f.mult, 1);
  return { rate, factors };
}

export function workRate(state: GameState, v: Villager, jt: JobType): number {
  return workRateBreakdown(state, v, jt).rate;
}

// ---------------------------------------------------------------------------
// Spots
// ---------------------------------------------------------------------------

/** Where a villager stands to work a resource node. Deterministic per node. */
export function nodeWorkSpot(world: World, node: ResourceNode): Vec2 {
  const base = ((node.id * 2654435761) >>> 0) / 4294967296;
  for (let k = 0; k < 8; k++) {
    const a = (base + k / 8) * Math.PI * 2;
    const p = { x: node.x + Math.cos(a) * 0.62, z: node.z + Math.sin(a) * 0.62 };
    if (world.grid.walkableAt(p)) return p;
  }
  return { x: node.x, z: node.z };
}

function edgeSpot(b: BuildingInstance, cx: number, cz: number): Vec2 {
  // Tile centre nudged towards the building so villagers visibly stand at the wall.
  const c = buildingCenter(b);
  const x = cx + 0.5;
  const z = cz + 0.5;
  const dx = c.x - x;
  const dz = c.z - z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: x + (dx / len) * 0.2, z: z + (dz / len) * 0.2 };
}

function walkablePerimeter(world: World, b: BuildingInstance): [number, number][] {
  return perimeterCells(b).filter(([cx, cz]) => world.grid.walkable(cx, cz));
}

/** Front-door spot, falling back to the nearest open perimeter tile. */
export function frontSpot(world: World, b: BuildingInstance): Vec2 {
  const c = buildingCenter(b);
  const f = frontDirection(b.rotation);
  const { w, d } = rotatedSize(b.defId, b.rotation);
  const reach = (f.x !== 0 ? w : d) / 2 + 0.5;
  const p = { x: c.x + f.x * reach, z: c.z + f.z * reach };
  if (world.grid.walkableAt(p)) return p;
  return nearestPerimeterSpot(world, b, p) ?? p;
}

export function nearestPerimeterSpot(world: World, b: BuildingInstance, from: Vec2): Vec2 | null {
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (const [cx, cz] of walkablePerimeter(world, b)) {
    const d = Math.hypot(cx + 0.5 - from.x, cz + 0.5 - from.z);
    if (d < bestD) {
      bestD = d;
      best = edgeSpot(b, cx, cz);
    }
  }
  return best;
}

/** Spreads several workers of one kind around a building instead of stacking them on one tile. */
function spreadSpot(state: GameState, world: World, v: Villager, b: BuildingInstance, kind: 'construct' | 'operate'): Vec2 {
  const builders = state.villagers
    .filter((o) => o.job?.kind === kind && o.job.buildingId === b.id)
    .sort((a, c) => a.id - c.id);
  const index = Math.max(0, builders.findIndex((o) => o.id === v.id));
  const front = frontSpot(world, b);
  const cells = walkablePerimeter(world, b).sort(
    (a, c) => Math.hypot(a[0] + 0.5 - front.x, a[1] + 0.5 - front.z) - Math.hypot(c[0] + 0.5 - front.x, c[1] + 0.5 - front.z),
  );
  if (cells.length === 0) return front;
  // Spread builders around the site rather than stacking them.
  const pick = cells[Math.min(cells.length - 1, index * 3)];
  return edgeSpot(b, pick[0], pick[1]);
}

export function workSpot(state: GameState, world: World, v: Villager): Vec2 | null {
  const job = v.job;
  if (!job) return null;
  if (job.kind === 'gather') {
    const node = findNode(state, job.nodeId);
    return node ? nodeWorkSpot(world, node) : null;
  }
  const b = findBuilding(state, job.buildingId);
  if (!b) return null;
  if (job.kind === 'construct') return spreadSpot(state, world, v, b, 'construct');
  // Multi-worker production areas spread their crew around the edge; single-slot buildings use the door.
  return buildingStats(b.defId, b.level).slots > 1 && JOBS[BUILDINGS[b.defId].operate?.job ?? 'cook'].output?.delivery === 'carry'
    ? spreadSpot(state, world, v, b, 'operate')
    : frontSpot(world, b);
}

/** Where an idle villager hangs out: in front of their home, spread out a little. */
export function restSpot(state: GameState, world: World, v: Villager): Vec2 {
  const home = v.homeId !== null ? findBuilding(state, v.homeId) : undefined;
  const anchor = home ?? state.buildings.find((b) => b.defId === 'cookhouse') ?? state.buildings[0];
  const base = anchor ? frontSpot(world, anchor) : { x: world.map.width / 2, z: world.map.height / 2 };
  const angle = (v.id * 2.399) % (Math.PI * 2);
  const p = { x: base.x + Math.cos(angle) * 0.9, z: base.z + Math.abs(Math.sin(angle)) * 0.9 + 0.3 };
  return world.grid.walkableAt(p) ? p : base;
}

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

/** Plans a route from the villager's current position. Returns false when unreachable. */
export function walkTo(state: GameState, world: World, v: Villager, target: Vec2, purpose: WalkPurpose): boolean {
  const from = villagerPosition(v, state.time);
  const points = findPath(world.grid, from, target);
  if (!points) return false;
  const speed = BALANCE.villager.walkSpeed * (v.carrying ? BALANCE.villager.carrySpeedMult : 1);
  v.pos = { x: from.x, z: from.z };
  v.route = buildRoute(world.grid, points, state.time, speed, BALANCE.villager.pathSpeedMult);
  v.activity = 'walking';
  v.purpose = purpose;
  v.blockedReason = null;
  return true;
}

function stopWalking(v: Villager, at: Vec2): void {
  v.pos = { x: at.x, z: at.z };
  v.route = null;
  v.purpose = null;
}

export function goRest(state: GameState, world: World, v: Villager): void {
  v.blockedReason = null;
  if (!walkTo(state, world, v, restSpot(state, world, v), 'toRest')) {
    const here = villagerPosition(v, state.time);
    stopWalking(v, here);
    v.activity = 'idle';
  }
}

/** Clears the job and sends the villager home, notifying the player. */
export function becomeIdle(state: GameState, world: World, v: Villager, sink: EventSink, reason: 'depleted' | 'finished' | 'unreachable' | 'removed' | 'unassigned'): void {
  v.job = null;
  v.workProgress = 0;
  v.batchWork = 0;
  v.depositTargetId = null;
  if (v.carrying) {
    addResource(state, v.carrying.resource, v.carrying.amount);
    v.carrying = null;
  }
  goRest(state, world, v);
  sink.push({ type: 'villagerIdle', villagerId: v.id, reason });
}

// ---------------------------------------------------------------------------
// Job flow
// ---------------------------------------------------------------------------

/** Sends the villager to the spot for their current job (keeps partial batch progress). */
export function goToWork(state: GameState, world: World, v: Villager, sink: EventSink): void {
  const spot = workSpot(state, world, v);
  if (!spot) {
    becomeIdle(state, world, v, sink, 'removed');
    return;
  }
  if (!walkTo(state, world, v, spot, 'toWork')) {
    v.activity = 'blocked';
    v.blockedReason = 'unreachable';
    sink.push({ type: 'villagerIdle', villagerId: v.id, reason: 'unreachable' });
  }
}

/** Called on arrival at the work spot. Resumes an unfinished batch or starts a new one. */
function arriveAtWork(state: GameState, world: World, v: Villager, sink: EventSink): void {
  const job = v.job;
  if (!job) {
    v.activity = 'idle';
    return;
  }
  if (job.kind === 'gather') {
    const node = findNode(state, job.nodeId);
    if (!node || node.amount <= 0) {
      continueGathering(state, world, v, node ?? null, sink);
      return;
    }
  } else {
    const b = findBuilding(state, job.buildingId);
    const valid = job.kind === 'construct' ? !!b && siteWork(b) !== null : b?.status === 'complete';
    if (!b || !valid) {
      becomeIdle(state, world, v, sink, job.kind === 'construct' ? 'finished' : 'removed');
      return;
    }
  }
  if (v.batchWork > 0 && v.workProgress < v.batchWork) {
    v.activity = 'working';
    return;
  }
  beginBatch(state, world, v, sink);
}

/** Starts a fresh batch, or parks the villager when something outside their control blocks it. */
export function beginBatch(state: GameState, world: World, v: Villager, sink: EventSink): void {
  const job = v.job;
  if (!job) return;
  const jt = jobTypeOf(state, job);
  if (!jt) {
    becomeIdle(state, world, v, sink, 'removed');
    return;
  }
  const def = JOBS[jt];
  if (jt === 'craft' && job.kind === 'operate') {
    const b = findBuilding(state, job.buildingId);
    if (!b) {
      becomeIdle(state, world, v, sink, 'removed');
      return;
    }
    const start = startNextItem(state, b);
    if (!start.ok) {
      const already = v.activity === 'blocked' && v.blockedReason === start.reason;
      v.activity = 'blocked';
      v.blockedReason = start.reason;
      v.workProgress = 0;
      v.batchWork = 0;
      if (!already && start.reason === 'storageFull') sink.push({ type: 'storageFull', resource: start.resource, villagerId: v.id });
      return;
    }
    v.activity = 'working';
    v.blockedReason = null;
    v.workProgress = 0;
    v.batchWork = RECIPES[start.recipe].work;
    return;
  }
  if (def.output?.delivery === 'direct') {
    const r = def.output.resource;
    const researching = r === 'knowledge' && state.research.active !== null;
    if (!researching && state.resources[r] >= capacity(state, r)) {
      v.activity = 'blocked';
      v.blockedReason = r === 'knowledge' ? 'knowledgeFull' : 'storageFull';
      v.workProgress = 0;
      v.batchWork = 0;
      if (r !== 'knowledge') sink.push({ type: 'storageFull', resource: r, villagerId: v.id });
      return;
    }
  }
  let batch = def.batchWork;
  if (job.kind === 'construct') {
    const b = findBuilding(state, job.buildingId);
    const site = b ? siteWork(b) : null;
    if (!site) return;
    batch = Math.max(0.01, Math.min(batch, site.required - site.progress));
  }
  v.activity = 'working';
  v.blockedReason = null;
  v.workProgress = 0;
  v.batchWork = batch;
}

function completeBatch(state: GameState, world: World, v: Villager, sink: EventSink): void {
  const job = v.job;
  if (!job) return;
  const jt = jobTypeOf(state, job);
  if (!jt) return;
  const def = JOBS[jt];
  practiceSkill(v, def.skill, sink, practiceCap(state));
  sink.push({ type: 'batch', villagerId: v.id, job: jt });

  switch (job.kind) {
    case 'gather': {
      const node = findNode(state, job.nodeId);
      v.workProgress = 0;
      v.batchWork = 0;
      if (!node || !def.output) {
        becomeIdle(state, world, v, sink, 'removed');
        return;
      }
      const taken = Math.min(def.output.amount, node.amount);
      node.amount -= taken;
      if (node.amount <= EPS) depleteNode(state, node, sink);
      v.carrying = { resource: def.output.resource, amount: taken };
      headToStorage(state, world, v, sink);
      return;
    }
    case 'operate': {
      const b = findBuilding(state, job.buildingId);
      if (b && jt === 'craft') {
        finishItem(state, b, v.id, sink);
        v.workProgress = 0;
        v.batchWork = 0;
        beginBatch(state, world, v, sink);
        return;
      }
      if (!b || !def.output) {
        becomeIdle(state, world, v, sink, 'removed');
        return;
      }
      const { resource, amount } = def.output;
      if (def.output.delivery === 'carry') {
        // Production areas (Woodlot, Clay Pit, Quarry): gatherers haul each load to storage.
        v.workProgress = 0;
        v.batchWork = 0;
        v.carrying = { resource, amount };
        headToStorage(state, world, v, sink);
        return;
      }
      if (resource === 'knowledge') produceKnowledge(state, amount, sink);
      else addResource(state, resource, amount);
      sink.push({ type: 'produced', villagerId: v.id, buildingId: b.id, resource, amount });
      beginBatch(state, world, v, sink);
      return;
    }
    case 'construct': {
      const b = findBuilding(state, job.buildingId);
      if (!b) {
        becomeIdle(state, world, v, sink, 'removed');
        return;
      }
      v.workProgress = 0;
      if (b.upgrade && b.status === 'complete') {
        b.upgrade.progress = Math.min(b.upgrade.workRequired, b.upgrade.progress + v.batchWork);
        v.batchWork = 0;
        if (b.upgrade.progress >= b.upgrade.workRequired - EPS) completeUpgrade(state, world, b, sink);
        else beginBatch(state, world, v, sink);
        return;
      }
      b.progress = Math.min(b.workRequired, b.progress + v.batchWork);
      v.batchWork = 0;
      if (b.progress >= b.workRequired - EPS) completeConstruction(state, world, b, sink);
      else beginBatch(state, world, v, sink);
      return;
    }
  }
}

function depleteNode(state: GameState, node: ResourceNode, sink: EventSink): void {
  node.amount = 0;
  node.depletedAt = state.time;
  node.regrowAt = state.time + regrowSeconds(state, node.kind);
  sink.push({ type: 'nodeDepleted', nodeId: node.id });
}

export function regrowNode(node: ResourceNode, sink: EventSink): void {
  node.amount = NODES[node.kind].amount;
  node.regrowAt = null;
  node.depletedAt = null;
  sink.push({ type: 'nodeRegrown', nodeId: node.id });
}

/** Carries the current load to the closest storage that accepts it. */
export function headToStorage(state: GameState, world: World, v: Villager, sink: EventSink): void {
  const load = v.carrying;
  if (!load) {
    goToWork(state, world, v, sink);
    return;
  }
  const here = villagerPosition(v, state.time);
  const store = nearestStorage(state, load.resource, here);
  if (!store) {
    stopWalking(v, here);
    v.activity = 'blocked';
    v.blockedReason = 'noStorage';
    return;
  }
  v.depositTargetId = store.id;
  const spot = nearestPerimeterSpot(world, store, here) ?? frontSpot(world, store);
  if (!walkTo(state, world, v, spot, 'toStorage')) {
    stopWalking(v, here);
    v.activity = 'blocked';
    v.blockedReason = 'unreachable';
  }
}

function deliver(state: GameState, world: World, v: Villager, sink: EventSink): void {
  const load = v.carrying;
  if (!load) {
    goToWork(state, world, v, sink);
    return;
  }
  const added = addResource(state, load.resource, load.amount);
  if (added > 0) {
    sink.push({ type: 'deposit', villagerId: v.id, buildingId: v.depositTargetId ?? -1, resource: load.resource, amount: added });
  }
  load.amount -= added;
  if (load.amount > EPS) {
    v.activity = 'blocked';
    v.blockedReason = 'storageFull';
    sink.push({ type: 'storageFull', resource: load.resource, villagerId: v.id });
    return;
  }
  v.carrying = null;
  v.depositTargetId = null;
  const job = v.job;
  if (job?.kind === 'gather') {
    const node = findNode(state, job.nodeId);
    if (node && node.amount > 0) goToWork(state, world, v, sink);
    else continueGathering(state, world, v, node ?? null, sink);
  } else if (job) {
    goToWork(state, world, v, sink);
  } else {
    goRest(state, world, v);
  }
}

/** When a node runs dry, move on to the nearest free node of the same kind nearby. */
function continueGathering(state: GameState, world: World, v: Villager, from: ResourceNode | null, sink: EventSink): void {
  const origin = from ?? villagerPosition(v, state.time);
  const kind = from?.kind ?? (v.carrying?.resource === 'clay' ? 'clay' : 'tree');
  const next = nearestFreeNode(state, kind, origin, v.id, BALANCE.autoContinueRadius);
  if (!next) {
    becomeIdle(state, world, v, sink, 'depleted');
    return;
  }
  v.job = { kind: 'gather', nodeId: next.id };
  v.workProgress = 0;
  v.batchWork = 0;
  sink.push({ type: 'autoContinue', villagerId: v.id, nodeId: next.id });
  goToWork(state, world, v, sink);
}

export function nodeWorkers(state: GameState, nodeId: number, exceptId = -1): Villager[] {
  return state.villagers.filter((o) => o.id !== exceptId && o.job?.kind === 'gather' && o.job.nodeId === nodeId);
}

export function nearestFreeNode(state: GameState, kind: ResourceNode['kind'], from: Vec2, exceptVillager: number, radius: number): ResourceNode | null {
  if (!isNodeUnlocked(state, kind)) return null;
  let best: ResourceNode | null = null;
  let bestD = radius;
  for (const n of state.nodes) {
    if (n.kind !== kind || n.amount <= 0) continue;
    const d = Math.hypot(n.x - from.x, n.z - from.z);
    if (d >= bestD) continue;
    if (nodeWorkers(state, n.id, exceptVillager).length >= NODES[kind].maxWorkers) continue;
    bestD = d;
    best = n;
  }
  return best;
}

function eat(state: GameState, v: Villager, sink: EventSink): void {
  if (state.resources.stew >= 1) {
    state.resources.stew -= 1;
    bumpStat(state, 'consumed.stew');
    v.energy = mealDuration(state);
    v.hungry = false;
    sink.push({ type: 'ate', villagerId: v.id });
  } else if (!v.hungry) {
    v.hungry = true;
    v.energy = 0;
    sink.push({ type: 'hungry', villagerId: v.id });
  }
}

// ---------------------------------------------------------------------------
// Scheduler hooks
// ---------------------------------------------------------------------------

function needsFood(state: GameState, v: Villager): boolean {
  if (!v.job) return false;
  const jt = jobTypeOf(state, v.job);
  return jt !== null && JOBS[jt].consumesFood;
}

/** Absolute sim time of this villager's next state change, or Infinity. */
export function villagerNextEvent(state: GameState, v: Villager): number {
  if (v.activity === 'walking') return v.route ? routeEnd(v.route) : state.time;
  if (v.activity !== 'working' || !v.job) return Infinity;
  const jt = jobTypeOf(state, v.job);
  if (!jt) return state.time;
  const rate = workRate(state, v, jt);
  const tBatch = rate > 0 ? state.time + Math.max(0, v.batchWork - v.workProgress) / rate : Infinity;
  const tMeal = JOBS[jt].consumesFood && !v.hungry ? state.time + Math.max(0, v.energy) : Infinity;
  return Math.min(tBatch, tMeal);
}

/** Advances continuous quantities (work, appetite) over an event-free interval. */
export function integrateVillager(state: GameState, v: Villager, dt: number): void {
  if (v.activity !== 'working' || !v.job || dt <= 0) return;
  const jt = jobTypeOf(state, v.job);
  if (!jt) return;
  v.workProgress += workRate(state, v, jt) * dt;
  if (JOBS[jt].consumesFood && !v.hungry) v.energy = Math.max(0, v.energy - dt);
}

/** Processes whatever is due for this villager at the current time. Returns true if anything happened. */
export function processVillager(state: GameState, world: World, v: Villager, sink: EventSink): boolean {
  if (v.activity === 'walking') {
    if (!v.route) {
      v.activity = 'idle';
      return true;
    }
    if (state.time < routeEnd(v.route) - EPS) return false;
    const end = v.route.points[v.route.points.length - 1];
    const purpose = v.purpose;
    stopWalking(v, end);
    if (purpose === 'toWork') arriveAtWork(state, world, v, sink);
    else if (purpose === 'toStorage') deliver(state, world, v, sink);
    else v.activity = 'idle';
    return true;
  }
  if (v.activity !== 'working') return false;
  if (!v.job || !jobTypeOf(state, v.job)) {
    becomeIdle(state, world, v, sink, 'removed');
    return true;
  }
  let acted = false;
  if (needsFood(state, v) && !v.hungry && v.energy <= EPS) {
    eat(state, v, sink);
    acted = true;
  }
  if (v.workProgress >= v.batchWork - EPS) {
    completeBatch(state, world, v, sink);
    acted = true;
  }
  return acted;
}

/** Re-checks villagers waiting on shared state (food, storage space, research choice). */
export function settleVillagers(state: GameState, world: World, sink: EventSink): void {
  for (const v of state.villagers) {
    if (v.hungry && v.activity === 'working' && state.resources.stew >= 1) eat(state, v, sink);
    if (v.activity !== 'blocked') continue;
    switch (v.blockedReason) {
      case 'storageFull':
        if (v.carrying) {
          if (capacity(state, v.carrying.resource) > state.resources[v.carrying.resource]) headToStorage(state, world, v, sink);
        } else {
          const jt = v.job ? jobTypeOf(state, v.job) : null;
          const out = jt ? JOBS[jt].output : undefined;
          if (jt === 'craft') beginBatch(state, world, v, sink);
          else if (out && state.resources[out.resource] < capacity(state, out.resource)) beginBatch(state, world, v, sink);
        }
        break;
      case 'noOrders':
      case 'noInputs':
        // Workshops re-check their orders and inputs; beginBatch stays blocked (silently) if nothing changed.
        beginBatch(state, world, v, sink);
        break;
      case 'knowledgeFull':
        if (state.research.active !== null || state.resources.knowledge < capacity(state, 'knowledge')) beginBatch(state, world, v, sink);
        break;
      case 'noStorage':
        if (v.carrying && nearestStorage(state, v.carrying.resource, v.pos)) headToStorage(state, world, v, sink);
        break;
      default:
        break;
    }
  }
}

/**
 * After buildings appear, move or vanish: rescue anyone standing inside a footprint and
 * re-plan every walk so nobody strolls through a wall.
 */
export function refreshAfterGridChange(state: GameState, world: World, sink: EventSink): void {
  for (const v of state.villagers) {
    const here = villagerPosition(v, state.time);
    if (!world.grid.walkableAt(here)) {
      const out = world.grid.nearestWalkable(here);
      if (out) {
        v.pos = out;
        if (v.route) v.route = { points: [out, out], times: [state.time, state.time] };
      }
    }
    if (v.activity === 'walking') {
      if (v.purpose === 'toWork') goToWork(state, world, v, sink);
      else if (v.purpose === 'toStorage') headToStorage(state, world, v, sink);
      else goRest(state, world, v);
    } else if ((v.activity === 'working' || v.activity === 'blocked') && v.job && v.job.kind !== 'gather') {
      const spot = workSpot(state, world, v);
      if (spot && Math.hypot(spot.x - v.pos.x, spot.z - v.pos.z) > 0.3) goToWork(state, world, v, sink);
    } else if (v.activity === 'blocked' && v.blockedReason === 'unreachable' && v.job) {
      goToWork(state, world, v, sink);
    }
  }
}
