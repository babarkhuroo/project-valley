import { useEffect, useState } from 'react';
import { DISTRICTS, VALLEY_BALANCE, VALLEY_BUILDING_ORDER, VALLEY_BUILDINGS, VALLEY_RESOURCES, type ValleyBuildingId } from '../../config/valley';
import { IDENTITY } from '../../config/identity';
import { RESOURCES, type ResourceId } from '../../config/resources';
import { playerId } from '../../game/persistence';
import type { ValleyBuildingState, ValleySnapshot } from '../../valley/types';
import { deliveredFraction, levelDef, remainingFor, reputationFor, valueOf } from '../../valley/valleySim';
import { contributeToValley, returnToVillage, selectValleyBuilding } from '../actions';
import { Bar, Section } from '../common/Bits';
import { Icon } from '../common/Icon';
import { formatDuration, formatNumber, useGameState, useValley } from '../hooks';
import { useUI } from '../store';
import { agoText, describeLog } from './format';
import { GuildTrainingSection, MerchantSection, roadProgress } from './TradeUi';
import { ValleyResearchSection, ValleyResearchSummary } from './ResearchUi';
import { ui as uiStore } from '../store';

function statusText(b: ValleyBuildingState, serverNow: number): string {
  const def = VALLEY_BUILDINGS[b.id];
  switch (b.status) {
    case 'locked': {
      const req = def.requires!;
      return `Opens when the ${VALLEY_BUILDINGS[req.building].name} is restored`;
    }
    case 'collecting':
      return b.level === 0 ? `Restoring · ${Math.round(deliveredFraction(b) * 100)}% gathered` : `Level ${b.level} · gathering for level ${b.level + 1}`;
    case 'building':
      return `Builders at work · ready in ${formatDuration(((b.doneAt ?? serverNow) - serverNow) / 1000)}`;
    case 'complete':
      return `Fully restored · level ${b.level}`;
  }
}

/** Server time now, extrapolated from the last snapshot. */
function useServerNow(): number {
  const { fetchedAt, receivedAt } = useValley();
  useUI((s) => s.tick);
  return fetchedAt + (Date.now() - receivedAt);
}

// ---------------------------------------------------------------------------
// Left: overview, projects and news
// ---------------------------------------------------------------------------

