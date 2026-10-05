import { VALLEY_RESOURCES, type ValleyBuildingId } from '../config/valley';
import type { ResourceId } from '../config/resources';
import type { CommandResult } from './commands';
import { bumpStat } from './economy';
import type { EventSink } from './events';
import { isValleyUnlocked } from './modifiers';
import type { GameState, ValleyBonuses } from './types';

/**
 * The village's side of the Valley. Deliveries leave the village immediately and wait
 * in an outbox (saved) until the server confirms them; the server's answer is applied
 * with `settleValleyOp`. Valley state itself never lives in the village save.
 */

export type ResourceAmounts = Partial<Record<ResourceId, number>>;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function joinValley(state: GameState, valleyId: string): void {
  state.valley.valleyId = valleyId;
}

/** Sends resources towards a Valley project. `limit` is what the project still needs, as last seen. */
export function sendToValley(state: GameState, building: ValleyBuildingId, resources: ResourceAmounts, opId: string, sink: EventSink, limit?: ResourceAmounts): CommandResult {
  if (!isValleyUnlocked(state)) return fail('Research The Valley Road first');
  if (!state.valley.valleyId) return fail('Visit the Valley first');
  const sent: ResourceAmounts = {};
  let any = false;
  for (const r of VALLEY_RESOURCES) {
    let amount = Math.floor(resources[r] ?? 0);
    if (limit) amount = Math.min(amount, limit[r] ?? 0);
    if (amount <= 0) continue;
    if (state.resources[r] < amount) return fail(`Not enough ${r}`);
    sent[r] = amount;
    any = true;
  }
  if (!any) return fail('Nothing to send');
  for (const r of VALLEY_RESOURCES) {
    const n = sent[r] ?? 0;
    if (n > 0) state.resources[r] -= n;
  }
  state.valley.outbox.push({ opId, target: { kind: 'building', id: building }, resources: sent, at: state.time });
  sink.push({ type: 'valleySent', building, resources: sent });
  return { ok: true };
}

/** Queues Valley Knowledge (earned trading) for the shared research. Nothing leaves the village. */
export function sendKnowledge(state: GameState, amount: number, opId: string): boolean {
  if (!state.valley.valleyId || amount <= 0) return false;
  state.valley.outbox.push({ opId, target: { kind: 'knowledge' }, resources: {}, knowledge: Math.floor(amount), at: state.time });
  return true;
}

/** Applies the server's answer to a delivery. Safe to call twice: unknown ops are ignored. */
export function settleValleyOp(state: GameState, opId: string, accepted: ResourceAmounts, returned: ResourceAmounts, reputation: number, sink: EventSink): boolean {
  const i = state.valley.outbox.findIndex((o) => o.opId === opId);
  if (i < 0) return false;
  const op = state.valley.outbox[i];
  state.valley.outbox.splice(i, 1);
  for (const r of VALLEY_RESOURCES) {
    const back = returned[r] ?? 0;
    // Returned parcels go straight back into store, even past the cap — nothing is lost.
    if (back > 0) state.resources[r] += back;
    const given = accepted[r] ?? 0;
    if (given > 0) {
      state.valley.given[r] = (state.valley.given[r] ?? 0) + given;
      bumpStat(state, `valley.${r}`, given);
    }
  }
  state.valley.reputation += reputation;
  if (op.target.kind === 'building') sink.push({ type: 'valleyAccepted', building: op.target.id, accepted, returned, reputation });
  else bumpStat(state, 'valley.knowledge', op.knowledge ?? 0);
  return true;
}

/** The server refused an op outright (e.g. the Valley was reset): everything comes home. */
export function returnValleyOp(state: GameState, opId: string): boolean {
  const i = state.valley.outbox.findIndex((o) => o.opId === opId);
  if (i < 0) return false;
  const [op] = state.valley.outbox.splice(i, 1);
  for (const r of VALLEY_RESOURCES) state.resources[r] += op.resources[r] ?? 0;
  return true;
}

export function setValleyBonuses(state: GameState, bonuses: ValleyBonuses): boolean {
  if (JSON.stringify(bonuses) === JSON.stringify(state.valley.bonuses)) return false;
  state.valley.bonuses = bonuses;
  return true;
}

/** Resources currently on their way to the Valley. */
export function inTransit(state: GameState): ResourceAmounts {
  const out: ResourceAmounts = {};
  for (const op of state.valley.outbox) {
    for (const r of VALLEY_RESOURCES) if (op.resources[r]) out[r] = (out[r] ?? 0) + op.resources[r]!;
  }
  return out;
}
