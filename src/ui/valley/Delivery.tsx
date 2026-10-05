import { useEffect, useState } from 'react';
import { VALLEY_BALANCE } from '../../config/valley';
import { RESOURCES, type ResourceId } from '../../config/resources';
import { playerId } from '../../game/persistence';
import type { ResourceBag, ValleySnapshot } from '../../valley/types';
import { reputationFor, valueOf } from '../../valley/valleySim';
import { Bar } from '../common/Bits';
import { Icon } from '../common/Icon';
import { formatNumber, useGameState, useValley } from '../hooks';

/** Who helped, in a fixed member order (you first) — never a leaderboard. */
export function MemberShares({ snapshot, shares, empty }: { snapshot: ValleySnapshot; shares: Record<string, number>; empty: string }) {
  const me = playerId();
  const total = Object.values(shares).reduce((s, v) => s + v, 0);
  if (total <= 0) return <p className="small muted">{empty}</p>;
  const max = Math.max(...Object.values(shares));
  const members = [...snapshot.members].sort((a, c) => (a.id === me ? -1 : c.id === me ? 1 : 0));
  return (
    <ul className="vp-shares">
      {members.map((m) => {
        const v = shares[m.id] ?? 0;
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

/**
 * Choose amounts per resource (or "All I can") against a goal and send them in one
 * parcel. Shared by Valley projects and festivals.
 */
export function DeliveryForm({ resetKey, cost, delivered, pending, onSend }: { resetKey: string; cost: ResourceBag; delivered: ResourceBag; pending: number; onSend: (chosen: ResourceBag) => boolean }) {
  const state = useGameState();
  const { connection } = useValley();
  const [amounts, setAmounts] = useState<ResourceBag>({});
  useEffect(() => setAmounts({}), [resetKey]);
  const resources = (Object.keys(cost) as ResourceId[]).filter((r) => (cost[r] ?? 0) > 0);
  const remaining = (r: ResourceId) => Math.max(0, (cost[r] ?? 0) - (delivered[r] ?? 0));
  const clamp = (r: ResourceId, n: number) => Math.max(0, Math.min(Math.floor(n), Math.floor(state.resources[r]), remaining(r)));
  const chosen: ResourceBag = {};
  for (const r of resources) {
    const n = clamp(r, amounts[r] ?? 0);
    if (n > 0) chosen[r] = n;
  }
  const value = valueOf(chosen);
  const set = (r: ResourceId, n: number) => setAmounts((a) => ({ ...a, [r]: clamp(r, n) }));
  return (
    <>
      <div className="vp-resources">
        {resources.map((r) => {
          const need = cost[r] ?? 0;
          const got = Math.min(need, delivered[r] ?? 0);
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
                    <button className="icon-btn" disabled={n >= Math.min(have, remaining(r))} onClick={() => set(r, n + step)} aria-label={`More ${RESOURCES[r].name}`}>
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
          if (onSend(chosen)) setAmounts({});
        }}
      >
        <Icon name="gift" size={22} />
        {value > 0 ? `Send · +${reputationFor(value)} reputation` : 'Choose what to send'}
      </button>
      {pending > 0 ? <p className="small muted vp-pending">{pending === 1 ? 'A parcel is' : `${pending} parcels are`} on the road…</p> : null}
      <p className="small muted">Every {Math.round(1 / VALLEY_BALANCE.reputationPerValue)} timber’s worth earns 1 reputation. Stone, planks, bricks and Stew count for more.</p>
    </>
  );
}
