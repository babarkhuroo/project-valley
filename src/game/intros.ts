import { INTROS, type IntroDef, type IntroId } from '../config/intros';
import { BOOST_ORDER } from '../config/trade';
import { SKILL_ORDER } from '../config/skills';
import { upgradeBlocker } from '../sim/levels';
import { isValleyUnlocked } from '../sim/modifiers';
import { canClaimRoad, tradeOpen } from '../sim/trade';
import { trainingOffer } from '../sim/training';
import type { GameState } from '../sim/types';
import type { ValleySnapshot } from '../valley/types';
import { libraryOpen } from '../valley/valleySim';

/** Whether a feature is available to this village now (some need the Valley snapshot). */
export function introMet(state: GameState, id: IntroId, valley: ValleySnapshot | null): boolean {
  const done = (r: string) => state.research.completed.includes(r as never);
  switch (id) {
    case 'clay':
      return done('clayDigging');
    case 'stone':
      return done('stonecutting');
    case 'upgrades':
      return state.buildings.some((b) => b.status === 'complete' && !b.upgrade && upgradeBlocker(state, b) === null);
    case 'workshops':
      return done('carpentry');
    case 'goldfurrow':
      return (valley?.buildings.goldfurrowCommons?.level ?? 0) > 0;
    case 'farming':
      return done('fieldSowing');
    case 'productionAreas':
      return done('woodlots');
    case 'valley':
      return isValleyUnlocked(state);
    case 'merchants':
      return tradeOpen(state);
    case 'tonics':
      return BOOST_ORDER.some((b) => (state.trade.inventory[b] ?? 0) > 0);
    case 'road':
      return canClaimRoad(state);
    case 'training':
      return state.villagers.some((v) => SKILL_ORDER.some((k) => trainingOffer(state, v, k).ok));
    case 'valleyResearch':
      return !!valley && libraryOpen(valley);
    case 'festivals':
      return valley?.festival?.outcome === 'running';
    case 'millrace':
      return state.valley.bonuses.workshopLevel > 0;
  }
}

/** The next introduction to show, once the opening tutorial is over. */
export function nextIntro(state: GameState, valley: ValleySnapshot | null): IntroDef | null {
  const t = state.tutorial;
  if (!(t.done || t.skipped) || t.intros === null) return null;
  return INTROS.find((i) => !t.intros!.includes(i.id) && introMet(state, i.id, valley)) ?? null;
}

export function markIntroSeen(state: GameState, id: IntroId): void {
  if (state.tutorial.intros && !state.tutorial.intros.includes(id)) state.tutorial.intros.push(id);
}

/** For villages from before introductions existed: whatever they already use counts as introduced. */
export function seedIntros(state: GameState): void {
  if (state.tutorial.intros !== null) return;
  state.tutorial.intros = INTROS.filter((i) => introMet(state, i.id, null)).map((i) => i.id);
}
