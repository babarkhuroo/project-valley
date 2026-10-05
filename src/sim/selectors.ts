import { TRAINING } from '../config/training';
import { VALLEY_BUILDINGS } from '../config/valley';
import { guildFor } from './training';
import { canClaimRoad } from './trade';
import { IDENTITY } from '../config/identity';
import { isValleyUnlocked } from './modifiers';
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
import { activeRecipe } from './crafting';
import { RECIPES, type RecipeId } from '../config/recipes';
import { mealDuration } from './modifiers';
import { findPath, pathLength } from './pathfinding';
import { housingCapacity } from './population';
import { researchStatus } from './research';
import type { BuildingInstance, GameState, Job, Vec2, Villager } from './types';
import {
  findBuilding,
  findNode,
  jobTypeOf,
  frontSpot,
  nearestPerimeterSpot,
  nodeWorkSpot,
  workRateBreakdown,
  type RateFactor,
} from './villagerAI';
import type { World } from './world';

/**
 * Read-only derived views of the state for the UI. Nothing here mutates the game.
 */

export type TaskIcon = 'idle' | JobType | 'carry' | 'walk' | 'hungry' | 'blocked' | 'travel';

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
  if (v.training) {
    const guild = VALLEY_BUILDINGS[guildFor(v.training.skill)].name;
    const left = v.training.until !== null ? v.training.until - state.time : null;
    const lesson = v.training.duration ?? TRAINING.lessons[v.training.toLevel].hours * 3600;
    return {
      label: left === null ? `Setting off for the ${guild}` : `Training at the ${guild}`,
      icon: 'travel',
      progress: left === null ? null : Math.max(0, Math.min(1, 1 - left / lesson)),
      warning: null,
      idle: false,
    };
  }
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
    const shop = jt === 'craft' && v.job.kind === 'operate' ? findBuilding(state, v.job.buildingId) : undefined;
    const recipe = shop ? activeRecipe(shop) : null;
    const missing = recipe ? RESOURCE_ORDER.find((r) => state.resources[r] < (RECIPES[recipe].inputs[r] ?? 0)) : undefined;
    const outName = recipe ? RESOURCES[RECIPES[recipe].output.resource].name : def.output ? RESOURCES[def.output.resource].name : 'Storage';
    const reasons: Record<string, string> = {
      storageFull: v.carrying ? `${RESOURCES[v.carrying.resource].name} storage full` : `${outName} storage full`,
      noOrders: `No orders at the ${target}`,
      noInputs: `Waiting for ${missing ? RESOURCES[missing].name.toLowerCase() : 'materials'}`,
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
  if (jt === 'craft' && v.job.kind === 'operate') {
    const shop = findBuilding(state, v.job.buildingId);
    const recipe = shop ? activeRecipe(shop) : null;
    if (recipe) label = RECIPES[recipe].verb;
  } else if (jt === 'study') {
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
  return state.villagers.filter((v) => !v.job && !v.training);
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
  /** Inputs consumed per minute at this pace (workshops). */
  consumes: Partial<Record<ResourceId, number>>;
  /** Recipe being estimated (workshops). */
  recipe?: RecipeId;
}

const travelCache = new Map<string, number>();

const STORE_FOR: Record<'timber' | 'clay' | 'stone', BuildingId> = {
  timber: 'timberYard',
  clay: 'clayShed',
  stone: 'stoneYard',
};

/** Walking time from a work spot to the nearest storage for `resource` and back (cached per layout). */
function roundTripSeconds(state: GameState, world: World, from: Vec2, cacheKey: string, resource: ResourceId): { seconds: number; storage: BuildingInstance | null } {
  const store = nearestStorage(state, resource, from);
  if (!store) return { seconds: 0, storage: null };
  const key = `${cacheKey}:${store.id}:${store.cellX},${store.cellZ},${store.rotation}`;
  let len = travelCache.get(key);
  if (len === undefined) {
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
  if (jt === 'craft' && job.kind === 'operate') {
    const shop = findBuilding(state, job.buildingId);
    const recipeId = shop ? activeRecipe(shop) : null;
    if (!shop || !recipeId) return null;
    const recipe = RECIPES[recipeId];
    const seconds = recipe.work / rate;
    const perItem = 60 / seconds;
    const consumes: Partial<Record<ResourceId, number>> = {};
    for (const r of RESOURCE_ORDER) if (recipe.inputs[r]) consumes[r] = recipe.inputs[r]! * perItem;
    return { jobType: jt, rate, factors, workSeconds: seconds, travelSeconds: 0, resource: recipe.output.resource, perMinute: recipe.output.amount * perItem, destination: BUILDINGS[shop.defId].name, consumes, recipe: recipeId };
  }
  const workSeconds = def.batchWork / rate;
  let travelSeconds = 0;
  let destination: string | null = null;
  const out = def.output;
  const site = job.kind === 'operate' && out?.delivery === 'carry' ? findBuilding(state, job.buildingId) : undefined;
  if (job.kind === 'gather' && out) {
    const node = findNode(state, job.nodeId);
    const trip = node ? roundTripSeconds(state, world, nodeWorkSpot(world, node), `n${node.id}`, out.resource) : { seconds: 0, storage: null };
    travelSeconds = trip.seconds;
    destination = trip.storage ? BUILDINGS[trip.storage.defId].name : null;
  } else if (site && out) {
    const trip = roundTripSeconds(state, world, frontSpot(world, site), `b${site.id}:${site.cellX},${site.cellZ},${site.rotation}`, out.resource);
    travelSeconds = trip.seconds;
    destination = trip.storage ? BUILDINGS[trip.storage.defId].name : null;
  } else if (out) {
    const b = findBuilding(state, (job as { buildingId: number }).buildingId);
    destination = out.resource === 'knowledge' ? (state.research.active ? RESEARCH[state.research.active].name : 'Academy bank') : b ? BUILDINGS[b.defId].name : null;
  }
  const perMinute = out ? (out.amount / (workSeconds + travelSeconds)) * 60 : (def.batchWork / workSeconds) * 60;
  return { jobType: jt, rate, factors, workSeconds, travelSeconds, resource: out?.resource ?? null, perMinute, destination, consumes: {} };
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
    // Blocked workers (no orders, no inputs, full storage) produce nothing right now.
    if (v.activity === 'blocked') continue;
    if (est.resource) out[est.resource].gain += est.perMinute;
    for (const r of RESOURCE_ORDER) out[r].use += est.consumes[r] ?? 0;
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
  action?: { type: 'selectVillager'; id: number } | { type: 'openResearch' } | { type: 'openBuild'; building?: BuildingId } | { type: 'selectBuilding'; id: number } | { type: 'openValley' } | { type: 'openHarbour' } | { type: 'openRoad' } | { type: 'openFestival' };
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
  const ship = state.trade.ship;
  if (ship && ship.crates.some((c) => !c.filled)) {
    const ready = ship.crates.filter((c) => !c.filled && state.resources[c.resource] >= c.amount).length;
    const left = Math.max(0, ship.leavesAt - state.time);
    tips.push({
      id: 'ship',
      kind: 'idea',
      text: `A merchant ship is in port for ${left >= 3600 ? `${Math.floor(left / 3600)}h ${Math.floor((left % 3600) / 60)}m` : `${Math.ceil(left / 60)}m`}${ready > 0 ? ` — you can fill ${ready} crate${ready > 1 ? 's' : ''}` : ''}`,
      action: { type: 'openHarbour' },
    });
  }
  if (canClaimRoad(state)) tips.push({ id: 'road', kind: 'idea', text: 'A Reputation Road reward is waiting for you', action: { type: 'openRoad' } });
  if (isValleyUnlocked(state) && !state.valley.valleyId) {
    tips.push({ id: 'valley', kind: 'idea', text: `The road to ${IDENTITY.valleyName} is open — meet your neighbours`, action: { type: 'openValley' } });
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
  for (const b of state.buildings) {
    if (!b.craft || b.status !== 'complete') continue;
    const crafters = state.villagers.filter((v) => v.job?.kind === 'operate' && v.job.buildingId === b.id);
    const name = BUILDINGS[b.defId].name;
    if (b.craft.orders.length === 0 && crafters.length > 0) tips.push({ id: `orders-${b.id}`, kind: 'warning', text: `The ${name} has no orders`, action: { type: 'selectBuilding', id: b.id } });
    else if (b.craft.orders.length > 0 && crafters.length === 0) tips.push({ id: `crafter-${b.id}`, kind: 'warning', text: `The ${name} has orders but no crafter`, action: { type: 'selectBuilding', id: b.id } });
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
