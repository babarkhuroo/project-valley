import { beforeAll, describe, expect, it } from 'vitest';
import { RESEARCH } from '../src/config/research';
import { runEconomySim, type PacingReport } from '../src/sim/economySim';

/**
 * Pacing guards, from the design brief: the opening must feel fast (frequent progress
 * in the first ten minutes, several real unlocks in the first hour) while the later
 * tiers must not collapse into the first sitting. Measured with the deterministic
 * autoplayer, which plays faster than a typical person — so these are upper bounds
 * for "fast enough" and lower bounds for "not too fast".
 */
let report: PacingReport;
const first = (label: string) => report.milestones.find((m) => m.label === label)?.t ?? Infinity;

beforeAll(() => {
  report = runEconomySim(4 * 3600);
});

describe('pacing', () => {
  it('is deterministic', () => {
    const again = runEconomySim(30 * 60);
    expect(again.milestones).toEqual(report.milestones.filter((m) => m.t <= 30 * 60));
  });

  it('the first ten minutes are packed', () => {
    expect(first('Academy')).toBeLessThan(5 * 60);
    expect(first('Village level 2')).toBeLessThan(12 * 60);
    expect(first('Villager #3 joins')).toBeLessThan(15 * 60);
    expect(report.milestones.filter((m) => m.t <= 10 * 60).length).toBeGreaterThanOrEqual(6);
  });

  it('the first hour brings several real unlocks', () => {
    const hour = report.milestones.filter((m) => m.t <= 3600);
    expect(hour.filter((m) => m.kind === 'build').length).toBeGreaterThanOrEqual(5);
    expect(hour.filter((m) => m.kind === 'research').length).toBeGreaterThanOrEqual(8);
    expect(first('Sawmill')).toBeLessThan(3600);
  });

  it('villagers stay busy and fed while there is something to do', () => {
    expect(report.hourly[0].blocked).toBeLessThan(0.1);
    expect(report.hourly[1].blocked).toBeLessThan(0.1);
    expect(report.hungryShare).toBeLessThan(0.05);
  });

  it('the whole village can be completed, and not in one sitting', () => {
    // A longer run: every research project and every building's last level are within reach of village play alone.
    const long = runEconomySim(9 * 3600);
    const done = long.milestones.filter((m) => m.kind === 'research');
    expect(done.length).toBe(Object.keys(RESEARCH).length);
    const last = Math.max(...long.milestones.filter((m) => m.kind === 'research' || m.kind === 'upgrade').map((m) => m.t));
    expect(last).toBeGreaterThan(5 * 3600);
    expect(last).toBeLessThan(9 * 3600);
    expect(long.milestones.some((m) => m.label === 'Bakery')).toBe(true);
  });

  it('the late tiers do not collapse into the first sitting', () => {
    expect(first('Village level 4')).toBeGreaterThan(25 * 60);
    expect(first('Village level 6')).toBeGreaterThan(90 * 60);
    expect(first('Quarry')).toBeGreaterThan(2 * 3600);
  });
});
