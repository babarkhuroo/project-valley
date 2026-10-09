import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type pg from 'pg';

/**
 * Playtest data: notes players send with the feedback button, and — only for players
 * who agreed — progress events (milestones, time played) used to compare real pacing
 * with the autoplayer's. Nothing personal: players are random ids, notes are what they
 * typed. Read back through `GET /api/admin/playtest` with the ADMIN_TOKEN.
 */

export interface FeedbackRecord {
  playerId: string;
  at: number;
  mood: 'happy' | 'okay' | 'stuck' | null;
  text: string;
  /** Where the player was: level, villagers, tutorial step, minutes played… */
  context: Record<string, unknown>;
}

export interface ProgressEvent {
  playerId: string;
  /** Server time it arrived. */
  at: number;
  kind: string;
  /** Village sim time (seconds since founding) when it happened. */
  simTime: number;
  /** Minutes the player has actively had the game open. */
  playMinutes: number;
  data: Record<string, unknown>;
}

export interface PlaytestStore {
  addFeedback(f: FeedbackRecord): Promise<void>;
  addEvents(events: ProgressEvent[]): Promise<void>;
  feedback(limit: number): Promise<FeedbackRecord[]>;
  events(): Promise<ProgressEvent[]>;
}

export class MemoryPlaytestStore implements PlaytestStore {
  readonly notes: FeedbackRecord[] = [];
  readonly log: ProgressEvent[] = [];
  async addFeedback(f: FeedbackRecord): Promise<void> {
    this.notes.push(f);
  }
  async addEvents(events: ProgressEvent[]): Promise<void> {
    this.log.push(...events);
  }
  async feedback(limit: number): Promise<FeedbackRecord[]> {
    return this.notes.slice(-limit).reverse();
  }
  async events(): Promise<ProgressEvent[]> {
    return [...this.log];
  }
}

/** Append-only JSON-lines files (single process). */
export class FilePlaytestStore implements PlaytestStore {
  constructor(private readonly dir: string) {}
  private async append(file: string, rows: unknown[]): Promise<void> {
    if (rows.length === 0) return;
    await fs.mkdir(this.dir, { recursive: true });
    await fs.appendFile(path.join(this.dir, file), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  private async read<T>(file: string): Promise<T[]> {
    try {
      return (await fs.readFile(path.join(this.dir, file), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
    } catch {
      return [];
    }
  }
  addFeedback(f: FeedbackRecord): Promise<void> {
    return this.append('feedback.jsonl', [f]);
  }
  addEvents(events: ProgressEvent[]): Promise<void> {
    return this.append('progress.jsonl', events);
  }
  async feedback(limit: number): Promise<FeedbackRecord[]> {
    return (await this.read<FeedbackRecord>('feedback.jsonl')).slice(-limit).reverse();
  }
  events(): Promise<ProgressEvent[]> {
    return this.read<ProgressEvent>('progress.jsonl');
  }
}

export class PgPlaytestStore implements PlaytestStore {
  constructor(private readonly pool: pg.Pool) {}
  async addFeedback(f: FeedbackRecord): Promise<void> {
    await this.pool.query('INSERT INTO playtest_feedback (player_id, at, mood, text, context) VALUES ($1, $2, $3, $4, $5::jsonb)', [f.playerId, f.at, f.mood, f.text, JSON.stringify(f.context)]);
  }
  async addEvents(events: ProgressEvent[]): Promise<void> {
    if (events.length === 0) return;
    const values: unknown[] = [];
    const rows = events.map((e, i) => {
      values.push(e.playerId, e.at, e.kind, e.simTime, e.playMinutes, JSON.stringify(e.data));
      const o = i * 6;
      return `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6}::jsonb)`;
    });
    await this.pool.query(`INSERT INTO playtest_events (player_id, at, kind, sim_time, play_minutes, data) VALUES ${rows.join(', ')}`, values);
  }
  async feedback(limit: number): Promise<FeedbackRecord[]> {
    const { rows } = await this.pool.query<{ player_id: string; at: number; mood: FeedbackRecord['mood']; text: string; context: Record<string, unknown> }>(
      'SELECT player_id, at, mood, text, context FROM playtest_feedback ORDER BY at DESC LIMIT $1',
      [limit],
    );
    return rows.map((r) => ({ playerId: r.player_id, at: r.at, mood: r.mood, text: r.text, context: r.context }));
  }
  async events(): Promise<ProgressEvent[]> {
    const { rows } = await this.pool.query<{ player_id: string; at: number; kind: string; sim_time: number; play_minutes: number; data: Record<string, unknown> }>(
      'SELECT player_id, at, kind, sim_time, play_minutes, data FROM playtest_events ORDER BY at',
    );
    return rows.map((r) => ({ playerId: r.player_id, at: r.at, kind: r.kind, simTime: r.sim_time, playMinutes: r.play_minutes, data: r.data }));
  }
}

const MOODS = new Set(['happy', 'okay', 'stuck']);
const KIND = /^[a-zA-Z][a-zA-Z0-9:_-]{0,40}$/;
const MAX_EVENTS = 50;
const lastNote = new Map<string, number>();

/** Keeps only small, plain JSON values (strings, numbers, booleans) under a few keys. */
function cleanRecord(raw: unknown, maxKeys = 16): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw).slice(0, maxKeys)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 120);
  }
  return out;
}

