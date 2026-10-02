import { BUILDINGS, type BuildingId } from '../config/buildings';
import { JOBS } from '../config/jobs';
import { REPEAT_ORDER } from '../config/recipes';
import type { ResearchId } from '../config/research';
import type { ResourceId } from '../config/resources';
import { acceptNewcomer, assignVillager, jobSlots, placeBuilding, queueCraft, setActiveResearch, startUpgrade, workersOn } from './commands';
import { checkBuildable, checkFootprint, countBuildings, nextCost } from './construction';
import { canAfford, capacity } from './economy';
import type { EventSink } from './events';
import { buildingCenter } from './grid';
import { canAffordUpgrade, nextUpgrade, siteWork, upgradeBlocker } from './levels';
import { isNodeUnlocked } from './modifiers';
import { researchStatus } from './research';
import type { GameState, Job, Vec2, Villager } from './types';
import { jobTypeOf, nearestFreeNode } from './villagerAI';
import type { World } from './world';

/**
 * A deterministic "reasonable player" used to measure pacing. It only acts through the
 * same commands as a human, so whatever it achieves a careful player can achieve too.
 * It is intentionally simple: a build/upgrade priority list, a research order, and a
 * role allocator that keeps food, research, construction and gathering staffed.
 */

type Goal = { build: BuildingId; count: number } | { upgrade: BuildingId; level: number };

export const AUTOPLAY_GOALS: Goal[] = [
  { build: 'academy', count: 1 },
  { build: 'cottage', count: 1 },
  { build: 'clayShed', count: 1 },
  { upgrade: 'timberYard', level: 2 },
  { build: 'stoneYard', count: 1 },
  { build: 'cottage', count: 2 },
  { upgrade: 'cookhouse', level: 2 },
  { build: 'sawmill', count: 1 },
  { upgrade: 'clayShed', level: 2 },
  { upgrade: 'academy', level: 2 },
  { upgrade: 'stoneYard', level: 2 },
  { build: 'brickworks', count: 1 },
  { build: 'warehouse', count: 1 },
  { upgrade: 'lodge', level: 2 },
  { build: 'cottage', count: 3 },
  { build: 'woodlot', count: 1 },
  { build: 'clayPit', count: 1 },
  { upgrade: 'timberYard', level: 3 },
  { build: 'house', count: 1 },
  { upgrade: 'cookhouse', level: 3 },
  { upgrade: 'academy', level: 3 },
  { build: 'quarry', count: 1 },
  { build: 'house', count: 2 },
];

export const AUTOPLAY_RESEARCH: ResearchId[] = [
  'cottageCraft', 'clayDigging', 'heartyRecipes', 'stonecutting', 'growingHamlet', 'carpentry', 'sturdyRacks', 'sharpAxes',
  'studyNotes', 'fieldRations', 'masonry', 'villageCommons', 'brickmaking', 'claySpades', 'woodlandTending', 'buildersPlans',
  'familyHomes', 'woodlots', 'clayPits', 'organisedStores', 'apprenticeship', 'masterCrafts', 'preservedFood', 'townhouses',
  'stoneQuarry', 'masterBuilders',
];

/** Where each kind of building is placed: storage near its resource, workshops in the clearing. */
const ANCHORS: Partial<Record<BuildingId, [number, number]>> = {
  timberYard: [21, 30],
  woodlot: [18, 31],
  clayShed: [41, 36],
  clayPit: [41, 40],
  stoneYard: [44, 18],
  quarry: [41, 15],
};
const CLEARING: [number, number] = [32, 37];

const RAW: { resource: ResourceId; kind: 'tree' | 'clay' | 'stone'; production: BuildingId }[] = [
  { resource: 'timber', kind: 'tree', production: 'woodlot' },
  { resource: 'clay', kind: 'clay', production: 'clayPit' },
  { resource: 'stone', kind: 'stone', production: 'quarry' },
];

