import { describe, expect, it } from 'vitest';
import { acceptNewcomer, assignVillager, cancelUpgrade, jobSlots, placeBuilding, startUpgrade } from '../src/sim/commands';
import { completeConstruction } from '../src/sim/construction';
import { capacity } from '../src/sim/economy';
import { buildingStats } from '../src/sim/levels';
import { deserialize, SAVE_VERSION, serialize } from '../src/sim/save';
import { workRateBreakdown } from '../src/sim/villagerAI';
import { ensureMapNodes } from '../src/sim/world';
import { building, cloneGame, makeGame, villager } from './helpers';

function rich(h: ReturnType<typeof makeGame>) {
  h.state.resources = { timber: 2000, clay: 2000, stone: 2000, planks: 2000, bricks: 2000, stew: 40, knowledge: 0 };
  // Generous storage so costs above the starting caps are payable in tests.
}

describe('stone', () => {
  it('outcrops exist but need Stonecutting and a Stone Yard', () => {
    const h = makeGame();
    const rock = h.state.nodes.find((n) => n.kind === 'stone')!;
    expect(rock).toBeTruthy();
    let res = assignVillager(h.state, h.world, villager(h).id, { kind: 'gather', nodeId: rock.id }, h.events);
    expect(res.ok).toBe(false);
    h.state.research.completed.push('clayDigging', 'stonecutting');
    res = assignVillager(h.state, h.world, villager(h).id, { kind: 'gather', nodeId: rock.id }, h.events);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Stone Yard/);
  });

  it('quarrymen carry stone to the Stone Yard', () => {
    const h = makeGame();
    h.state.research.completed.push('clayDigging', 'stonecutting');
    h.state.resources.timber = 100;
    h.state.resources.clay = 50;
    const yard = placeBuilding(h.state, h.world, 'stoneYard', 44, 18, 0, h.events);
    if (!yard.ok) throw new Error(yard.error);
    completeConstruction(h.state, h.world, yard.value!, h.events);
    const rock = h.state.nodes.filter((n) => n.kind === 'stone').sort((a, b) => Math.hypot(a.x - 45, a.z - 19) - Math.hypot(b.x - 45, b.z - 19))[0];
    expect(assignVillager(h.state, h.world, villager(h).id, { kind: 'gather', nodeId: rock.id }, h.events).ok).toBe(true);
    h.run(120);
    expect(h.state.resources.stone).toBeGreaterThan(0);
    expect(h.state.resources.stone % 3).toBe(0);
  });
});

