import { RESOURCES } from '../../config/resources';
import { VALLEY_BUILDINGS, VALLEY_RESOURCES } from '../../config/valley';
import { VALLEY_RESEARCH } from '../../config/valleyResearch';
import { FESTIVALS } from '../../config/festivals';
import type { ResourceBag, ValleyLogEntry, ValleySnapshot } from '../../valley/types';

export function memberName(snapshot: ValleySnapshot, id: string, me: string | null): string {
  if (id === me) return 'You';
  return snapshot.members.find((m) => m.id === id)?.name ?? 'A neighbour';
}

export function bagText(bag: ResourceBag): string {
  return [...VALLEY_RESOURCES, 'stew' as const, 'grain' as const].filter((r) => (bag[r] ?? 0) > 0)
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
    case 'left':
      return `${memberName(snapshot, e.member, me)} ${e.member === me ? 'left' : 'has left'} the Valley`;
    case 'movedOn':
      return `${memberName(snapshot, e.member, me)}’s family moved on, making room for new neighbours`;
    case 'returned':
      return `${memberName(snapshot, e.member, me)} is back in the Valley`;
    case 'knowledge':
      return `${memberName(snapshot, e.member, me)} brought ${e.amount} Valley Knowledge from trading`;
    case 'researched':
      return `The Valley finished researching ${VALLEY_RESEARCH[e.research].name}!`;
    case 'festivalStarted':
      return `The ${FESTIVALS[e.festival].name} has begun on Market Green!`;
    case 'festivalGift':
      return `${memberName(snapshot, e.member, me)} brought ${bagText(e.resources)} to the ${FESTIVALS[e.festival].name}`;
    case 'festivalWon':
      return `The ${FESTIVALS[e.festival].name} was a triumph!`;
    case 'festivalLost':
      return `The ${FESTIVALS[e.festival].name} ended before the goal was met`;
    case 'sowingOpened':
      return 'Sowing is open at the Goldfurrow Commons';
    case 'sown':
      return `${memberName(snapshot, e.member, me)} sowed ${e.grain} Grain at Goldfurrow`;
    case 'harvested':
      return e.villages > 0 ? `The Goldfurrow harvest is in: ${e.villages} ${e.villages === 1 ? 'village' : 'villages'} sowed, every grain came back ×${e.mult}` : 'Nobody sowed at Goldfurrow this time';
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
