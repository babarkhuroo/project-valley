import { BUILDINGS, type BuildingId } from '../config/buildings';
import { IDENTITY } from '../config/identity';
import type { ResourceId } from '../config/resources';
import type { ValleyBuildingId } from '../config/valley';
import { isValleyUnlocked } from '../sim/modifiers';
import type { BoostId } from '../config/trade';
import { buyWare, claimRoadReward, fillCrate, useBoost } from '../sim/trade';
import { startTraining } from '../sim/training';
import { startShift } from '../sim/millrace';
import type { CoopRecipeId } from '../config/millrace';
import type { SkillId } from '../config/skills';
import type { ValleyResearchId } from '../config/valleyResearch';
import { RESEARCH, type ResearchId } from '../config/research';
import type { RecipeId } from '../config/recipes';
import { runtime, game } from '../game/runtime';
import { advanceTutorial, skipTutorial } from '../game/tutorial';
import {
  acceptNewcomer,
  assignVillager,
  cancelConstruction,
  cancelUpgrade,
  startUpgrade,
  queueCraft,
  cancelCraftOrder,
  moveCraftOrder,
  moveBuilding,
  placeBuilding,
  renamePlayer,
  renameVillage,
  setActiveResearch,
  unassignVillager,
  type CommandResult,
} from '../sim/commands';
import { canAfford } from '../sim/economy';
import { checkBuildable, checkFootprint, nextCost } from '../sim/construction';
import { rotatedSize } from '../sim/grid';
import type { Job, Rotation } from '../sim/types';
import { findBuilding, findVillager } from '../sim/villagerAI';
import type { PickTarget } from '../rendering/InputController';
import { ui } from './store';

/**
 * UI-facing actions. Each wraps a simulation command with player feedback: sounds,
 * selection changes and a toast when something is refused.
 */

function feedback<T>(result: CommandResult<T>, success?: () => void): CommandResult<T> {
  if (result.ok) {
    success?.();
  } else {
    runtime.audio.play('error');
    ui.toast({ kind: 'warning', title: result.error, icon: 'info' }, 3000);
  }
  return result;
}

export function focus(target: PickTarget, distance?: number): void {
  runtime.renderer?.focusOn(target, distance);
}

export function selectAndFocus(target: PickTarget, distance?: number): void {
  ui.select(target);
  focus(target, distance);
  runtime.audio.play('click');
}

export function assign(villagerId: number, job: Job): void {
  const res = game().run((s, w, sink) => assignVillager(s, w, villagerId, job, sink));
  feedback(res, () => {
    runtime.audio.play('click');
    const replaced = res.ok ? res.value?.replaced : null;
    if (replaced) {
      const v = findVillager(game().state, replaced);
      if (v) ui.toast({ kind: 'info', title: `${v.name} is now free`, body: 'Replaced on that job.', icon: 'idle', target: { kind: 'villager', id: v.id } }, 3000);
    }
  });
  if (ui.get().mode.kind === 'assign') ui.set({ mode: { kind: 'normal' } });
}

export function unassign(villagerId: number): void {
  feedback(game().run((s, w, sink) => unassignVillager(s, w, villagerId, sink)), () => runtime.audio.play('close'));
}

export function beginAssign(villagerId: number): void {
  ui.set({ mode: { kind: 'assign', villagerId }, panel: null });
  runtime.audio.play('open');
}

export function startPlacing(defId: BuildingId): void {
  const ok = checkBuildable(game().state, defId);
  if (!ok.ok) {
    feedback({ ok: false, error: ok.reason });
    return;
  }
  ui.set({ mode: { kind: 'place', defId, rotation: 0 }, panel: null, placement: null, selection: null });
  runtime.audio.play('open');
}

export function startMove(buildingId: number): void {
  const b = findBuilding(game().state, buildingId);
  if (!b) return;
  ui.set({
    mode: { kind: 'move', buildingId, defId: b.defId, rotation: b.rotation },
    placement: { cellX: b.cellX, cellZ: b.cellZ, valid: true, reason: null },
    panel: null,
  });
  runtime.audio.play('open');
}

export function cancelMode(): void {
  const { mode } = ui.get();
  if (mode.kind !== 'normal') {
    ui.set({ mode: { kind: 'normal' }, placement: null });
    runtime.audio.play('close');
  }
}

export function rotatePlacement(): void {
  const { mode, placement } = ui.get();
  if (mode.kind !== 'place' && mode.kind !== 'move') return;
  const rotation = ((mode.rotation + 1) % 4) as Rotation;
  ui.set({ mode: { ...mode, rotation } });
  if (placement) updatePlacementCell(placement.cellX, placement.cellZ);
  runtime.audio.play('click');
}

/** Converts a ground point under the cursor into a placement cell and validates it. */
export function updatePlacementFromGround(x: number, z: number): void {
  const { mode } = ui.get();
  if (mode.kind !== 'place' && mode.kind !== 'move') return;
  const { w, d } = rotatedSize(mode.defId, mode.rotation);
  updatePlacementCell(Math.round(x - w / 2), Math.round(z - d / 2));
}

