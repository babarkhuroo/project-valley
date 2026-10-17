import { describe, expect, it } from 'vitest';
import { MemoryValleyStore, ValleyService } from '../../server/valleyService.ts';
import { ContributionAllowance, maxStore } from '../../server/contributionLimits.ts';

const T0 = Date.UTC(2026, 9, 8, 12);
const HOUR = 3_600_000;
const me = { id: 'p-limits-0001', name: 'Wren', villageName: 'Thistledown' };

describe('Valley delivery allowance', () => {
  it('keeps what a real village could bring, returns the rest, and refills by the hour', async () => {
    let now = T0;
    const service = new ValleyService(new MemoryValleyStore(), () => now);
    expect((await service.create(me.id, me, { name: 'Test Dale', open: false })).ok).toBe(true);
    const allowance = 2 * maxStore('timber');
    // A doctored app offers far more Timber than any village can hold.
    const first = await service.contribute(me.id, 'hearthHall', { timber: 1_000_000 }, 'op-a');
    if (!first?.ok) throw new Error('delivery refused');
    const kept = first.result.accepted.timber ?? 0;
    expect(kept).toBeLessThanOrEqual(allowance);
    expect(kept + (first.result.returned.timber ?? 0)).toBe(1_000_000);
    // A retry gets the same answer and uses no more allowance.
    const again = await service.contribute(me.id, 'hearthHall', { timber: 1_000_000 }, 'op-a');
    expect(again?.ok && again.result).toEqual(first.result);
    if (kept === allowance) {
      const empty = await service.contribute(me.id, 'hearthHall', { timber: 50 }, 'op-b');
      expect(empty?.ok && empty.result.returned.timber).toBe(50);
      now += HOUR;
      const later = await service.contribute(me.id, 'hearthHall', { timber: 50 }, 'op-c');
      expect(later?.ok && (later.result.accepted.timber ?? 0) + (later.result.returned.timber ?? 0)).toBe(50);
    }
  });

  it('splits offers by what is left, charges only what was kept, and refills hourly', () => {
    let now = T0;
    const a = new ContributionAllowance(() => now);
    const cap = 2 * maxStore('timber');
    expect(a.split(me.id, { timber: cap + 30, stew: 5 })).toEqual({ within: { timber: cap, stew: 5 }, over: { timber: 30 } });
    a.charge(me.id, { timber: cap - 10 });
    expect(a.split(me.id, { timber: 25 })).toEqual({ within: { timber: 10 }, over: { timber: 15 } });
    now += HOUR / 2;
    expect(a.split(me.id, { timber: cap })).toEqual({ within: { timber: 10 + cap / 2 }, over: { timber: cap - 10 - cap / 2 } });
    now += 5 * HOUR;
    expect(a.split(me.id, { timber: cap }).over).toEqual({});
  });

  it('is far above what one village stores', () => {
    for (const r of ['timber', 'clay', 'stone', 'planks', 'bricks'] as const) expect(maxStore(r)).toBeGreaterThan(300);
  });
});
