import { nextSteps, type Suggestion } from '../../sim/selectors';
import { currentStep } from '../../game/tutorial';
import { selectAndFocus } from '../actions';
import { Icon } from '../common/Icon';
import { useGameState } from '../hooks';
import { ui, useUI } from '../store';

function run(s: Suggestion): void {
  const a = s.action;
  if (!a) return;
  switch (a.type) {
    case 'selectVillager':
      selectAndFocus({ kind: 'villager', id: a.id }, 14);
      break;
    case 'selectBuilding':
      selectAndFocus({ kind: 'building', id: a.id });
      break;
    case 'openResearch':
      ui.set({ panel: 'research' });
      break;
    case 'openBuild':
      ui.set({ panel: 'build', buildHighlight: a.building ?? null });
      break;
  }
}

/** Always answers "what should I do next?" once the tutorial is out of the way. */
export function NextSteps() {
  const state = useGameState();
  const mode = useUI((s) => s.mode.kind);
  if (currentStep(state) !== null || mode !== 'normal') return null;
  const tips = nextSteps(state);
  if (tips.length === 0) return null;
  return (
    <div className="next-steps panel">
      <h4>
        <Icon name="compass" size={18} /> Next steps
      </h4>
      <ul>
        {tips.map((t) => (
          <li key={t.id}>
            <button className={`tip tip-${t.kind}`} onClick={() => run(t)} disabled={!t.action}>
              <span className="dot" />
              {t.text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
