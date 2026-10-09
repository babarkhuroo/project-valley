/**
 * Communal sowing at the Goldfurrow Commons (see GAME_DESIGN.md, "Goldfurrow Fields").
 * A round opens for sowing, closes, grows, then ripens: everyone who sowed takes home
 * their seed times the harvest multiplier, which grows with every village that joined in.
 */
export const SOWING = {
  /** Hours a round is open for sowing, then hours the crop grows. */
  windowHours: 8,
  growHours: 12,
  /** Hours between a harvest and the next round opening (and after the Commons first opens). */
  gapHours: 1,
  /** Harvest multiplier: base, plus this much for each village that sowed, up to the cap. */
  baseMult: 1.5,
  perVillage: 0.1,
  maxMult: 2.6,
  /** Most grain one village can sow in a round. */
  maxSeed: 300,
  /** Recent harvests kept for villages to collect their share. */
  harvestsKept: 3,
  /** Simulated neighbours sow on some of their visits while a round is open. */
  neighbourChance: 0.5,
  neighbourSeed: { min: 40, max: 120 },
} as const;
