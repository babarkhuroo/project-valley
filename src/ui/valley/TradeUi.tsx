import { BOOSTS, BOOST_ORDER, MERCHANTS, REPUTATION_ROAD, TRADE_BALANCE, type RoadReward } from '../../config/trade';
import { BUILDINGS } from '../../config/buildings';
import { RESOURCES, type ResourceId } from '../../config/resources';
import { isValleyUnlocked } from '../../sim/modifiers';
import { canClaimRoad, tradeOpen } from '../../sim/trade';
import type { GameState } from '../../sim/types';
import { buyFromMerchant, claimRoad, drinkTonic, fillMerchantCrate, trainVillager } from '../actions';
import { SKILLS, type SkillId } from '../../config/skills';
import { TRAINING } from '../../config/training';
import { trainingOffer } from '../../sim/training';
import { Portrait } from '../common/Portrait';
import { Bar, Section } from '../common/Bits';
import { Icon } from '../common/Icon';
import { formatDuration, formatNumber, useGameState } from '../hooks';
import { ui, useUI } from '../store';

// ---------------------------------------------------------------------------
// Top bar pieces
// ---------------------------------------------------------------------------

export function CoinsChip() {
  const state = useGameState();
  if (!tradeOpen(state) && state.trade.coins <= 0) return null;
  return (
    <div className="res-chip res-coins" title="Coins: earned from merchant ships and the Reputation Road. Spend them on tonics.">
      <Icon name="coin" size={30} />
      <div className="res-vals">
        <span className="res-amt">{formatNumber(state.trade.coins)}</span>
        <span className="res-sub muted">Coins</span>
      </div>
    </div>
  );
}

