import { FESTIVALS } from '../../config/festivals';
import { playerId } from '../../game/persistence';
import type { ValleySnapshot } from '../../valley/types';
import { festivalFraction } from '../../valley/valleySim';
import { contributeToFestival, selectValleyBuilding } from '../actions';
import { Bar, Section } from '../common/Bits';
import { Icon } from '../common/Icon';
import { formatDuration, useGameState } from '../hooks';
import { DeliveryForm, MemberShares } from './Delivery';

/** The festival at the Festival Grounds: goal, deliveries, who helped, and the rewards. */
export function FestivalSection({ snapshot, serverNow }: { snapshot: ValleySnapshot; serverNow: number }) {
  const state = useGameState();
  const f = snapshot.festival;
  if (!f || (f.outcome !== 'running' && snapshot.nextFestivalAt !== null && serverNow > f.endsAt)) {
    return (
      <Section title="Festivals">
        <p className="small muted">{snapshot.nextFestivalAt !== null ? `The next festival begins in about ${formatDuration((snapshot.nextFestivalAt - serverNow) / 1000)}.` : 'Festivals will begin soon.'}</p>
      </Section>
    );
  }
  const def = FESTIVALS[f.kind];
  const mine = f.shares[playerId()] ?? 0;
  const pending = state.valley.outbox.filter((o) => o.target.kind === 'festival' && o.target.festivalId === f.id).length;
  const reward = `${Math.round(def.reward.coins * f.rewardMult)} coins, +${Math.round(def.reward.reputation * f.rewardMult)} reputation${def.decor ? ' and Festival Lanterns' : ''}`;
  return (
    <Section title={def.name} aside={f.outcome === 'running' ? <small className="muted">ends in {formatDuration((f.endsAt - serverNow) / 1000)}</small> : null}>
      <p className="vp-desc">{def.description}</p>
      {f.outcome === 'running' ? (
        <>
          <p className="small">
            <Icon name="gift" size={16} /> If the Valley meets the goal, everyone who helped gets {reward}.
          </p>
          <DeliveryForm resetKey={`festival:${f.id}`} cost={f.goal} delivered={f.delivered} pending={pending} onSend={(chosen) => contributeToFestival(chosen)} />
        </>
      ) : f.outcome === 'won' ? (
        <p className="vp-note festival-won">
          <Icon name="check" size={18} /> The festival was a triumph! {mine > 0 ? `Your share: ${reward}.` : 'Help next time to share the rewards.'}
        </p>
      ) : (
        <p className="vp-note">The festival ended before the goal was met. There will be another.</p>
      )}
      <MemberShares snapshot={snapshot} shares={f.shares} empty="Nobody has brought anything yet — get the party started!" />
    </Section>
  );
}

/** A banner in the Valley sidebar while a festival runs. */
export function FestivalCard({ snapshot, serverNow }: { snapshot: ValleySnapshot; serverNow: number }) {
  const f = snapshot.festival;
  if (!f || f.outcome !== 'running') return null;
  const def = FESTIVALS[f.kind];
  return (
    <button className="vs-festival" style={{ borderColor: def.color }} onClick={() => selectValleyBuilding('festivalGrounds', true)}>
      <Icon name="gift" size={22} />
      <span className="vs-research-text">
        <strong>{def.name}</strong>
        <small>{formatDuration((f.endsAt - serverNow) / 1000)} left · join in at Market Green</small>
        <Bar value={festivalFraction(f)} tone="honey" thin />
      </span>
    </button>
  );
}