function placeNear(state: GameState, world: World, defId: BuildingId, sink: EventSink): boolean {
  const [ax, az] = ANCHORS[defId] ?? CLEARING;
  for (let r = 0; r < 14; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = ax + dx;
        const z = az + dz;
        if (!checkFootprint(world, defId, x, z, 0).ok) continue;
        // Leave a lane between buildings so paths stay open.
        if (!checkFootprint(world, defId, x - 1, z - 1, 0).ok && !checkFootprint(world, defId, x + 1, z + 1, 0).ok) continue;
        return placeBuilding(state, world, defId, x, z, 0, sink).ok;
      }
    }
  }
  return false;
}

function pursueGoals(state: GameState, world: World, sink: EventSink): void {
  if (state.buildings.some((b) => siteWork(b))) return; // one project at a time keeps builders focused
  for (const goal of AUTOPLAY_GOALS) {
    if ('build' in goal) {
      if (countBuildings(state, goal.build) >= goal.count) continue;
      if (!checkBuildable(state, goal.build).ok) continue;
      const cost = nextCost(state, goal.build).resources;
      if (Object.entries(cost).some(([r, n]) => (n ?? 0) > Math.max(capacity(state, r as ResourceId), state.resources[r as ResourceId]))) continue;
      if (canAfford(state, cost)) placeNear(state, world, goal.build, sink);
      return; // save up for this goal before considering later ones
    }
    const b = state.buildings.find((o) => o.defId === goal.upgrade && o.level < goal.level && o.status === 'complete');
    if (!b) continue;
    if (upgradeBlocker(state, b)) continue;
    const up = nextUpgrade(b.defId, b.level)!;
    if (Object.entries(up.cost.resources).some(([r, n]) => (n ?? 0) > Math.max(capacity(state, r as ResourceId), state.resources[r as ResourceId]))) continue;
    if (canAffordUpgrade(state, b)) startUpgrade(state, world, b.id, sink);
    return;
  }
}

function pickResearch(state: GameState, world: World, sink: EventSink): void {
  if (state.research.active) return;
  const next = AUTOPLAY_RESEARCH.find((id) => researchStatus(state, id) === 'available');
  if (next) setActiveResearch(state, world, next, sink);
}

function keepWorkshopsBusy(state: GameState, world: World, sink: EventSink): void {
  for (const b of state.buildings) {
    if (!b.craft || b.status !== 'complete' || b.craft.orders.length > 0) continue;
    const recipe = BUILDINGS[b.defId].workshop!.recipes[0];
    queueCraft(state, world, b.id, recipe, REPEAT_ORDER, sink);
  }
}

/** A villager is free for reassignment when idle or stuck on something that won't clear soon. */
function isFree(v: Villager): boolean {
  if (v.training) return false;
  if (!v.job) return v.activity !== 'walking' || v.purpose === 'toRest';
  return v.activity === 'blocked' && v.blockedReason !== 'knowledgeFull';
}

function gatherJob(state: GameState, _world: World, v: Villager, need: (typeof RAW)[number]): Job | null {
  for (const b of state.buildings) {
    if (b.defId !== need.production || b.status !== 'complete') continue;
    const job: Job = { kind: 'operate', buildingId: b.id };
    if (workersOn(state, job, v.id).length < jobSlots(state, job)) return job;
  }
  const store = state.buildings.find((b) => b.status === 'complete' && (BUILDINGS[b.defId].storage?.[need.resource] ?? 0) > 0);
  if (!store || !isNodeUnlocked(state, need.kind)) return null;
  const from: Vec2 = buildingCenter(store);
  const node = nearestFreeNode(state, need.kind, from, v.id, 30);
  return node ? { kind: 'gather', nodeId: node.id } : null;
}

interface Role {
  job: Job;
  want: number;
}

/**
 * Staffs roles in priority order: food when low, construction, research, workshops; the
 * rest gather whatever is scarcest. Roles already staffed keep their people, so the
 * village doesn't thrash; lower-priority workers are borrowed when a higher role needs them.
 */
