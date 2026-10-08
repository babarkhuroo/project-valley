import { VALLEY_RESEARCH } from '../../config/valleyResearch';
import { DISTRICTS, VALLEY_BUILDING_ORDER, VALLEY_BUILDINGS, type ValleyBuildingId } from '../../config/valley';
import { IDENTITY } from '../../config/identity';
import { playerId } from '../../game/persistence';
import type { ValleyBuildingState } from '../../valley/types';
import { deliveredFraction, levelDef } from '../../valley/valleySim';
import { contributeToValley, returnToVillage, selectValleyBuilding } from '../actions';
import { Bar, Section } from '../common/Bits';
import { Icon } from '../common/Icon';
import { formatDuration, formatNumber, useGameState, useOnline, useValley } from '../hooks';
import { useUI } from '../store';
import { agoText, describeLog } from './format';
import { GuildTrainingSection, MerchantSection, roadProgress } from './TradeUi';
import { ValleyResearchSection, ValleyResearchSummary } from './ResearchUi';
import { FestivalCard, FestivalSection } from './FestivalUi';
import { DeliveryForm, MemberShares } from './Delivery';
import { MillraceSection } from './MillraceUi';
import { MembersSection } from './MembersUi';
import { ui as uiStore } from '../store';

function statusText(b: ValleyBuildingState, serverNow: number): string {
  const def = VALLEY_BUILDINGS[b.id];
  switch (b.status) {
    case 'locked': {
      const req = def.requires!;
      return 'research' in req ? `Opens with the Valley research ${VALLEY_RESEARCH[req.research].name}` : `Opens when the ${VALLEY_BUILDINGS[req.building].name} is restored`;
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
  const online = useOnline();
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
      <FestivalCard snapshot={snapshot} serverNow={serverNow} />
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
      <MembersSection snapshot={snapshot} online={online} />
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

function ContributeForm({ id, b }: { id: ValleyBuildingId; b: ValleyBuildingState }) {
  const state = useGameState();
  const def = levelDef(id, b.level)!;
  const pending = state.valley.outbox.filter((o) => o.target.kind === 'building' && o.target.id === id).length;
  return <DeliveryForm resetKey={`${id}:${b.level}`} cost={def.cost} delivered={b.delivered} pending={pending} onSend={(chosen) => contributeToValley(id, chosen)} />;
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
      {id === 'festivalGrounds' && b.level > 0 ? <FestivalSection snapshot={snapshot} serverNow={serverNow} /> : null}
      {id === 'millraceWorkshop' && b.level > 0 ? <MillraceSection snapshot={snapshot} serverNow={serverNow} /> : null}
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
          <MemberShares snapshot={snapshot} shares={b.shares} empty="Nobody has brought anything for this level yet — be the first!" />
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
