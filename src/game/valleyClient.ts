import type { ValleyBuildingId } from '../config/valley';
import type { ValleyResearchId } from '../config/valleyResearch';
import { isValleyUnlocked } from '../sim/modifiers';
import { claimFestival, claimHarvest, joinValley, leaveValley, returnValleyOp, sendToFestival, sendToSowing, sendToValley, setValleyBonuses, settleValleyOp, type ResourceAmounts } from '../sim/valley';
import { SOWING } from '../config/sowing';
import type { ChatMessage, ContributionResult, ValleyLogEntry, ValleySnapshot } from '../valley/types';
import { festivalRemaining, remainingFor, sowingOpen, valleyBonuses } from '../valley/valleySim';
import { now } from './clock';
import type { Game } from './Game';
import { playerId } from './persistence';
import { apiFetch, sessionToken } from './session';

export interface ValleyListing {
  id: string;
  name: string;
  players: number;
  neighbours: number;
  levels: number;
}

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
const POLL_LIVE_MS = 120_000;

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
  /** Members connected right now (live presence). Replaced, never mutated, so React can compare. */
  online: ReadonlySet<string> = new Set();
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
      void this.refresh().then(() => this.connectLive());
      // With a live link the server pushes changes; polling is only a safety net.
      this.timer = window.setTimeout(loop, this.live ? POLL_LIVE_MS : this.visiting ? POLL_VISITING_MS : POLL_MS);
    };
    loop();
  }

  // -------------------------------------------------------------------------
  // Live link (WebSocket): pushed snapshots and presence
  // -------------------------------------------------------------------------

  private ws: WebSocket | null = null;
  private retryMs = 1000;
  /** True while the WebSocket to the server is open. */
  live = false;

  private connectLive(): void {
    const token = sessionToken();
    if (this.ws || !token || !this.game.state.valley.valleyId || typeof WebSocket === 'undefined') return;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${scheme}://${location.host}/api/live?token=${encodeURIComponent(token)}`);
    this.ws = ws;
    ws.onopen = () => {
      this.live = true;
      this.retryMs = 1000;
    };
    ws.onmessage = (e: MessageEvent<string>) => {
      try {
        const msg = JSON.parse(e.data) as { type: string; online?: string[] } & ServerView;
        if (msg.type === 'snapshot') this.apply(msg);
        else if (msg.type === 'presence') {
          this.online = new Set(msg.online ?? []);
          for (const l of this.listeners) l();
        }
      } catch {
        // Ignore malformed pushes; the next poll catches up.
      }
    };
    ws.onclose = () => {
      this.ws = null;
      this.live = false;
      this.online = new Set();
      for (const l of this.listeners) l();
      if (!this.game.state.valley.valleyId) return;
      window.setTimeout(() => this.connectLive(), this.retryMs);
      this.retryMs = Math.min(30_000, this.retryMs * 2);
    };
  }

  private disconnectLive(): void {
    this.ws?.close();
    this.ws = null;
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
      // Goldfurrow harvests the village sowed into: its share comes home (once each).
      for (const h of view.valley.harvests ?? []) claimHarvest(state, h.id, h.yields[view.memberId] ?? 0, h.mult, sink);
    });
    const chat = this.lastChatId === null ? [] : (view.valley.chat ?? []).filter((m) => m.id > this.lastChatId!);
    this.lastChatId = (view.valley.chat ?? []).reduce((m, c) => Math.max(m, c.id), this.lastChatId ?? 0);
    this.set({ snapshot: view.valley, connection: 'ready', fetchedAt: view.now, receivedAt: Date.now() });
    if (fresh.length > 0) this.onLog?.(fresh, view.valley);
    if (chat.length > 0) this.onChat?.(chat, view.valley);
    this.connectLive();
  }

  private lastChatId: number | null = null;
  /** New chat messages since the last snapshot (not called for the first snapshot). */
  onChat: ((messages: ChatMessage[], snapshot: ValleySnapshot) => void) | null = null;

  /** Posts to the Valley chat. Returns a refusal reason, or null. */
  async sendChat(text: string): Promise<string | null> {
    try {
      const res = await this.post('chat', { text });
      const body = (await res.json()) as ServerView & { error?: string };
      if (!res.ok) return body.error ?? 'Message not sent';
      this.apply(body);
      return null;
    } catch {
      this.set({ connection: 'offline' });
      return 'The Valley is out of reach right now';
    }
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
        // Not (or no longer) in a Valley — left from another device, or the Valley is
        // gone. Parcels on the road come home; the player can pick a Valley again.
        if (state.valley.valleyId) this.game.mutate((s) => leaveValley(s));
        this.disconnectLive();
        this.set({ snapshot: null, connection: 'idle' });
        return;
      }
      if (!res.ok) throw new Error(`valley ${res.status}`);
      this.apply((await res.json()) as ServerView);
      await this.flush();
    } catch {
      this.set({ connection: 'offline' });
    }
  }

  private names() {
    const s = this.game.state;
    return { name: s.player.name, villageName: s.player.villageName };
  }

  private async post(path: string, body: unknown): Promise<Response> {
    return apiFetch(`/api/valley/${playerId()}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  /** Runs a join-style request; on success the village belongs to that Valley. Returns an error or null. */
  private async enter(path: string, body: unknown): Promise<string | null> {
    try {
      const res = await this.post(path, { ...this.names(), ...(body as object) });
      const reply = (await res.json()) as ServerView & { error?: string };
      if (!res.ok) return reply.error ?? 'That didn’t work';
      this.apply(reply);
      await this.flush();
      return null;
    } catch {
      this.set({ connection: 'offline' });
      return 'The Valley is out of reach right now';
    }
  }

  /** Founds a new Valley with simulated neighbours. */
  found(valleyName: string, open: boolean): Promise<string | null> {
    return this.enter('create', { valleyName, open });
  }

  joinByCode(code: string): Promise<string | null> {
    return this.enter('join', { code });
  }

  joinOpen(valleyId: string): Promise<string | null> {
    return this.enter('join', { valleyId });
  }

  /** Open Valleys with room. */
  async listOpen(): Promise<ValleyListing[] | null> {
    try {
      const res = await apiFetch('/api/valleys');
      if (!res.ok) return null;
      return ((await res.json()) as { valleys: ValleyListing[] }).valleys;
    } catch {
      return null;
    }
  }

  async leave(): Promise<boolean> {
    try {
      const res = await this.post('leave', {});
      if (!res.ok && res.status !== 404) return false;
    } catch {
      return false;
    }
    this.game.mutate((s) => leaveValley(s));
    this.disconnectLive();
    this.lastLogId = null;
    this.lastChatId = null;
    this.set({ snapshot: null, connection: 'idle' });
    return true;
  }

  async setOpen(open: boolean): Promise<void> {
    try {
      const res = await this.post('settings', { open });
      if (res.ok) this.apply((await res.json()) as ServerView);
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

  /** Server time now, extrapolated from the last snapshot. */
  serverNow(): number {
    return this.view.fetchedAt + (Date.now() - this.view.receivedAt);
  }

  /** Sows grain at Goldfurrow. Returns a refusal reason, or null. */
  contributeSowing(grain: number): string | null {
    const s = this.view.snapshot?.sowing ?? null;
    if (!s || !sowingOpen(s, this.serverNow())) return 'Sowing isn’t open at Goldfurrow right now';
    const pending = this.game.state.valley.outbox.filter((o) => o.target.kind === 'sowing' && o.target.round === s.id).reduce((n, o) => n + (o.resources.grain ?? 0), 0);
    const room = SOWING.maxSeed - (s.seed[playerId()] ?? 0) - pending;
    if (room <= 0) return `Your village has sown all it can this round (${SOWING.maxSeed})`;
    const opId = `${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const result = this.game.run((state, _world, sink) => sendToSowing(state, s.id, grain, opId, sink, room));
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
