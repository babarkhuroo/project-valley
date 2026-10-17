import type { IncomingMessage } from 'node:http';

/**
 * A fixed-window counter per key (an IP or a player id). Per process: with several server
 * processes each one counts on its own, which is fine for its job — slowing down scripted
 * abuse (mass guest sessions, password guessing from one address, invite-code scanning),
 * never limiting a real player.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  /** Counts one attempt; false when the key is over its limit for this window. */
  take(key: string): boolean {
    const now = this.clock();
    let h = this.hits.get(key);
    if (!h || h.resetAt <= now) {
      // Drop finished windows now and then so the map can't grow without bound.
      if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
      h = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, h);
    }
    h.count++;
    return h.count <= this.limit;
  }
}

/**
 * The caller's address. Behind Render's proxy the socket is the proxy, so the address it
 * appends (the last X-Forwarded-For entry) is the one to trust; earlier entries are whatever
 * the client claimed.
 */
export function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  const list = (Array.isArray(fwd) ? fwd.join(',') : fwd ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.at(-1) ?? req.socket?.remoteAddress ?? 'unknown';
}
