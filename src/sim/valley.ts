import { VALLEY_RESOURCES, type ValleyBuildingId } from '../config/valley';
import type { ResourceId } from '../config/resources';
import type { CommandResult } from './commands';
import { bumpStat } from './economy';
import type { EventSink } from './events';
import { isValleyUnlocked } from './modifiers';
import { newValleyBonuses } from './save';
import type { GameState, ValleyBonuses, ValleyTarget } from './types';
import { FESTIVALS, type FestivalId } from '../config/festivals';
import type { BuildingId } from '../config/buildings';

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

/**
 * The village is no longer in a Valley (it left, or the Valley is gone). Parcels still
 * on the road come home; Knowledge in transit is simply not delivered; bonuses lapse.
 */
export function leaveValley(state: GameState): void {
  for (const op of [...state.valley.outbox]) returnValleyOp(state, op.opId);
  state.valley.valleyId = null;
  state.valley.bonuses = newValleyBonuses();
}

/** Sends resources towards a Valley project. `limit` is what the project still needs, as last seen. */
export function sendToValley(state: GameState, building: ValleyBuildingId, resources: ResourceAmounts, opId: string, sink: EventSink, limit?: ResourceAmounts): CommandResult {
  return queueDelivery(state, { kind: 'building', id: building }, VALLEY_RESOURCES, resources, opId, sink, limit);
}

/** Sends resources (Stew included) to the running festival. */
export function sendToFestival(state: GameState, festivalId: number, resources: ResourceAmounts, opId: string, sink: EventSink, limit: ResourceAmounts): CommandResult {
  return queueDelivery(state, { kind: 'festival', festivalId }, Object.keys(limit) as ResourceId[], resources, opId, sink, limit);
}

function queueDelivery(state: GameState, target: ValleyTarget, allowed: readonly ResourceId[], resources: ResourceAmounts, opId: string, sink: EventSink, limit?: ResourceAmounts): CommandResult {
  if (!isValleyUnlocked(state)) return fail('Research The Valley Road first');
  if (!state.valley.valleyId) return fail('Visit the Valley first');
  const sent: ResourceAmounts = {};
  let any = false;
  for (const r of allowed) {
    let amount = Math.floor(resources[r] ?? 0);
    if (limit) amount = Math.min(amount, limit[r] ?? 0);
    if (amount <= 0) continue;
    if (state.resources[r] < amount) return fail(`Not enough ${r}`);
    sent[r] = amount;
    any = true;
  }
  if (!any) return fail('Nothing to send');
  for (const [r, n] of Object.entries(sent) as [ResourceId, number][]) state.resources[r] -= n;
  state.valley.outbox.push({ opId, target, resources: sent, at: state.time });
  sink.push({ type: 'valleySent', target, resources: sent });
  return { ok: true };
}

/** Collects a won festival's rewards (once per festival). */
export function claimFestival(state: GameState, festivalId: number, kind: FestivalId, rewardMult: number, sink: EventSink): boolean {
  if (state.trade.festivalsClaimed.includes(festivalId)) return false;
  state.trade.festivalsClaimed.push(festivalId);
  if (state.trade.festivalsClaimed.length > 50) state.trade.festivalsClaimed.shift();
  const def = FESTIVALS[kind];
  const coins = Math.round(def.reward.coins * rewardMult);
  const reputation = Math.round(def.reward.reputation * rewardMult);
  state.trade.coins += coins;
  state.valley.reputation += reputation;
  let decor: BuildingId | null = null;
  if (def.decor && !state.trade.unlockedDecor.includes(def.decor)) {
    state.trade.unlockedDecor.push(def.decor);
    decor = def.decor;
  }
  sink.push({ type: 'festivalReward', festival: kind, coins, reputation, decor });
  return true;
}

/** Queues goods made away from the village (Millrace shifts) for a Valley target. Nothing is deducted here. */
export function queueValleyGift(state: GameState, target: ValleyTarget, resources: ResourceAmounts, opId: string): boolean {
  if (!state.valley.valleyId) return false;
  state.valley.outbox.push({ opId, target, resources, at: state.time });
  return true;
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
  for (const r of [...VALLEY_RESOURCES, 'stew' as const]) {
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
  else if (op.target.kind === 'festival') sink.push({ type: 'festivalAccepted', accepted, returned, reputation });
  else bumpStat(state, 'valley.knowledge', op.knowledge ?? 0);
  return true;
}

/** The server refused an op outright (e.g. the Valley was reset): everything comes home. */
export function returnValleyOp(state: GameState, opId: string): boolean {
  const i = state.valley.outbox.findIndex((o) => o.opId === opId);
  if (i < 0) return false;
  const [op] = state.valley.outbox.splice(i, 1);
  for (const [r, n] of Object.entries(op.resources) as [ResourceId, number][]) state.resources[r] += n ?? 0;
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
    for (const [r, n] of Object.entries(op.resources) as [ResourceId, number][]) if (n) out[r] = (out[r] ?? 0) + n;
  }
  return out;
}
