import { describe, expect, it } from 'vitest';
import { BASE_BOOST_ORDER, BOOSTS, BOOST_ORDER } from '../src/config/trade';
import { NEWCOMER_NAMES } from '../src/config/villagers';
import { BUILDINGS } from '../src/config/buildings';
import { RESEARCH_IDS, RESEARCH, MAX_RESEARCH_TIER } from '../src/config/research';
import { autoplayStep } from '../src/sim/autoplay';
import { addHerbs, brew, brewBlocker, brewSeconds, herbs, settleBrewing, BREWING } from '../src/sim/brewing';
import { chestsPending, ensureChests, openChest } from '../src/sim/chests';
import { capacity } from '../src/sim/economy';
import { maxLevel, upgradeBlocker } from '../src/sim/levels';
import { levelForXp } from '../src/config/balance';
import { ensureRequests, fulfilRequest, REQUESTS, skipRequest } from '../src/sim/requests';
import { boostFor } from '../src/sim/trade';
import { TRAITS, traitForName } from '../src/sim/traits';
import { workRate } from '../src/sim/villagerAI';
import { ensureWilds, gatherWild, WILDS } from '../src/sim/wilds';
import type { SimEvent } from '../src/sim/events';
import { cloneGame, makeGame } from './helpers';

describe('requests board', () => {
  it('opens at level 3 with requests the village can store, pays, and pauses before the next', () => {
    const { state } = makeGame();
    state.player.level = 2;
    ensureRequests(state);
    expect(state.requests).toBeUndefined();
    state.player.level = 3;
    ensureRequests(state);
    expect(state.requests!.slots).toHaveLength(REQUESTS.slots);
    for (const r of state.requests!.slots) for (const [res, n] of Object.entries(r.wants)) expect(n).toBeLessThanOrEqual(capacity(state, res as never));
    const r = state.requests!.slots[0];
    for (const [res, n] of Object.entries(r.wants)) state.resources[res as 'timber'] = n! + 5;
    const coins = state.trade.coins;
    const sink: SimEvent[] = [];
    expect(fulfilRequest(state, r.id, sink).ok).toBe(true);
    expect(state.trade.coins).toBe(coins + r.coins);
    expect(state.requests!.slots[0].readyAt).toBe(state.time + REQUESTS.nextAfterFulfil);
    expect(skipRequest(state, state.requests!.slots[1].id).ok).toBe(true);
    expect(state.requests!.slots[1].readyAt).toBe(state.time + REQUESTS.nextAfterSkip);
  });
});

describe('wild finds and chests', () => {
  it('grow on open ground and come back elsewhere after gathering', () => {
    const { state, world } = makeGame();
    ensureWilds(state, world);
    expect(state.wilds!.spots).toHaveLength(WILDS.spots);
    const spot = state.wilds!.spots[0];
    const xp = state.player.xp;
    expect(gatherWild(state, world, spot.id, []).ok).toBe(true);
    expect(state.player.xp).toBe(xp + 2);
    expect(state.wilds!.spots.some((s) => s.id === spot.id)).toBe(false);
    expect(state.wilds!.spots).toHaveLength(WILDS.spots);
  });

  it('count levels from when they began', () => {
    const { state } = makeGame();
    state.player.level = 4;
    ensureChests(state);
    expect(chestsPending(state)).toBe(0);
    state.player.level = 6;
    expect(chestsPending(state)).toBe(2);
    const opened = openChest(state, []);
    expect(opened.ok && opened.value?.level).toBe(5);
    expect(chestsPending(state)).toBe(1);
  });
});

describe('brewing and tonic strengths', () => {
  it('every tonic has Strong and Grand brews', () => {
    expect(BASE_BOOST_ORDER).toHaveLength(6);
    expect(BOOST_ORDER).toHaveLength(18);
    expect(BOOSTS.woodTonicGrand).toMatchObject({ mult: 2, seconds: 3600, name: 'Grand Woodworker Tonic' });
    expect(BOOSTS.woodTonicGrand.description).toContain('+100%');
  });

  it('a brew takes its ingredients and arrives in the satchel', () => {
    const { state } = makeGame();
    state.player.level = BREWING.unlockLevel;
    expect(brewBlocker(state, 'woodTonic', 1)).toMatch(/herbs/);
    addHerbs(state, 5);
    state.resources.timber = 100;
    state.resources.stew = 30;
    expect(brewBlocker(state, 'woodTonic', 2)).toBe('Needs a level 2 Cookhouse');
    expect(brew(state, 'woodTonic', 1).ok).toBe(true);
    expect([herbs(state), state.resources.timber, state.resources.stew]).toEqual([3, 85, 20]);
    state.time += brewSeconds(1);
    const sink: SimEvent[] = [];
    settleBrewing(state, sink);
    expect(sink).toContainEqual({ type: 'tonicBrewed', tonic: 'woodTonic' });
    expect(state.trade.inventory.woodTonic).toBe(1);
  });

  it('only the strongest tonic for a job counts', () => {
    const { state } = makeGame();
    state.trade.active.push({ boost: 'woodTonic', until: 9999 }, { boost: 'woodTonicGrand', until: 9999 });
    expect(boostFor(state, 'chop')).toEqual({ mult: 2, names: ['Grand Woodworker Tonic'] });
  });
});

describe('sixth research tier and later levels', () => {
  it('opens building levels behind research and village level', () => {
    expect(MAX_RESEARCH_TIER).toBe(6);
    expect(RESEARCH_IDS.filter((id) => RESEARCH[id].tier === 6)).toHaveLength(6);
    expect(maxLevel('timberYard')).toBe(5);
    expect(maxLevel('sawmill')).toBe(3);
    expect(levelForXp(14000)).toBe(10);
    const { state } = makeGame();
    const yard = state.buildings.find((b) => b.defId === 'timberYard')!;
    yard.level = 3;
    expect(upgradeBlocker(state, yard)).toBe('needs-research:grandYards');
    state.research.completed.push('grandYards');
    expect(upgradeBlocker(state, yard)).toBe('Reach village level 7');
    expect(BUILDINGS.timberYard.upgrades).toHaveLength(4);
  });
});

describe('villager traits', () => {
  it('every name has one lasting trait, and all of them turn up', () => {
    expect(traitForName('Wren')).toBe(traitForName('Wren'));
    expect(new Set(NEWCOMER_NAMES.map((n) => traitForName(n).id)).size).toBe(TRAITS.length);
  });

  it('a trait scales its villager’s own work', () => {
    const { state } = makeGame();
    const v = state.villagers[0];
    v.name = NEWCOMER_NAMES.find((n) => traitForName(n).id === 'woodsy')!;
    const chop = workRate(state, v, 'chop');
    v.name = NEWCOMER_NAMES.find((n) => traitForName(n).id === 'bookish')!;
    expect(chop).toBeCloseTo(workRate(state, v, 'chop') * 1.25, 9);
  });

  it('time away still equals play with traits', () => {
    const h = makeGame();
    h.state.tutorial.skipped = true;
    for (let i = 0; i < 240; i++) {
      autoplayStep(h.state, h.world, h.events);
      h.run(15);
    }
    const copy = cloneGame(h);
    h.run(7200);
    copy.run(7200, 1);
    expect(JSON.parse(JSON.stringify(copy.state))).toEqual(JSON.parse(JSON.stringify(h.state)));
  });
});
