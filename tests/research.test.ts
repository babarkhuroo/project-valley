import { describe, expect, it } from 'vitest';
import { assignVillager, placeBuilding, setActiveResearch } from '../src/sim/commands';
import { completeConstruction } from '../src/sim/construction';
import { isBuildingUnlocked } from '../src/sim/modifiers';
import { researchStatus } from '../src/sim/research';
import { makeGame, villager, type Harness } from './helpers';

function withAcademy(): { h: Harness; academyId: number } {
  const h = makeGame();
  h.state.resources.timber = 100;
  const res = placeBuilding(h.state, h.world, 'academy', 34, 36, 0, h.events);
  if (!res.ok) throw new Error(res.error);
  completeConstruction(h.state, h.world, res.value!, h.events);
  return { h, academyId: res.value!.id };
}

describe('research', () => {
  it('knowledge flows into the active project and completes it', () => {
    const { h, academyId } = withAcademy();
    expect(setActiveResearch(h.state, h.world, 'cottageCraft', h.events).ok).toBe(true);
    assignVillager(h.state, h.world, villager(h).id, { kind: 'operate', buildingId: academyId }, h.events);
    h.run(200);
    expect(h.state.research.completed).toContain('cottageCraft');
    expect(isBuildingUnlocked(h.state, 'cottage')).toBe(true);
    expect(h.events.some((e) => e.type === 'researchComplete')).toBe(true);
  });

  it('switching projects keeps earlier progress', () => {
    const { h, academyId } = withAcademy();
    setActiveResearch(h.state, h.world, 'heartyRecipes', h.events);
    assignVillager(h.state, h.world, villager(h).id, { kind: 'operate', buildingId: academyId }, h.events);
    h.run(60);
    const partial = h.state.research.progress.heartyRecipes ?? 0;
    expect(partial).toBeGreaterThan(0);
    setActiveResearch(h.state, h.world, 'clayDigging', h.events);
    h.run(30);
    expect(h.state.research.progress.heartyRecipes).toBe(partial);
    setActiveResearch(h.state, h.world, 'heartyRecipes', h.events);
    expect(h.state.research.progress.heartyRecipes).toBeGreaterThanOrEqual(partial);
  });

  it('banks knowledge when nothing is selected and applies it on selection', () => {
    const { h, academyId } = withAcademy();
    assignVillager(h.state, h.world, villager(h).id, { kind: 'operate', buildingId: academyId }, h.events);
    h.run(100);
    const banked = h.state.resources.knowledge;
    expect(banked).toBeGreaterThan(5);
    setActiveResearch(h.state, h.world, 'clayDigging', h.events);
    expect(h.state.resources.knowledge).toBeLessThan(banked);
  });

  it('pauses the scholar when the bank is full and no project is chosen', () => {
    const { h, academyId } = withAcademy();
    const v = villager(h);
    assignVillager(h.state, h.world, v.id, { kind: 'operate', buildingId: academyId }, h.events);
    h.run(400);
    expect(h.state.resources.knowledge).toBe(30);
    expect(v.blockedReason).toBe('knowledgeFull');
    setActiveResearch(h.state, h.world, 'cottageCraft', h.events);
    expect(v.activity).toBe('working');
  });

  it('gates projects by prerequisites and player level', () => {
    const { h } = withAcademy();
    expect(researchStatus(h.state, 'growingHamlet')).toBe('locked-prereq');
    h.state.research.completed.push('cottageCraft');
    expect(researchStatus(h.state, 'growingHamlet')).toBe('locked-level');
    expect(setActiveResearch(h.state, h.world, 'growingHamlet', h.events).ok).toBe(false);
    h.state.player.level = 2;
    expect(researchStatus(h.state, 'growingHamlet')).toBe('available');
  });
});
