import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ValleySnapshot } from '../src/valley/types.ts';
import type { AuthService } from './auth.ts';
import type { ValleyService } from './valleyService.ts';
import { acceptWebSocket, type WsConnection } from './ws.ts';

/**
 * Live Valley updates over WebSockets (`/api/live?token=…`). Server → client only:
 * every change to a Valley (anyone's delivery, a vote, chat, a neighbour's visit
 * while members are connected) is pushed as a fresh snapshot to every connected
 * member, along with who is connected right now. Client actions keep using the HTTP
 * API, where they're validated and idempotent.
 *
 *   → { type: 'snapshot', memberId, now, valley }
 *   → { type: 'presence', online: string[] }
 *   ← { type: 'ping' }  → { type: 'pong' }
 */
export class LiveHub {
  private readonly connections = new Map<string, Set<WsConnection>>();
  private readonly valleyOf = new Map<string, string>();
  private readonly members = new Map<string, Set<string>>();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly valleys: ValleyService,
    private readonly auth: AuthService,
    options: { tickMs?: number } = {},
  ) {
    valleys.listeners.add((snap, now) => this.pushSnapshot(snap, now));
    valleys.membership.add((playerId, valleyId) => this.move(playerId, valleyId));
    // Keep connected Valleys moving so neighbours' parcels and builds show up live.
    this.timer = setInterval(() => void this.tick(), options.tickMs ?? 10_000);
    this.timer.unref?.();
  }

  /** Players connected to a Valley right now. */
  online(valleyId: string): string[] {
    return [...(this.members.get(valleyId) ?? [])];
  }

  async handleUpgrade(req: IncomingMessage, socket: Duplex): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const me = await this.auth.authenticate(url.searchParams.get('token'));
    if (!me) {
      socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return;
    }
    const conn = acceptWebSocket(req, socket);
    if (!conn) return;
    const id = me.playerId;
    let set = this.connections.get(id);
    if (!set) this.connections.set(id, (set = new Set()));
    set.add(conn);
    conn.onMessage = (text) => {
      try {
        if ((JSON.parse(text) as { type?: string }).type === 'ping') conn.send('{"type":"pong"}');
      } catch {
        // Ignore anything that isn't our JSON.
      }
    };
    conn.onClose = () => {
      const s = this.connections.get(id);
      s?.delete(conn);
      if (s && s.size === 0) {
        this.connections.delete(id);
        this.move(id, null);
      }
    };
    this.move(id, await this.valleys.valleyIdFor(id));
    // A fresh snapshot straight away, so the client needn't poll on connect.
    const view = await this.valleys.get(id);
    if (view && conn.isOpen) conn.send(JSON.stringify({ type: 'snapshot', ...view }));
  }

  /** Re-files a player under their (new) Valley and tells both Valleys who's here. */
  private move(playerId: string, valleyId: string | null): void {
    const before = this.valleyOf.get(playerId) ?? null;
    const connected = this.connections.has(playerId);
    const after = connected ? valleyId : null;
    if (before === after) return;
    if (before) {
      this.members.get(before)?.delete(playerId);
      if (this.members.get(before)?.size === 0) this.members.delete(before);
      this.valleyOf.delete(playerId);
      this.pushPresence(before);
    }
    if (after) {
      let m = this.members.get(after);
      if (!m) this.members.set(after, (m = new Set()));
      m.add(playerId);
      this.valleyOf.set(playerId, after);
      this.pushPresence(after);
    }
  }

  private sendTo(playerId: string, text: string): void {
    for (const c of this.connections.get(playerId) ?? []) if (c.isOpen) c.send(text);
  }

  private pushPresence(valleyId: string): void {
    const text = JSON.stringify({ type: 'presence', online: this.online(valleyId) });
    for (const id of this.members.get(valleyId) ?? []) this.sendTo(id, text);
  }

  private pushSnapshot(snap: ValleySnapshot, now: number): void {
    const ids = this.members.get(snap.id);
    if (!ids || ids.size === 0) return;
    // Serialise the Valley once; only memberId differs per recipient.
    const valley = JSON.stringify(snap);
    for (const id of ids) this.sendTo(id, `{"type":"snapshot","memberId":${JSON.stringify(id)},"now":${now},"valley":${valley}}`);
  }

  private async tick(): Promise<void> {
    for (const valleyId of [...this.members.keys()]) {
      try {
        await this.valleys.touch(valleyId);
      } catch {
        // A bad Valley file shouldn't stop the others.
      }
    }
  }

  close(): void {
    clearInterval(this.timer);
    for (const set of this.connections.values()) for (const c of set) c.close(1001);
  }
}