function allocate(state: GameState, world: World, sink: EventSink): void {
  const villagers = state.villagers;
  const n = villagers.length;
  const roles: Role[] = [];

  const kitchen = state.buildings.find((b) => b.defId === 'cookhouse')!;
  const cookJob: Job = { kind: 'operate', buildingId: kitchen.id };
  const stewFill = fill(state, 'stew');
  const cooking = workersOn(state, cookJob).length > 0;
  if (stewFill < 0.3 || (cooking && stewFill < 0.9)) roles.push({ job: cookJob, want: 1 });

  for (const b of state.buildings) {
    if (siteWork(b)) roles.push({ job: { kind: 'construct', buildingId: b.id }, want: n >= 5 ? 2 : 1 });
  }

  const academy = state.buildings.find((b) => b.defId === 'academy' && b.status === 'complete');
  const studying = !!academy && (state.research.active !== null || AUTOPLAY_RESEARCH.some((id) => researchStatus(state, id) === 'available'));
  // With only two villagers, research waits until timber is healthy so someone always gathers.
  if (academy && studying && (n >= 3 || fill(state, 'timber') > 0.6)) {
    // A bigger village staffs every Academy desk: late tiers are research-bound.
    const job: Job = { kind: 'operate', buildingId: academy.id };
    roles.push({ job, want: n >= 6 ? jobSlots(state, job) : 1 });
  }

  if (n >= 4) {
    for (const b of state.buildings) {
      if (!b.craft || b.status !== 'complete') continue;
      // Work until the store is actually full: some goals need every last plank the store can hold.
      const plenty = b.defId === 'sawmill' ? fill(state, 'timber') > 0.35 && fill(state, 'planks') < 1 : fill(state, 'clay') > 0.35 && fill(state, 'bricks') < 1;
      if (plenty) roles.push({ job: { kind: 'operate', buildingId: b.id }, want: 1 });
    }
  }

  const sameJob = (a: Job | null, b: Job) => !!a && a.kind === b.kind && (a.kind === 'gather' ? a.nodeId === (b as { nodeId: number }).nodeId : a.buildingId === (b as { buildingId: number }).buildingId);
  const taken = new Set<number>();
  // Keep people already doing a requested role.
  for (const role of roles) {
    for (const v of villagers) {
      if (taken.has(v.id) || !sameJob(v.job, role.job) || v.activity === 'blocked') continue;
      if (role.want <= 0) break;
      taken.add(v.id);
      role.want--;
    }
  }
  // Fill what's missing: idle or stuck people first, then whoever gathers the most plentiful resource.
  for (const role of roles) {
    while (role.want > 0) {
      const pool = villagers.filter((v) => !taken.has(v.id));
      const pick = pool.find(isFree) ?? pool.sort((a, b) => fill(state, outputOf(state, b)) - fill(state, outputOf(state, a)))[0];
      if (!pick) break;
      taken.add(pick.id);
      role.want--;
      assignVillager(state, world, pick.id, role.job, sink);
    }
  }
  // Everyone else gathers whatever is scarcest.
  const needs = RAW.filter((r) => capacity(state, r.resource) > 0);
  for (const v of villagers) {
    if (taken.has(v.id)) continue;
    const ranked = [...needs].sort((a, b) => fill(state, a.resource) - fill(state, b.resource));
    const current = v.job ? jobTypeOf(state, v.job) : null;
    const gathering = current === 'chop' || current === 'dig' || current === 'quarry';
    if (gathering && v.activity !== 'blocked' && fill(state, outputOf(state, v)) < fill(state, ranked[0].resource) + 0.25) continue;
    for (const need of ranked) {
      const job = gatherJob(state, world, v, need);
      if (job && assignVillager(state, world, v.id, job, sink).ok) break;
    }
  }
}

function outputOf(state: GameState, v: Villager): ResourceId {
  const jt = v.job ? jobTypeOf(state, v.job) : null;
  return (jt && JOBS[jt].output?.resource) || 'timber';
}

function fill(state: GameState, r: ResourceId): number {
  const cap = capacity(state, r);
  return cap > 0 ? state.resources[r] / cap : 1;
}

/** One decision tick of the autoplayer. */
export function autoplayStep(state: GameState, world: World, sink: EventSink): void {
  if (state.newcomers) acceptNewcomer(state, world, 0, sink);
  pickResearch(state, world, sink);
  pursueGoals(state, world, sink);
  keepWorkshopsBusy(state, world, sink);
  allocate(state, world, sink);
}
