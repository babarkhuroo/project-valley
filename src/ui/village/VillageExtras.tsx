import { BOOSTS, BASE_BOOST_ORDER, type BaseBoostId } from '../../config/trade';
import { RESOURCES, type ResourceId } from '../../config/resources';
import { canAfford } from '../../sim/economy';
import { readyRequests, requestsCanFulfil, REQUESTS } from '../../sim/requests';
import { chestsPending } from '../../sim/chests';
import { BREWING, brewBlocker, brewCost, brewSeconds, brewingUnlocked, herbs, kettles, maxStrength, variant } from '../../sim/brewing';
import type { BrewingNow, GameState } from '../../sim/types';
import { brewTonic, deliverRequest, openNextChest, turnDownRequest } from '../actions';
import { Bar, Cost, Section } from '../common/Bits';
import { Icon } from '../common/Icon';
import type { IconName } from '../icons';
import { formatDuration, formatNumber, useGameState } from '../hooks';
import { ui, useUI } from '../store';
import { useState } from 'react';

// ---------------------------------------------------------------------------
// Top bar buttons
// ---------------------------------------------------------------------------

/** The requests board's button: a count of requests the stores can cover now. */
export function RequestsButton() {
  const state = useGameState();
  if (!state.requests) return null;
  const n = requestsCanFulfil(state);
  return (
    <button className="round-btn" onClick={() => ui.openPanel('requests')} title="Village requests">
      <Icon name="crate" size={24} />
      {n > 0 ? <span className="badge-count">{n}</span> : null}
    </button>
  );
}

