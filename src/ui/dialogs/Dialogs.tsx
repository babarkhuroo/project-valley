import { useEffect, useState } from 'react';
import { BALANCE } from '../../config/balance';
import { RESEARCH_IDS, RESEARCH } from '../../config/research';
import { RESOURCES, RESOURCE_ORDER } from '../../config/resources';
import { SKILLS } from '../../config/skills';
import { SPECIALTY_BLURB } from '../../config/villagers';
import { welcomeNewcomer } from '../actions';
import { Icon } from '../common/Icon';
import { Portrait } from '../common/Portrait';
import { formatDuration, useGameState } from '../hooks';
import { ui, useUI } from '../store';

export function NewcomerDialog() {
  const state = useGameState();
  const hidden = useUI((s) => s.newcomersHidden);
  const [pick, setPick] = useState(0);
  const candidates = state.newcomers;
  if (!candidates) return null;
  if (hidden) {
    return (
      <button className="newcomer-chip pop-in" onClick={() => ui.set({ newcomersHidden: false })}>
        <Icon name="villager" size={24} /> Travellers are waiting!
      </button>
    );
  }
  return (
    <div className="modal-backdrop fade-in">
      <div className="modal newcomer panel pop-in" role="dialog" aria-label="Choose a newcomer">
        <h2>Travellers at the gate</h2>
        <p className="muted">Word of {state.player.villageName} has spread. A new home is ready — who will you welcome?</p>
        <div className="candidates">
          {candidates.map((c, i) => (
            <button key={c.name} className={`candidate ${pick === i ? 'picked' : ''}`} onClick={() => setPick(i)}>
              <Portrait appearance={c.appearance} size={96} />
              <strong>{c.name}</strong>
              <span className="pill pill-blue" style={{ background: SKILLS[c.specialty].color }}>
                {SKILLS[c.specialty].name} 1
              </span>
              <small>{SPECIALTY_BLURB[c.specialty]}</small>
            </button>
          ))}
        </div>
        <div className="row-buttons end">
          <button className="btn ghost" onClick={() => ui.set({ newcomersHidden: true })}>
            Decide later
          </button>
          <button className="btn green" onClick={() => welcomeNewcomer(pick)}>
            Welcome {candidates[pick].name}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AwayDialog() {
  const away = useUI((s) => s.away);
  if (!away) return null;
  const gained = RESOURCE_ORDER.filter((r) => away.gained[r]);
  const capped = away.cappedSeconds < away.seconds;
  return (
    <div className="modal-backdrop fade-in">
      <div className="modal away panel pop-in" role="dialog" aria-label="While you were away">
        <h2>While you were away</h2>
        <p className="muted">
          {formatDuration(away.seconds)} passed.
          {capped ? ` Villagers worked the first ${formatDuration(away.cappedSeconds)} of it.` : ' Your villagers kept at it.'}
        </p>
        {gained.length > 0 ? (
          <div className="away-grid">
            {gained.map((r) => (
              <div key={r} className="away-res">
                <Icon name={r} size={36} />
                <strong>+{away.gained[r]}</strong>
                <small>{RESOURCES[r].name}</small>
              </div>
            ))}
          </div>
        ) : null}
        <ul className="away-list">
          {away.built.map((b, i) => (
            <li key={`b${i}`}>
              <Icon name="hammerHouse" size={20} /> {b} was completed
            </li>
          ))}
          {away.researched.map((r, i) => (
            <li key={`r${i}`}>
              <Icon name="research" size={20} /> Researched {r}
            </li>
          ))}
          {away.levels.map((l) => (
            <li key={`l${l}`}>
              <Icon name="xp" size={20} /> Reached village level {l}
            </li>
          ))}
          {away.shipInPort ? (
            <li>
              <Icon name="coin" size={20} /> A merchant ship is in port at Saltreach Harbour
            </li>
          ) : null}
          {away.shipsMissed > 0 ? (
            <li className="warn">
              <Icon name="coin" size={20} /> {away.shipsMissed === 1 ? 'A merchant ship' : `${away.shipsMissed} merchant ships`} sailed without trading
            </li>
          ) : null}
          {away.newcomers ? (
            <li>
              <Icon name="villager" size={20} /> Travellers are waiting to join
            </li>
          ) : null}
          {away.fullStorage.map((r) => (
            <li key={`f${r}`} className="warn">
              <Icon name="full" size={20} /> {RESOURCES[r].name} storage filled up
            </li>
          ))}
          {away.wentHungry ? (
            <li className="warn">
              <Icon name="hungry" size={20} /> The stew ran out for a while
            </li>
          ) : null}
          {away.idle.length > 0 ? (
            <li className="warn">
              <Icon name="idle" size={20} /> {away.idle.join(', ')} ran out of work
            </li>
          ) : null}
        </ul>
        <div className="row-buttons end">
          <button className="btn green" onClick={() => ui.set({ away: null })}>
            Back to the village
          </button>
        </div>
      </div>
    </div>
  );
}

export function LevelUpBanner() {
  const level = useUI((s) => s.levelUp);
  useEffect(() => {
    if (level === null) return;
    const t = window.setTimeout(() => ui.set({ levelUp: null }), 6000);
    return () => window.clearTimeout(t);
  }, [level]);
  if (level === null) return null;
  const newTier = RESEARCH_IDS.filter((id) => RESEARCH[id].tier === level);
  const gift = BALANCE.progression.levelUpGift;
  return (
    <div className="levelup pop-in" onClick={() => ui.set({ levelUp: null })} role="status">
      <div className="levelup-star">
        <Icon name="xp" size={96} />
        <span>{level}</span>
      </div>
      <h2>Village level {level}!</h2>
      {newTier.length > 0 ? (
        <p>
          New research tier: {newTier.map((id) => RESEARCH[id].name).join(', ')}
        </p>
      ) : (
        <p>Your village grows more capable.</p>
      )}
      <p className="gift">
        Gift:{' '}
        {RESOURCE_ORDER.filter((r) => gift[r]).map((r) => (
          <span key={r}>
            <Icon name={r} size={18} /> +{gift[r]}
          </span>
        ))}
      </p>
      {newTier.length > 0 ? (
        <button
          className="btn"
          onClick={(e) => {
            e.stopPropagation();
            ui.set({ levelUp: null, panel: 'research' });
          }}
        >
          Open research
        </button>
      ) : null}
    </div>
  );
}
