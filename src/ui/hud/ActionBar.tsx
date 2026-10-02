import { BUILDINGS } from '../../config/buildings';
import { findVillager } from '../../sim/villagerAI';
import { game } from '../../game/runtime';
import { cancelMode, confirmPlacement, rotatePlacement, travelToValley } from '../actions';
import { IDENTITY } from '../../config/identity';
import { isValleyUnlocked } from '../../sim/modifiers';
import { Icon } from '../common/Icon';
import { useGameState } from '../hooks';
import { ui, useUI } from '../store';
import { currentStep } from '../../game/tutorial';

export function ActionBar() {
  const state = useGameState();
  const mode = useUI((s) => s.mode);
  const panel = useUI((s) => s.panel);
  const step = currentStep(state);
  if (mode.kind !== 'normal') return <ModeBar />;
  const pulseBuild = step === 'buildAcademy' && !state.buildings.some((b) => b.defId === 'academy') ? true : step === 'buildCottage' && !state.buildings.some((b) => b.defId === 'cottage');
  const pulseResearch = step === 'research' && state.buildings.some((b) => b.defId === 'academy' && b.status === 'complete') && !state.research.active;
  return (
    <nav className="action-bar">
      <button className={`big-btn build ${panel === 'build' ? 'active' : ''} ${pulseBuild ? 'pulse' : ''}`} onClick={() => ui.openPanel('build')}>
        <Icon name="hammerHouse" size={34} />
        <span>Build</span>
      </button>
      <button className={`big-btn research ${panel === 'research' ? 'active' : ''} ${pulseResearch ? 'pulse' : ''}`} onClick={() => ui.openPanel('research')}>
        <Icon name="research" size={34} />
        <span>Research</span>
      </button>
      <ValleyButton />
    </nav>
  );
}

function ValleyButton() {
  const state = useGameState();
  const open = isValleyUnlocked(state);
  return (
    <button
      className={`big-btn valley ${open ? '' : 'locked'} ${open && !state.valley.valleyId ? 'pulse' : ''}`}
      onClick={travelToValley}
      title={open ? `Travel to ${IDENTITY.valleyName}` : 'Research The Valley Road to open the way'}
    >
      <Icon name={open ? 'valley' : 'lock'} size={34} />
      <span>Valley</span>
    </button>
  );
}

function ModeBar() {
  const mode = useUI((s) => s.mode);
  const placement = useUI((s) => s.placement);
  useUI((s) => s.tick);
  if (mode.kind === 'assign') {
    const v = findVillager(game().state, mode.villagerId);
    return (
      <div className="mode-bar panel pop-in">
        <Icon name="target" size={26} />
        <span className="mode-text">
          <strong>Choose a job for {v?.name ?? 'your villager'}</strong>
          <small>Tap a tree, the Cookhouse, the Academy or a construction site.</small>
        </span>
        <button className="btn ghost" onClick={cancelMode}>
          Cancel
        </button>
      </div>
    );
  }
  if (mode.kind !== 'place' && mode.kind !== 'move') return null;
  const def = BUILDINGS[mode.defId];
  const valid = placement?.valid ?? false;
  return (
    <div className="mode-bar panel pop-in">
      <Icon name={mode.kind === 'move' ? 'move' : 'hammerHouse'} size={26} />
      <span className="mode-text">
        <strong>
          {mode.kind === 'move' ? 'Move' : 'Place'} {def.name}
        </strong>
        <small className={placement && !valid ? 'warn' : ''}>{placement ? (valid ? 'Looks good! Click to confirm.' : placement.reason) : 'Point at the ground to choose a spot.'}</small>
      </span>
      {def.footprint.w !== def.footprint.d || def.category !== 'decor' ? (
        <button className="btn ghost square" onClick={rotatePlacement} title="Rotate (R)">
          <Icon name="rotate" size={22} />
        </button>
      ) : null}
      <button className="btn ghost" onClick={cancelMode}>
        Cancel
      </button>
      <button className="btn green" disabled={!valid} onClick={confirmPlacement}>
        <Icon name="check" size={20} />
        {mode.kind === 'move' ? 'Move here' : 'Build'}
      </button>
    </div>
  );
}
