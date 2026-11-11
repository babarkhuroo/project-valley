/**
 * Server-synchronised wall clock. Offline progress is measured against the server's
 * clock so changing the device time cannot fast-forward production.
 */
let offsetMs = 0;

export function now(): number {
  return Date.now() + offsetMs;
}

/** Aligns the local clock with a server timestamp observed mid-request. */
export function applyServerTime(serverNow: number, requestStart: number, requestEnd: number): void {
  const midpoint = (requestStart + requestEnd) / 2;
  offsetMs = serverNow - midpoint;
}
