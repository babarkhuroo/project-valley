import { VALLEY_RESEARCH, VALLEY_RESEARCH_ORDER, type ValleyResearchId } from '../../config/valleyResearch';
import { playerId } from '../../game/persistence';
import type { ValleySnapshot } from '../../valley/types';
import { availableResearch, leadingResearch, libraryOpen, voteCounts } from '../../valley/valleySim';
import { selectValleyBuilding, voteValleyResearch } from '../actions';
import { Bar, Section } from '../common/Bits';
import { Icon } from '../common/Icon';
import { formatNumber } from '../hooks';
import { memberName } from './format';

function voters(snapshot: ValleySnapshot, ids: string[] | undefined, me: string): string {
  if (!ids || ids.length === 0) return 'No votes yet';
  const names = ids.map((id) => memberName(snapshot, id, me));
  return `${names.join(', ')} ${ids.length === 1 && ids[0] !== me ? 'wants' : 'want'} this`;
}

/** Valley research at the Great Library: raise Knowledge together, vote on what comes next. */
export function ValleyResearchSection({ snapshot }: { snapshot: ValleySnapshot }) {
  const me = playerId();
  const r = snapshot.research;
  const open = libraryOpen(snapshot);
  const avail = availableResearch(snapshot);
  const votes = voteCounts(snapshot);
  const leading = leadingResearch(snapshot);
  const myVote = r.votes[me];
  return (
    <Section title="Valley research" aside={<small className="muted">{formatNumber(r.raised)} Knowledge raised</small>}>
      <p className="small muted">
        {open
          ? 'Every contribution adds Valley Knowledge, and merchant crates add more. It flows into the project with the most votes.'
          : `Valley Knowledge is gathering (${formatNumber(r.banked)} so far) — restore the Library to start researching.`}
      </p>
      <ul className="vr-list">
        {VALLEY_RESEARCH_ORDER.map((id) => {
          const def = VALLEY_RESEARCH[id];
          const done = r.completed.includes(id);
          const can = avail.includes(id);
          const progress = r.progress[id] ?? 0;
          return (
            <li key={id} className={`${done ? 'done' : ''} ${id === leading && open ? 'leading' : ''} ${!done && !can ? 'locked' : ''}`}>
              <div className="vr-head">
                <strong>{def.name}</strong>
                {done ? <Icon name="check" size={18} /> : <small className="muted">{def.cost} Knowledge</small>}
              </div>
              <small className="vr-desc">{def.description}</small>
              {!done && can ? (
                <>
                  <Bar value={progress / def.cost} tone="blue" thin />
                  <div className="vr-votes">
                    <small>{voters(snapshot, votes[id], me)}</small>
                    {myVote === id ? (
                      <span className="pill pill-blue">Your vote</span>
                    ) : (
                      <button className="btn small ghost" onClick={() => voteValleyResearch(id as ValleyResearchId)}>
                        Vote
                      </button>
                    )}
                  </div>
                </>
              ) : null}
              {!done && !can ? <small className="muted">After {def.requires.map((q) => VALLEY_RESEARCH[q].name).join(' and ')}</small> : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** One line in the Valley sidebar: what the Valley is researching. */
export function ValleyResearchSummary({ snapshot }: { snapshot: ValleySnapshot }) {
  const leading = leadingResearch(snapshot);
  const open = libraryOpen(snapshot);
  const def = leading ? VALLEY_RESEARCH[leading] : null;
  return (
    <button className="vs-research" onClick={() => selectValleyBuilding('greatLibrary', true)}>
      <Icon name="knowledge" size={22} />
      <span className="vs-research-text">
        <strong>{!open ? 'Valley research' : def ? def.name : 'All Valley research done'}</strong>
        <small>{!open ? 'Opens with the Great Library' : def ? `${Math.floor(snapshot.research.progress[leading!] ?? 0)} / ${def.cost} Knowledge` : `${snapshot.research.completed.length} projects finished`}</small>
        {open && def ? <Bar value={(snapshot.research.progress[leading!] ?? 0) / def.cost} tone="blue" thin /> : null}
      </span>
    </button>
  );
}
