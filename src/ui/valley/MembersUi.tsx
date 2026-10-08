import { useState } from 'react';
import { playerId } from '../../game/persistence';
import { runtime } from '../../game/runtime';
import type { ValleySnapshot } from '../../valley/types';
import { activeMembers, MAX_PLAYERS, neighboursAwake } from '../../valley/valleySim';
import { leaveCurrentValley } from '../actions';
import { Section } from '../common/Bits';
import { Icon } from '../common/Icon';
import { ui } from '../store';

/** Who's in the Valley, how to invite friends, and the way out. */
export function MembersSection({ snapshot, online: live, serverNow }: { snapshot: ValleySnapshot; online: ReadonlySet<string>; serverNow: number }) {
  const me = playerId();
  // Players are here when connected; neighbours when they're awake.
  const online = new Set([...live, ...neighboursAwake(snapshot, serverNow), me]);
  const [confirm, setConfirm] = useState(false);
  const members = activeMembers(snapshot);
  const players = members.filter((m) => m.kind === 'player');
  const ordered = [...members].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0) || (a.kind === b.kind ? 0 : a.kind === 'player' ? -1 : 1));
  return (
    <Section title={`Members · ${players.length}/${MAX_PLAYERS} players`}>
      <ul className="members">
        {ordered.map((m) => (
          <li key={m.id} className={m.id === me ? 'me' : ''}>
            <i className={`presence ${online.has(m.id) ? 'on' : ''}`} title={online.has(m.id) ? 'Here now' : 'Away'} />
            <span>
              <strong>{m.id === me ? `${m.name} (you)` : m.name}</strong>
              <small>{m.villageName}</small>
            </span>
            <em className={`member-kind ${m.kind}`}>{m.kind === 'player' ? 'player' : 'neighbour'}</em>
          </li>
        ))}
      </ul>
      <div className="invite">
        <span className="small">
          Invite code <strong className="code">{snapshot.code}</strong>
        </span>
        <button
          className="btn small ghost"
          onClick={() => {
            void navigator.clipboard?.writeText(snapshot.code).then(
              () => ui.toast({ kind: 'success', title: 'Invite code copied', body: `Friends can join ${snapshot.name} with ${snapshot.code}.`, icon: 'valley' }, 2500),
              () => undefined,
            );
          }}
        >
          Copy
        </button>
      </div>
      <label className="toggle small">
        <input type="checkbox" checked={snapshot.open} onChange={(e) => void runtime.valley?.setOpen(e.target.checked)} /> Listed for anyone to join
      </label>
      {confirm ? (
        <div className="blocker warn">
          <span>Leave {snapshot.name}? Your past help stays on its record; bonuses stop.</span>
          <button className="btn small danger" onClick={() => void leaveCurrentValley()}>
            Leave
          </button>
          <button className="btn small ghost" onClick={() => setConfirm(false)}>
            Stay
          </button>
        </div>
      ) : (
        <button className="btn small ghost leave-btn" onClick={() => setConfirm(true)}>
          <Icon name="travel" size={16} /> Leave this Valley…
        </button>
      )}
    </Section>
  );
}
