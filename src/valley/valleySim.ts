import { IDENTITY } from '../config/identity';
import type { ResourceId } from '../config/resources';
import { NEIGHBOURS, VALLEY_BALANCE, VALLEY_BUILDING_ORDER, VALLEY_BUILDINGS, VALLEY_RESOURCES, type ValleyBuildingId, type ValleyLevelDef } from '../config/valley';
import type { ValleyBonuses } from '../sim/types';
import type { ContributionResult, ResourceBag, ValleyBuildingState, ValleyLogEntry, ValleyMember, ValleySnapshot, ValleyState } from './types';

/**
 * The shared Valley as a deterministic, discrete-event simulation over wall-clock
 * milliseconds. The server owns the state and calls `advanceValley(state, now)` before
 * every read or write; simulated neighbours deliver parcels at seeded times, so the
 * same Valley advanced in one step or in many ends up identical.
 */

export const VALLEY_SCHEMA = 2;
const HOUR = 3_600_000;
const MINUTE = 60_000;
const MAX_EVENTS_PER_ADVANCE = 250_000;
const OPS_KEPT = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** mulberry32 step over the state's own seed, so randomness is saved and replayable. */
function rand(v: ValleyState): number {
  v.rng = (v.rng + 0x6d2b79f5) | 0;
  let t = v.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function levelDef(id: ValleyBuildingId, level: number): ValleyLevelDef | null {
  return VALLEY_BUILDINGS[id].levels[level] ?? null;
}

/** Resources still missing for the level being collected. */
export function remainingFor(b: ValleyBuildingState): ResourceBag {
  const def = b.status === 'collecting' ? levelDef(b.id, b.level) : null;
  const out: ResourceBag = {};
  if (!def) return out;
  for (const r of VALLEY_RESOURCES) {
    const need = (def.cost[r] ?? 0) - (b.delivered[r] ?? 0);
    if (need > 0) out[r] = need;
  }
  return out;
}

/** 0..1 share of the current level's resources delivered. */
export function deliveredFraction(b: ValleyBuildingState): number {
  const def = levelDef(b.id, b.level);
  if (!def || b.status === 'complete') return 1;
  if (b.status === 'building') return 1;
  let need = 0;
  let got = 0;
  for (const r of VALLEY_RESOURCES) {
    need += def.cost[r] ?? 0;
    got += Math.min(def.cost[r] ?? 0, b.delivered[r] ?? 0);
  }
  return need > 0 ? got / need : 1;
}

export function valueOf(resources: ResourceBag): number {
  let v = 0;
  for (const r of VALLEY_RESOURCES) v += (resources[r] ?? 0) * (VALLEY_BALANCE.value[r] ?? 1);
  return v;
}

export function reputationFor(value: number): number {
  return Math.round(value * VALLEY_BALANCE.reputationPerValue);
}

function finishedLevels(v: ValleyState | ValleySnapshot): number {
  let n = 0;
  for (const id of VALLEY_BUILDING_ORDER) n += v.buildings[id].level;
  return n;
}

type NewLogEntry = ValleyLogEntry extends infer E ? (E extends ValleyLogEntry ? Omit<E, 'id'> : never) : never;

function log(v: ValleyState, entry: NewLogEntry): void {
  v.log.push({ ...entry, id: v.nextLogId++ } as ValleyLogEntry);
  // Routine deliveries make way first, so milestones survive a long time away.
  while (v.log.length > VALLEY_BALANCE.logSize) {
    const i = v.log.findIndex((e) => e.kind === 'delivery');
    v.log.splice(i >= 0 && i < v.log.length - 10 ? i : 0, 1);
  }
}

function requirementMet(v: ValleyState, id: ValleyBuildingId): boolean {
  const req = VALLEY_BUILDINGS[id].requires;
  return !req || v.buildings[req.building].level >= req.level;
}

function openUnlocked(v: ValleyState, at: number): void {
  for (const id of VALLEY_BUILDING_ORDER) {
    const b = v.buildings[id];
    if (b.status === 'locked' && requirementMet(v, id)) {
      b.status = 'collecting';
      log(v, { at, kind: 'opened', building: id });
    }
  }
}

/** Moves a fully supplied level into its building phase. */
function checkSupplied(v: ValleyState, b: ValleyBuildingState, at: number): void {
  if (b.status !== 'collecting') return;
  if (Object.keys(remainingFor(b)).length > 0) return;
  const def = levelDef(b.id, b.level)!;
  b.status = 'building';
  b.doneAt = at + def.buildHours * HOUR;
  log(v, { at, kind: 'started', building: b.id, level: b.level + 1 });
}

function finishBuilding(v: ValleyState, b: ValleyBuildingState, at: number): void {
  b.level += 1;
  b.delivered = {};
  b.shares = {};
  b.doneAt = null;
  b.status = levelDef(b.id, b.level) ? 'collecting' : 'complete';
  log(v, { at, kind: 'finished', building: b.id, level: b.level });
  openUnlocked(v, at);
}

function deliver(member: ValleyMember, b: ValleyBuildingState, resources: ResourceBag): { accepted: ResourceBag; returned: ResourceBag; value: number } {
  const remaining = remainingFor(b);
  const accepted: ResourceBag = {};
  const returned: ResourceBag = {};
  for (const r of VALLEY_RESOURCES) {
    const amount = Math.max(0, Math.floor(resources[r] ?? 0));
    if (amount <= 0) continue;
    const take = Math.min(amount, remaining[r] ?? 0);
    if (take > 0) {
      accepted[r] = take;
      b.delivered[r] = (b.delivered[r] ?? 0) + take;
    }
    if (amount > take) returned[r] = amount - take;
  }
  const value = valueOf(accepted);
  if (value > 0) {
    b.shares[member.id] = (b.shares[member.id] ?? 0) + value;
    member.lifetimeValue += value;
  }
  return { accepted, returned, value };
}

// ---------------------------------------------------------------------------
// Simulated neighbours
// ---------------------------------------------------------------------------

/** Hours into the member's quiet night at time t (negative when awake). */
function hoursIntoNight(m: ValleyMember, t: number): number {
  const def = NEIGHBOURS[m.neighbour!];
  const hour = (t / HOUR) % 24;
  const into = (hour - def.sleepAt + 24) % 24;
  return into < VALLEY_BALANCE.neighbours.sleepHours ? into : -1;
}

function scheduleVisit(v: ValleyState, m: ValleyMember, from: number): void {
  const { min, max } = VALLEY_BALANCE.neighbours.intervalMinutes;
  let at = from + (min + rand(v) * (max - min)) * MINUTE;
  const night = hoursIntoNight(m, at);
  if (night >= 0) at += (VALLEY_BALANCE.neighbours.sleepHours - night) * HOUR + rand(v) * 40 * MINUTE;
  m.nextVisitAt = Math.round(at);
}

function weightedPick<T>(v: ValleyState, items: T[], weight: (t: T) => number): T | null {
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  if (total <= 0) return null;
  let roll = rand(v) * total;
  for (const it of items) {
    roll -= Math.max(0, weight(it));
    if (roll <= 0) return it;
  }
  return items[items.length - 1];
}

function neighbourVisit(v: ValleyState, m: ValleyMember, at: number): void {
  const def = NEIGHBOURS[m.neighbour!];
  const open = VALLEY_BUILDING_ORDER.map((id) => v.buildings[id]).filter((b) => b.status === 'collecting');
  // Neighbours like to finish things: the closer a project is, the likelier they help it.
  const target = weightedPick(v, open, (b) => 0.35 + deliveredFraction(b));
  if (target) {
    const remaining = remainingFor(target);
    const needed = Object.keys(remaining) as ResourceId[];
    const resource = weightedPick(v, needed, (r) => (def.focus[r] ?? 0.15) * (0.5 + (remaining[r] ?? 0) / 1000));
    if (resource) {
      const { min, max } = VALLEY_BALANCE.neighbours.parcelValue;
      const growth = 1 + VALLEY_BALANCE.neighbours.growthPerLevel * finishedLevels(v);
      const value = (min + rand(v) * (max - min)) * def.generosity * growth;
      const amount = Math.max(1, Math.round(value / (VALLEY_BALANCE.value[resource] ?? 1)));
      const result = deliver(m, target, { [resource]: amount });
      if (result.value > 0) log(v, { at, kind: 'delivery', member: m.id, building: target.id, resources: result.accepted });
      checkSupplied(v, target, at);
    }
  }
  scheduleVisit(v, m, at);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export interface FoundingPlayer {
  id: string;
  name: string;
  villageName: string;
}

/** A fresh Valley with simulated neighbours who have already started on Hearth Hall. */
export function createValley(id: string, seed: number, now: number, player: FoundingPlayer): ValleyState {
  const buildings = {} as Record<ValleyBuildingId, ValleyBuildingState>;
  for (const bid of VALLEY_BUILDING_ORDER) {
    buildings[bid] = { id: bid, level: 0, status: VALLEY_BUILDINGS[bid].requires ? 'locked' : 'collecting', delivered: {}, shares: {}, doneAt: null };
  }
  const v: ValleyState = {
    schemaVersion: VALLEY_SCHEMA,
    id,
    name: IDENTITY.valleyName,
    seed,
    createdAt: now,
    time: now,
    rng: seed | 0,
    nextLogId: 1,
    members: [],
    buildings,
    log: [],
    ops: {},
  };
  NEIGHBOURS.forEach((n, i) => {
    v.members.push({ id: `sim-${i + 1}`, name: n.name, villageName: n.villageName, kind: 'simulated', joinedAt: now, neighbour: i, nextVisitAt: null, lifetimeValue: 0 });
  });
  // The neighbours got here first: part of the hall is already supplied.
  const hall = buildings.hearthHall;
  const cost = levelDef('hearthHall', 0)!.cost;
  for (const r of VALLEY_RESOURCES) {
    let left = Math.floor((cost[r] ?? 0) * VALLEY_BALANCE.foundingProgress);
    while (left > 0) {
      const m = v.members[Math.floor(rand(v) * v.members.length)];
      const chunk = Math.min(left, 50 + Math.floor(rand(v) * 150));
      deliver(m, hall, { [r]: chunk });
      left -= chunk;
    }
  }
  for (const m of v.members) scheduleVisit(v, m, now - rand(v) * 30 * MINUTE);
  addPlayer(v, player, now);
  return v;
}

export function addPlayer(v: ValleyState, player: FoundingPlayer, now: number): ValleyMember {
  const existing = v.members.find((m) => m.id === player.id);
  if (existing) return existing;
  const m: ValleyMember = { id: player.id, name: player.name, villageName: player.villageName, kind: 'player', joinedAt: now, neighbour: null, nextVisitAt: null, lifetimeValue: 0 };
  v.members.push(m);
  log(v, { at: now, kind: 'joined', member: m.id });
  return m;
}

/**
 * Brings a stored Valley up to the current content: buildings added since it was
 * founded (e.g. the Trading Post, schema 2) appear as ruins, already open if their
 * requirement is met. Safe to run on every load.
 */
export function upgradeValley(v: ValleyState, now: number): boolean {
  let changed = false;
  for (const id of VALLEY_BUILDING_ORDER) {
    if (v.buildings[id]) continue;
    v.buildings[id] = { id, level: 0, status: 'locked', delivered: {}, shares: {}, doneAt: null };
    changed = true;
  }
  if (changed) openUnlocked(v, now);
  if (v.schemaVersion !== VALLEY_SCHEMA) {
    v.schemaVersion = VALLEY_SCHEMA;
    changed = true;
  }
  return changed;
}

/** Processes every neighbour visit and finished build up to `now`, in time order. */
export function advanceValley(v: ValleyState, now: number): void {
  for (let guard = 0; guard < MAX_EVENTS_PER_ADVANCE; guard++) {
    let at = Infinity;
    let visitor: ValleyMember | null = null;
    let site: ValleyBuildingState | null = null;
    for (const m of v.members) {
      if (m.nextVisitAt !== null && m.nextVisitAt < at) {
        at = m.nextVisitAt;
        visitor = m;
        site = null;
      }
    }
    for (const id of VALLEY_BUILDING_ORDER) {
      const b = v.buildings[id];
      if (b.doneAt !== null && b.doneAt < at) {
        at = b.doneAt;
        site = b;
        visitor = null;
      }
    }
    if (at > now) break;
    if (site) finishBuilding(v, site, at);
    else if (visitor) neighbourVisit(v, visitor, at);
  }
  v.time = Math.max(v.time, now);
}

export type ContributeOutcome = { ok: true; result: ContributionResult } | { ok: false; reason: string };

/**
 * A player's delivery. Idempotent per `opId`: a retried request returns the original
 * result. Anything no longer needed is returned rather than lost.
 */
export function contribute(v: ValleyState, memberId: string, buildingId: ValleyBuildingId, resources: ResourceBag, opId: string, now: number): ContributeOutcome {
  const member = v.members.find((m) => m.id === memberId);
  if (!member) return { ok: false, reason: 'Not a member of this Valley' };
  const seen = v.ops[memberId]?.[opId];
  if (seen) return { ok: true, result: seen };
  const b = v.buildings[buildingId];
  if (!b) return { ok: false, reason: 'Unknown Valley building' };
  let result: ContributionResult;
  if (b.status !== 'collecting') {
    // Finished or not open: everything goes home again.
    const returned: ResourceBag = {};
    for (const r of VALLEY_RESOURCES) if ((resources[r] ?? 0) > 0) returned[r] = Math.floor(resources[r]!);
    result = { accepted: {}, returned, value: 0, reputation: 0 };
  } else {
    const d = deliver(member, b, resources);
    result = { accepted: d.accepted, returned: d.returned, value: d.value, reputation: reputationFor(d.value) };
    if (d.value > 0) log(v, { at: now, kind: 'delivery', member: member.id, building: b.id, resources: d.accepted });
    checkSupplied(v, b, now);
  }
  const ops = (v.ops[memberId] ??= {});
  ops[opId] = result;
  const keys = Object.keys(ops);
  for (let i = 0; i < keys.length - OPS_KEPT; i++) delete ops[keys[i]];
  return { ok: true, result };
}

export function snapshotOf(v: ValleyState): ValleySnapshot {
  const snapshot: Partial<ValleyState> = structuredClone(v);
  delete snapshot.ops;
  delete snapshot.rng;
  return snapshot as ValleySnapshot;
}

/** Village-side bonuses from every finished Valley level. */
export function valleyBonuses(v: ValleySnapshot | null): ValleyBonuses {
  const out: ValleyBonuses = { jobRate: {}, storageMult: 1, mealDurationMult: 1, tradeLevel: 0 };
  if (!v) return out;
  for (const id of VALLEY_BUILDING_ORDER) {
    const def = VALLEY_BUILDINGS[id];
    for (let l = 0; l < v.buildings[id].level; l++) {
      for (const e of def.levels[l].effects) {
        if (e.type === 'jobRate') for (const j of e.jobs) out.jobRate[j] = (out.jobRate[j] ?? 1) * e.mult;
        else if (e.type === 'storage') out.storageMult *= e.mult;
        else if (e.type === 'mealDuration') out.mealDurationMult *= e.mult;
        else out.tradeLevel += 1;
      }
    }
  }
  return out;
}

export const NO_VALLEY_BONUSES: ValleyBonuses = { jobRate: {}, storageMult: 1, mealDurationMult: 1, tradeLevel: 0 };

/**
 * Development aid: makes the Valley `ms` older, as if that much time had passed with
 * nobody looking. The next `advanceValley` plays it out like real time (exactly so for
 * whole days; otherwise the neighbours' nights fall at shifted hours).
 */
export function ageValley(v: ValleyState, ms: number): void {
  v.createdAt -= ms;
  v.time -= ms;
  for (const m of v.members) {
    m.joinedAt -= ms;
    if (m.nextVisitAt !== null) m.nextVisitAt -= ms;
  }
  for (const id of VALLEY_BUILDING_ORDER) {
    const b = v.buildings[id];
    if (b.doneAt !== null) b.doneAt -= ms;
  }
  for (const e of v.log) e.at -= ms;
}
