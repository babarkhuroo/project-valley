import { AudioEngine } from '../audio/AudioEngine';
import type { GameRenderer } from '../rendering/GameRenderer';
import type { Game } from './Game';

/**
 * Process-wide handles to the long-lived, non-React objects. UI code reads the game
 * through these; React state only holds UI concerns (selection, open panels, toasts).
 */
export const runtime: { game: Game | null; renderer: GameRenderer | null; audio: AudioEngine } = {
  game: null,
  renderer: null,
  audio: new AudioEngine(),
};

export function game(): Game {
  if (!runtime.game) throw new Error('Game not booted');
  return runtime.game;
}