describe('building upgrades', () => {
  it('pays, keeps working while builders upgrade, then applies the new level', () => {
    const h = makeGame();
    const yard = building(h, 'timberYard');
    h.state.resources.timber = 110;
    h.state.resources.clay = 30;
    expect(capacity(h.state, 'timber')).toBe(120);
    expect(startUpgrade(h.state, h.world, yard.id, h.events).ok).toBe(true);
    expect(h.state.resources.timber).toBe(30);
    expect(yard.upgrade?.toLevel).toBe(2);
    // Storage keeps working at the old level during the upgrade.
    expect(capacity(h.state, 'timber')).toBe(120);
    expect(assignVillager(h.state, h.world, villager(h).id, { kind: 'construct', buildingId: yard.id }, h.events).ok).toBe(true);
    h.run(90);
    expect(yard.level).toBe(2);
    expect(yard.upgrade).toBeNull();
    expect(capacity(h.state, 'timber')).toBe(200);
    expect(h.events.some((e) => e.type === 'upgradeComplete')).toBe(true);
    expect(h.state.player.xp).toBe(20);
    expect(villager(h).job).toBeNull();
  });

  it('refuses without resources or research, and cancelling refunds', () => {
    const h = makeGame();
    const yard = building(h, 'timberYard');
    expect(startUpgrade(h.state, h.world, yard.id, h.events).ok).toBe(false);
    rich(h);
    yard.level = 2;
    const gated = startUpgrade(h.state, h.world, yard.id, h.events);
    expect(gated.ok).toBe(false);
    if (!gated.ok) expect(gated.error).toMatch(/Masonry/);
    yard.level = 1;
    const before = { ...h.state.resources };
    expect(startUpgrade(h.state, h.world, yard.id, h.events).ok).toBe(true);
    expect(cancelUpgrade(h.state, h.world, yard.id, h.events).ok).toBe(true);
    expect(h.state.resources).toEqual(before);
    expect(yard.upgrade).toBeNull();
  });

  it('a level 2 Cookhouse has two cook slots and a visible speed bonus', () => {
    const h = makeGame();
    const kitchen = building(h, 'cookhouse');
    expect(jobSlots(h.state, { kind: 'operate', buildingId: kitchen.id })).toBe(1);
    kitchen.level = 2;
    expect(jobSlots(h.state, { kind: 'operate', buildingId: kitchen.id })).toBe(2);
    expect(capacity(h.state, 'stew')).toBe(60);
    assignVillager(h.state, h.world, villager(h, 0).id, { kind: 'operate', buildingId: kitchen.id }, h.events);
    assignVillager(h.state, h.world, villager(h, 1).id, { kind: 'operate', buildingId: kitchen.id }, h.events);
    expect(villager(h, 0).job).not.toBeNull();
    expect(villager(h, 1).job).not.toBeNull();
    const { rate, factors } = workRateBreakdown(h.state, villager(h, 0), 'cook');
    expect(rate).toBeCloseTo(1.2);
    expect(factors.some((f) => f.label === 'Cookhouse level 2')).toBe(true);
  });

  it('extending the Founders’ Lodge makes room for a newcomer', () => {
    const h = makeGame();
    rich(h);
    h.state.research.completed.push('clayDigging', 'stonecutting', 'masonry');
    const lodge = building(h, 'lodge');
    expect(buildingStats('lodge', 1).housing).toBe(2);
    expect(startUpgrade(h.state, h.world, lodge.id, h.events).ok).toBe(true);
    assignVillager(h.state, h.world, villager(h).id, { kind: 'construct', buildingId: lodge.id }, h.events);
    h.run(200);
    expect(lodge.level).toBe(2);
    expect(h.state.newcomers?.length).toBe(3);
    expect(acceptNewcomer(h.state, h.world, 0, h.events).ok).toBe(true);
    expect(h.state.villagers.at(-1)!.homeId).toBe(lodge.id);
  });

  it('offline catch-up of an upgrade matches live play', () => {
    const h = makeGame();
    const yard = building(h, 'timberYard');
    h.state.resources.timber = 110;
    h.state.resources.clay = 30;
    startUpgrade(h.state, h.world, yard.id, h.events);
    assignVillager(h.state, h.world, villager(h, 0).id, { kind: 'construct', buildingId: yard.id }, h.events);
    assignVillager(h.state, h.world, villager(h, 1).id, { kind: 'construct', buildingId: yard.id }, h.events);
    const copy = cloneGame(h);
    h.run(300, 1 / 30);
    copy.run(300);
    expect(copy.state.buildings).toEqual(h.state.buildings);
    expect(copy.state.resources).toEqual(h.state.resources);
  });
});

describe('save migration', () => {
  it('migrates a v1 save and gives the old village its stone outcrops', () => {
    const h = makeGame();
    const v1 = JSON.parse(serialize(h.state));
    v1.schemaVersion = 1;
    delete v1.resources.stone;
    delete v1.resources.planks;
    delete v1.resources.bricks;
    for (const b of v1.buildings) {
      delete b.upgrade;
      delete b.craft;
    }
    v1.nodes = v1.nodes.filter((n: { kind: string }) => n.kind !== 'stone');
    const restored = deserialize(JSON.stringify(v1));
    expect(restored.schemaVersion).toBe(SAVE_VERSION);
    expect(restored.resources.stone).toBe(0);
    expect(restored.resources.planks).toBe(0);
    expect(restored.buildings.every((b) => b.upgrade === null && b.craft === null)).toBe(true);
    const added = ensureMapNodes(restored, h.world);
    expect(added).toBe(h.state.nodes.filter((n) => n.kind === 'stone').length);
    expect(ensureMapNodes(restored, h.world)).toBe(0);
    const ids = restored.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
