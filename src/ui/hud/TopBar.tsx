import { levelBounds } from '../../config/balance';
import { RESEARCH, type ResearchId } from '../../config/research';
import { RESOURCES, RESOURCE_ORDER, type ResourceId } from '../../config/resources';
import { game } from '../../game/runtime';
import { capacity } from '../../sim/economy';
import { productionSummary } from '../../sim/selectors';
import { Icon } from '../common/Icon';
import { formatNumber, useGameState } from '../hooks';
import { ui, useUI } from '../store';

function LevelBadge() {
  const state = useGameState();
  const { level, xp, villageName } = state.player;
  const { start, next } = levelBounds(level);
  const frac = next === null ? 1 : (xp - start) / (next - start);
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <button className="level-badge" onClick={() => ui.openPanel('research')} title={next === null ? 'Top level reached' : `${xp - start} / ${next - start} XP to level ${level + 1}`}>
      <svg viewBox="0 0 56 56" className="level-ring">
        <circle cx="28" cy="28" r={r} className="track" />
        <circle cx="28" cy="28" r={r} className="fill" strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 28 28)" />
      </svg>
      <span className="level-num">{level}</span>
      <span className="level-text">
        <strong>{villageName}</strong>
        <small>
          {next === null ? 'Max level' : `${Math.floor(xp - start)} / ${next - start} XP`}
        </small>
      </span>
    </button>
  );
}

const UNLOCKED_BY: Partial<Record<ResourceId, ResearchId>> = { clay: 'clayDigging', stone: 'stonecutting', planks: 'carpentry', bricks: 'brickmaking' };

function ResourceChip({ id, rate }: { id: ResourceId; rate: { gain: number; use: number } }) {
  const state = game().state;
  const amount = state.resources[id];
  const cap = capacity(state, id);
  const full = cap > 0 && amount >= cap;
  const net = rate.gain - rate.use;
  const active = id === 'knowledge' ? state.research.active : null;
  // Late resources stay out of the bar until the player can actually get them.
  const gate = UNLOCKED_BY[id];
  const unlocked = !gate || state.research.completed.includes(gate) || amount > 0;
  if (!unlocked) return null;
  let sub: string | null = null;
  if (Math.abs(net) >= 0.05) sub = `${net > 0 ? '+' : '−'}${Math.abs(net) < 10 ? Math.abs(net).toFixed(1) : Math.round(Math.abs(net))}/min`;
  return (
    <div className={`res-chip res-${id} ${full ? 'is-full' : ''} ${id === 'stew' && amount < 5 ? 'is-low' : ''}`} title={`${RESOURCES[id].name}: ${RESOURCES[id].description}`}>
      <Icon name={id} size={30} />
      <div className="res-vals">
        <span className="res-amt">
          {formatNumber(amount)}
          {cap > 0 ? <small>/{formatNumber(cap)}</small> : null}
        </span>
        {full ? (
          <span className="res-sub warn">Full</span>
        ) : active ? (
          <span className="res-sub">{RESEARCH[active].name}</span>
        ) : sub ? (
          <span className={`res-sub ${net < 0 ? 'neg' : ''}`}>{sub}</span>
        ) : (
          <span className="res-sub muted">{RESOURCES[id].name}</span>
        )}
      </div>
    </div>
  );
}

export function TopBar() {
  const state = useGameState();
  const unread = useUI((s) => s.unread);
  const g = game();
  const rates = productionSummary(state, g.world);
  return (
    <header className="topbar">
      <LevelBadge />
      <div className="resource-bar">
        {RESOURCE_ORDER.filter((r) => RESOURCES[r].hud).map((r) => (
          <ResourceChip key={r} id={r} rate={rates[r]} />
        ))}
      </div>
      <div className="top-buttons">
        <button className="round-btn" onClick={() => ui.openPanel('notifications')} title="Notifications">
          <Icon name="bell" size={24} />
          {unread > 0 ? <span className="badge-count">{unread > 9 ? '9+' : unread}</span> : null}
        </button>
        <button className="round-btn" onClick={() => ui.openPanel('settings')} title="Settings">
          <Icon name="gear" size={24} />
        </button>
        {import.meta.env.DEV ? (
          <button className="round-btn dev" onClick={() => ui.openPanel('dev')} title="Developer tools">
            <Icon name="wrench" size={24} />
          </button>
        ) : null}
      </div>
    </header>
  );
}
