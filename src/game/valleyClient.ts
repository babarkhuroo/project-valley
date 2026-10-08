import type { ValleyBuildingId } from '../config/valley';
import type { ValleyResearchId } from '../config/valleyResearch';
import { isValleyUnlocked } from '../sim/modifiers';
import { claimFestival, joinValley, returnValleyOp, sendToFestival, sendToValley, setValleyBonuses, settleValleyOp, type ResourceAmounts } from '../sim/valley';
import type { ContributionResult, ValleyLogEntry, ValleySnapshot } from '../valley/types';
import { festivalRemaining, remainingFor, valleyBonuses } from '../valley/valleySim';
import { now } from './clock';
import type { Game } from './Game';
import { playerId } from './persistence';
import { apiFetch } from './session';

export type ValleyConnection = 'idle' | 'loading' | 'ready' | 'offline';

export interface ValleyView {
  snapshot: ValleySnapshot | null;
  connection: ValleyConnection;
  /** Server time of the snapshot, for "x minutes ago" and build countdowns. */
  fetchedAt: number;
  /** Local clock when it arrived, to extrapolate server time between polls. */
  receivedAt: number;
}

interface ServerView {
  valley: ValleySnapshot;
  memberId: string;
  now: number;
}

const POLL_MS = 45_000;
const POLL_VISITING_MS = 12_000;

/**
 * The client's window onto the server-owned Valley. It polls snapshots, joins when the
 * player first visits, flushes the village's delivery outbox (retrying until the
 * server confirms each op) and copies the Valley's bonuses into the village state.
 */
export class ValleyClient {
  private view: ValleyView = { snapshot: null, connection: 'idle', fetchedAt: 0, receivedAt: 0 };
  private readonly listeners = new Set<() => void>();
  private timer = 0;
  private flushing = false;
  private lastLogId: number | null = null;
  /** Set while the Valley scene is open, for faster polling. */
  visiting = false;
  /** New Valley log entries since the last poll (deliveries by others, finished builds…). */
  onLog: ((entries: ValleyLogEntry[], snapshot: ValleySnapshot) => void) | null = null;

  constructor(private readonly game: Game) {}

  get current(): ValleyView {
    return this.view;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<ValleyView>): void {
    this.view = { ...this.view, ...patch };
    for (const l of this.listeners) l();
  }

  start(): void {
    const loop = () => {
      void this.refresh();
      this.timer = window.setTimeout(loop, this.visiting ? POLL_VISITING_MS : POLL_MS);
    };
    loop();
  }

  stop(): void {
    window.clearTimeout(this.timer);
  }

  private apply(view: ServerView): void {
    const fresh = this.lastLogId === null ? [] : view.valley.log.filter((e) => e.id > this.lastLogId!);
    this.lastLogId = view.valley.log.reduce((m, e) => Math.max(m, e.id), this.lastLogId ?? 0);
    const f = view.valley.festival;
    this.game.mutate((state, _world, sink) => {
      if (state.valley.valleyId !== view.valley.id) joinValley(state, view.valley.id);
      setValleyBonuses(state, valleyBonuses(view.valley));
      // A festival the village helped win: collect the rewards (once).
      if (f && f.outcome === 'won' && (f.shares[view.memberId] ?? 0) > 0) claimFestival(state, f.id, f.kind, f.rewardMult, sink);
    });
    this.set({ snapshot: view.valley, connection: 'ready', fetchedAt: view.now, receivedAt: Date.now() });
    if (fresh.length > 0) this.onLog?.(fresh, view.valley);
  }

