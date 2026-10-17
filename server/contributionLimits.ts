import { BUILDINGS } from '../src/config/buildings.ts';
import { RESEARCH } from '../src/config/research.ts';
import { VALLEY_RESOURCES } from '../src/config/valley.ts';
import type { ResourceId } from '../src/config/resources.ts';
import type { ResourceBag } from '../src/valley/types.ts';

/**
 * What one village can plausibly bring to the Valley. Villages are simulated on the players'
 * phones, so the server can't check a delivery against the village itself; instead each
 * player has an allowance per resource that a real village never runs into: up to twice the
 * largest store any village can build at once, refilled at that rate every hour. A doctored
 * app can't finish a Valley project for everyone in one go; anything over the allowance is
 * returned to the village like any other surplus, so honest players never lose a thing.
 */
export function maxStore(r: ResourceId): number {
  let total = 0;
  for (const def of Object.values(BUILDINGS)) {
    const perCopy = Math.max(def.storage?.[r] ?? 0, ...(def.upgrades ?? []).map((u) => u.storage?.[r] ?? 0));
    if (perCopy === 0) continue;
    let copies = def.maxCount;
    for (const res of Object.values(RESEARCH)) for (const e of res.effects) if (e.type === 'maxCount' && e.building === def.id) copies += e.add;
    total += perCopy * copies;
  }
  let mult = 1;
  for (const res of Object.values(RESEARCH)) for (const e of res.effects) if (e.type === 'storage' && e.resources.includes(r)) mult *= e.mult;
  // Valley storehouses and feasts add a little more; round up generously.
  return Math.ceil(total * mult * 1.5);
}

const BURST: Partial<Record<ResourceId, number>> = Object.fromEntries(VALLEY_RESOURCES.map((r) => [r, 2 * maxStore(r)]));
// Grain for festivals and sowing rounds comes from Granaries and fields: the same rule.
BURST.grain = 2 * maxStore('grain');
const HOUR = 3_600_000;

export class ContributionAllowance {
  private readonly buckets = new Map<string, { level: Partial<Record<ResourceId, number>>; at: number }>();

  constructor(private readonly clock: () => number = Date.now) {}

  private bucket(playerId: string) {
    const now = this.clock();
    let b = this.buckets.get(playerId);
    if (!b) {
      b = { level: { ...BURST }, at: now };
      this.buckets.set(playerId, b);
    }
    // Refill: a full allowance per hour.
    const hours = (now - b.at) / HOUR;
    if (hours > 0) {
      for (const [r, cap] of Object.entries(BURST) as [ResourceId, number][]) b.level[r] = Math.min(cap, (b.level[r] ?? cap) + cap * hours);
      b.at = now;
    }
    return b;
  }

  /** Splits an offer into what fits the player's allowance now and the rest (to go home). */
  split(playerId: string, offer: ResourceBag): { within: ResourceBag; over: ResourceBag } {
    const b = this.bucket(playerId);
    const within: ResourceBag = {};
    const over: ResourceBag = {};
    for (const [r, n] of Object.entries(offer) as [ResourceId, number][]) {
      if (!n || n <= 0) continue;
      const room = r in BURST ? Math.floor(b.level[r] ?? 0) : n;
      const take = Math.min(n, room);
      if (take > 0) within[r as keyof ResourceBag] = take;
      if (n - take > 0) over[r as keyof ResourceBag] = n - take;
    }
    return { within, over };
  }

  /** Uses up allowance for what the Valley actually kept. */
  charge(playerId: string, accepted: ResourceBag): void {
    const b = this.bucket(playerId);
    for (const [r, n] of Object.entries(accepted) as [ResourceId, number][]) if (r in BURST && n > 0) b.level[r] = Math.max(0, (b.level[r] ?? 0) - n);
  }

  /** Once in a while: forget players whose allowance is full again. */
  prune(): void {
    if (this.buckets.size < 5_000) return;
    const now = this.clock();
    for (const [id, b] of this.buckets) if (now - b.at > HOUR) this.buckets.delete(id);
  }
}

/** Adds `extra` into `bag` (both resource bags). */
export function addInto(bag: ResourceBag, extra: ResourceBag): void {
  for (const [r, n] of Object.entries(extra) as [keyof ResourceBag, number][]) if (n > 0) bag[r] = (bag[r] ?? 0) + n;
}
