import { saveGame, saveOnExit, type SaveOutcome } from './persistence';
import type { Game } from './Game';

const AUTOSAVE_MS = 15_000;

export interface SaveStatus {
  lastSavedAt: number | null;
  outcome: SaveOutcome | null;
}

/** Periodic saves plus a best-effort save whenever the page is hidden or closed. */
export function startAutosave(game: Game, onStatus: (s: SaveStatus) => void): () => void {
  let stopped = false;
  const run = async () => {
    if (stopped) return;
    const outcome = await saveGame(game.state);
    onStatus({ lastSavedAt: Date.now(), outcome });
  };
  const timer = window.setInterval(() => void run(), AUTOSAVE_MS);
  const onHide = () => {
    if (document.visibilityState === 'hidden') saveOnExit(game.state);
  };
  const onPageHide = () => saveOnExit(game.state);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onPageHide);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onPageHide);
  };
}

export async function saveNow(game: Game): Promise<SaveOutcome> {
  return saveGame(game.state);
}
