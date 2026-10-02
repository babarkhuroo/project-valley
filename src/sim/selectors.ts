import { BALANCE } from '../config/balance';
import { BUILDINGS, BUILD_MENU_ORDER, type BuildingId } from '../config/buildings';
import { JOBS, type JobType } from '../config/jobs';
import { NODES } from '../config/nodes';
import { RESEARCH, RESEARCH_IDS } from '../config/research';
import { RESOURCES, RESOURCE_ORDER, type ResourceId } from '../config/resources';
import { canAfford, capacity, nearestStorage } from './economy';
import { buildingCenter } from './grid';
import { checkBuildable, nextCost } from './construction';
import { canAffordUpgrade, siteWork, upgradeBlocker } from './levels';
import { mealDuration } from './modifiers';
import { findPath, pathLength } from './pathfinding';
import { housingCapacity } from './population';
import { researchStatus } from './research';
import type { BuildingInstance, GameState, Job, Villager } from './types';
import {
  findBuilding,
  findNode,
  jobTypeOf,
  nearestPerimeterSpot,
  nodeWorkSpot,
  workRateBreakdown,
  type RateFactor,
} from './villagerAI';
import type { World } from './world';

/**
 * Read-only derived views of the state for the UI. Nothing here mutates the game.
 */

export type TaskIcon = 'idle' | JobType | 'carry' | 'walk' | 'hungry' | 'blocked';

export interface TaskInfo {
  label: string;
  icon: TaskIcon;
  /** 0..1 progress of the current batch, if working. */
  progress: number | null;
  warning: string | null;
  idle: boolean;
}

export function jobTargetName(state: GameState, job: Job): string {
  if (job.kind === 'gather') {
    const n = findNode(state, job.nodeId);
    return n ? NODES[n.kind].name : 'Resource';
  }
  const b = findBuilding(state, job.buildingId);
  return b ? BUILDINGS[b.defId].name : 'Building';
}

export function villagerTask(state: GameState, v: Villager): TaskInfo {
  const jt = v.job ? jobTypeOf(state, v.job) : null;
  const warning = v.hungry && jt && JOBS[jt].consumesFood ? 'Hungry — working slowly' : null;
  if (!v.job || !jt) {
    return {
      label: v.activity === 'walking' ? 'Idle — heading home' : 'Idle',
      icon: 'idle',
      progress: null,
      warning: null,
      idle: true,
    };
  }
  const def = JOBS[jt];
  const target = jobTargetName(state, v.job);
  if (v.activity === 'blocked') {
    const reasons: Record<string, string> = {
      storageFull: v.carrying ? `${RESOURCES[v.carrying.resource].name} storage full` : `${def.output ? RESOURCES[def.output.resource].name : 'Storage'} full`,
      noStorage: 'No storage to deliver to',
      knowledgeFull: 'Pick a research project',
      unreachable: `Can’t reach the ${target}`,
    };
    return { label: `Waiting — ${reasons[v.blockedReason ?? ''] ?? 'blocked'}`, icon: 'blocked', progress: null, warning: reasons[v.blockedReason ?? ''] ?? null, idle: false };
  }
  if (v.activity === 'walking') {
    if (v.purpose === 'toStorage' && v.carrying) {
      return { label: `Carrying ${RESOURCES[v.carrying.resource].name.toLowerCase()}`, icon: 'carry', progress: null, warning, idle: false };
    }
    return { label: `Walking to ${target}`, icon: 'walk', progress: null, warning, idle: false };
  }
  let label = def.verb;
  if (jt === 'study') {
    const active = state.research.active;
    label = active ? `Studying ${RESEARCH[active].name}` : 'Studying';
  } else if (jt === 'build') {
    const site = v.job.kind === 'construct' ? findBuilding(state, v.job.buildingId) : undefined;
    label = site?.upgrade ? `Upgrading ${target}` : `Building ${target}`;
  }
  const progress = v.batchWork > 0 ? Math.min(1, v.workProgress / v.batchWork) : 0;
  return { label, icon: warning ? 'hungry' : jt, progress, warning, idle: false };
}

export function idleVillagers(state: GameState): Villager[] {
  return state.villagers.filter((v) => !v.job);
}

// ---------------------------------------------------------------------------
// Production estimates
// ---------------------------------------------------------------------------

export interface JobEstimate {
  jobType: JobType;
  rate: number;
  factors: RateFactor[];
  /** Seconds of actual work per batch at this rate. */
  workSeconds: number;
  /** Round-trip walking per batch (gathering only). */
  travelSeconds: number;
  resource: ResourceId | null;
  perMinute: number;
  destination: string | null;
}

