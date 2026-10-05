import { JOBS } from '../../config/jobs';
import { housingCapacity } from '../../sim/population';
import { villagerTask } from '../../sim/selectors';
import { jobTypeOf } from '../../sim/villagerAI';
import type { IconName } from '../icons';
import { Icon } from '../common/Icon';
import { Portrait } from '../common/Portrait';
import { selectAndFocus } from '../actions';
import { useGameState } from '../hooks';
import { sameTarget, ui, useUI } from '../store';

export function WorkerList() {
  const state = useGameState();
  const selection = useUI((s) => s.selection);
  const open = useUI((s) => s.panel === 'workers');
  const idle = state.villagers.filter((v) => !v.job && !v.away).length;
  const beds = housingCapacity(state);
  return (
    <aside className={`worker-list panel ${open ? 'open' : ''}`}>
      <button className="wl-header" onClick={() => ui.openPanel('workers')}>
        <Icon name="villager" size={22} />
        <strong>Villagers</strong>
        <span className="wl-count">
          {state.villagers.length}/{beds}
        </span>
        {idle > 0 ? <span className="idle-chip">{idle} idle</span> : null}
      </button>
      <ul>
        {state.villagers.map((v) => {
          const task = villagerTask(state, v);
          const jt = v.job ? jobTypeOf(state, v.job) : null;
          const icon: IconName = task.icon;
          const selected = sameTarget(selection, { kind: 'villager', id: v.id });
          return (
            <li key={v.id}>
              <button className={`wl-row ${task.idle ? 'is-idle' : ''} ${task.warning ? 'is-warn' : ''} ${selected ? 'is-selected' : ''}`} onClick={() => selectAndFocus({ kind: 'villager', id: v.id }, 14)}>
                <Portrait appearance={v.appearance} size={40} ring={task.idle ? 'idle' : task.warning ? 'warn' : null} />
                <span className="wl-info">
                  <strong>{v.name}</strong>
                  <span className="wl-task">
                    <Icon name={icon} size={16} />
                    <span>{task.label}</span>
                  </span>
                  {task.progress !== null ? (
                    <span className="wl-progress">
                      <i style={{ width: `${task.progress * 100}%`, background: jt ? `var(--job-${JOBS[jt].anim})` : undefined }} />
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
