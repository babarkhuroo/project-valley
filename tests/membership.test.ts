import { describe, expect, it } from 'vitest';
import { MemoryValleyStore, ValleyService } from '../server/valleyService.ts';
import { activeMembers, activePlayers, addPlayer, advanceValley, createValley, inviteCode, MAX_PLAYERS, removePlayer, TARGET_MEMBERS } from '../src/valley/valleySim';

const T0 = Date.UTC(2026, 9, 8, 12);
const HOUR = 3_600_000;
const p = (n: number) => ({ id: `p-player-${String(n).padStart(4, '0')}`, name: `Player ${n}`, villageName: `Village ${n}` });

describe('valley membership', () => {
  it('neighbours move on as players arrive and come back when they leave', () => {
    const v = createValley('v-m', 11, T0, p(1));
    expect(activeMembers(v)).toHaveLength(TARGET_MEMBERS);
    addPlayer(v, p(2), T0);
    addPlayer(v, p(3), T0);
    expect(activePlayers(v)).toHaveLength(3);
    expect(activeMembers(v)).toHaveLength(TARGET_MEMBERS);
    expect(v.log.filter((e) => e.kind === 'movedOn')).toHaveLength(2);
    removePlayer(v, p(2).id, T0 + HOUR);
    expect(activeMembers(v)).toHaveLength(TARGET_MEMBERS);
    expect(v.log.some((e) => e.kind === 'returned')).toBe(true);
    // A returning neighbour gets visits again.
    expect(v.members.filter((m) => m.kind === 'simulated' && m.leftAt === null).every((m) => m.nextVisitAt !== null)).toBe(true);
  });

  it('holds at most ten players, with no neighbours once there are eight', () => {
    const v = createValley('v-m', 12, T0, p(1));
    for (let i = 2; i <= MAX_PLAYERS; i++) expect(addPlayer(v, p(i), T0)).not.toBeNull();
    expect(addPlayer(v, p(99), T0)).toBeNull();
    expect(activeMembers(v).filter((m) => m.kind === 'simulated')).toHaveLength(0);
    expect(() => advanceValley(v, T0 + 24 * HOUR)).not.toThrow();
  });

  it('players who left can come back with their history', () => {
    const v = createValley('v-m', 13, T0, p(1));
    v.members.find((m) => m.id === p(1).id)!.lifetimeValue = 500;
    removePlayer(v, p(1).id, T0);
    expect(addPlayer(v, p(1), T0 + HOUR)!.lifetimeValue).toBe(500);
  });

  it('invite codes are short and unambiguous', () => {
    const code = inviteCode(123456);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(inviteCode(123456)).toBe(code);
    expect(inviteCode(123457)).not.toBe(code);
  });
});

describe('valley service: founding, joining, leaving', () => {
  it('founds, lists open Valleys, joins by code or from the list, and leaves', async () => {
    let now = T0;
    const service = new ValleyService(new MemoryValleyStore(), () => now);
    const made = await service.create(p(1).id, p(1), { name: 'Bramble Dale', open: true });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.view.valley.name).toBe('Bramble Dale');
    expect((await service.create(p(1).id, p(1), {})).ok).toBe(false);
    const secret = await service.create(p(2).id, p(2), { name: 'Hidden Hollow', open: false });
    if (!secret.ok) return;
    const list = await service.listOpen();
    expect(list.map((l) => l.name)).toEqual(['Bramble Dale']);
    expect((await service.joinExisting(p(3).id, p(3), { valleyId: secret.view.valley.id })).ok).toBe(false);
    const byCode = await service.joinExisting(p(3).id, p(3), { code: secret.view.valley.code.toLowerCase() });
    expect(byCode.ok && byCode.view.valley.id).toBe(secret.view.valley.id);
    const fromList = await service.joinExisting(p(4).id, p(4), { valleyId: made.view.valley.id });
    expect(fromList.ok).toBe(true);
    expect((await service.joinExisting(p(5).id, p(5), { code: 'NOPE00' })).ok).toBe(false);
    now += HOUR;
    expect(await service.leave(p(4).id)).toBe(true);
    expect(await service.get(p(4).id)).toBeNull();
    const after = (await service.get(p(1).id))!;
    expect(after.valley.members.find((m) => m.id === p(4).id)?.leftAt).toBe(now);
    expect((await service.contribute(p(4).id, 'hearthHall', { timber: 5 }, 'x'))).toBeNull();
  });
});