const travelCache = new Map<string, number>();

const STORE_FOR: Record<'timber' | 'clay' | 'stone', BuildingId> = {
  timber: 'timberYard',
  clay: 'clayShed',
  stone: 'stoneYard',
};

function roundTripSeconds(state: GameState, world: World, nodeId: number, resource: ResourceId): { seconds: number; storage: BuildingInstance | null } {
  const node = findNode(state, nodeId);
  if (!node) return { seconds: 0, storage: null };
  const store = nearestStorage(state, resource, node);
  if (!store) return { seconds: 0, storage: null };
  const key = `${nodeId}:${store.id}:${store.cellX},${store.cellZ},${store.rotation}`;
  let len = travelCache.get(key);
  if (len === undefined) {
    const from = nodeWorkSpot(world, node);
    const to = nearestPerimeterSpot(world, store, from) ?? buildingCenter(store);
    const pts = findPath(world.grid, from, to);
    len = pts ? pathLength(pts) : Math.hypot(to.x - from.x, to.z - from.z);
    if (travelCache.size > 2000) travelCache.clear();
    travelCache.set(key, len);
  }
  const speed = BALANCE.villager.walkSpeed;
  const seconds = len / speed + len / (speed * BALANCE.villager.carrySpeedMult);
  return { seconds, storage: store };
}

export function estimateJob(state: GameState, world: World, v: Villager, job: Job): JobEstimate | null {
  const jt = jobTypeOf(state, job);
  if (!jt) return null;
  const def = JOBS[jt];
  const { rate, factors } = workRateBreakdown(state, v, jt, job);
  const workSeconds = def.batchWork / rate;
  let travelSeconds = 0;
  let destination: string | null = null;
  const out = def.output;
  if (job.kind === 'gather' && out) {
    const trip = roundTripSeconds(state, world, job.nodeId, out.resource);
    travelSeconds = trip.seconds;
    destination = trip.storage ? BUILDINGS[trip.storage.defId].name : null;
  } else if (out) {
    const b = findBuilding(state, (job as { buildingId: number }).buildingId);
    destination = out.resource === 'knowledge' ? (state.research.active ? RESEARCH[state.research.active].name : 'Academy bank') : b ? BUILDINGS[b.defId].name : null;
  }
  const perMinute = out ? (out.amount / (workSeconds + travelSeconds)) * 60 : (def.batchWork / workSeconds) * 60;
  return { jobType: jt, rate, factors, workSeconds, travelSeconds, resource: out?.resource ?? null, perMinute, destination };
}

/** Estimated net flow per minute for each resource given current assignments. */
export function productionSummary(state: GameState, world: World): Record<ResourceId, { gain: number; use: number }> {
  const out = {} as Record<ResourceId, { gain: number; use: number }>;
  for (const r of RESOURCE_ORDER) out[r] = { gain: 0, use: 0 };
  const meal = mealDuration(state);
  for (const v of state.villagers) {
    if (!v.job) continue;
    const est = estimateJob(state, world, v, v.job);
    if (!est) continue;
    if (est.resource) out[est.resource].gain += est.perMinute;
    if (JOBS[est.jobType].consumesFood) {
      const duty = est.workSeconds / (est.workSeconds + est.travelSeconds);
      out.stew.use += (60 / meal) * duty;
    }
  }
  return out;
}

export function constructionEta(state: GameState, b: BuildingInstance): number | null {
  const site = siteWork(b);
  if (!site) return null;
  const builders = state.villagers.filter((v) => v.job?.kind === 'construct' && v.job.buildingId === b.id && v.activity === 'working');
  const rate = builders.reduce((sum, v) => sum + workRateBreakdown(state, v, 'build').rate, 0);
  if (rate <= 0) return null;
  const inFlight = builders.reduce((sum, v) => sum + v.workProgress, 0);
  return Math.max(0, site.required - site.progress - inFlight) / rate;
}

/** Construction or upgrade progress 0..1 including builders' in-progress batches (for smooth visuals). */
export function constructionFraction(state: GameState, b: BuildingInstance): number {
  const site = siteWork(b);
  if (!site) return 1;
  if (site.required <= 0) return 0;
  let p = site.progress;
  for (const v of state.villagers) {
    if (v.job?.kind === 'construct' && v.job.buildingId === b.id && v.activity === 'working') p += Math.min(v.workProgress, v.batchWork);
  }
  return Math.max(0, Math.min(1, p / site.required));
}

// ---------------------------------------------------------------------------
// Guidance
// ---------------------------------------------------------------------------