export function ValleySidebar() {
  const state = useGameState();
  const { snapshot, connection } = useValley();
  const selected = useUI((s) => s.valleySelection);
  const serverNow = useServerNow();
  if (!snapshot) {
    return (
      <aside className="valley-side panel pop-in">
        <h3>
          <Icon name="valley" size={26} /> {IDENTITY.valleyName}
        </h3>
        <p className="muted">{connection === 'offline' ? 'The road is washed out — can’t reach the Valley right now. Retrying…' : 'Walking over the ridge…'}</p>
      </aside>
    );
  }
  const me = playerId();
  const news = [...snapshot.log].reverse().slice(0, 7);
  const road = roadProgress(state);
  return (
    <aside className={`valley-side panel pop-in ${selected ? 'has-selection' : ''}`}>
      <header className="vs-head">
        <Icon name="valley" size={34} />
        <div>
          <h3>{snapshot.name}</h3>
          <small>
            {snapshot.members.length} villages · {connection === 'offline' ? 'reconnecting…' : 'together'}
          </small>
        </div>
      </header>
      <button className="vs-rep" onClick={() => uiStore.openPanel('road')}>
        <Icon name="reputation" size={22} />
        <span>
          <strong>{formatNumber(state.valley.reputation)}</strong> reputation
        </span>
        <small className="muted">{road.next !== null ? `Next Reputation Road reward at ${road.next}` : 'Reputation Road complete'}</small>
        {road.next !== null ? <Bar value={(state.valley.reputation - road.prev) / (road.next - road.prev)} tone="red" thin /> : null}
      </button>
      <ValleyResearchSummary snapshot={snapshot} />
      <Section title="Projects">
        <ul className="vs-projects">
          {VALLEY_BUILDING_ORDER.map((id) => {
            const b = snapshot.buildings[id];
            const def = VALLEY_BUILDINGS[id];
            return (
              <li key={id}>
                <button className={`vs-project ${selected === id ? 'active' : ''} is-${b.status}`} onClick={() => selectValleyBuilding(id, true)}>
                  <span className="vs-dot" style={{ background: def.color }} />
                  <span className="vs-pname">
                    <strong>
                      {def.name}
                      {b.level > 0 ? <em className="lvl-pip">{b.level}</em> : null}
                    </strong>
                    <small>{statusText(b, serverNow)}</small>
                    {b.status === 'collecting' ? <Bar value={deliveredFraction(b)} thin /> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="Valley news">
        <ul className="vs-news">
          {news.map((e) => (
            <li key={e.id} className={`news-${e.kind}`}>
              <span>{describeLog(e, snapshot, me)}</span>
              <time>{agoText(serverNow - e.at)}</time>
            </li>
          ))}
        </ul>
      </Section>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Right: one project and the contribution form
// ---------------------------------------------------------------------------

function MemberShares({ snapshot, b }: { snapshot: ValleySnapshot; b: ValleyBuildingState }) {
  const me = playerId();
  const total = Object.values(b.shares).reduce((s, v) => s + v, 0);
  if (total <= 0) return <p className="small muted">Nobody has brought anything for this level yet — be the first!</p>;
  const max = Math.max(...Object.values(b.shares));
  // Fixed member order (never a leaderboard): you first, then neighbours as they joined.
  const members = [...snapshot.members].sort((a, c) => (a.id === me ? -1 : c.id === me ? 1 : 0));
  return (
    <ul className="vp-shares">
      {members.map((m) => {
        const v = b.shares[m.id] ?? 0;
        return (
          <li key={m.id} className={m.id === me ? 'me' : ''}>
            <span className="vp-member">
              <strong>{m.id === me ? 'You' : m.name}</strong>
              <small>{m.villageName}</small>
            </span>
            <span className="vp-share-bar">
              <i style={{ width: `${(v / max) * 100}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ContributeForm({ id, b }: { id: ValleyBuildingId; b: ValleyBuildingState }) {
  const state = useGameState();
  const { connection } = useValley();
  const [amounts, setAmounts] = useState<Partial<Record<ResourceId, number>>>({});
  useEffect(() => setAmounts({}), [id, b.level]);
  const def = levelDef(id, b.level)!;
  const remaining = remainingFor(b);
  const resources = VALLEY_RESOURCES.filter((r) => (def.cost[r] ?? 0) > 0);
  const clamp = (r: ResourceId, n: number) => Math.max(0, Math.min(Math.floor(n), Math.floor(state.resources[r]), remaining[r] ?? 0));
  const chosen: Partial<Record<ResourceId, number>> = {};
  for (const r of resources) {
    const n = clamp(r, amounts[r] ?? 0);
    if (n > 0) chosen[r] = n;
  }
  const value = valueOf(chosen);
  const pending = state.valley.outbox.filter((o) => o.target.kind === 'building' && o.target.id === id).length;
  const set = (r: ResourceId, n: number) => setAmounts((a) => ({ ...a, [r]: clamp(r, n) }));
  return (
    <>
      <div className="vp-resources">
        {resources.map((r) => {
          const need = def.cost[r] ?? 0;
          const got = Math.min(need, b.delivered[r] ?? 0);
          const have = Math.floor(state.resources[r]);
          const step = have >= 500 ? 100 : have >= 100 ? 25 : 5;
          const n = clamp(r, amounts[r] ?? 0);
          const done = got >= need;
          return (
            <div key={r} className={`vp-res ${done ? 'done' : ''}`}>
              <Icon name={r} size={30} />
              <div className="vp-res-main">
                <Bar value={need > 0 ? got / need : 1} tone={done ? 'green' : 'honey'} label={`${formatNumber(got)} / ${formatNumber(need)} ${RESOURCES[r].name}`} />
                {done ? (
                  <small className="muted">All the {RESOURCES[r].name.toLowerCase()} it needs</small>
                ) : (
                  <div className="vp-stepper">
                    <button className="icon-btn" disabled={n <= 0} onClick={() => set(r, n - step)} aria-label={`Less ${RESOURCES[r].name}`}>
                      −
                    </button>
                    <span className="vp-amt">{n}</span>
                    <button className="icon-btn" disabled={n >= Math.min(have, remaining[r] ?? 0)} onClick={() => set(r, n + step)} aria-label={`More ${RESOURCES[r].name}`}>
                      +
                    </button>
                    <button className="btn small ghost" disabled={have <= 0} onClick={() => set(r, Infinity)}>
                      All I can
                    </button>
                    <small className="muted">you have {formatNumber(have)}</small>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <button
        className="btn green wide"
        disabled={value <= 0 || connection !== 'ready'}
        onClick={() => {
          if (contributeToValley(id, chosen)) setAmounts({});
        }}
      >
        <Icon name="gift" size={22} />
        {value > 0 ? `Send · +${reputationFor(value)} reputation` : 'Choose what to send'}
      </button>
      {pending > 0 ? <p className="small muted vp-pending">{pending === 1 ? 'A parcel is' : `${pending} parcels are`} on the road…</p> : null}
      <p className="small muted">Every {Math.round(1 / VALLEY_BALANCE.reputationPerValue)} timber’s worth earns 1 reputation. Stone, planks and bricks count for more.</p>
    </>
  );
}

export function ValleyProjectPanel() {
  const id = useUI((s) => s.valleySelection);
  // Side panels (road, tonics, settings…) open in the same spot; let them take over.
  const covered = useUI((s) => s.panel !== null);
  const { snapshot } = useValley();
  const serverNow = useServerNow();
  if (!id || !snapshot || covered) return null;
  const b = snapshot.buildings[id];
  const def = VALLEY_BUILDINGS[id];
  const next = levelDef(id, b.level);
  return (
    <div className="selection-panel valley-panel panel pop-in">
      <header className="sp-header">
        <div className="sp-icon" style={{ borderColor: def.color }}>
          <Icon name={def.model === 'hall' ? 'valley' : 'home'} size={42} />
        </div>
        <div className="sp-title">
          <h3>{def.name}</h3>
          <small>
            {DISTRICTS[def.district].name} · {statusText(b, serverNow)}
          </small>
        </div>
        <button className="icon-btn" onClick={() => selectValleyBuilding(null)} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </header>
      <p className="vp-desc">{def.description}</p>
      <div className="vp-levels">
        {def.levels.map((l, i) => (
          <div key={i} className={`vp-level ${i < b.level ? 'done' : i === b.level ? 'next' : ''}`}>
            <span className="lvl-pip">{i + 1}</span>
            <span>{l.summary}</span>
            {i < b.level ? <Icon name="check" size={16} /> : null}
          </div>
        ))}
      </div>
      {id === 'tradingPost' && b.level > 0 ? <MerchantSection /> : null}
      {def.trains && b.level > 0 ? <GuildTrainingSection skill={def.trains} /> : null}
      {id === 'greatLibrary' ? <ValleyResearchSection snapshot={snapshot} /> : null}
      {b.status === 'locked' ? (
        <p className="vp-note">
          <Icon name="lock" size={18} /> {statusText(b, serverNow)}.
        </p>
      ) : null}
      {b.status === 'building' && next ? (
        <Section title="Builders at work">
          <Bar value={1 - Math.max(0, (b.doneAt ?? serverNow) - serverNow) / (next.buildHours * 3_600_000)} tone="blue" label={`Ready in ${formatDuration(((b.doneAt ?? serverNow) - serverNow) / 1000)}`} />
        </Section>
      ) : null}
      {b.status === 'collecting' && next ? (
        <Section title={b.level === 0 ? 'Bring materials to restore it' : `Materials for level ${b.level + 1}`}>
          <ContributeForm id={id} b={b} />
        </Section>
      ) : null}
      {b.status === 'collecting' || b.status === 'building' ? (
        <Section title="Who’s helping">
          <MemberShares snapshot={snapshot} b={b} />
        </Section>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom: the way home, and the travel veil
// ---------------------------------------------------------------------------

export function ValleyActionBar() {
  const state = useGameState();
  return (
    <nav className="action-bar">
      <button className="big-btn home" onClick={returnToVillage}>
        <Icon name="home" size={34} />
        <span>{state.player.villageName}</span>
      </button>
    </nav>
  );
}

export function TravelVeil() {
  const travelling = useUI((s) => s.travelling);
  const scene = useUI((s) => s.scene);
  const state = useGameState();
  if (!travelling) return null;
  return (
    <div className="travel-veil">
      <div className="travel-card">
        <Icon name="travel" size={48} />
        <span>{scene === 'valley' ? `Walking over the ridge to ${IDENTITY.valleyName}…` : `Heading home to ${state.player.villageName}…`}</span>
      </div>
    </div>
  );
}
