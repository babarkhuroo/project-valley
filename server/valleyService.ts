import { VALLEY_BUILDINGS, type ValleyBuildingId } from '../src/config/valley.ts';
import type { ResourceBag, ValleySnapshot, ValleyState } from '../src/valley/types.ts';
import { activeMembers, activePlayers, addPlayer, advanceValley, ageValley, MAX_PLAYERS, removePlayer, contribute, contributeFestival, contributeKnowledge, createValley, snapshotOf, upgradeValley, voteResearch, type ContributeOutcome } from '../src/valley/valleySim.ts';
import { VALLEY_RESEARCH, type ValleyResearchId } from '../src/config/valleyResearch.ts';

/**
 * Persistence for shared Valleys. A file-backed store ships now; the multiplayer
 * milestone swaps in PostgreSQL behind the same interface (see ARCHITECTURE.md).
 */
export interface ValleyStore {
  valleyFor(playerId: string): Promise<string | null>;
  setMembership(playerId: string, valleyId: string): Promise<void>;
  clearMembership(playerId: string): Promise<void>;
  load(valleyId: string): Promise<ValleyState | null>;
  save(valley: ValleyState): Promise<void>;
  /** Every Valley id (for browsing open Valleys and finding invite codes). */
  list(): Promise<string[]>;
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
  async list(): Promise<string[]> {
    return [...this.valleys.keys()];
  }
  async load(valleyId: string): Promise<ValleyState | null> {
    const raw = this.valleys.get(valleyId);
    return raw ? (JSON.parse(raw) as ValleyState) : null;
  }
  async save(valley: ValleyState): Promise<void> {
    this.valleys.set(valley.id, JSON.stringify(valley));
  }
}

export interface ValleyListing {
  id: string;
  name: string;
  players: number;
  neighbours: number;
  /** Building levels restored so far — a feel for how established it is. */
  levels: number;
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

  constructor(
    private readonly store: ValleyStore,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Loads a Valley and brings it up to the current content version. */
  private async load(valleyId: string): Promise<ValleyState | null> {
    const v = await this.store.load(valleyId);
    if (v) upgradeValley(v, this.clock());
    return v;
  }

  private async locked<T>(valleyId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(valleyId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(fn);
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
      advanceValley(v, now);
      await this.store.save(v);
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
      await this.store.save(v);
      await this.store.setMembership(playerId, valleyId);
      return { ok: true as const, view: { valley: snapshotOf(v), memberId: playerId, now } };
    });
  }

  /** Open Valleys with room, busiest first. */
  async listOpen(): Promise<ValleyListing[]> {
    const out: ValleyListing[] = [];
    for (const id of await this.store.list()) {
      const v = await this.load(id);
      if (!v || !v.open) continue;
      const players = activePlayers(v).length;
      if (players >= MAX_PLAYERS) continue;
      out.push({ id: v.id, name: v.name, players, neighbours: activeMembers(v).length - players, levels: Object.values(v.buildings).reduce((n, b) => n + b.level, 0) });
    }
    return out.sort((a, b) => b.players - a.players || b.levels - a.levels).slice(0, 30);
  }

  private async findByCode(code: string): Promise<string | null> {
    const want = code.trim().toUpperCase();
    for (const id of await this.store.list()) {
      const v = await this.load(id);
      if (v?.code === want) return id;
    }
    return null;
  }

  /** Joins a Valley by invite code, or (if it is open) by id. */
  async joinExisting(playerId: string, names: PlayerNames, by: { code?: string; valleyId?: string }): Promise<JoinOutcome> {
    if (await this.store.valleyFor(playerId)) return { ok: false, status: 409, error: 'Leave your Valley first' };
    const valleyId = by.code ? await this.findByCode(by.code) : (by.valleyId ?? null);
    if (!valleyId) return { ok: false, status: 404, error: 'No Valley has that code' };
    return this.locked(valleyId, async () => {
      const v = await this.load(valleyId);
      if (!v) return { ok: false as const, status: 404, error: 'That Valley no longer exists' };
      if (!by.code && !v.open) return { ok: false as const, status: 403, error: 'That Valley is invite-only' };
      const now = this.clock();
      advanceValley(v, now);
      if (!addPlayer(v, { id: playerId, ...names }, now)) return { ok: false as const, status: 409, error: 'That Valley is full' };
      await this.store.save(v);
      await this.store.setMembership(playerId, valleyId);
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
        await this.store.save(v);
      }
      await this.store.clearMembership(playerId);
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
      await this.store.save(v);
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
      await this.store.save(v);
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
      await this.store.save(v);
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
      await this.store.save(v);
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
      await this.store.save(v);
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
      await this.store.save(v);
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
      await this.store.save(v);
      return { ...out, view: { valley: snapshotOf(v), memberId: playerId, now } };
    });
  }
}