  /** Polls the Valley (when the village belongs to one) and retries pending deliveries. */
  async refresh(): Promise<void> {
    const state = this.game.state;
    if (!isValleyUnlocked(state)) return;
    if (!state.valley.valleyId && !this.visiting) return;
    if (!this.view.snapshot) this.set({ connection: 'loading' });
    try {
      const res = await apiFetch(`/api/valley/${playerId()}`, { cache: 'no-store' });
      if (res.status === 404) {
        // The village belongs to a Valley the server no longer knows (e.g. a wiped dev
        // server): found a new one rather than stranding the outbox.
        await this.join();
        return;
      }
      if (!res.ok) throw new Error(`valley ${res.status}`);
      this.apply((await res.json()) as ServerView);
      await this.flush();
    } catch {
      this.set({ connection: 'offline' });
    }
  }

  /** Joins (or re-finds) the player's Valley. */
  async join(): Promise<boolean> {
    const state = this.game.state;
    if (!isValleyUnlocked(state)) return false;
    this.set({ connection: this.view.snapshot ? this.view.connection : 'loading' });
    try {
      const res = await apiFetch(`/api/valley/${playerId()}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: state.player.name, villageName: state.player.villageName }),
      });
      if (!res.ok) throw new Error(`join ${res.status}`);
      this.apply((await res.json()) as ServerView);
      await this.flush();
      return true;
    } catch {
      this.set({ connection: 'offline' });
      return false;
    }
  }

  /**
   * Sends resources to a Valley project: they leave the village at once (outbox) and
   * the server's answer settles them. Returns a refusal reason, or null on success.
   */
  contribute(building: ValleyBuildingId, resources: ResourceAmounts): string | null {
    const b = this.view.snapshot?.buildings[building];
    if (!b) return 'The Valley is out of reach right now';
    const opId = `${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const result = this.game.run((state, _world, sink) => sendToValley(state, building, resources, opId, sink, remainingFor(b)));
    if (!result.ok) return result.error;
    void this.flush();
    return null;
  }

  /** Sends resources to the running festival. Returns a refusal reason, or null. */
  contributeFestival(resources: ResourceAmounts): string | null {
    const f = this.view.snapshot?.festival;
    if (!f || f.outcome !== 'running') return 'No festival is running right now';
    const opId = `${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const result = this.game.run((state, _world, sink) => sendToFestival(state, f.id, resources, opId, sink, festivalRemaining(f)));
    if (!result.ok) return result.error;
    void this.flush();
    return null;
  }

  /** Tells the Valley the player's current name and village name. */
  async syncProfile(): Promise<void> {
    const state = this.game.state;
    if (!state.valley.valleyId) return;
    try {
      const res = await apiFetch(`/api/valley/${playerId()}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: state.player.name, villageName: state.player.villageName }),
      });
      if (res.ok) this.apply((await res.json()) as ServerView);
    } catch {
      // The next join/refresh carries the names anyway.
    }
  }

  /** Votes for the Valley's next research project. Returns a refusal reason, or null. */
  async vote(research: ValleyResearchId): Promise<string | null> {
    try {
      const res = await apiFetch(`/api/valley/${playerId()}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ research }),
      });
      if (!res.ok) return 'That project can’t be chosen right now';
      this.apply((await res.json()) as ServerView);
      return null;
    } catch {
      this.set({ connection: 'offline' });
      return 'The Valley is out of reach right now';
    }
  }

  /** Delivers queued ops one at a time, oldest first. Network errors leave them queued. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      for (const op of [...this.game.state.valley.outbox]) {
        const res = await apiFetch(`/api/valley/${playerId()}/contribute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ opId: op.opId, target: op.target, resources: op.resources, knowledge: op.knowledge }),
        });
        if (res.status === 422) {
          this.game.mutate((state) => returnValleyOp(state, op.opId));
          continue;
        }
        if (!res.ok) break;
        const body = (await res.json()) as ServerView & { result: ContributionResult };
        const r = body.result;
        this.game.mutate((state, _world, sink) => settleValleyOp(state, op.opId, r.accepted, r.returned, r.reputation, sink));
        this.apply(body);
      }
    } catch {
      this.set({ connection: 'offline' });
    } finally {
      this.flushing = false;
    }
  }
}
