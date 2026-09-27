import { RESEARCH, type ResearchId } from '../config/research';
import { addResource } from './economy';
import type { EventSink } from './events';
import { addXp } from './progression';
import type { GameState } from './types';

export type ResearchStatus = 'completed' | 'active' | 'available' | 'locked-level' | 'locked-prereq';

export function researchStatus(state: GameState, id: ResearchId): ResearchStatus {
  const def = RESEARCH[id];
  if (state.research.completed.includes(id)) return 'completed';
  if (state.research.active === id) return 'active';
  if (!def.prereqs.every((p) => state.research.completed.includes(p))) return 'locked-prereq';
  if (state.player.level < def.tier) return 'locked-level';
  return 'available';
}

export function researchProgress(state: GameState, id: ResearchId): number {
  return state.research.progress[id] ?? 0;
}

/**
 * Knowledge flows straight into the active project; any surplus (or everything, when
 * nothing is selected) is banked in the Academy up to its capacity.
 * Returns how much was accepted.
 */
export function produceKnowledge(state: GameState, amount: number, sink: EventSink): number {
  let remaining = amount;
  const active = state.research.active;
  if (active) {
    const need = RESEARCH[active].cost - researchProgress(state, active);
    const used = Math.min(need, remaining);
    state.research.progress[active] = researchProgress(state, active) + used;
    remaining -= used;
    if (researchProgress(state, active) >= RESEARCH[active].cost - 1e-9) completeResearch(state, active, sink);
  }
  const banked = remaining > 0 ? addResource(state, 'knowledge', remaining) : 0;
  return amount - remaining + banked;
}

/** Moves banked Knowledge into the active project. */
export function drainBankIntoActive(state: GameState, sink: EventSink): void {
  const active = state.research.active;
  if (!active || state.resources.knowledge <= 0) return;
  const need = RESEARCH[active].cost - researchProgress(state, active);
  const used = Math.min(need, state.resources.knowledge);
  state.resources.knowledge -= used;
  state.research.progress[active] = researchProgress(state, active) + used;
  if (researchProgress(state, active) >= RESEARCH[active].cost - 1e-9) completeResearch(state, active, sink);
}

export function completeResearch(state: GameState, id: ResearchId, sink: EventSink): void {
  if (state.research.completed.includes(id)) return;
  state.research.completed.push(id);
  state.research.progress[id] = RESEARCH[id].cost;
  if (state.research.active === id) state.research.active = null;
  sink.push({ type: 'researchComplete', researchId: id });
  addXp(state, RESEARCH[id].xp, `Research: ${RESEARCH[id].name}`, sink);
}
