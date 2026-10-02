import { describe, expect, it } from 'vitest';
import { acceptNewcomer, assignVillager, placeBuilding, setActiveResearch } from '../src/sim/commands';
import { checkFootprint, completeConstruction } from '../src/sim/construction';
import { capacity } from '../src/sim/economy';
import { housingCapacity } from '../src/sim/population';
import { practiceSkill } from '../src/sim/progression';
import { practiceCap } from '../src/sim/modifiers';
import { researchStatus } from '../src/sim/research';
import { estimateJob } from '../src/sim/selectors';
import { villagerPosition } from '../src/sim/villagerAI';
import type { BuildingId } from '../src/config/buildings';
import { makeGame, villager, type Harness } from './helpers';

function build(h: Harness, defId: BuildingId, near: [number, number]) {
  Object.assign(h.state.resources, { timber: 999, clay: 999, stone: 999, planks: 999, bricks: 999 });
  for (let r = 0; r < 10; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!checkFootprint(h.world, defId, near[0] + dx, near[1] + dz, 0).ok) continue;
        const res = placeBuilding(h.state, h.world, defId, near[0] + dx, near[1] + dz, 0, h.events);
        if (!res.ok) throw new Error(res.error);
        completeConstruction(h.state, h.world, res.value!, h.events);
        return res.value!;
      }
    }
  }
  throw new Error(`no room for ${defId}`);
}

describe('tier 4–5 research', () => {
  it('opens with village level 4 and 5', () => {
    const h = makeGame();
    h.state.research.completed.push('cottageCraft', 'growingHamlet', 'villageCommons', 'carpentry', 'clayDigging', 'brickmaking', 'sharpAxes', 'woodlandTending');
    h.state.player.level = 3;
    expect(researchStatus(h.state, 'woodlots')).toBe('locked-level');
    expect(setActiveResearch(h.state, h.world, 'woodlots', h.events).ok).toBe(false);
    h.state.player.level = 4;
    expect(researchStatus(h.state, 'woodlots')).toBe('available');
    expect(researchStatus(h.state, 'familyHomes')).toBe('available');
    h.state.research.completed.push('familyHomes');
    expect(researchStatus(h.state, 'townhouses')).toBe('locked-level');
  });

  it('Apprenticeship lets practice reach level 3', () => {
    const h = makeGame();
    const v = villager(h);
    v.skills.woodcutting = { level: 2, xp: 500 };
    practiceSkill(v, 'woodcutting', h.events, practiceCap(h.state));
    expect(v.skills.woodcutting.level).toBe(2);
    h.state.research.completed.push('apprenticeship');
    practiceSkill(v, 'woodcutting', h.events, practiceCap(h.state));
    expect(v.skills.woodcutting.level).toBe(3);
  });

  it('Organised Stores raises stone and goods storage', () => {
    const h = makeGame();
    h.state.research.completed.push('carpentry', 'clayDigging', 'brickmaking', 'stonecutting');
    build(h, 'warehouse', [36, 38]);
    expect(capacity(h.state, 'planks')).toBe(100);
    h.state.research.completed.push('organisedStores');
    expect(capacity(h.state, 'planks')).toBe(150);
  });
});

describe('production areas', () => {
  it('a Woodlot never runs out and its crew carries timber to storage', () => {
    const h = makeGame();
    h.state.research.completed.push('woodlots');
    const lot = build(h, 'woodlot', [19, 30]);
    h.state.resources.timber = 0;
    const a = villager(h, 0);
    const b = villager(h, 1);
    expect(assignVillager(h.state, h.world, a.id, { kind: 'operate', buildingId: lot.id }, h.events).ok).toBe(true);
    expect(assignVillager(h.state, h.world, b.id, { kind: 'operate', buildingId: lot.id }, h.events).ok).toBe(true);
    h.run(8);
    const pa = villagerPosition(a, h.state.time);
    const pb = villagerPosition(b, h.state.time);
    expect(Math.hypot(pa.x - pb.x, pa.z - pb.z)).toBeGreaterThan(0.5);
    h.run(600);
    expect(h.state.resources.timber).toBe(capacity(h.state, 'timber'));
    expect(h.events.filter((e) => e.type === 'deposit').length).toBeGreaterThan(20);
    const est = estimateJob(h.state, h.world, a, a.job!)!;
    expect(est.travelSeconds).toBeGreaterThan(0);
    expect(est.destination).toBe('Timber Yard');
  });

  it('a Clay Pit needs somewhere to put the clay', () => {
    const h = makeGame();
    h.state.research.completed.push('clayDigging', 'clayPits');
    const pit = build(h, 'clayPit', [40, 32]);
    const res = assignVillager(h.state, h.world, villager(h).id, { kind: 'operate', buildingId: pit.id }, h.events);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Clay Shed/);
  });
});

describe('homes', () => {
  it('a House brings two more beds, and Townhouses a second House', () => {
    const h = makeGame();
    h.state.research.completed.push('familyHomes');
    const beds = housingCapacity(h.state);
    build(h, 'house', [36, 38]);
    expect(housingCapacity(h.state)).toBe(beds + 2);
    expect(acceptNewcomer(h.state, h.world, 0, h.events).ok).toBe(true);
    expect(h.state.newcomers?.length).toBe(3);
    expect(() => build(h, 'house', [36, 44])).toThrow();
    h.state.research.completed.push('townhouses');
    expect(() => build(h, 'house', [36, 44])).not.toThrow();
  });
});