/** Level-up chests waiting to be opened. */
export function ChestButton() {
  const state = useGameState();
  const n = chestsPending(state);
  if (n <= 0) return null;
  return (
    <button className="round-btn glow" onClick={() => openNextChest()} title="Level-up chests">
      <Icon name="gift" size={24} />
      <span className="badge-count">{n}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Requests board
// ---------------------------------------------------------------------------

const wanted = (wants: Partial<Record<ResourceId, number>>) =>
  (Object.entries(wants) as [ResourceId, number][]).map(([r, n]) => `${formatNumber(n)} ${RESOURCES[r].name}`).join(' and ');

export function RequestsPanel() {
  const state = useGameState();
  const open = useUI((s) => s.panel === 'requests');
  if (!open) return null;
  const board = state.requests;
  return (
    <div className="side-panel panel pop-in">
      <header>
        <h3>
          <Icon name="crate" size={22} /> Village requests
        </h3>
        <button className="icon-btn" onClick={() => ui.closePanel()} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </header>
      {!board ? (
        <p className="small muted">Folk from around the valley start sending requests once your village reaches level {REQUESTS.unlockLevel}.</p>
      ) : (
        <>
          <p className="small strong-honey">Folk from around the valley need goods. Help them out for XP, coins and the odd tonic.</p>
          {board.slots.map((r) =>
            r.readyAt > state.time ? (
              <div key={r.id} className="request-card waiting">
                <Icon name="clock" size={26} />
                <span className="small muted">Another request arrives in {formatDuration(r.readyAt - state.time)}.</span>
              </div>
            ) : (
              <div key={r.id} className={`request-card ${canAfford(state, r.wants) ? 'can' : ''}`}>
                <div className="request-head">
                  <Icon name={Object.keys(r.wants)[0] as IconName} size={40} />
                  <span>
                    <strong>{r.who}</strong>
                    <small>
                      needs {wanted(r.wants)} {r.why}.
                    </small>
                  </span>
                </div>
                <Cost bundle={r.wants} state={state} />
                <div className="request-reward">
                  <span className="muted small">Reward</span>
                  <span>
                    <Icon name="xp" size={20} /> +{formatNumber(r.xp)} XP
                  </span>
                  <span>
                    <Icon name="coin" size={20} /> +{formatNumber(r.coins)}
                  </span>
                  {r.tonic ? (
                    <span>
                      <Icon name="potion" size={20} /> {BOOSTS[r.tonic].name}
                    </span>
                  ) : null}
                </div>
                <div className="row-buttons">
                  <button className="btn ghost small" onClick={() => turnDownRequest(r.id)}>
                    Not now
                  </button>
                  <button className="btn green" disabled={!canAfford(state, r.wants)} onClick={() => deliverRequest(r.id)}>
                    {canAfford(state, r.wants) ? 'Deliver' : 'Not enough yet'}
                  </button>
                </div>
              </div>
            ),
          )}
          {board.done > 0 ? <p className="small muted center">Requests fulfilled: {board.done}</p> : null}
        </>
      )}
    </div>
  );
}

/** Requests showing now (for the renderer's carts). */
export const requestsShowing = (state: GameState) => readyRequests(state);

// ---------------------------------------------------------------------------
// Level-up chest
// ---------------------------------------------------------------------------

export function ChestDialog() {
  const reward = useUI((s) => s.chest);
  const state = useGameState();
  if (!reward) return null;
  const more = chestsPending(state);
  return (
    <div className="modal-backdrop fade-in" onClick={() => ui.set({ chest: null })}>
      <div className="modal chest panel pop-in" role="dialog" aria-label={`Level ${reward.level} chest`} onClick={(e) => e.stopPropagation()}>
        <h2>
          <Icon name="gift" size={34} /> Level {reward.level} chest
        </h2>
        <div className="chest-rewards">
          <div className="away-res reveal" style={{ animationDelay: '0.1s' }}>
            <Icon name="coin" size={40} />
            <strong>+{formatNumber(reward.coins)}</strong>
            <small>coins</small>
          </div>
          {(Object.entries(reward.goods) as [ResourceId, number][]).map(([r, n], i) => (
            <div key={r} className="away-res reveal" style={{ animationDelay: `${0.22 + i * 0.12}s` }}>
              <Icon name={r} size={40} />
              <strong>+{formatNumber(n)}</strong>
              <small>{RESOURCES[r].name}</small>
            </div>
          ))}
          {reward.tonics.map((t, i) => (
            <div key={`${t}${i}`} className="away-res reveal" style={{ animationDelay: `${0.46 + i * 0.12}s` }}>
              <Icon name="potion" size={40} />
              <strong>+1</strong>
              <small>{BOOSTS[t].name}</small>
            </div>
          ))}
        </div>
        <div className="row-buttons center">
          {more > 0 ? (
            <button className="btn" onClick={() => openNextChest()}>
              Open the next ({more})
            </button>
          ) : null}
          <button className="btn green" onClick={() => ui.set({ chest: null })}>
            Lovely!
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brewing (the Cookhouse's Tonics section)
// ---------------------------------------------------------------------------

const STRENGTH_NAMES = ['Ordinary', 'Strong', 'Grand'];
const strengthOf = (k: BrewingNow) => (k.tonic.endsWith('Grand') ? 3 : k.tonic.endsWith('Strong') ? 2 : 1);

export function BrewSection() {
  const state = useGameState();
  const [strength, setStrength] = useState(1);
  if (!brewingUnlocked(state)) return null;
  const now = state.brewing?.kettles ?? [];
  const slots = kettles(state);
  const max = maxStrength(state);
  return (
    <>
      <Section title={slots > 1 ? 'The kettles' : 'The kettle'} aside={`${formatNumber(herbs(state))}/${BREWING.herbPouch} herbs`}>
        {Array.from({ length: slots }, (_, i) => {
          const k = now[i];
          if (!k) return <p key={i} className="small muted">Empty — pick a brew below.</p>;
          const left = Math.max(0, k.doneAt - state.time);
          return (
            <div key={i} className="kettle">
              <span>
                <strong>{BOOSTS[k.tonic].name}</strong> <small className="good">ready in {formatDuration(Math.max(1, left))}</small>
              </span>
              <Bar value={1 - left / brewSeconds(strengthOf(k))} tone="honey" thin />
            </div>
          );
        })}
        <p className="small muted">Herbs grow in the wild herb patches around the village; tap them to gather.</p>
      </Section>
      <Section title="Brew">
        <div className="segmented">
          {STRENGTH_NAMES.map((n, i) => (
            <button key={n} className={strength === i + 1 ? 'on' : ''} onClick={() => setStrength(i + 1)}>
              {n}
            </button>
          ))}
        </div>
        {strength > max ? <p className="small warn">{STRENGTH_NAMES[strength - 1]} brews need a level {strength} Cookhouse.</p> : null}
        {BASE_BOOST_ORDER.map((tonic: BaseBoostId) => {
          const def = BOOSTS[variant(tonic, strength)];
          const cost = brewCost(tonic, strength);
          const why = brewBlocker(state, tonic, strength);
          return (
            <div key={tonic} className="brew-card">
              <div className="tonic-row">
                <span className="tonic-dot" style={{ background: def.color }} />
                <span className="tonic-name">
                  <strong>{def.name}</strong>
                  <small>{def.description}</small>
                </span>
              </div>
              <div className="brew-cost">
                <span className={herbs(state) >= cost.herbs ? '' : 'warn'}>
                  <Icon name="leaf" size={20} /> {cost.herbs}
                </span>
                <Cost bundle={cost.goods} state={state} compact />
                {cost.coins > 0 ? (
                  <span className={state.trade.coins >= cost.coins ? '' : 'warn'}>
                    <Icon name="coin" size={20} /> {cost.coins}
                  </span>
                ) : null}
              </div>
              <div className="row-buttons">
                <small className={why ? 'warn' : 'good'}>{why ?? `Ready in ${formatDuration(brewSeconds(strength))}`}</small>
                <button className="btn small orange" disabled={!!why} onClick={() => brewTonic(tonic, strength)}>
                  Brew
                </button>
              </div>
            </div>
          );
        })}
      </Section>
    </>
  );
}
