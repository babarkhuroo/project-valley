import { useEffect, useRef } from 'react';
import { TUTORIAL_STEPS } from '../../config/tutorial';
import { runtime, game } from '../../game/runtime';
import { currentStep, updateTutorial } from '../../game/tutorial';
import { buildingCenter } from '../../sim/grid';
import type { PickTarget } from '../../rendering/InputController';
import type { GameState } from '../../sim/types';
import { tutorialNext, tutorialSkip } from '../actions';
import { Icon } from '../common/Icon';
import { useGameState } from '../hooks';

/** Which world object the tutorial arrow should point at for the current step. */
function tutorialTarget(state: GameState): PickTarget | null {
  const step = currentStep(state);
  const byDef = (defId: string) => state.buildings.find((b) => b.defId === defId);
  switch (step) {
    case 'assignTimber': {
      const yard = byDef('timberYard');
      if (!yard) return null;
      const c = buildingCenter(yard);
      let best: PickTarget | null = null;
      let bestD = Infinity;
      for (const n of state.nodes) {
        if (n.kind !== 'tree' || n.amount <= 0) continue;
        const d = Math.hypot(n.x - c.x, n.z - c.z);
        if (d < bestD) {
          bestD = d;
          best = { kind: 'node', id: n.id };
        }
      }
      return best;
    }
    case 'assignCook': {
      const k = byDef('cookhouse');
      return k ? { kind: 'building', id: k.id } : null;
    }
    case 'gatherTimber': {
      const y = byDef('timberYard');
      return y ? { kind: 'building', id: y.id } : null;
    }
    case 'buildAcademy': {
      const a = byDef('academy');
      return a ? { kind: 'building', id: a.id } : null;
    }
    case 'research': {
      const a = byDef('academy');
      return a && !state.villagers.some((v) => v.job?.kind === 'operate' && v.job.buildingId === a.id) ? { kind: 'building', id: a.id } : null;
    }
    case 'buildCottage': {
      const c = byDef('cottage');
      return c ? { kind: 'building', id: c.id } : null;
    }
    default:
      return null;
  }
}

export function TutorialCoach() {
  const state = useGameState();
  const step = currentStep(state);
  const framed = useRef<string | null>(null);
  useEffect(() => {
    const g = game();
    if (currentStep(g.state) === null) {
      if (runtime.renderer) runtime.renderer.view.tutorialTarget = null;
      return;
    }
    let changed = false;
    g.mutate((s, _w, sink) => {
      changed = updateTutorial(s, sink);
    });
    if (changed) runtime.audio.play('skillUp');
    const target = tutorialTarget(g.state);
    if (runtime.renderer) runtime.renderer.view.tutorialTarget = target;
    // Bring each new objective into view once, without fighting the player's camera afterwards.
    const key = target ? `${currentStep(g.state)}:${target.kind}:${target.id}` : null;
    if (target && key !== framed.current && runtime.renderer) {
      framed.current = key;
      runtime.renderer.focusOn(target, 20);
    }
  });
  if (!step) return null;
  const index = TUTORIAL_STEPS.findIndex((s) => s.id === step);
  const def = TUTORIAL_STEPS[index];
  const progress = step === 'gatherTimber' ? Math.min(1, state.resources.timber / 60) : null;
  return (
    <div className={`coach panel ${step === 'welcome' ? 'welcome' : ''}`} role="status">
      <div className="coach-head">
        <span className="coach-step">
          {index + 1}/{TUTORIAL_STEPS.length}
        </span>
        <strong>{def.title}</strong>
      </div>
      <p>{def.body}</p>
      {progress !== null ? (
        <div className="bar tone-honey thin">
          <i style={{ width: `${progress * 100}%` }} />
        </div>
      ) : null}
      <div className="coach-actions">
        {step === 'welcome' || step === 'done' ? (
          <button className="btn green" onClick={tutorialNext}>
            {step === 'welcome' ? 'Let’s begin' : 'Got it'}
          </button>
        ) : (
          <span className="coach-hint">
            <Icon name="target" size={16} /> {def.hint}
          </span>
        )}
        {step !== 'done' ? (
          <button className="link" onClick={tutorialSkip}>
            Skip tutorial
          </button>
        ) : null}
      </div>
    </div>
  );
}
