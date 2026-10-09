import { CHAT_BALANCE, VALLEY_BUILDINGS, type ValleyBuildingId } from '../src/config/valley.ts';
import type { ResourceBag, ValleySnapshot, ValleyState } from '../src/valley/types.ts';
import { activeMembers, postChat, activePlayers, addPlayer, advanceValley, ageValley, MAX_PLAYERS, removePlayer, contribute, contributeFestival, contributeKnowledge, createValley, snapshotOf, upgradeValley, voteResearch, type ContributeOutcome } from '../src/valley/valleySim.ts';
import { VALLEY_RESEARCH, type ValleyResearchId } from '../src/config/valleyResearch.ts';

/**
 * Persistence for shared Valleys: JSON files for a single process
 * (`server/saveStore.ts`), Postgres for several (`server/db/pgStores.ts`).
 */
export interface ValleyStore {
  valleyFor(playerId: string): Promise<string | null>;
  setMembership(playerId: string, valleyId: string): Promise<void>;
  clearMembership(playerId: string): Promise<void>;
  load(valleyId: string): Promise<ValleyState | null>;
  save(valley: ValleyState): Promise<void>;
  /** Open Valleys with room for another player, busiest first. */
  listOpen(limit: number): Promise<ValleyListing[]>;
  /** The Valley with this invite code (already upper-cased and trimmed). */
  findByCode(code: string): Promise<string | null>;
  /**
   * Runs `fn` holding this Valley's lock for every process that shares the store.
   * Single-process stores just run it: the service already serialises calls in-process.
   */
  lock<T>(valleyId: string, fn: () => Promise<T>): Promise<T>;
}

export interface ValleyListing {
  id: string;
  name: string;
  players: number;
  neighbours: number;
  /** Building levels restored so far — a feel for how established it is. */
  levels: number;
}

/** How a Valley shows in the "open Valleys" list (stores keep this next to the state). */
export function listingOf(v: ValleyState): ValleyListing & { open: boolean; code: string } {
  const players = activePlayers(v).length;
  return {
    id: v.id,
    name: v.name,
    players,
    neighbours: activeMembers(v).length - players,
    levels: Object.values(v.buildings).reduce((n, b) => n + b.level, 0),
    open: v.open,
    code: v.code,
  };
}

/** Listing for stores that scan every Valley (files, memory). */
export function rankOpen(all: (ValleyListing & { open: boolean })[], limit: number): ValleyListing[] {
  return all
    .filter((l) => l.open && l.players < MAX_PLAYERS)
    .sort((a, b) => b.players - a.players || b.levels - a.levels)
    .slice(0, limit)
    .map(({ id, name, players, neighbours, levels }) => ({ id, name, players, neighbours, levels }));
}

export class MemoryValleyStore implements ValleyStore {
  private readonly members = new Map<string, string>();
  private readonly valleys = new Map<string, string>();
  async valleyFor(playerId: string): Promise<string | null> {
    return this.members.get(playerId) ?? null;
  }
  async setMembership(playerId: string, valleyId: string): Promise<void> {
    this.members.set(playerId, valleyId);
  }
  async clearMembership(playerId: string): Promise<void> {
    this.members.delete(playerId);
  }
  async load(valleyId: string): Promise<ValleyState | null> {
    const raw = this.valleys.get(valleyId);
    return raw ? (JSON.parse(raw) as ValleyState) : null;
  }
  async save(valley: ValleyState): Promise<void> {
    this.valleys.set(valley.id, JSON.stringify(valley));
  }
  async listOpen(limit: number): Promise<ValleyListing[]> {
    return rankOpen([...this.valleys.values()].map((raw) => listingOf(JSON.parse(raw) as ValleyState)), limit);
  }
  async findByCode(code: string): Promise<string | null> {
    for (const raw of this.valleys.values()) {
      const v = JSON.parse(raw) as ValleyState;
      if (v.code === code) return v.id;
    }
    return null;
  }
  lock<T>(_valleyId: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}

export type JoinOutcome = { ok: true; view: ValleyView } | { ok: false; status: number; error: string };

export interface PlayerNames {
  name: string;
  villageName: string;
}

export interface ValleyView {
  valley: ValleySnapshot;
  memberId: string;
  now: number;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Server-authoritative Valley operations. Every call first advances the Valley to the
 * server's clock, and calls on the same Valley are serialised so concurrent members
 * can never overwrite each other's deliveries.
 */
export class ValleyService {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly lastChat = new Map<string, number>();
  /** Called after any change to a Valley (the live hub pushes it to connected members). */
  readonly listeners = new Set<(valley: ValleySnapshot, now: number) => void>();
  /** Called when a player joins or leaves a Valley (the live hub moves their connection). */
  readonly membership = new Set<(playerId: string, valleyId: string | null) => void>();

  constructor(
    private readonly store: ValleyStore,
    private readonly clock: () => number = Date.now,
  ) {}

  private async commit(v: ValleyState, notify = true): Promise<void> {
    await this.store.save(v);
    if (!notify || this.listeners.size === 0) return;
    const snap = snapshotOf(v);
    const now = this.clock();
    for (const l of this.listeners) l(snap, now);
  }

