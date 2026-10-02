import { BUILDINGS, BUILD_MENU_ORDER, type BuildingId } from '../config/buildings';
import { JOBS } from '../config/jobs';
import { NODES } from '../config/nodes';
import { RESEARCH, type ResearchId } from '../config/research';
import { RESOURCES } from '../config/resources';
import { canAfford, addResource, nearestStorage, pay, refund } from './economy';
import type { EventSink } from './events';
import { checkBuildable, checkFootprint, completeConstruction, completeUpgrade, nextCost } from './construction';
import { buildingStats, nextUpgrade, siteWork, upgradeBlocker } from './levels';
import { isNodeUnlocked } from './modifiers';
import { checkNewcomers, createVillager, homeWithSpace } from './population';
import { drainBankIntoActive, researchStatus } from './research';
import type { BuildingInstance, GameState, Job, Rotation, Villager } from './types';
import {
  becomeIdle,
  findBuilding,
  findNode,
  findVillager,
  goRest,
  goToWork,
  nodeWorkers,
  refreshAfterGridChange,
  restSpot,
  settleVillagers,
  walkTo,
} from './villagerAI';
import { syncWorld, type World } from './world';
import { BALANCE } from '../config/balance';

/**
 * Player intents. Every mutation that originates from input goes through here, is
 * validated against the current state, and reports a human-readable reason on refusal.
 * Keeping commands explicit lets the server replay or validate them later.
 */
export type CommandResult<T = undefined> = { ok: true; value?: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function jobSlots(state: GameState, job: Job): number {
  if (job.kind === 'gather') {
    const node = findNode(state, job.nodeId);
    return node ? NODES[node.kind].maxWorkers : 0;
  }
  const b = findBuilding(state, job.buildingId);
  if (!b) return 0;
  if (job.kind === 'construct') return BALANCE.villager.buildersPerSite;
  return BUILDINGS[b.defId].operate ? buildingStats(b.defId, b.level).slots : 0;
}

export function workersOn(state: GameState, job: Job, exceptId = -1): Villager[] {
  if (job.kind === 'gather') return nodeWorkers(state, job.nodeId, exceptId);
  return state.villagers.filter((v) => v.id !== exceptId && v.job?.kind === job.kind && v.job.buildingId === job.buildingId);
}

/** Why a job cannot be taken right now, or null when it can. */
export function jobBlocker(state: GameState, job: Job): string | null {
  switch (job.kind) {
    case 'gather': {
      const node = findNode(state, job.nodeId);
      if (!node) return 'That resource is gone';
      const def = NODES[node.kind];
      if (!isNodeUnlocked(state, node.kind)) return `Research ${RESEARCH[def.requiresResearch!].name} first`;
      if (node.amount <= 0) return 'Exhausted — regrowing';
      const out = JOBS[def.job].output?.resource;
      if (out && !nearestStorage(state, out, node)) {
        const store = BUILD_MENU_ORDER.find((id) => BUILDINGS[id].storage?.[out]);
        return store ? `Build a ${BUILDINGS[store].name} to store ${RESOURCES[out].name.toLowerCase()}` : `Build storage for ${RESOURCES[out].name}`;
      }
      return null;
    }
    case 'operate': {
      const b = findBuilding(state, job.buildingId);
      if (!b || b.status !== 'complete') return 'Building is not finished';
      if (!BUILDINGS[b.defId].operate) return 'Nobody works here';
      return null;
    }
    case 'construct': {
      const b = findBuilding(state, job.buildingId);
      if (!b || !siteWork(b)) return 'Nothing to build here';
      return null;
    }
  }
}

function sameJob(a: Job | null, b: Job): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind === 'gather' ? a.nodeId === (b as { nodeId: number }).nodeId : a.buildingId === (b as { buildingId: number }).buildingId;
}

/**
 * Assigns a villager to a job. If every slot is taken, the longest-serving worker is
 * replaced (the UI labels this "Replace …" so it is never a surprise).
 */
export function assignVillager(state: GameState, world: World, villagerId: number, job: Job, sink: EventSink): CommandResult<{ replaced: number | null }> {
  const v = findVillager(state, villagerId);
  if (!v) return fail('Unknown villager');
  if (sameJob(v.job, job)) return { ok: true, value: { replaced: null } };
  const blocker = jobBlocker(state, job);
  if (blocker) return fail(blocker);

  let replaced: number | null = null;
  const others = workersOn(state, job, v.id);
  if (others.length >= jobSlots(state, job)) {
    const out = others.sort((a, b) => a.id - b.id)[0];
    becomeIdle(state, world, out, sink, 'unassigned');
    replaced = out.id;
  }
  if (v.carrying) {
    // Hand over whatever they were carrying before switching jobs.
    addResource(state, v.carrying.resource, v.carrying.amount);
    v.carrying = null;
  }
  v.job = job;
  v.workProgress = 0;
  v.batchWork = 0;
  v.blockedReason = null;
  v.depositTargetId = null;
  goToWork(state, world, v, sink);
  settleVillagers(state, world, sink);
  return { ok: true, value: { replaced } };
}

export function unassignVillager(state: GameState, world: World, villagerId: number, sink: EventSink): CommandResult {
  const v = findVillager(state, villagerId);
  if (!v) return fail('Unknown villager');
  if (!v.job) return { ok: true };
  becomeIdle(state, world, v, sink, 'unassigned');
  return { ok: true };
}

