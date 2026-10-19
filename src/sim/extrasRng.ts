import { mulberry32 } from '../world/noise';

/**
 * The later village systems (requests board, wild finds, chests) each roll from their own
 * mulberry32 stream kept beside them, so nothing they do moves the village's own random
 * stream (state.rng) and the simulation's replays stay exactly as they were.
 */
export function nextOf(holder: { rng: number }): number {
  const [v, next] = mulberry32(holder.rng);
  holder.rng = next;
  return v;
}

/** A stream's starting state from the village seed (JS ToInt32, made odd). */
export function seedFrom(seed: number, mult: number, add: number): number {
  return ((seed * mult + add) | 0) | 1;
}