function finite(n: unknown, fallback = 0): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/** POST /api/feedback — a note from a signed-in player (one a minute at most). */
export async function receiveFeedback(store: PlaytestStore, playerId: string, body: Record<string, unknown>, now = Date.now()): Promise<{ status: number; body: unknown }> {
  const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim().slice(0, 2000) : '';
  const mood = typeof body.mood === 'string' && MOODS.has(body.mood) ? (body.mood as FeedbackRecord['mood']) : null;
  if (!text && !mood) return { status: 400, body: { error: 'Write a note or pick how it’s going' } };
  if (now - (lastNote.get(playerId) ?? 0) < 60_000) return { status: 429, body: { error: 'Thanks! Give it a minute before sending another' } };
  lastNote.set(playerId, now);
  await store.addFeedback({ playerId, at: now, mood, text, context: cleanRecord(body.context, 24) });
  return { status: 200, body: { ok: true } };
}

/** POST /api/progress — a batch of progress events from a player who agreed to share them. */
export async function receiveProgress(store: PlaytestStore, playerId: string, body: Record<string, unknown>, now = Date.now()): Promise<{ status: number; body: unknown }> {
  const raw = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];
  const events: ProgressEvent[] = [];
  for (const e of raw as Record<string, unknown>[]) {
    if (!e || typeof e !== 'object' || typeof e.kind !== 'string' || !KIND.test(e.kind)) continue;
    events.push({ playerId, at: now, kind: e.kind, simTime: finite(e.simTime), playMinutes: finite(e.playMinutes), data: cleanRecord(e.data) });
  }
  await store.addEvents(events);
  return { status: 200, body: { stored: events.length } };
}

/** Whether a request carries the admin token (constant-time compare). No token configured: never. */
export function isAdmin(req: IncomingMessage, adminToken: string | undefined): boolean {
  if (!adminToken) return false;
  const h = req.headers.authorization;
  const given = h?.startsWith('Bearer ') ? h.slice(7).trim() : '';
  const a = Buffer.from(given);
  const b = Buffer.from(adminToken);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface PlaytestReport {
  players: number;
  sharing: number;
  feedback: FeedbackRecord[];
  /** Per milestone: how many players reached it, and the median sim minutes / play minutes it took. */
  milestones: { kind: string; label: string; players: number; medianSimMinutes: number; medianPlayMinutes: number }[];
  /** Per player: furthest level, buildings, minutes played, last seen. */
  roster: { playerId: string; level: number; buildings: number; playMinutes: number; lastSeen: number; events: number }[];
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Summarises progress the same way the autoplayer's pacing report does, but for real players. */
export async function playtestReport(store: PlaytestStore): Promise<PlaytestReport> {
  const events = await store.events();
  const feedback = await store.feedback(200);
  const byPlayer = new Map<string, ProgressEvent[]>();
  for (const e of events) {
    const list = byPlayer.get(e.playerId) ?? [];
    list.push(e);
    byPlayer.set(e.playerId, list);
  }
  // First time each player reached each milestone.
  const firsts = new Map<string, { label: string; sim: number[]; play: number[] }>();
  const roster: PlaytestReport['roster'] = [];
  for (const [playerId, list] of byPlayer) {
    const seen = new Set<string>();
    let level = 1;
    let buildings = 0;
    let playMinutes = 0;
    let lastSeen = 0;
    for (const e of list) {
      playMinutes = Math.max(playMinutes, e.playMinutes);
      lastSeen = Math.max(lastSeen, e.at);
      if (e.kind === 'levelUp') level = Math.max(level, finite(e.data.level, level));
      if (e.kind === 'built') buildings += 1;
      if (e.kind === 'heartbeat' || e.kind === 'session') continue;
      const key = `${e.kind}:${String(e.data.id ?? e.data.level ?? '')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = typeof e.data.label === 'string' ? e.data.label : key;
      const f = firsts.get(key) ?? { label, sim: [], play: [] };
      f.sim.push(e.simTime / 60);
      f.play.push(e.playMinutes);
      firsts.set(key, f);
    }
    roster.push({ playerId, level, buildings, playMinutes: Math.round(playMinutes), lastSeen, events: list.length });
  }
  const milestones = [...firsts.entries()]
    .map(([kind, f]) => ({ kind, label: f.label, players: f.sim.length, medianSimMinutes: Math.round(median(f.sim)), medianPlayMinutes: Math.round(median(f.play)) }))
    .sort((a, b) => a.medianSimMinutes - b.medianSimMinutes);
  return { players: new Set([...byPlayer.keys(), ...feedback.map((f) => f.playerId)]).size, sharing: byPlayer.size, feedback, milestones, roster: roster.sort((a, b) => b.lastSeen - a.lastSeen) };
}

export function sendJsonReply(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}
