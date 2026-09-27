import { BALANCE, levelForXp } from '../config/balance';
import { RESOURCE_ORDER } from '../config/resources';
import type { SkillId } from '../config/skills';
import { addResource } from './economy';
import type { EventSink } from './events';
import type { GameState, Villager } from './types';

/** Grants Village XP and handles level-ups (with their small resource gift). */
export function addXp(state: GameState, amount: number, reason: string, sink: EventSink): void {
  if (amount <= 0) return;
  state.player.xp += amount;
  sink.push({ type: 'xp', amount, reason });
  const level = levelForXp(state.player.xp);
  while (state.player.level < level) {
    state.player.level++;
    const gift = BALANCE.progression.levelUpGift;
    // Gifts fill storage but never overflow it.
    for (const r of RESOURCE_ORDER) addResource(state, r, gift[r] ?? 0);
    sink.push({ type: 'levelUp', level: state.player.level });
  }
}

export function skillMultiplier(level: number): number {
  const table = BALANCE.skills.levelMultipliers;
  return table[Math.min(level, table.length - 1)];
}

/** Practice XP from doing a job. Practice tops out at `practiceCap`; guilds go further. */
export function practiceSkill(villager: Villager, skill: SkillId, sink: EventSink): void {
  const s = villager.skills[skill];
  const { practiceXpPerBatch, practiceThresholds, practiceCap } = BALANCE.skills;
  if (s.level >= practiceCap) return;
  s.xp += practiceXpPerBatch;
  while (s.level < practiceCap && s.xp >= practiceThresholds[s.level + 1]) {
    s.level++;
    sink.push({ type: 'skillUp', villagerId: villager.id, skill, level: s.level });
  }
}

/** Progress (0..1) towards the next practice level, or null when practice is capped. */
export function practiceProgress(villager: Villager, skill: SkillId): number | null {
  const s = villager.skills[skill];
  const { practiceThresholds, practiceCap } = BALANCE.skills;
  if (s.level >= practiceCap) return null;
  const from = practiceThresholds[s.level];
  const to = practiceThresholds[s.level + 1];
  return Math.max(0, Math.min(1, (s.xp - from) / (to - from)));
}
