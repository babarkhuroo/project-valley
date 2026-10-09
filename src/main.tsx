import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { IDENTITY } from './config/identity';
import { startAutosave } from './game/autosave';
import { bootGame } from './game/boot';
import { summaryIsInteresting } from './game/offline';
import { runtime } from './game/runtime';
import { ValleyClient } from './game/valleyClient';
import { App } from './ui/App';
import { attachNotifications, attachValleyNotifications } from './ui/notifications';
import { attachProgressReporter } from './game/playtest';
import { applyPrefs, ui } from './ui/store';

applyPrefs(ui.get().prefs);
import './styles/global.css';

document.title = IDENTITY.gameTitle;

// Browsers only allow audio after a user gesture.
window.addEventListener('pointerdown', () => runtime.audio.unlock());
window.addEventListener('keydown', () => runtime.audio.unlock());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

bootGame()
  .then(({ game, away, source }) => {
    runtime.game = game;
    attachNotifications(game);
    attachProgressReporter(game, () => ui.get().prefs.shareProgress === 'yes');
    runtime.valley = new ValleyClient(game);
    attachValleyNotifications(runtime.valley);
    runtime.valley.start();
    startAutosave(game, (saveStatus) => ui.set({ saveStatus }));
    ui.set({ booted: true, saveSource: source, away: away && summaryIsInteresting(away) ? away : null });
    if (import.meta.env.DEV) (window as unknown as { valley: typeof runtime }).valley = runtime;
  })
  .catch((err: unknown) => {
    console.error(err);
    ui.set({ bootError: err instanceof Error ? err.message : String(err) });
  });
