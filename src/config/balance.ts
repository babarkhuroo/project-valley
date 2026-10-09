import type { ResourceId } from './resources';

/**
 * Global tuning knobs. Per-entity numbers (costs, batch sizes, research prices) live next
 * to their definitions; everything cross-cutting lives here. See BALANCING.md.
 */
export const BALANCE = {
  villager: {
    /** Tiles per second on open ground. */
    walkSpeed: 2.2,
    /** Multiplier while carrying a load back to storage. */
    carrySpeedMult: 0.85,
    /** Multiplier while walking on a dirt path. */
    pathSpeedMult: 1.3,
    /** Seconds of work one bowl of Stew fuels. */
    mealDuration: 20,
    /** Work-rate multiplier while hungry (no Stew available). */
    hungryWorkMult: 0.3,
    /** Maximum villagers who can build on one site at once. */
    buildersPerSite: 2,
  },
  work: {
    /** Work units per second for an untrained, fed villager. */
    baseRate: 1,
  },
  skills: {
    /** Work-rate multiplier indexed by skill level. */
    levelMultipliers: [1, 1.1, 1.2, 1.3, 1.42, 1.55, 1.7],
    /** Practice XP gained per finished batch in the job's skill. */
    practiceXpPerBatch: 1,
    /** Cumulative practice XP needed to reach each level (index = level). */
    practiceThresholds: [0, 30, 90, 200],
    /** Practice alone cannot raise a skill beyond this (Apprenticeship research adds 1); guild training (Valley) goes further. */
    practiceCap: 2,
  },
  progression: {
    /** Cumulative Village XP needed for each player level (index 0 = level 1). */
    levelXp: [0, 80, 250, 700, 1500, 2800, 4600],
    /** Resources gifted on reaching a new level. */
    levelUpGift: { stew: 25, timber: 40 } as Partial<Record<ResourceId, number>>,
  },
  population: {
    /** Candidates offered when a new home becomes available. */
    newcomerChoices: 3,
  },
  /** Distance (tiles) within which a gatherer automatically moves on to a fresh node. */
  autoContinueRadius: 14,
  offline: {
    /** Offline progress is capped to keep catch-up bounded. */
    maxSeconds: 7 * 24 * 3600,
  },
  start: {
    resources: { timber: 20, clay: 0, stone: 0, planks: 0, bricks: 0, grain: 0, stew: 30, knowledge: 0 } as Record<ResourceId, number>,
    level: 1,
  },
  /** XP granted for finishing tutorial beats. */
  tutorialXp: 5,
} as const;

export function levelForXp(xp: number): number {
  const table = BALANCE.progression.levelXp;
  let level = 1;
  for (let i = 1; i < table.length; i++) {
    if (xp >= table[i]) level = i + 1;
  }
  return level;
}

/** XP bounds of the given level: [start, next) — `next` is null at the level cap. */
export function levelBounds(level: number): { start: number; next: number | null } {
  const table = BALANCE.progression.levelXp;
  const start = table[Math.min(level - 1, table.length - 1)];
  const next = level < table.length ? table[level] : null;
  return { start, next };
}