  private announce(playerId: string, valleyId: string | null): void {
    for (const l of this.membership) l(playerId, valleyId);
  }

  async valleyIdFor(playerId: string): Promise<string | null> {
    return this.store.valleyFor(playerId);
  }

  /** Brings a Valley up to now; tells listeners only if something happened (new log or chat). */
  async touch(valleyId: string): Promise<void> {
    await this.locked(valleyId, async () => {
      const v = await this.load(valleyId);
      if (!v) return;
      const before = v.nextLogId;
      advanceValley(v, this.clock());
      await this.commit(v, v.nextLogId !== before);
    });
  }

  /** A chat message from a member. Null when refused (not a member, empty, too fast). */
  async chat(playerId: string, text: string): Promise<ValleyView | null> {
    const valleyId = await this.store.valleyFor(playerId);
    if (!valleyId) return null;
    const now = this.clock();
    if (now - (this.lastChat.get(playerId) ?? 0) < CHAT_BALANCE.minGapMs) return null;
    return this.locked(valleyId, async () => {
      const v = await this.load(valleyId);
      if (!v) return null;
      advanceValley(v, now);
      if (!postChat(v, playerId, text, now)) return null;
      this.lastChat.set(playerId, now);
      await this.commit(v);
      return { valley: snapshotOf(v), memberId: playerId, now };
    });
  }

  /** Loads a Valley and brings it up to the current content version. */
  private async load(valleyId: string): Promise<ValleyState | null> {
    const v = await this.store.load(valleyId);
    if (v) upgradeValley(v, this.clock());
    return v;
  }

  private async locked<T>(valleyId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(valleyId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(() => this.store.lock(valleyId, fn));
    this.locks.set(valleyId, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(valleyId) === run) this.locks.delete(valleyId);
    }
  }

  /** The player's Valley, advanced to now; null when they haven't joined one. */
  async get(playerId: string): Promise<ValleyView | null> {
    const valleyId = await this.store.valleyFor(playerId);
    if (!valleyId) return null;
    return this.locked(valleyId, async () => {
      const v = await this.load(valleyId);
      if (!v) return null;
      const now = this.clock();
      const before = v.nextLogId;
      advanceValley(v, now);
      await this.commit(v, v.nextLogId !== before);
      return { valley: snapshotOf(v), memberId: playerId, now };
    });
  }

  /**
   * Joins the player to a Valley. Until matchmaking exists (milestone 4) every player
   * founds their own Valley, shared with simulated neighbours.
   */
  /** The player's Valley, or a newly founded one if they have none (single-player default). */
  async join(playerId: string, name: string, villageName: string): Promise<ValleyView> {
    const existing = await this.get(playerId);
    if (existing) return existing;
    const out = await this.create(playerId, { name, villageName }, {});
    if (!out.ok) throw new Error(out.error);
    return out.view;
  }

  /** Founds a new Valley (with neighbours) and makes the player its first member. */
  async create(playerId: string, names: PlayerNames, options: { name?: string; open?: boolean }): Promise<JoinOutcome> {
    if (await this.store.valleyFor(playerId)) return { ok: false, status: 409, error: 'Leave your Valley first' };
    const now = this.clock();
    const valleyId = `v-${hashString(`${playerId}:${now}:${Math.random()}`).toString(16)}`;
    return this.locked(valleyId, async () => {
      const v = createValley(valleyId, hashString(valleyId), now, { id: playerId, ...names }, options);
      await this.commit(v);
      await this.store.setMembership(playerId, valleyId);
      this.announce(playerId, valleyId);
      return { ok: true as const, view: { valley: snapshotOf(v), memberId: playerId, now } };
    });
  }

  /** Open Valleys with room, busiest first. */
  async listOpen(): Promise<ValleyListing[]> {
    return this.store.listOpen(30);
  }

  /** A Valley's latest committed state, without advancing or writing it (for other processes' pushes). */
  async peek(valleyId: string): Promise<ValleySnapshot | null> {
    const v = await this.load(valleyId);
    return v ? snapshotOf(v) : null;
  }

  /** Joins a Valley by invite code, or (if it is open) by id. */
  async joinExisting(playerId: string, names: PlayerNames, by: { code?: string; valleyId?: string }): Promise<JoinOutcome> {
    if (await this.store.valleyFor(playerId)) return { ok: false, status: 409, error: 'Leave your Valley first' };
    const valleyId = by.code ? await this.store.findByCode(by.code.trim().toUpperCase()) : (by.valleyId ?? null);
    if (!valleyId) return { ok: false, status: 404, error: 'No Valley has that code' };
    return this.locked(valleyId, async () => {
      const v = await this.load(valleyId);
      if (!v) return { ok: false as const, status: 404, error: 'That Valley no longer exists' };
      if (!by.code && !v.open) return { ok: false as const, status: 403, error: 'That Valley is invite-only' };
      const now = this.clock();
      advanceValley(v, now);
      if (!addPlayer(v, { id: playerId, ...names }, now)) return { ok: false as const, status: 409, error: 'That Valley is full' };
      await this.commit(v);
      await this.store.setMembership(playerId, valleyId);
      this.announce(playerId, valleyId);
      return { ok: true as const, view: { valley: snapshotOf(v), memberId: playerId, now } };
    });
  }

