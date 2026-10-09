import { useState } from 'react';
import { SOWING } from '../../config/sowing';
import { playerId } from '../../game/persistence';
import type { ValleySnapshot } from '../../valley/types';
import { harvestMult, sowers, sowingOpen } from '../../valley/valleySim';
import { selectValleyBuilding, sowAtGoldfurrow } from '../actions';
import { Bar, Section } from '../common/Bits';
import { Icon } from '../common/Icon';
import { formatDuration, useGameState } from '../hooks';
import { MemberShares } from './Delivery';

const x = (n: number) => `×${(Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, '')}`;

/** Goldfurrow's sowing round: put grain in together, take more home at the harvest. */
export function SowingSection({ snapshot, serverNow }: { snapshot: ValleySnapshot; serverNow: number }) {
  const state = useGameState();
  const me = playerId();
  const s = snapshot.sowing;
  const last = snapshot.harvests[snapshot.harvests.length - 1] ?? null;
  const lastLine = last ? (
    <p className="small muted">
      Last harvest: every grain came back {x(last.mult)}.{' '}
      {(last.yields[me] ?? 0) > 0 ? `Your share, ${last.yields[me]} Grain, came home.` : 'Sow next time to share in it.'}
    </p>
  ) : null;
  if (!s) {
    return (
      <Section title="Sowing">
        <p className="small muted">{snapshot.nextSowingAt !== null ? `The next sowing opens in about ${formatDuration(Math.max(0, snapshot.nextSowingAt - serverNow) / 1000)}.` : 'Sowing will begin soon.'}</p>
        {lastLine}
      </Section>
    );
  }
  const open = sowingOpen(s, serverNow);
  const mine = s.seed[me] ?? 0;
  const pending = state.valley.outbox.filter((o) => o.target.kind === 'sowing' && o.target.round === s.id).reduce((n, o) => n + (o.resources.grain ?? 0), 0);
  const mult = harvestMult(s);
  return (
    <Section
      title={open ? 'Sowing now' : 'The crop is growing'}
      aside={<small className="muted">{open ? `closes in ${formatDuration((s.closesAt - serverNow) / 1000)}` : `ripe in ${formatDuration(Math.max(0, s.ripeAt - serverNow) / 1000)}`}</small>}
    >
      <p className="small">
        <Icon name="grain" size={16} /> Every grain sown comes back <strong>{x(mult)}</strong> at the harvest — {x(SOWING.baseMult * s.returnMult)}, plus {x(SOWING.perVillage * s.returnMult).slice(1)} for each village that sows (up to {x(SOWING.maxMult * s.returnMult)}).{' '}
        {sowers(s) === 0 ? 'Nobody has sown yet.' : `${sowers(s)} ${sowers(s) === 1 ? 'village has' : 'villages have'} sown so far.`}
      </p>
      {!open ? (
        <Bar value={Math.min(1, (serverNow - s.closesAt) / Math.max(1, s.ripeAt - s.closesAt))} tone="green" label={mine > 0 ? `Your ${mine} Grain → about ${Math.floor(mine * mult)} at the harvest` : 'Growing'} />
      ) : (
        <SowForm sown={mine} pending={pending} grain={state.resources.grain} farming={state.research.completed.includes('fieldSowing')} mult={mult} />
      )}
      {lastLine}
      <MemberShares snapshot={snapshot} shares={s.seed} empty="No seed in the ground yet — be the first to sow!" />
    </Section>
  );
}

function SowForm({ sown, pending, grain, farming, mult }: { sown: number; pending: number; grain: number; farming: boolean; mult: number }) {
  const room = Math.max(0, SOWING.maxSeed - sown - pending);
  const most = Math.floor(Math.min(room, grain));
  const [amount, setAmount] = useState(0);
  const chosen = Math.min(amount || Math.min(most, 100), most);
  if (!farming && grain <= 0) {
    return <p className="vp-note"><Icon name="info" size={18} /> Grain comes from Grain Fields — research Field Sowing in your village, then bring a harvest here.</p>;
  }
  return (
    <div className="sow-form">
      <p className="small">
        You’ve sown {sown}{pending > 0 ? ` (+${pending} on the way)` : ''} of {SOWING.maxSeed} this round · {Math.floor(grain)} Grain at home.
      </p>
      {most > 0 ? (
        <>
          <label className="slider">
            <span>Seed</span>
            <input type="range" min={1} max={most} step={1} value={chosen} onChange={(e) => setAmount(Number(e.target.value))} />
          </label>
          <p className="small">
            {chosen} Grain now → about <strong>{Math.floor(chosen * mult)}</strong> at the harvest (more if more villages sow).
          </p>
          <button className="btn" onClick={() => sowAtGoldfurrow(chosen) && setAmount(0)}>
            <Icon name="grain" size={18} /> Sow {chosen} Grain
          </button>
        </>
      ) : (
        <p className="small muted">{room <= 0 ? 'Your village has sown all it can this round.' : 'No grain at home to sow.'}</p>
      )}
    </div>
  );
}

/** A note in the Valley sidebar while Goldfurrow is open for sowing. */
export function SowingCard({ snapshot, serverNow }: { snapshot: ValleySnapshot; serverNow: number }) {
  const s = snapshot.sowing;
  if (!s || !sowingOpen(s, serverNow)) return null;
  return (
    <button className="vs-festival" style={{ borderColor: '#d9a83a' }} onClick={() => selectValleyBuilding('goldfurrowCommons', true)}>
      <Icon name="grain" size={22} />
      <span className="vs-research-text">
        <strong>Sowing at Goldfurrow</strong>
        <small>
          {formatDuration((s.closesAt - serverNow) / 1000)} left · grain comes back {x(harvestMult(s))}
        </small>
        <Bar value={(serverNow - s.opensAt) / (s.closesAt - s.opensAt)} tone="honey" thin />
      </span>
    </button>
  );
}