export function updatePlacementCell(cellX: number, cellZ: number): void {
  const { mode } = ui.get();
  if (mode.kind !== 'place' && mode.kind !== 'move') return;
  const g = game();
  const ignore = mode.kind === 'move' ? mode.buildingId : -1;
  const fit = checkFootprint(g.world, mode.defId, cellX, cellZ, mode.rotation, ignore);
  let valid = fit.ok;
  let reason = fit.ok ? null : fit.reason;
  if (valid && mode.kind === 'place' && !canAfford(g.state, nextCost(g.state, mode.defId).resources)) {
    valid = false;
    reason = 'Not enough resources';
  }
  const prev = ui.get().placement;
  if (prev && prev.cellX === cellX && prev.cellZ === cellZ && prev.valid === valid && prev.reason === reason) return;
  ui.set({ placement: { cellX, cellZ, valid, reason } });
}

export function confirmPlacement(): void {
  const { mode, placement } = ui.get();
  if (!placement) return;
  if (mode.kind === 'place') {
    const res = game().run((s, w, sink) => placeBuilding(s, w, mode.defId, placement.cellX, placement.cellZ, mode.rotation, sink));
    feedback(res, () => {
      const b = res.ok ? res.value! : null;
      const def = BUILDINGS[mode.defId];
      const keepPlacing = def.category === 'decor' && checkBuildable(game().state, mode.defId).ok && canAfford(game().state, nextCost(game().state, mode.defId).resources);
      if (keepPlacing) {
        // Decorations can be stamped repeatedly.
        updatePlacementCell(placement.cellX, placement.cellZ);
      } else {
        ui.set({ mode: { kind: 'normal' }, placement: null });
        if (b) ui.select({ kind: 'building', id: b.id });
      }
    });
  } else if (mode.kind === 'move') {
    const res = game().run((s, w, sink) => moveBuilding(s, w, mode.buildingId, placement.cellX, placement.cellZ, mode.rotation, sink));
    feedback(res, () => {
      runtime.audio.play('place');
      ui.set({ mode: { kind: 'normal' }, placement: null, selection: { kind: 'building', id: mode.buildingId } });
    });
  }
}

export function cancelSite(buildingId: number): void {
  feedback(game().run((s, w, sink) => cancelConstruction(s, w, buildingId, sink)), () => {
    runtime.audio.play('close');
    ui.select(null);
  });
}

export function upgradeBuilding(buildingId: number): void {
  const res = game().run((s, w, sink) => startUpgrade(s, w, buildingId, sink));
  feedback(res, () => {
    const b = findBuilding(game().state, buildingId);
    if (b?.upgrade) ui.toast({ kind: 'info', title: `${BUILDINGS[b.defId].name} upgrade started`, body: 'Assign a builder — it keeps working meanwhile.', icon: 'upgrade', target: { kind: 'building', id: b.id } }, 3500);
  });
}

export function cancelBuildingUpgrade(buildingId: number): void {
  feedback(game().run((s, w, sink) => cancelUpgrade(s, w, buildingId, sink)), () => runtime.audio.play('close'));
}

export function orderCraft(buildingId: number, recipe: RecipeId, count: number): void {
  feedback(game().run((s, w, sink) => queueCraft(s, w, buildingId, recipe, count, sink)), () => runtime.audio.play('click'));
}

export function cancelOrder(buildingId: number, index: number): void {
  feedback(game().run((s, w, sink) => cancelCraftOrder(s, w, buildingId, index, sink)), () => runtime.audio.play('close'));
}

export function moveOrder(buildingId: number, index: number, delta: -1 | 1): void {
  feedback(game().run((s) => moveCraftOrder(s, buildingId, index, delta)), () => runtime.audio.play('click'));
}

export function chooseResearch(id: ResearchId | null): void {
  feedback(game().run((s, w, sink) => setActiveResearch(s, w, id, sink)), () => {
    runtime.audio.play('click');
    if (id) ui.toast({ kind: 'info', title: `Researching ${RESEARCH[id].name}`, icon: 'research' }, 2500);
  });
}

export function welcomeNewcomer(index: number): void {
  const res = game().run((s, w, sink) => acceptNewcomer(s, w, index, sink));
  feedback(res, () => {
    if (res.ok && res.value) {
      ui.set({ newcomersHidden: false });
      selectAndFocus({ kind: 'villager', id: res.value.id }, 16);
    }
  });
}

export function rename(name: string): void {
  feedback(game().run((s) => renameVillage(s, name)), () => void runtime.valley?.syncProfile());
}

export function renameMe(name: string): void {
  feedback(game().run((s) => renamePlayer(s, name)), () => void runtime.valley?.syncProfile());
}

export function tutorialNext(): void {
  game().mutate((s, _w, sink) => advanceTutorial(s, sink));
  runtime.audio.play('click');
}

export function tutorialSkip(): void {
  game().mutate((s) => skipTutorial(s));
}

export function tutorialRestart(): void {
  game().mutate((s) => {
    s.tutorial = { step: 0, done: false, skipped: false, intros: s.tutorial.intros };
  });
}

