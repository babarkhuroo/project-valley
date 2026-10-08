import { IDENTITY } from '../config/identity';
import type { ResourceId } from '../config/resources';
import { CHAT_BALANCE, NEIGHBOUR_LINES, NEIGHBOURS, VALLEY_BALANCE, VALLEY_BUILDING_ORDER, VALLEY_BUILDINGS, VALLEY_RESOURCES, type ValleyBuildingId, type ValleyLevelDef } from '../config/valley';
import type { ValleyBonuses } from '../sim/types';
import { newValleyBonuses } from '../sim/save';
import { VALLEY_RESEARCH, VALLEY_RESEARCH_ORDER, type ValleyResearchId } from '../config/valleyResearch';
import { FESTIVALS, FESTIVAL_BALANCE, FESTIVAL_ORDER } from '../config/festivals';
import type { ChatMessage, ContributionResult, ResourceBag, ValleyBuildingState, ValleyFestival, ValleyLogEntry, ValleyMember, ValleyResearchState, ValleySnapshot, ValleyState } from './types';

/**
 * The shared Valley as a deterministic, discrete-event simulation over wall-clock
 * milliseconds. The server owns the state and calls `advanceValley(state, now)` before
 * every read or write; simulated neighbours deliver parcels at seeded times, so the
 * same Valley advanced in one step or in many ends up identical.
 */

export const VALLEY_SCHEMA = 6;
/** Real players a Valley can hold. */
export const MAX_PLAYERS = 10;
/** Neighbours keep the Valley at least this busy until enough players arrive. */
export const TARGET_MEMBERS = 8;
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
  for (const [r, n] of Object.entries(resources) as [ResourceId, number][]) v += (n ?? 0) * (VALLEY_BALANCE.value[r] ?? 1);
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
  if (!req) return true;
  if ('research' in req) return v.research.completed.includes(req.research);
  return v.buildings[req.building].level >= req.level;
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
  neighbourSays(v, at, 'finished', { building: VALLEY_BUILDINGS[b.id].name });
  openUnlocked(v, at);
  // A newly opened Library puts the banked Knowledge to work.
  if (b.id === 'greatLibrary') spendKnowledge(v, at);
  // Newly opened Festival Grounds: the first festival is not far off.
  if (b.id === 'festivalGrounds' && b.level === 1 && v.nextFestivalAt === null && v.festival === null) {
    v.nextFestivalAt = at + FESTIVAL_BALANCE.firstDelayHours * HOUR;
  }
}

// ---------------------------------------------------------------------------
// Festivals
// ---------------------------------------------------------------------------

function festivalRewardMult(v: ValleyState): number {
  let mult = 1;
  for (let l = 0; l < v.buildings.festivalGrounds.level; l++) {
    for (const e of VALLEY_BUILDINGS.festivalGrounds.levels[l].effects) if (e.type === 'festival') mult *= e.rewardMult;
  }
  return mult;
}

export function festivalRemaining(f: ValleyFestival): ResourceBag {
  const out: ResourceBag = {};
  for (const [r, n] of Object.entries(f.goal) as [ResourceId, number][]) {
    const left = n - (f.delivered[r] ?? 0);
    if (left > 0) out[r] = left;
  }
  return out;
}

export function festivalFraction(f: ValleyFestival): number {
  const goal = valueOf(f.goal);
  return goal > 0 ? Math.min(1, valueOf(f.delivered) / goal) : 1;
}

function startFestival(v: ValleyState, at: number): void {
  const last = v.festival?.kind;
  const choices = FESTIVAL_ORDER.filter((k) => k !== last);
  const kind = choices[Math.floor(rand(v) * choices.length) % choices.length];
  v.festival = {
    id: v.nextLogId,
    kind,
    startsAt: at,
    endsAt: at + FESTIVAL_BALANCE.durationHours * HOUR,
    goal: { ...FESTIVALS[kind].goal },
    delivered: {},
    shares: {},
    outcome: 'running',
    rewardMult: festivalRewardMult(v),
  };
  v.nextFestivalAt = null;
  log(v, { at, kind: 'festivalStarted', festival: kind });
  neighbourSays(v, at, 'festival', { festival: FESTIVALS[kind].name });
}

