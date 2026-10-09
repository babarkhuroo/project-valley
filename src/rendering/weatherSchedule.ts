/**
 * When it rains, as a pure function of the wall clock: time is cut into 45-minute
 * blocks and roughly one block in five holds a shower of 6–14 minutes. Everyone
 * sees the same weather at the same moment, and a reload doesn't change it.
 * Cosmetic only — the simulation never reads it.
 */

const BLOCK_MS = 45 * 60_000;
const SHOWER_CHANCE = 0.2;
/** Seconds a shower takes to build up and to ease off. */
const RAMP_S = 70;

function hash(n: number): number {
  const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

export interface Shower {
  start: number;
  end: number;
  /** Peak strength 0..1. */
  peak: number;
}

/** The shower in the block containing `ms`, if that block has one. */
export function showerIn(ms: number): Shower | null {
  const block = Math.floor(ms / BLOCK_MS);
  if (hash(block) >= SHOWER_CHANCE) return null;
  const start = block * BLOCK_MS + hash(block + 0.31) * 25 * 60_000;
  const length = (6 + hash(block + 0.57) * 8) * 60_000;
  return { start, end: start + length, peak: 0.55 + hash(block + 0.83) * 0.45 };
}

/** How hard it is raining at wall-clock `ms` (0 = dry, 1 = a proper downpour). */
export function rainAt(ms: number): number {
  const s = showerIn(ms);
  if (!s || ms <= s.start || ms >= s.end) return 0;
  const edge = Math.min(ms - s.start, s.end - ms) / 1000 / RAMP_S;
  const k = Math.min(1, edge);
  return s.peak * k * k * (3 - 2 * k);
}

/** Seconds since the last shower ended (or Infinity if none in the last two blocks). */
export function sinceShower(ms: number): number {
  for (const t of [ms, ms - BLOCK_MS]) {
    const s = showerIn(t);
    if (s && s.end <= ms) return (ms - s.end) / 1000;
  }
  return Infinity;
}
