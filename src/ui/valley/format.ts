import { RESOURCES } from '../../config/resources';
import { VALLEY_BUILDINGS, VALLEY_RESOURCES } from '../../config/valley';
import type { ResourceBag, ValleyLogEntry, ValleySnapshot } from '../../valley/types';

export function memberName(snapshot: ValleySnapshot, id: string, me: string | null): string {
  if (id === me) return 'You';
  return snapshot.members.find((m) => m.id === id)?.name ?? 'A neighbour';
}

export function bagText(bag: ResourceBag): string {
  return VALLEY_RESOURCES.filter((r) => (bag[r] ?? 0) > 0)
    .map((r) => `${bag[r]} ${RESOURCES[r].name}`)
    .join(' + ');
}

/** One line of Valley news, written warmly rather than as a ledger. */
export function describeLog(e: ValleyLogEntry, snapshot: ValleySnapshot, me: string | null): string {
  switch (e.kind) {
    case 'joined':
      return e.member === me ? `You joined ${snapshot.name}` : `${memberName(snapshot, e.member, me)} joined the Valley`;
    case 'delivery':
      return `${memberName(snapshot, e.member, me)} brought ${bagText(e.resources)} to the ${VALLEY_BUILDINGS[e.building].name}`;
    case 'started':
      return `Everything is in for the ${VALLEY_BUILDINGS[e.building].name} — builders are at work`;
    case 'finished':
      return e.level === 1 ? `The ${VALLEY_BUILDINGS[e.building].name} is restored!` : `The ${VALLEY_BUILDINGS[e.building].name} reached level ${e.level}!`;
    case 'opened':
      return `Work can begin on the ${VALLEY_BUILDINGS[e.building].name}`;
  }
}

export function agoText(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
