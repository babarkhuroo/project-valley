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
import { useEdgeVar } from './layout';
import { useUI } from './store';
import { TutorialCoach } from './tutorial/TutorialCoach';
import { IntroCard } from './tutorial/IntroCard';
import { TravelVeil, ValleyActionBar, ValleyProjectPanel, ValleySidebar } from './valley/ValleyHud';
import { ValleyView } from './valley/ValleyView';
import { RoadPanel, SatchelPanel } from './valley/TradeUi';
import { ValleyChooser } from './valley/ValleyChooser';
import { ChatPanel } from './valley/ChatUi';
import { FeedbackPanel, ProgressConsent } from './playtest/Feedback';

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
  // Something fills the bottom of a phone screen (a selection sheet or a panel).
  const sheet = useUI((s) => (s.scene === 'village' ? s.selection !== null : s.valleySelection !== null) || (s.panel !== null && s.panel !== 'workers'));
  const workers = useUI((s) => s.panel === 'workers');
  // The villager list makes room for the cards below it.
  const stack = useEdgeVar<HTMLDivElement>('--left-stack-top', 'top');
  if (!booted) return <LoadingScreen error={error} />;
  const village = scene === 'village';
  return (
    <div className={`app scene-${scene} ${sheet ? 'has-sheet' : ''} ${workers ? 'workers-open' : ''}`}>
      {village ? <GameView /> : <ValleyView />}
      {/* Everything but the world lives in one layer that the interface-size setting scales. */}
      <div className="ui-layer">
      <div className="hud">
        <TopBar />
        {village ? (
          <>
            <WorkerList />
            {/* Most urgent first: phones show only the first card (see .left-stack in global.css). */}
            <div className="left-stack" ref={stack}>
              <TutorialCoach />
              <ProgressConsent />
              <IntroCard />
              <NextSteps />
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
        <FeedbackPanel />
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
    </div>
  );
}