  /** Leaves the player's Valley. Their past contributions stay on its record. */
  async leave(playerId: string): Promise<boolean> {
    const valleyId = await this.store.valleyFor(playerId);
    if (!valleyId) return false;
    return this.locked(valleyId, async () => {
      const v = await this.load(valleyId);
      if (v) {
        const now = this.clock();
        advanceValley(v, now);
        removePlayer(v, playerId, now);
        await this.commit(v);
      }
      await this.store.clearMembership(playerId);
      this.announce(playerId, null);
      return true;
    });
  }

  /** Owner-ish settings: anyone in the Valley may open it up or close it. */
  async setOpen(playerId: string, open: boolean): Promise<ValleyView | null> {
    const valleyId = await this.store.valleyFor(playerId);
    if (!valleyId) return null;
    return this.locked(valleyId, async () => {
      const v = await this.load(valleyId);
      if (!v) return null;
      v.open = open;
      const now = this.clock();
      advanceValley(v, now);
      await this.commit(v);
      return { valley: snapshotOf(v), memberId: playerId, now };
    });
  }

  /** Development only: lets `ms` of Valley time pass instantly. */
  async devSkip(playerId: string, ms: number): Promise<ValleyView | null> {
    const valleyId = await this.store.valleyFor(playerId);
    if (!valleyId) return null;
    return this.locked(valleyId, async () => {
      const v = await this.load(valleyId);
      if (!v) return null;
      const now = this.clock();
      ageValley(v, ms);
      advanceValley(v, now);
      await this.commit(v);
      return { valley: snapshotOf(v), memberId: playerId, now };
    });
  }

  /** Valley Knowledge a member earned (trading). Idempotent per op id. */
  async knowledge(playerId: string, amount: number, opId: string): Promise<(ContributeOutcome & { view?: ValleyView }) | null> {
    const valleyId = await this.store.valleyFor(playerId);
    if (!valleyId) return null;
    return this.locked(valleyId, async () => {
      const v = await this.load(valleyId);
      if (!v) return null;
      const now = this.clock();
      advanceValley(v, now);
      const out = contributeKnowledge(v, playerId, amount, opId, now);
      await this.commit(v);
      return { ...out, view: { valley: snapshotOf(v), memberId: playerId, now } };
    });
  }

  /** A member's delivery to the running festival. */
  async festival(playerId: string, festivalId: number, resources: ResourceBag, opId: string): Promise<(ContributeOutcome & { view?: ValleyView }) | null> {
    const valleyId = await this.store.valleyFor(playerId);
    if (!valleyId) return null;
    return this.locked(valleyId, async () => {
      const v = await this.load(valleyId);
      if (!v) return null;
      const now = this.clock();
      advanceValley(v, now);
      const out = contributeFestival(v, playerId, festivalId, resources, opId);
      await this.commit(v);
      return { ...out, view: { valley: snapshotOf(v), memberId: playerId, now } };
    });
  }

  /** Keeps a member's name and village name current. */
  async profile(playerId: string, name: string, villageName: string): Promise<ValleyView | null> {
    const valleyId = await this.store.valleyFor(playerId);
    if (!valleyId) return null;
    return this.locked(valleyId, async () => {
      const v = await this.load(valleyId);
      if (!v) return null;
      const m = v.members.find((x) => x.id === playerId);
      if (!m) return null;
      m.name = name.slice(0, 24) || m.name;
      m.villageName = villageName.slice(0, 28) || m.villageName;
      const now = this.clock();
      advanceValley(v, now);
      await this.commit(v);
      return { valley: snapshotOf(v), memberId: playerId, now };
    });
  }

  /** A member's vote for the next Valley research project. */
  async vote(playerId: string, research: string): Promise<ValleyView | null> {
    if (!(research in VALLEY_RESEARCH)) return null;
    const valleyId = await this.store.valleyFor(playerId);
    if (!valleyId) return null;
    return this.locked(valleyId, async () => {
      const v = await this.load(valleyId);
      if (!v) return null;
      const now = this.clock();
      advanceValley(v, now);
      if (!voteResearch(v, playerId, research as ValleyResearchId)) return null;
      await this.commit(v);
      return { valley: snapshotOf(v), memberId: playerId, now };
    });
  }

  async contribute(playerId: string, building: string, resources: ResourceBag, opId: string): Promise<(ContributeOutcome & { view?: ValleyView }) | null> {
    const valleyId = await this.store.valleyFor(playerId);
    if (!valleyId) return null;
    if (!(building in VALLEY_BUILDINGS)) return { ok: false, reason: 'Unknown Valley building' };
    return this.locked(valleyId, async () => {
      const v = await this.load(valleyId);
      if (!v) return null;
      const now = this.clock();
      advanceValley(v, now);
      const out = contribute(v, playerId, building as ValleyBuildingId, resources, opId, now);
      await this.commit(v);
      return { ...out, view: { valley: snapshotOf(v), memberId: playerId, now } };
    });
  }
}
