/**
 * Server-synchronised wall clock. Offline progress is measured against the server's
 * clock so changing the device time cannot fast-forward production.
 */
let offsetMs = 0;
let synced = false;

export function now(): number {
  return Date.now() + offsetMs;
}

export function isClockSynced(): boolean {
  return synced;
}

/** Aligns the local clock with a server timestamp observed mid-request. */
export function applyServerTime(serverNow: number, requestStart: number, requestEnd: number): void {
  const midpoint = (requestStart + requestEnd) / 2;
  offsetMs = serverNow - midpoint;
  synced = true;
}

export async function syncClock(): Promise<boolean> {
  try {
    const start = Date.now();
    const res = await fetch('/api/time', { cache: 'no-store' });
    const end = Date.now();
    if (!res.ok) return false;
    const body = (await res.json()) as { now: number };
    applyServerTime(body.now, start, end);
    return true;
  } catch {
    return false;
  }
}
