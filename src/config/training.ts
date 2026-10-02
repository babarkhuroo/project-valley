/**
 * Guild training: the only way past what practice teaches. A villager walks out of
 * the village, spends time at the matching Valley guild (missing work meanwhile) and
 * comes home one skill level higher. Each guild level opens a higher skill level.
 */
export const TRAINING = {
  /** Highest skill level a guild can teach, by its Valley level (index 0 = not restored). */
  maxLevelByGuild: [0, 4, 5, 6],
  /** Cost and time to reach each skill level. */
  lessons: {
    3: { coins: 100, hours: 1 },
    4: { coins: 180, hours: 2 },
    5: { coins: 300, hours: 4 },
    6: { coins: 480, hours: 8 },
  } as Record<number, { coins: number; hours: number }>,
};
