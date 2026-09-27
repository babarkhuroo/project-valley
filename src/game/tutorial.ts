import { TUTORIAL_STEPS, type TutorialStepId } from '../config/tutorial';
import { BALANCE } from '../config/balance';
import type { SimEvent } from '../sim/events';
import { addXp } from '../sim/progression';
import type { GameState } from '../sim/types';
import { findNode } from '../sim/villagerAI';

export function currentStep(state: GameState): TutorialStepId | null {
  if (state.tutorial.done || state.tutorial.skipped) return null;
  return TUTORIAL_STEPS[state.tutorial.step]?.id ?? null;
}

/** Whether a step's goal is already satisfied (steps can be completed out of order). */
function satisfied(state: GameState, id: TutorialStepId): boolean {
  const has = (defId: string, complete = true) => state.buildings.some((b) => b.defId === defId && (!complete || b.status === 'complete'));
  switch (id) {
    case 'welcome':
      return false;
    case 'assignTimber':
      return state.villagers.some((v) => v.job?.kind === 'gather' && findNode(state, v.job.nodeId)?.kind === 'tree');
    case 'assignCook':
      return state.villagers.some((v) => v.job?.kind === 'operate' && state.buildings.find((b) => b.id === (v.job as { buildingId: number }).buildingId)?.defId === 'cookhouse');
    case 'gatherTimber':
      return state.resources.timber >= 60 || has('academy', false);
    case 'buildAcademy':
      return has('academy');
    case 'research':
      return state.research.completed.includes('cottageCraft');
    case 'buildCottage':
      return has('cottage');
    case 'meetNewcomer':
      return state.villagers.length >= 3;
    case 'done':
      return false;
  }
}

/** Advances past every satisfied step. Returns true if the step changed. */
export function updateTutorial(state: GameState, sink: SimEvent[]): boolean {
  let changed = false;
  for (let guard = 0; guard < TUTORIAL_STEPS.length; guard++) {
    const id = currentStep(state);
    if (!id || !satisfied(state, id)) break;
    advanceTutorial(state, sink);
    changed = true;
  }
  return changed;
}

export function advanceTutorial(state: GameState, sink: SimEvent[]): void {
  const id = currentStep(state);
  if (!id) return;
  if (id === 'done') {
    state.tutorial.done = true;
    return;
  }
  state.tutorial.step += 1;
  if (id !== 'welcome') addXp(state, BALANCE.tutorialXp, 'Tutorial', sink);
}

export function skipTutorial(state: GameState): void {
  state.tutorial.skipped = true;
}