export function TradeButtons() {
  const state = useGameState();
  if (!isValleyUnlocked(state)) return null;
  const tonics = BOOST_ORDER.reduce((n, b) => n + (state.trade.inventory[b] ?? 0), 0);
  const active = state.trade.active.length > 0;
  return (
    <>
      <button className={`round-btn ${active ? 'glow' : ''}`} onClick={() => ui.openPanel('satchel')} title="Tonics">
        <Icon name="potion" size={24} />
        {tonics > 0 ? <span className="badge-count soft">{tonics}</span> : null}
      </button>
      <button className="round-btn" onClick={() => ui.openPanel('road')} title="Reputation Road">
        <Icon name="reputation" size={24} />
        {canClaimRoad(state) ? <span className="badge-count">!</span> : null}
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tonic satchel
// ---------------------------------------------------------------------------

export function SatchelPanel() {
  const state = useGameState();
  const open = useUI((s) => s.panel === 'satchel');
  if (!open) return null;
  const owned = BOOST_ORDER.filter((b) => (state.trade.inventory[b] ?? 0) > 0);
  return (
    <div className="side-panel panel pop-in">
      <header>
        <h3>
          <Icon name="potion" size={22} /> Tonics
        </h3>
        <button className="icon-btn" onClick={() => ui.closePanel()} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </header>
      {state.trade.active.length > 0 ? (
        <Section title="Working now">
          {state.trade.active.map((a) => (
            <div key={a.boost} className="tonic-row active">
              <span className="tonic-dot" style={{ background: BOOSTS[a.boost].color }} />
              <span className="tonic-name">
                <strong>{BOOSTS[a.boost].name}</strong>
                <small>{formatDuration(a.until - state.time)} left</small>
              </span>
            </div>
          ))}
        </Section>
      ) : null}
      <Section title="In your satchel">
        {owned.length === 0 ? (
          <p className="small muted">No tonics yet. Merchant ships sell them, and the Reputation Road gives some away.</p>
        ) : (
          owned.map((b) => (
            <div key={b} className="tonic-row">
              <span className="tonic-dot" style={{ background: BOOSTS[b].color }} />
              <span className="tonic-name">
                <strong>
                  {BOOSTS[b].name} ×{state.trade.inventory[b]}
                </strong>
                <small>{BOOSTS[b].description}</small>
              </span>
              <button className="btn small green" onClick={() => drinkTonic(b)}>
                Use
              </button>
            </div>
          ))
        )}
      </Section>
      <p className="small muted">Taking another dose of a tonic that's already working adds to its time.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reputation Road
// ---------------------------------------------------------------------------

function rewardText(r: RoadReward): string {
  switch (r.type) {
    case 'coins':
      return `${r.amount} coins`;
    case 'boost':
      return `${r.count} × ${BOOSTS[r.boost].name}`;
    case 'resources':
      return Object.entries(r.resources)
        .map(([res, n]) => `${n} ${RESOURCES[res as ResourceId].name}`)
        .join(', ');
    case 'decor':
      return `New decoration: ${BUILDINGS[r.building].name}`;
  }
}

function rewardIcon(r: RoadReward) {
  switch (r.type) {
    case 'coins':
      return 'coin' as const;
    case 'boost':
      return 'potion' as const;
    case 'resources':
      return 'gift' as const;
    case 'decor':
      return 'hammerHouse' as const;
  }
}

export function roadProgress(state: GameState): { prev: number; next: number | null } {
  const claimed = state.trade.roadClaimed;
  return { prev: claimed > 0 ? REPUTATION_ROAD[claimed - 1].at : 0, next: REPUTATION_ROAD[claimed]?.at ?? null };
}

export function RoadPanel() {
  const state = useGameState();
  const open = useUI((s) => s.panel === 'road');
  if (!open) return null;
  const rep = state.valley.reputation;
  return (
    <div className="side-panel road-panel panel pop-in">
      <header>
        <h3>
          <Icon name="reputation" size={22} /> Reputation Road
        </h3>
        <button className="icon-btn" onClick={() => ui.closePanel()} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </header>
      <p className="small muted">
        You have <strong>{formatNumber(rep)}</strong> reputation, earned by helping Valley projects and trading with merchants.
      </p>
      <ol className="road">
        {REPUTATION_ROAD.map((m, i) => {
          const claimed = i < state.trade.roadClaimed;
          const ready = i === state.trade.roadClaimed && rep >= m.at;
          return (
            <li key={i} className={claimed ? 'claimed' : ready ? 'ready' : rep >= m.at ? 'reached' : ''}>
              <span className="road-at">{m.at}</span>
              <Icon name={rewardIcon(m.reward)} size={24} />
              <span className="road-reward">{rewardText(m.reward)}</span>
              {claimed ? <Icon name="check" size={18} /> : ready ? (
                <button className="btn small green" onClick={claimRoad}>
                  Claim
                </button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The merchant at the Trading Post
// ---------------------------------------------------------------------------

export function MerchantSection() {
  const state = useGameState();
  const ship = state.trade.ship;
  if (!ship) {
    const next = state.trade.nextShipAt;
    return (
      <Section title="Merchants">
        <div className="merchant-empty">
          <Icon name="ship" size={34} />
          <span>{next !== null ? `The next ship is expected in about ${formatDuration(Math.max(0, next - state.time))}.` : 'Ships will start calling soon.'}</span>
        </div>
      </Section>
    );
  }
  const m = MERCHANTS[ship.merchant];
  const filled = ship.crates.filter((c) => c.filled).length;
  const bonus = Math.round(ship.crates.reduce((s, c) => s + c.coins, 0) * TRADE_BALANCE.fullShipBonus.coinShare);
  return (
    <Section title="Merchant in port" aside={<small className="muted">sails in {formatDuration(ship.leavesAt - state.time)}</small>}>
      <div className="merchant-head">
        <Icon name="ship" size={34} />
        <span>
          <strong>{m.name}</strong>
          <small>aboard {m.ship}</small>
        </span>
      </div>
      <ul className="crates">
        {ship.crates.map((c, i) => {
          const have = Math.floor(state.resources[c.resource]);
          return (
            <li key={i} className={c.filled ? 'filled' : ''}>
              <Icon name={c.resource} size={28} />
              <span className="crate-ask">
                <strong>
                  {c.amount} {RESOURCES[c.resource].name}
                </strong>
                <small>{c.filled ? 'Loaded' : `you have ${formatNumber(have)}`}</small>
              </span>
              <span className="crate-pay">
                <Icon name="coin" size={18} />
                {c.coins}
                <Icon name="reputation" size={16} />
                {c.reputation}
              </span>
              {c.filled ? (
                <Icon name="check" size={20} />
              ) : (
                <button className="btn small green" disabled={have < c.amount} onClick={() => fillMerchantCrate(i)}>
                  Load
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <Bar value={filled / ship.crates.length} tone="honey" thin />
      <p className="small muted">
        {ship.bonusPaid ? 'Every crate filled — the merchant paid a bonus.' : `Fill every crate for a bonus of ${bonus} coins and +${TRADE_BALANCE.fullShipBonus.reputation} reputation. Prices vary — not every crate is worth your goods.`}
      </p>
      <h4 className="wares-title">Tonics for sale</h4>
      <ul className="wares">
        {ship.wares.map((w, i) => (
          <li key={w.boost}>
            <span className="tonic-dot" style={{ background: BOOSTS[w.boost].color }} />
            <span className="tonic-name">
              <strong>{BOOSTS[w.boost].name}</strong>
              <small>{w.stock > 0 ? `${BOOSTS[w.boost].description} · ${w.stock} left` : 'Sold out'}</small>
            </span>
            <button className="btn small" disabled={w.stock <= 0 || state.trade.coins < w.price} onClick={() => buyFromMerchant(i)}>
              <Icon name="coin" size={16} />
              {w.price}
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Training at a guild
// ---------------------------------------------------------------------------

/** Who could train here, who is training now, and what it costs. */
export function GuildTrainingSection({ skill }: { skill: SkillId }) {
  const state = useGameState();
  const here = state.villagers.filter((v) => v.training?.skill === skill);
  const offers = state.villagers.filter((v) => !v.training).map((v) => ({ v, offer: trainingOffer(state, v, skill) }));
  const able = offers.filter((o) => o.offer.ok);
  const practising = offers.filter((o) => !o.offer.ok && /Practice/.test(o.offer.reason)).length;
  return (
    <Section title={`${SKILLS[skill].name} lessons`} aside={<small className="muted">{state.trade.coins} coins</small>}>
      {here.map((v) => {
        const t = v.training!;
        const total = TRAINING.lessons[t.toLevel].hours * 3600;
        return (
          <div key={v.id} className="trainee">
            <Portrait appearance={v.appearance} size={34} />
            <span className="tonic-name">
              <strong>
                {v.name} → level {t.toLevel}
              </strong>
              {t.until !== null ? <Bar value={1 - (t.until - state.time) / total} tone="blue" thin /> : <small>On the road here…</small>}
            </span>
            {t.until !== null ? <small className="muted">{formatDuration(t.until - state.time)}</small> : null}
          </div>
        );
      })}
      {able.map(({ v, offer }) =>
        offer.ok ? (
          <div key={v.id} className="trainee">
            <Portrait appearance={v.appearance} size={34} />
            <span className="tonic-name">
              <strong>{v.name}</strong>
              <small>
                {SKILLS[skill].name} {v.skills[skill].level} → {offer.toLevel} · away {offer.hours}h
              </small>
            </span>
            <button className="btn small green" disabled={state.trade.coins < offer.coins} onClick={() => trainVillager(v.id, skill)}>
              <Icon name="coin" size={16} />
              {offer.coins}
            </button>
          </div>
        ) : null,
      )}
      {here.length === 0 && able.length === 0 ? (
        <p className="small muted">
          {practising > 0 ? `Your villagers are still learning ${SKILLS[skill].name.toLowerCase()} by practice.` : `Nobody in ${state.player.villageName} is ready for the next lesson here.`}
        </p>
      ) : null}
      <p className="small muted">Villagers in training are away from work. They come back to their old job if it’s still free.</p>
    </Section>
  );
}