// ---------------------------------------------------------------------------
// The Valley
// ---------------------------------------------------------------------------

/** Swaps the world on screen to the shared Valley (the village keeps simulating). */
export function travelToValley(): void {
  const state = game().state;
  if (!isValleyUnlocked(state)) {
    ui.toast({ kind: 'info', title: `The road to ${IDENTITY.valleyName} is still overgrown`, body: 'Research The Valley Road at the Academy to clear it.', icon: 'valley' });
    return;
  }
  const client = runtime.valley;
  if (!state.valley.valleyId) {
    // First, the village has to find (or found) a Valley.
    ui.set({ valleyChooser: true, panel: null });
    return;
  }
  if (client) {
    client.visiting = true;
    void client.refresh();
  }
  runtime.audio.play('click');
  ui.set({ scene: 'valley', travelling: true, selection: null, hover: null, mode: { kind: 'normal' }, panel: null, valleySelection: null, valleyHover: null });
}

export function returnToVillage(): void {
  if (runtime.valley) runtime.valley.visiting = false;
  runtime.audio.play('click');
  ui.set({ scene: 'village', travelling: true, valleySelection: null, valleyHover: null, panel: null });
}

export function selectValleyBuilding(id: ValleyBuildingId | null, focusCamera = false): void {
  ui.set({ valleySelection: id });
  if (id && focusCamera) runtime.valleyRenderer?.focusOn(id);
}

/** Sends resources to a Valley project; the toast for the result comes when the server confirms. */
export function contributeToValley(id: ValleyBuildingId, resources: Partial<Record<ResourceId, number>>): boolean {
  const client = runtime.valley;
  const error = client ? client.contribute(id, resources) : 'The Valley is out of reach right now';
  if (error) {
    ui.toast({ kind: 'warning', title: 'Couldn’t send that', body: error, icon: 'info' }, 3000);
    runtime.audio.play('error');
    return false;
  }
  runtime.audio.play('deposit');
  return true;
}

// ---------------------------------------------------------------------------
// Merchants, tonics and the Reputation Road
// ---------------------------------------------------------------------------

/** Travels to the Valley (if needed) and opens one of its buildings. */
export function openValleyBuilding(id: ValleyBuildingId): void {
  if (ui.get().scene !== 'valley') travelToValley();
  window.setTimeout(() => selectValleyBuilding(id, true), 120);
}

export function openHarbour(): void {
  openValleyBuilding('tradingPost');
}

export function fillMerchantCrate(index: number): void {
  const res = game().run((s, _w, sink) => fillCrate(s, index, sink));
  feedback(res, () => runtime.audio.play('deposit'));
}

export function buyFromMerchant(index: number): void {
  const res = game().run((s, _w, sink) => buyWare(s, index, sink));
  feedback(res, () => runtime.audio.play('click'));
}

export function drinkTonic(boost: BoostId): void {
  const res = game().run((s, _w, sink) => useBoost(s, boost, sink));
  feedback(res, () => runtime.audio.play('skillUp'));
}

export function claimRoad(): void {
  const res = game().run((s, _w, sink) => claimRoadReward(s, sink));
  feedback(res, () => runtime.audio.play('levelUp'));
}

/** Sends a villager to their Valley guild for a lesson. */
export function trainVillager(villagerId: number, skill: SkillId): void {
  const res = game().run((s, w, sink) => startTraining(s, w, villagerId, skill, sink));
  feedback(res, () => runtime.audio.play('newcomer'));
}

export function voteValleyResearch(id: ValleyResearchId): void {
  void runtime.valley?.vote(id).then((error) => {
    if (error) ui.toast({ kind: 'warning', title: error, icon: 'info' }, 3000);
    else runtime.audio.play('click');
  });
}

export function contributeToFestival(resources: Partial<Record<ResourceId, number>>): boolean {
  const error = runtime.valley ? runtime.valley.contributeFestival(resources) : 'The Valley is out of reach right now';
  if (error) {
    ui.toast({ kind: 'warning', title: 'Couldn’t send that', body: error, icon: 'info' }, 3000);
    runtime.audio.play('error');
    return false;
  }
  runtime.audio.play('deposit');
  return true;
}

/** Sends a villager for a Millrace shift, credited to a Valley project. */
export function sendOnShift(villagerId: number, recipe: CoopRecipeId, project: ValleyBuildingId, helpers: number): void {
  const res = game().run((s, w, sink) => startShift(s, w, villagerId, recipe, project, helpers, sink));
  feedback(res, () => runtime.audio.play('newcomer'));
}

/** Leaves the current Valley: parcels on the road come home, bonuses lapse. */
export async function leaveCurrentValley(): Promise<void> {
  const ok = (await runtime.valley?.leave()) ?? false;
  if (!ok) {
    ui.toast({ kind: 'warning', title: 'Couldn’t leave right now', body: 'The Valley is out of reach — try again in a moment.', icon: 'info' }, 3500);
    return;
  }
  ui.toast({ kind: 'info', title: 'You left the Valley', body: 'Your village is on its own until it joins another.', icon: 'valley' });
  returnToVillage();
}
