/**
 * Grain Fields and hearty Stew. See BALANCING.md (generated) for what these numbers
 * mean in grain per minute.
 */
export const FARMING = {
  /** Seconds an untended crop takes to ripen after sowing. */
  growSeconds: 600,
  /** Seconds of growing each finished tending batch saves. */
  tendSeconds: 45,
  /** Grain standing in a ripe field. */
  yield: 24,
  /** Harvest multiplier for fields on fertile meadow soil. */
  fertileMult: 1.25,
  /** Grain a cook puts in one pot, and the extra bowls of Stew it makes. */
  cookGrain: 1,
  cookBonus: 2,
} as const;