function scheduleNextFestival(v: ValleyState, from: number): void {
  const { min, max } = FESTIVAL_BALANCE.gapHours;
  v.nextFestivalAt = Math.round(from + (min + rand(v) * (max - min)) * HOUR);
}

function endFestival(v: ValleyState, at: number): void {
  const f = v.festival!;
  f.outcome = 'lost';
  log(v, { at, kind: 'festivalLost', festival: f.kind });
  scheduleNextFestival(v, at);
}

/** Delivers to the running festival; a full goal wins it for everyone who helped. */
function giveToFestival(v: ValleyState, member: ValleyMember, resources: ResourceBag, at: number): { accepted: ResourceBag; returned: ResourceBag; value: number } {
  const f = v.festival!;
  const remaining = festivalRemaining(f);
  const accepted: ResourceBag = {};
  const returned: ResourceBag = {};
  for (const [r, raw] of Object.entries(resources) as [ResourceId, number][]) {
    const amount = Math.max(0, Math.floor(raw ?? 0));
    if (amount <= 0) continue;
    const take = Math.min(amount, remaining[r] ?? 0);
    if (take > 0) {
      accepted[r] = take;
      f.delivered[r] = (f.delivered[r] ?? 0) + take;
    }
    if (amount > take) returned[r] = amount - take;
  }
  const value = valueOf(accepted);
  if (value > 0) {
    f.shares[member.id] = (f.shares[member.id] ?? 0) + value;
    member.lifetimeValue += value;
    log(v, { at, kind: 'festivalGift', member: member.id, festival: f.kind, resources: accepted });
    if (Object.keys(festivalRemaining(f)).length === 0) {
      f.outcome = 'won';
      log(v, { at, kind: 'festivalWon', festival: f.kind });
      neighbourSays(v, at, 'won', { festival: FESTIVALS[f.kind].name });
      raiseKnowledge(v, FESTIVALS[f.kind].reward.knowledge * f.rewardMult, at);
      scheduleNextFestival(v, f.endsAt);
    }
  }
  return { accepted, returned, value };
}

// ---------------------------------------------------------------------------
// Valley research
// ---------------------------------------------------------------------------

export function newResearchState(): ValleyResearchState {
  return { completed: [], progress: {}, votes: {}, banked: 0, raised: 0 };
}

/** The Great Library must be restored before Knowledge turns into research. */
export function libraryOpen(v: ValleyState | ValleySnapshot): boolean {
  return (v.buildings.greatLibrary?.level ?? 0) > 0;
}

function knowledgeMult(v: ValleyState | ValleySnapshot): number {
  let mult = 1;
  const lib = v.buildings.greatLibrary;
  for (let l = 0; l < (lib?.level ?? 0); l++) {
    for (const e of VALLEY_BUILDINGS.greatLibrary.levels[l].effects) if (e.type === 'knowledge') mult *= e.mult;
  }
  return mult;
}

export function availableResearch(v: ValleyState | ValleySnapshot): ValleyResearchId[] {
  const done = v.research.completed;
  return VALLEY_RESEARCH_ORDER.filter((id) => !done.includes(id) && VALLEY_RESEARCH[id].requires.every((r) => done.includes(r)));
}

/** Votes per available project. */
export function voteCounts(v: ValleyState | ValleySnapshot): Partial<Record<ValleyResearchId, string[]>> {
  const avail = availableResearch(v);
  const out: Partial<Record<ValleyResearchId, string[]>> = {};
  for (const [member, id] of Object.entries(v.research.votes)) if (avail.includes(id)) (out[id] ??= []).push(member);
  return out;
}

/** The project the Valley is working on: most votes, then most progress, then tree order. */
export function leadingResearch(v: ValleyState | ValleySnapshot): ValleyResearchId | null {
  const avail = availableResearch(v);
  if (avail.length === 0) return null;
  const votes = voteCounts(v);
  const score = (id: ValleyResearchId) => (votes[id]?.length ?? 0) * 1e9 + (v.research.progress[id] ?? 0);
  return [...avail].sort((a, b) => score(b) - score(a) || VALLEY_RESEARCH_ORDER.indexOf(a) - VALLEY_RESEARCH_ORDER.indexOf(b))[0];
}

