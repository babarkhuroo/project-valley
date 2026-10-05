import { BALANCE } from '../config/balance';
import type { SkillId } from '../config/skills';
import { TRAINING } from '../config/training';
import { VALLEY_BUILDING_ORDER, VALLEY_BUILDINGS, type ValleyBuildingId } from '../config/valley';
import type { CommandResult } from './commands';
import { leaveForValley } from './away';
import type { EventSink } from './events';
import { practiceCap } from './modifiers';
import type { GameState, Lesson, Villager } from './types';
import { findVillager } from './villagerAI';
import type { World } from './world';

/**
 * Guild training. A villager leaves their job, walks out along the Valley road, spends
 * the lesson "away" (a timer in the village simulation, so it finishes during offline
 * catch-up too), then comes home one skill level higher and picks their old job back
 * up if nobody has taken the slot.
 */

export const MAX_SKILL_LEVEL = TRAINING.maxLevelByGuild[TRAINING.maxLevelByGuild.length - 1];

export function guildFor(skill: SkillId): ValleyBuildingId {
  return VALLEY_BUILDING_ORDER.find((id) => VALLEY_BUILDINGS[id].trains === skill)!;
}

export type TrainingOffer =
  | { ok: true; guild: ValleyBuildingId; toLevel: number; coins: number; hours: number }
  | { ok: false; guild: ValleyBuildingId; reason: string };

/** What training this villager could take in a skill right now (ignoring coins). */
export function trainingOffer(state: GameState, v: Villager, skill: SkillId): TrainingOffer {
  const guild = guildFor(skill);
  const name = VALLEY_BUILDINGS[guild].name;
  if (v.away) return { ok: false, guild, reason: 'Already training' };
  const guildLevel = state.valley.bonuses.guildLevels[skill] ?? 0;
  if (guildLevel <= 0) return { ok: false, guild, reason: `Restore the ${name} in the Valley to train` };
  const level = v.skills[skill].level;
  if (level >= MAX_SKILL_LEVEL) return { ok: false, guild, reason: 'Mastered' };
  const cap = practiceCap(state);
  if (level < cap) return { ok: false, guild, reason: `Practice reaches level ${cap} — no lessons needed yet` };
  const toLevel = level + 1;
  const max = TRAINING.maxLevelByGuild[Math.min(guildLevel, TRAINING.maxLevelByGuild.length - 1)];
  if (toLevel > max) return { ok: false, guild, reason: `The ${name} must reach level ${guildLevel + 1} to teach level ${toLevel}` };
  const lesson = TRAINING.lessons[toLevel];
  const b = state.valley.bonuses;
  return { ok: true, guild, toLevel, coins: Math.round(lesson.coins * b.trainingCostMult), hours: lesson.hours * b.trainingTimeMult };
}

export function startTraining(state: GameState, world: World, villagerId: number, skill: SkillId, sink: EventSink): CommandResult {
  const v = findVillager(state, villagerId);
  if (!v) return { ok: false, error: 'Unknown villager' };
  const offer = trainingOffer(state, v, skill);
  if (!offer.ok) return { ok: false, error: offer.reason };
  if (state.trade.coins < offer.coins) return { ok: false, error: `Needs ${offer.coins} coins` };
  state.trade.coins -= offer.coins;
  leaveForValley(state, world, v, { kind: 'lesson', skill, toLevel: offer.toLevel });
  sink.push({ type: 'trainingStarted', villagerId: v.id, skill, level: offer.toLevel });
  return { ok: true };
}

/** Lesson over: one skill level up. */
export function completeLesson(v: Villager, lesson: Lesson, sink: EventSink): void {
  const s = v.skills[lesson.skill];
  s.level = Math.max(s.level, lesson.toLevel);
  const thresholds = BALANCE.skills.practiceThresholds;
  s.xp = Math.max(s.xp, thresholds[Math.min(s.level, thresholds.length - 1)]);
  sink.push({ type: 'trainingDone', villagerId: v.id, skill: lesson.skill, level: s.level });
  sink.push({ type: 'skillUp', villagerId: v.id, skill: lesson.skill, level: s.level });
}

