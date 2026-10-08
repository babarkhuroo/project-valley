import { describe, expect, it } from 'vitest';
import { markIntroSeen, nextIntro, seedIntros } from '../src/game/intros';
import { migrate, SAVE_VERSION } from '../src/sim/save';
import { makeGame } from './helpers';

describe('feature introductions', () => {
  it('wait for the opening tutorial, then introduce one new system at a time', () => {
    const h = makeGame();
    h.state.research.completed.push('clayDigging', 'stonecutting');
    expect(nextIntro(h.state, null)).toBeNull();
    h.state.tutorial.done = true;
    expect(nextIntro(h.state, null)?.id).toBe('clay');
    markIntroSeen(h.state, 'clay');
    expect(nextIntro(h.state, null)?.id).toBe('stone');
    markIntroSeen(h.state, 'stone');
    // Upgrades are open from the start (the Timber Yard needs no research).
    expect(nextIntro(h.state, null)?.id).toBe('upgrades');
    markIntroSeen(h.state, 'upgrades');
    expect(nextIntro(h.state, null)).toBeNull();
    h.state.trade.inventory.woodTonic = 1;
    expect(nextIntro(h.state, null)?.id).toBe('tonics');
  });

  it('existing villages start with what they already use marked as introduced', () => {
    const h = makeGame();
    h.state.tutorial = { step: 9, done: true, skipped: false, intros: null };
    h.state.research.completed.push('clayDigging', 'carpentry', 'valleyRoad');
    seedIntros(h.state);
    expect(h.state.tutorial.intros).toEqual(expect.arrayContaining(['clay', 'workshops', 'valley']));
    expect(nextIntro(h.state, null)).toBeNull();
    h.state.research.completed.push('stonecutting');
    expect(nextIntro(h.state, null)?.id).toBe('stone');
  });

  it('Valley-side introductions use the snapshot', () => {
    const h = makeGame();
    h.state.tutorial.done = true;
    h.state.tutorial.intros = ['upgrades'];
    const snap = { buildings: { greatLibrary: { level: 1 } }, festival: { outcome: 'running' } } as never;
    expect(nextIntro(h.state, snap)?.id).toBe('valleyResearch');
    markIntroSeen(h.state, 'valleyResearch');
    expect(nextIntro(h.state, snap)?.id).toBe('festivals');
  });

  it('migrates version-9 saves to be seeded on load', () => {
    const out = migrate({ schemaVersion: 9, tutorial: { step: 3, done: false, skipped: false } });
    expect(out.schemaVersion).toBe(SAVE_VERSION);
    expect((out.tutorial as { intros: unknown }).intros).toBeNull();
  });
});