/** Neighbours keep a vote on something available; each has their own taste. */
function settleVotes(v: ValleyState): void {
  const avail = availableResearch(v);
  for (const m of v.members) {
    if (m.leftAt !== null) {
      delete v.research.votes[m.id];
      continue;
    }
    const vote = v.research.votes[m.id];
    if (vote && avail.includes(vote)) continue;
    if (m.kind === 'player' || avail.length === 0) {
      delete v.research.votes[m.id];
      continue;
    }
    const taste = (id: ValleyResearchId) => (VALLEY_RESEARCH_ORDER.indexOf(id) * 7 + m.neighbour! * 3) % 11;
    v.research.votes[m.id] = [...avail].sort((a, b) => taste(a) - taste(b))[0];
  }
}

/** Pours banked Knowledge into the leading project, finishing projects as it goes. */
function spendKnowledge(v: ValleyState, at: number): void {
  const r = v.research;
  while (libraryOpen(v) && r.banked > 1e-9) {
    const target = leadingResearch(v);
    if (!target) break;
    const cost = VALLEY_RESEARCH[target].cost;
    const take = Math.min(r.banked, cost - (r.progress[target] ?? 0));
    r.progress[target] = (r.progress[target] ?? 0) + take;
    r.banked -= take;
    if (r.progress[target]! >= cost - 1e-6) {
      delete r.progress[target];
      r.completed.push(target);
      log(v, { at, kind: 'researched', research: target });
      settleVotes(v);
      openUnlocked(v, at);
    }
  }
}

/** Knowledge raised by any member's effort (contributions, trade). */
export function raiseKnowledge(v: ValleyState, amount: number, at: number): void {
  if (amount <= 0) return;
  const gained = amount * knowledgeMult(v);
  v.research.raised += gained;
  v.research.banked += gained;
  // Until the Library opens, only so much can wait on the old shelves.
  if (!libraryOpen(v)) v.research.banked = Math.min(v.research.banked, VALLEY_BALANCE.knowledgeBankCap);
  spendKnowledge(v, at);
}