export function placeBuilding(
  state: GameState,
  world: World,
  defId: BuildingId,
  cellX: number,
  cellZ: number,
  rotation: Rotation,
  sink: EventSink,
): CommandResult<BuildingInstance> {
  const buildable = checkBuildable(state, defId);
  if (!buildable.ok) return fail(buildable.reason);
  const cost = nextCost(state, defId);
  if (!canAfford(state, cost.resources)) return fail('Not enough resources');
  const fit = checkFootprint(world, defId, cellX, cellZ, rotation);
  if (!fit.ok) return fail(fit.reason);

  pay(state, cost.resources);
  const b: BuildingInstance = {
    id: state.nextId++,
    defId,
    cellX,
    cellZ,
    rotation,
    level: 1,
    status: 'construction',
    progress: 0,
    workRequired: cost.work,
    paid: { ...cost.resources },
    completedAt: null,
    variant: state.nextId % 4,
    upgrade: null,
  };
  state.buildings.push(b);
  syncWorld(world, state);
  sink.push({ type: 'constructionStarted', buildingId: b.id, defId });
  if (cost.work <= 0) completeConstruction(state, world, b, sink);
  refreshAfterGridChange(state, world, sink);
  return { ok: true, value: b };
}

export function moveBuilding(state: GameState, world: World, buildingId: number, cellX: number, cellZ: number, rotation: Rotation, sink: EventSink): CommandResult {
  const b = findBuilding(state, buildingId);
  if (!b) return fail('Unknown building');
  const fit = checkFootprint(world, b.defId, cellX, cellZ, rotation, b.id);
  if (!fit.ok) return fail(fit.reason);
  b.cellX = cellX;
  b.cellZ = cellZ;
  b.rotation = rotation;
  syncWorld(world, state);
  refreshAfterGridChange(state, world, sink);
  return { ok: true };
}

export function cancelConstruction(state: GameState, world: World, buildingId: number, sink: EventSink): CommandResult {
  const b = findBuilding(state, buildingId);
  if (!b || b.status !== 'construction') return fail('Nothing to cancel');
  for (const v of state.villagers) {
    if (v.job?.kind === 'construct' && v.job.buildingId === b.id) becomeIdle(state, world, v, sink, 'removed');
  }
  refund(state, b.paid);
  state.buildings = state.buildings.filter((o) => o.id !== b.id);
  syncWorld(world, state);
  refreshAfterGridChange(state, world, sink);
  return { ok: true };
}

/** Pays for the next level and opens the building to builders. It keeps working meanwhile. */
export function startUpgrade(state: GameState, world: World, buildingId: number, sink: EventSink): CommandResult {
  const b = findBuilding(state, buildingId);
  if (!b) return fail('Unknown building');
  const blocker = upgradeBlocker(state, b);
  if (blocker) return fail(blocker.startsWith('needs-research:') ? `Research ${RESEARCH[blocker.slice(15) as ResearchId].name} first` : blocker);
  const up = nextUpgrade(b.defId, b.level)!;
  if (!canAfford(state, up.cost.resources)) return fail('Not enough resources');
  pay(state, up.cost.resources);
  b.upgrade = { toLevel: b.level + 1, progress: 0, workRequired: up.cost.work, paid: { ...up.cost.resources } };
  sink.push({ type: 'upgradeStarted', buildingId: b.id, defId: b.defId, level: b.level + 1 });
  if (up.cost.work <= 0) completeUpgrade(state, world, b, sink);
  settleVillagers(state, world, sink);
  return { ok: true };
}

export function cancelUpgrade(state: GameState, world: World, buildingId: number, sink: EventSink): CommandResult {
  const b = findBuilding(state, buildingId);
  if (!b?.upgrade) return fail('No upgrade in progress');
  for (const v of state.villagers) {
    if (v.job?.kind === 'construct' && v.job.buildingId === b.id) becomeIdle(state, world, v, sink, 'removed');
  }
  refund(state, b.upgrade.paid);
  b.upgrade = null;
  return { ok: true };
}

export function setActiveResearch(state: GameState, world: World, id: ResearchId | null, sink: EventSink): CommandResult {
  if (id === null) {
    state.research.active = null;
    return { ok: true };
  }
  const status = researchStatus(state, id);
  if (status === 'completed') return fail('Already researched');
  if (status === 'locked-prereq') return fail('Finish the earlier research first');
  if (status === 'locked-level') return fail(`Reach village level ${RESEARCH[id].tier} first`);
  state.research.active = id;
  drainBankIntoActive(state, sink);
  settleVillagers(state, world, sink);
  return { ok: true };
}

export function acceptNewcomer(state: GameState, world: World, index: number, sink: EventSink): CommandResult<Villager> {
  const candidates = state.newcomers;
  if (!candidates || !candidates[index]) return fail('Nobody is waiting to join');
  const home = homeWithSpace(state);
  if (!home) return fail('No free home');
  const c = candidates[index];
  const [ex, ez] = world.map.entrance;
  const v = createVillager(state, { name: c.name, appearance: c.appearance, skills: { [c.specialty]: 1 } }, home.id, { x: ex, z: ez });
  state.villagers.push(v);
  state.newcomers = null;
  if (!walkTo(state, world, v, restSpot(state, world, v), 'toRest')) goRest(state, world, v);
  sink.push({ type: 'villagerJoined', villagerId: v.id });
  checkNewcomers(state, sink);
  return { ok: true, value: v };
}

export function renameVillage(state: GameState, name: string): CommandResult {
  const trimmed = name.trim().slice(0, 28);
  if (!trimmed) return fail('Name cannot be empty');
  state.player.villageName = trimmed;
  return { ok: true };
}
