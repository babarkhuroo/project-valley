import type { IntroAction } from '../../config/intros';
import { game } from '../../game/runtime';
import { markIntroSeen, nextIntro } from '../../game/intros';
import { upgradeBlocker } from '../../sim/levels';
import { SKILL_ORDER } from '../../config/skills';
import { trainingOffer } from '../../sim/training';
import { openHarbour, openValleyBuilding, selectAndFocus, travelToValley } from '../actions';
import { Icon } from '../common/Icon';
import { useGameState, useValley } from '../hooks';
import type { IconName } from '../icons';
import { ui, useUI } from '../store';

function run(action: IntroAction): void {
  const state = game().state;
  switch (action.type) {
    case 'openBuild':
      ui.set({ panel: 'build', buildHighlight: action.building });
      break;
    case 'openValley':
      travelToValley();
      break;
    case 'openHarbour':
      openHarbour();
      break;
    case 'openSatchel':
      ui.set({ panel: 'satchel' });
      break;
    case 'openRoad':
      ui.set({ panel: 'road' });
      break;
    case 'selectUpgradable': {
      const b = state.buildings.find((x) => x.status === 'complete' && !x.upgrade && upgradeBlocker(state, x) === null);
      if (b) selectAndFocus({ kind: 'building', id: b.id });
      break;
    }
    case 'selectTrainable': {
      const v = state.villagers.find((x) => SKILL_ORDER.some((k) => trainingOffer(state, x, k).ok));
      if (v) selectAndFocus({ kind: 'villager', id: v.id }, 14);
      break;
    }
    case 'openValleyBuilding':
      openValleyBuilding(action.building);
      break;
  }
}

/** One new feature at a time, explained when it first becomes available. */
export function IntroCard() {
  const state = useGameState();
  const { snapshot } = useValley();
  const mode = useUI((s) => s.mode.kind);
  const intro = nextIntro(state, snapshot);
  if (!intro || mode !== 'normal') return null;
  const seen = () => game().mutate((s) => markIntroSeen(s, intro.id));
  return (
    <div className="intro-card panel pop-in" role="status">
      <div className="intro-head">
        <Icon name={intro.icon as IconName} size={34} />
        <strong>{intro.title}</strong>
      </div>
      <p>{intro.body}</p>
      <div className="row-buttons">
        <button
          className="btn small green"
          onClick={() => {
            seen();
            run(intro.action);
          }}
        >
          {intro.actionLabel}
        </button>
        <button className="btn small ghost" onClick={seen}>
          Got it
        </button>
      </div>
    </div>
  );
}