export interface Suggestion {
  id: string;
  text: string;
  kind: 'warning' | 'idea';
  action?: { type: 'selectVillager'; id: number } | { type: 'openResearch' } | { type: 'openBuild'; building?: BuildingId } | { type: 'selectBuilding'; id: number };
}

/** "What should I do next?" — a short, prioritised list of nudges. */
export function nextSteps(state: GameState): Suggestion[] {
  const tips: Suggestion[] = [];
  const idle = idleVillagers(state);
  if (idle.length > 0) {
    tips.push({
      id: 'idle',
      kind: 'warning',
      text: idle.length === 1 ? `${idle[0].name} has nothing to do` : `${idle.length} villagers are idle`,
      action: { type: 'selectVillager', id: idle[0].id },
    });
  }
  const eaters = state.villagers.filter((v) => v.job && jobTypeOf(state, v.job) && JOBS[jobTypeOf(state, v.job)!].consumesFood).length;
  const cooks = state.villagers.filter((v) => v.job && jobTypeOf(state, v.job) === 'cook').length;
  if (state.resources.stew < 5 && eaters > 0 && cooks === 0) {
    const kitchen = state.buildings.find((b) => b.defId === 'cookhouse');
    tips.push({ id: 'food', kind: 'warning', text: 'Stew is running low — put someone on the pot', action: kitchen ? { type: 'selectBuilding', id: kitchen.id } : undefined });
  }
  for (const r of ['timber', 'clay', 'stone'] as const) {
    const cap = capacity(state, r);
    if (cap > 0 && state.resources[r] >= cap) {
      // Prefer pointing at an affordable upgrade of an existing store over building a new one.
      const store = STORE_FOR[r];
      const upgradable = state.buildings.find((b) => b.defId === store && !upgradeBlocker(state, b) && canAffordUpgrade(state, b));
      tips.push(
        upgradable
          ? { id: `full-${r}`, kind: 'warning', text: `${RESOURCES[r].name} storage is full — upgrade the ${BUILDINGS[store].name}`, action: { type: 'selectBuilding', id: upgradable.id } }
          : { id: `full-${r}`, kind: 'warning', text: `${RESOURCES[r].name} storage is full`, action: { type: 'openBuild', building: store } },
      );
    }
  }
  for (const b of state.buildings) {
    if (!siteWork(b)) continue;
    const builders = state.villagers.filter((v) => v.job?.kind === 'construct' && v.job.buildingId === b.id).length;
    const what = b.upgrade ? `${BUILDINGS[b.defId].name} upgrade` : `${BUILDINGS[b.defId].name} site`;
    if (builders === 0) tips.push({ id: `site-${b.id}`, kind: 'warning', text: `${what} needs a builder`, action: { type: 'selectBuilding', id: b.id } });
  }
  const academy = state.buildings.find((b) => b.defId === 'academy' && b.status === 'complete');
  if (academy && !state.research.active) {
    const available = RESEARCH_IDS.filter((id) => researchStatus(state, id) === 'available');
    if (available.length > 0) tips.push({ id: 'research', kind: 'idea', text: `Choose a research project (${available.length} available)`, action: { type: 'openResearch' } });
  }
  if (!academy && !state.buildings.some((b) => b.defId === 'academy')) {
    tips.push({ id: 'academy', kind: 'idea', text: 'Build an Academy to start researching', action: { type: 'openBuild', building: 'academy' } });
  }
  for (const id of BUILD_MENU_ORDER) {
    if (BUILDINGS[id].category === 'decor' || id === 'academy') continue;
    if (!checkBuildable(state, id).ok) continue;
    if (id === 'cottage' && housingCapacity(state) <= state.villagers.length && canAfford(state, nextCost(state, id).resources)) {
      tips.push({ id: 'cottage', kind: 'idea', text: 'You can afford a Cottage — room for a new villager', action: { type: 'openBuild', building: 'cottage' } });
    }
  }
  if (!state.buildings.some((b) => b.upgrade)) {
    const ready = state.buildings.find((b) => !upgradeBlocker(state, b) && canAffordUpgrade(state, b) && BUILDINGS[b.defId].category !== 'storage');
    if (ready) tips.push({ id: `upgrade-${ready.id}`, kind: 'idea', text: `You can afford to upgrade the ${BUILDINGS[ready.defId].name}`, action: { type: 'selectBuilding', id: ready.id } });
  }
  const lockedTier = RESEARCH_IDS.find((id) => researchStatus(state, id) === 'locked-level');
  if (lockedTier && tips.length < 3) {
    tips.push({ id: 'level', kind: 'idea', text: `Reach level ${RESEARCH[lockedTier].tier} to open new research`, action: { type: 'openResearch' } });
  }
  return tips.slice(0, 4);
}