/** A member's vote for the next project. */
export function voteResearch(v: ValleyState, memberId: string, id: ValleyResearchId): boolean {
  if (!v.members.some((m) => m.id === memberId && m.leftAt === null) || !availableResearch(v).includes(id)) return false;
  v.research.votes[memberId] = id;
  return true;
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
  const f = v.festival;
  if (f && f.outcome === 'running' && rand(v) < FESTIVAL_BALANCE.neighbourShare) {
    const remaining = festivalRemaining(f);
    const needed = Object.keys(remaining) as ResourceId[];
    const resource = weightedPick(v, needed, (r) => remaining[r] ?? 0);
    if (resource) {
      const { min, max } = VALLEY_BALANCE.neighbours.parcelValue;
      const value = (min + rand(v) * (max - min)) * def.generosity;
      giveToFestival(v, m, { [resource]: Math.max(1, Math.round(value / (VALLEY_BALANCE.value[resource] ?? 1))) }, at);
      scheduleVisit(v, m, at);
      return;
    }
  }
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
      raiseKnowledge(v, result.value * VALLEY_BALANCE.knowledgePerValue, at);
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
export interface ValleyOptions {
  name?: string;
  open?: boolean;
  code?: string;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A short, unambiguous invite code derived from the seed. */
export function inviteCode(seed: number): string {
  let x = seed >>> 0 || 1;
  let out = '';
  for (let i = 0; i < 6; i++) {
    x = (Math.imul(x ^ (x >>> 15), 2246822519) + 0x9e3779b9) >>> 0;
    out += CODE_ALPHABET[x % CODE_ALPHABET.length];
  }
  return out;
}

export function activeMembers(v: ValleyState | ValleySnapshot): ValleyMember[] {
  return v.members.filter((m) => m.leftAt === null);
}

export function activePlayers(v: ValleyState | ValleySnapshot): ValleyMember[] {
  return v.members.filter((m) => m.leftAt === null && m.kind === 'player');
}

/**
 * Neighbours make room as players arrive (the least involved moves on first) and come
 * back when players leave, keeping the Valley lively at any size.
 */
function rebalanceNeighbours(v: ValleyState, now: number): void {
  const want = Math.max(0, TARGET_MEMBERS - activePlayers(v).length);
  let sims = v.members.filter((m) => m.kind === 'simulated' && m.leftAt === null);
  while (sims.length > want) {
    const out = [...sims].sort((a, b) => a.lifetimeValue - b.lifetimeValue || b.neighbour! - a.neighbour!)[0];
    out.leftAt = now;
    out.nextVisitAt = null;
    delete v.research.votes[out.id];
    log(v, { at: now, kind: 'movedOn', member: out.id });
    sims = sims.filter((m) => m !== out);
  }
  const resting = v.members.filter((m) => m.kind === 'simulated' && m.leftAt !== null).sort((a, b) => b.leftAt! - a.leftAt!);
  while (sims.length < want && resting.length > 0) {
    const back = resting.shift()!;
    back.leftAt = null;
    scheduleVisit(v, back, now);
    log(v, { at: now, kind: 'returned', member: back.id });
    sims.push(back);
  }
  settleVotes(v);
}

export function createValley(id: string, seed: number, now: number, player: FoundingPlayer, options: ValleyOptions = {}): ValleyState {
  const buildings = {} as Record<ValleyBuildingId, ValleyBuildingState>;
  for (const bid of VALLEY_BUILDING_ORDER) {
    buildings[bid] = { id: bid, level: 0, status: VALLEY_BUILDINGS[bid].requires ? 'locked' : 'collecting', delivered: {}, shares: {}, doneAt: null };
  }
  const v: ValleyState = {
    schemaVersion: VALLEY_SCHEMA,
    id,
    name: options.name?.trim().slice(0, 30) || IDENTITY.valleyName,
    code: options.code ?? inviteCode(seed),
    open: options.open ?? true,
    seed,
    createdAt: now,
    time: now,
    rng: seed | 0,
    nextLogId: 1,
    members: [],
    buildings,
    log: [],
    research: newResearchState(),
    festival: null,
    nextFestivalAt: null,
    chat: [],
    ops: {},
  };
  NEIGHBOURS.forEach((n, i) => {
    v.members.push({ id: `sim-${i + 1}`, name: n.name, villageName: n.villageName, kind: 'simulated', joinedAt: now, neighbour: i, nextVisitAt: null, lifetimeValue: 0, leftAt: null });
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
  settleVotes(v);
  return v;
}

/** Adds (or welcomes back) a player. Null when the Valley is full. */
export function addPlayer(v: ValleyState, player: FoundingPlayer, now: number): ValleyMember | null {
  const existing = v.members.find((m) => m.id === player.id);
  if (existing && existing.leftAt === null) return existing;
  if (activePlayers(v).length >= MAX_PLAYERS) return null;
  let m = existing;
  if (m) {
    m.leftAt = null;
    m.name = player.name;
    m.villageName = player.villageName;
  } else {
    m = { id: player.id, name: player.name, villageName: player.villageName, kind: 'player', joinedAt: now, neighbour: null, nextVisitAt: null, lifetimeValue: 0, leftAt: null };
    v.members.push(m);
  }
  log(v, { at: now, kind: 'joined', member: m.id });
  rebalanceNeighbours(v, now);
  neighbourSays(v, now, 'welcome', { player: m.name, village: m.villageName });
  return m;
}

/** A player leaves. Their past help stays on the record; a neighbour may come back. */
export function removePlayer(v: ValleyState, playerId: string, now: number): boolean {
  const m = v.members.find((x) => x.id === playerId && x.kind === 'player' && x.leftAt === null);
  if (!m) return false;
  m.leftAt = now;
  delete v.research.votes[m.id];
  log(v, { at: now, kind: 'left', member: m.id });
  rebalanceNeighbours(v, now);
  return true;
}

/**
 * Brings a stored Valley up to the current content: buildings added since it was
 * founded (e.g. the Trading Post, schema 2) appear as ruins, already open if their
 * requirement is met. Safe to run on every load.
 */
export function upgradeValley(v: ValleyState, now: number): boolean {
  let changed = false;
  if (!v.research) {
    v.research = newResearchState();
    settleVotes(v);
    changed = true;
  }
  if (v.festival === undefined) {
    v.festival = null;
    v.nextFestivalAt = null;
    changed = true;
  }
  if (v.chat === undefined) {
    v.chat = [];
    changed = true;
  }
  if (v.code === undefined) {
    v.code = inviteCode(v.seed);
    v.open = false;
    for (const m of v.members) m.leftAt ??= null;
    changed = true;
  }
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

/**
 * Neighbours working a Millrace shift at `now` (they take turns through their waking
 * hours). Pure and shared by server and client, so both show the same crew.
 */
export function millraceCrew(v: ValleyState | ValleySnapshot, now: number): string[] {
  if ((v.buildings.millraceWorkshop?.level ?? 0) <= 0) return [];
  const hour = Math.floor(now / HOUR);
  return v.members
    .filter((m) => m.kind === 'simulated' && m.leftAt === null && hoursIntoNight(m, now) < 0 && (hour + m.neighbour! * 5) % 7 < 3)
    .map((m) => m.name);
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

function pushChat(v: ValleyState, member: string, text: string, at: number): ChatMessage {
  const msg: ChatMessage = { id: v.nextLogId++, at, member, text };
  v.chat.push(msg);
  if (v.chat.length > CHAT_BALANCE.keep) v.chat.splice(0, v.chat.length - CHAT_BALANCE.keep);
  return msg;
}

/** A member's message. Whitespace is tidied and length capped; empty messages are dropped. */
export function postChat(v: ValleyState, memberId: string, text: string, now: number): ChatMessage | null {
  if (!v.members.some((m) => m.id === memberId && m.leftAt === null)) return null;
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, CHAT_BALANCE.maxLength);
  if (!clean) return null;
  return pushChat(v, memberId, clean, now);
}

/** An awake neighbour says something fitting (welcomes, cheers). Seeded, so replays match. */
function neighbourSays(v: ValleyState, at: number, kind: keyof typeof NEIGHBOUR_LINES, vars: Record<string, string>): void {
  const awake = v.members.filter((m) => m.kind === 'simulated' && m.leftAt === null && hoursIntoNight(m, at) < 0);
  if (awake.length === 0) return;
  const who = awake[Math.floor(rand(v) * awake.length) % awake.length];
  const lines = NEIGHBOUR_LINES[kind];
  const line = lines[Math.floor(rand(v) * lines.length) % lines.length].replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? '');
  pushChat(v, who.id, line, at);
}

/** Simulated neighbours who are awake (and so "here") at `now`. */
export function neighboursAwake(v: ValleyState | ValleySnapshot, now: number): string[] {
  return v.members.filter((m) => m.kind === 'simulated' && m.leftAt === null && hoursIntoNight(m, now) < 0).map((m) => m.id);
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
    let festival: 'start' | 'end' | null = null;
    if (v.nextFestivalAt !== null && v.nextFestivalAt < at) {
      at = v.nextFestivalAt;
      festival = 'start';
    }
    if (v.festival?.outcome === 'running' && v.festival.endsAt < at) {
      at = v.festival.endsAt;
      festival = 'end';
    }
    if (at > now) break;
    if (festival === 'start') startFestival(v, at);
    else if (festival === 'end') endFestival(v, at);
    else if (site) finishBuilding(v, site, at);
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
  const member = v.members.find((m) => m.id === memberId && m.leftAt === null);
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
    raiseKnowledge(v, d.value * VALLEY_BALANCE.knowledgePerValue, now);
    checkSupplied(v, b, now);
  }
  const ops = (v.ops[memberId] ??= {});
  ops[opId] = result;
  const keys = Object.keys(ops);
  for (let i = 0; i < keys.length - OPS_KEPT; i++) delete ops[keys[i]];
  return { ok: true, result };
}

/** Valley Knowledge brought by a member (e.g. earned trading). Idempotent per `opId`. */
export function contributeKnowledge(v: ValleyState, memberId: string, amount: number, opId: string, now: number): ContributeOutcome {
  const member = v.members.find((m) => m.id === memberId);
  if (!member) return { ok: false, reason: 'Not a member of this Valley' };
  const seen = v.ops[memberId]?.[opId];
  if (seen) return { ok: true, result: seen };
  const n = Math.max(0, Math.floor(amount));
  if (n > 0) {
    log(v, { at: now, kind: 'knowledge', member: memberId, amount: n });
    raiseKnowledge(v, n, now);
  }
  const result: ContributionResult = { accepted: {}, returned: {}, value: 0, reputation: 0, knowledge: n };
  const ops = (v.ops[memberId] ??= {});
  ops[opId] = result;
  const keys = Object.keys(ops);
  for (let i = 0; i < keys.length - OPS_KEPT; i++) delete ops[keys[i]];
  return { ok: true, result };
}

/** A member's delivery to the running festival. Idempotent per `opId`; late deliveries come home. */
export function contributeFestival(v: ValleyState, memberId: string, festivalId: number, resources: ResourceBag, opId: string): ContributeOutcome {
  const member = v.members.find((m) => m.id === memberId);
  if (!member) return { ok: false, reason: 'Not a member of this Valley' };
  const seen = v.ops[memberId]?.[opId];
  if (seen) return { ok: true, result: seen };
  let result: ContributionResult;
  const f = v.festival;
  if (!f || f.id !== festivalId || f.outcome !== 'running') {
    const returned: ResourceBag = {};
    for (const [r, n] of Object.entries(resources) as [ResourceId, number][]) if (n > 0) returned[r] = Math.floor(n);
    result = { accepted: {}, returned, value: 0, reputation: 0 };
  } else {
    const d = giveToFestival(v, member, resources, v.time);
    result = { accepted: d.accepted, returned: d.returned, value: d.value, reputation: reputationFor(d.value) };
    raiseKnowledge(v, d.value * VALLEY_BALANCE.knowledgePerValue, v.time);
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
  const out: ValleyBonuses = { ...NO_VALLEY_BONUSES, jobRate: {}, guildLevels: {} };
  if (!v) return out;
  for (const id of VALLEY_BUILDING_ORDER) {
    const def = VALLEY_BUILDINGS[id];
    if (!v.buildings[id]) continue;
    if (def.trains && v.buildings[id].level > 0) out.guildLevels[def.trains] = v.buildings[id].level;
    for (let l = 0; l < v.buildings[id].level; l++) {
      for (const e of def.levels[l].effects) {
        if (e.type === 'jobRate') for (const j of e.jobs) out.jobRate[j] = (out.jobRate[j] ?? 1) * e.mult;
        else if (e.type === 'storage') out.storageMult *= e.mult;
        else if (e.type === 'mealDuration') out.mealDurationMult *= e.mult;
        else if (e.type === 'trade') out.tradeLevel += 1;
        else if (e.type === 'workshop') {
          out.workshopLevel += 1;
          out.workshopYield *= e.yieldMult;
        }
      }
    }
  }
  for (const id of v.research?.completed ?? []) {
    for (const e of VALLEY_RESEARCH[id].effects) {
      if (e.type === 'mealDuration') out.mealDurationMult *= e.mult;
      else if (e.type === 'storage') out.storageMult *= e.mult;
      else if (e.type === 'tradePay') out.tradePayMult *= e.mult;
      else if (e.type === 'tradeGap') out.tradeGapMult *= e.mult;
      else if (e.type === 'trainingTime') out.trainingTimeMult *= e.mult;
      else out.trainingCostMult *= e.mult;
    }
  }
  return out;
}

export const NO_VALLEY_BONUSES: ValleyBonuses = newValleyBonuses();

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
