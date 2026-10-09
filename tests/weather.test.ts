import { describe, expect, it } from 'vitest';
import { rainAt, showerIn, sinceShower } from '../src/rendering/weatherSchedule';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const t0 = Date.UTC(2026, 9, 1);

describe('weather schedule', () => {
  it('is a pure function of the clock', () => {
    for (let t = t0; t < t0 + DAY; t += 7 * MIN) expect(rainAt(t)).toBe(rainAt(t));
  });

  it('rains now and then, in showers of a few minutes', () => {
    let wet = 0;
    let samples = 0;
    const lengths = new Set<number>();
    for (let t = t0; t < t0 + 14 * DAY; t += MIN) {
      samples++;
      if (rainAt(t) > 0) wet++;
      const s = showerIn(t);
      if (s) lengths.add(Math.round((s.end - s.start) / MIN));
    }
    const share = wet / samples;
    expect(share).toBeGreaterThan(0.02);
    expect(share).toBeLessThan(0.12);
    for (const l of lengths) {
      expect(l).toBeGreaterThanOrEqual(6);
      expect(l).toBeLessThanOrEqual(14);
    }
  });

  it('builds up and eases off rather than switching on', () => {
    let s = null;
    for (let t = t0; !s; t += 45 * MIN) s = showerIn(t);
    expect(rainAt(s.start + 5_000)).toBeLessThan(0.05);
    expect(rainAt((s.start + s.end) / 2)).toBeCloseTo(s.peak, 5);
    expect(rainAt(s.end - 5_000)).toBeLessThan(0.05);
    expect(rainAt(s.end + 1)).toBe(0);
    expect(sinceShower(s.end + 90_000)).toBeCloseTo(90, 5);
  });
});
