import { nextSteps, type Suggestion } from '../../sim/selectors';
import { currentStep } from '../../game/tutorial';
import { openHarbour, openValleyBuilding, selectAndFocus, travelToValley } from '../actions';
import { FESTIVALS } from '../../config/festivals';
import { Icon } from '../common/Icon';
import { useGameState, useValley } from '../hooks';
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
    case 'openValley':
      travelToValley();
      break;
    case 'openHarbour':
      openHarbour();
      break;
    case 'openRoad':
      ui.set({ panel: 'road' });
      break;
    case 'openFestival':
      openValleyBuilding('festivalGrounds');
      break;
  }
}

/** Always answers "what should I do next?" once the tutorial is out of the way. */
export function NextSteps() {
  const state = useGameState();
  const mode = useUI((s) => s.mode.kind);
  const { snapshot } = useValley();
  if (currentStep(state) !== null || mode !== 'normal') return null;
  const tips = nextSteps(state);
  // Festivals live in the Valley snapshot, which the village simulation never sees.
  const f = snapshot?.festival;
  if (f && f.outcome === 'running') {
    tips.unshift({ id: 'festival', kind: 'idea', text: `The ${FESTIVALS[f.kind].name} is on in the Valley — bring what you can spare`, action: { type: 'openFestival' } });
    tips.splice(4);
  }
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
