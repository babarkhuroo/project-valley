import { VALLEY_BUILDINGS, type ValleyBuildingId } from '../src/config/valley.ts';
import type { ResourceBag, ValleySnapshot, ValleyState } from '../src/valley/types.ts';
import { advanceValley, ageValley, contribute, contributeFestival, contributeKnowledge, createValley, snapshotOf, upgradeValley, voteResearch, type ContributeOutcome } from '../src/valley/valleySim.ts';
import { VALLEY_RESEARCH, type ValleyResearchId } from '../src/config/valleyResearch.ts';

/**
 * Persistence for shared Valleys. A file-backed store ships now; the multiplayer
 * milestone swaps in PostgreSQL behind the same interface (see ARCHITECTURE.md).
 */
export interface ValleyStore {
  valleyFor(playerId: string): Promise<string | null>;
  setMembership(playerId: string, valleyId: string): Promise<void>;
  load(valleyId: string): Promise<ValleyState | null>;
  save(valley: ValleyState): Promise<void>;
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
  async load(valleyId: string): Promise<ValleyState | null> {
    const raw = this.valleys.get(valleyId);
    return raw ? (JSON.parse(raw) as ValleyState) : null;
  }
  async save(valley: ValleyState): Promise<void> {
    this.valleys.set(valley.id, JSON.stringify(valley));
  }
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
  async join(playerId: string, name: string, villageName: string): Promise<ValleyView> {
    const existing = await this.get(playerId);
    if (existing) return existing;
    const now = this.clock();
    const valleyId = `v-${hashString(`${playerId}:${now}`).toString(16)}`;
    return this.locked(valleyId, async () => {
      const v = createValley(valleyId, hashString(valleyId), now, { id: playerId, name, villageName });
      await this.store.save(v);
      await this.store.setMembership(playerId, valleyId);
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
