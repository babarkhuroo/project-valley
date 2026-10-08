import { lazy, Suspense } from 'react';
import { IDENTITY } from '../config/identity';
import { BuildMenu } from './build/BuildMenu';
import { AwayDialog, LevelUpBanner, NewcomerDialog } from './dialogs/Dialogs';
import { SettingsPanel } from './dialogs/SettingsPanel';
import { GameView } from './GameView';
import { ActionBar } from './hud/ActionBar';
import { NextSteps } from './hud/NextSteps';
import { NotificationsPanel, Toasts } from './hud/Toasts';
import { TopBar } from './hud/TopBar';
import { WorkerList } from './hud/WorkerList';
import { SelectionPanel } from './panels/SelectionPanel';
import { ResearchScreen } from './research/ResearchScreen';
import { useUI } from './store';
import { TutorialCoach } from './tutorial/TutorialCoach';
import { TravelVeil, ValleyActionBar, ValleyProjectPanel, ValleySidebar } from './valley/ValleyHud';
import { ValleyView } from './valley/ValleyView';
import { RoadPanel, SatchelPanel } from './valley/TradeUi';
import { ValleyChooser } from './valley/ValleyChooser';
import { ChatPanel } from './valley/ChatUi';

// Compiled out of production builds entirely.
const DevPanel = import.meta.env.DEV ? lazy(() => import('./dev/DevPanel').then((m) => ({ default: m.DevPanel }))) : null;

function LoadingScreen({ error }: { error: string | null }) {
  return (
    <div className="loading">
      <div className="loading-card">
        <h1>{IDENTITY.gameTitle}</h1>
        <p>{error ? `Something went wrong: ${error}` : 'Waking the villagers…'}</p>
        {!error ? <div className="loading-dots"><i /><i /><i /></div> : <button className="btn" onClick={() => window.location.reload()}>Try again</button>}
      </div>
    </div>
  );
}

export function App() {
  const booted = useUI((s) => s.booted);
  const error = useUI((s) => s.bootError);
  const scene = useUI((s) => s.scene);
  if (!booted) return <LoadingScreen error={error} />;
  const village = scene === 'village';
  return (
    <div className={`app scene-${scene}`}>
      {village ? <GameView /> : <ValleyView />}
      <div className="hud">
        <TopBar />
        {village ? (
          <>
            <WorkerList />
            <div className="left-stack">
              <NextSteps />
              <TutorialCoach />
            </div>
            <SelectionPanel />
            <ActionBar />
          </>
        ) : (
          <>
            <ValleySidebar />
            <ValleyProjectPanel />
            <ValleyActionBar />
          </>
        )}
        <Toasts />
        <NotificationsPanel />
        <SatchelPanel />
        <RoadPanel />
        <ChatPanel />
        <SettingsPanel />
        {DevPanel ? (
          <Suspense fallback={null}>
            <DevPanel />
          </Suspense>
        ) : null}
      </div>
      {village ? <BuildMenu /> : null}
      <ResearchScreen />
      <NewcomerDialog />
      <AwayDialog />
      <LevelUpBanner />
      <TravelVeil />
      <ValleyChooser />
    </div>
  );
}
