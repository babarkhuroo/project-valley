import type { SimEvent } from '../sim/events';
import type { CommandResult } from '../sim/commands';
import { advance } from '../sim/simulation';
import type { GameState } from '../sim/types';
import { syncWorld, type World } from '../sim/world';
import { now } from './clock';

export type GameListener = (events: SimEvent[], info: { catchUp: boolean }) => void;

/** Frames longer than this (e.g. a backgrounded tab) are treated as a catch-up. */
const CATCH_UP_THRESHOLD = 20;

/**
 * Owns the authoritative GameState and the only path by which it changes:
 * `tick` (time passing) and `run` (player commands). Rendering, audio and UI subscribe
 * to the resulting events and read state; they never write to it.
 */
export class Game {
  speed = 1;
  paused = false;
  /** Increments whenever state changes; cheap change detection for the UI. */
  version = 0;
  private listeners = new Set<GameListener>();

  constructor(
    public state: GameState,
    public readonly world: World,
  ) {
    syncWorld(world, state);
  }

  subscribe(listener: GameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(events: SimEvent[], catchUp: boolean): void {
    this.version++;
    if (events.length === 0) return;
    for (const l of this.listeners) l(events, { catchUp });
  }

  /** Advances real time. Returns true when this frame was a catch-up (large gap). */
  tick(realDt: number): boolean {
    this.state.lastProcessedAt = now();
    if (this.paused || realDt <= 0) return false;
    const catchUp = realDt > CATCH_UP_THRESHOLD;
    const events: SimEvent[] = [];
    advance(this.state, this.world, realDt * this.speed, events);
    this.emit(events, catchUp);
    return catchUp;
  }

  /** Fast-forwards simulated time directly (offline catch-up, dev skips). */
  skip(seconds: number): SimEvent[] {
    const events: SimEvent[] = [];
    advance(this.state, this.world, seconds, events);
    this.emit(events, true);
    return events;
  }

  /** Runs a player command against the state and broadcasts what happened. */
  run<T>(command: (state: GameState, world: World, sink: SimEvent[]) => CommandResult<T>): CommandResult<T> {
    const events: SimEvent[] = [];
    const result = command(this.state, this.world, events);
    this.emit(events, false);
    return result;
  }

  /** Runs a mutation that cannot fail (dev tools, tutorial bookkeeping). */
  mutate(fn: (state: GameState, world: World, sink: SimEvent[]) => void): void {
    const events: SimEvent[] = [];
    fn(this.state, this.world, events);
    this.emit(events, false);
  }

  replaceState(state: GameState): void {
    this.state = state;
    syncWorld(this.world, state);
    this.version++;
  }
}
