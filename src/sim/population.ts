import { BALANCE } from '../config/balance';
import { SKILL_ORDER, type SkillId } from '../config/skills';
import { APPEARANCE_PALETTE, NEWCOMER_NAMES, type Appearance, type VillagerTemplate } from '../config/villagers';
import { mulberry32 } from '../world/noise';
import { buildingStats } from './levels';
import { mealDuration } from './modifiers';
import type { EventSink } from './events';
import type { BuildingInstance, GameState, NewcomerCandidate, SkillState, Villager } from './types';

export function housingCapacity(state: GameState): number {
  return state.buildings.reduce((sum, b) => sum + (b.status === 'complete' ? buildingStats(b.defId, b.level).housing : 0), 0);
}

export function residents(state: GameState, homeId: number): Villager[] {
  return state.villagers.filter((v) => v.homeId === homeId);
}

export function homeWithSpace(state: GameState): BuildingInstance | null {
  for (const b of state.buildings) {
    const beds = b.status === 'complete' ? buildingStats(b.defId, b.level).housing : 0;
    if (beds > residents(state, b.id).length) return b;
  }
  return null;
}

function rand(state: GameState): number {
  const [v, next] = mulberry32(state.rng);
  state.rng = next;
  return v;
}

function pick<T>(state: GameState, list: readonly T[]): T {
  return list[Math.floor(rand(state) * list.length) % list.length];
}

export function emptySkills(): Record<SkillId, SkillState> {
  const skills = {} as Record<SkillId, SkillState>;
  for (const id of SKILL_ORDER) skills[id] = { level: 0, xp: 0 };
  return skills;
}

/** Rolls a fresh set of newcomer candidates (deterministic from the save's RNG). */
export function rollNewcomers(state: GameState): NewcomerCandidate[] {
  const taken = new Set(state.villagers.map((v) => v.name));
  const specialties: SkillId[] = ['woodcutting', 'mining', 'farming', 'research', 'construction'];
  const out: NewcomerCandidate[] = [];
  const usedSpecialty = new Set<SkillId>();
  for (let i = 0; i < BALANCE.population.newcomerChoices; i++) {
    let name = pick(state, NEWCOMER_NAMES);
    for (let guard = 0; (taken.has(name) || out.some((c) => c.name === name)) && guard < 50; guard++) name = pick(state, NEWCOMER_NAMES);
    let specialty = pick(state, specialties);
    for (let guard = 0; usedSpecialty.has(specialty) && guard < 20; guard++) specialty = pick(state, specialties);
    usedSpecialty.add(specialty);
    // Keep the line-up visually distinct: no two candidates share a shirt colour.
    const shirts = APPEARANCE_PALETTE.shirt.filter((c) => !out.some((o) => o.appearance.shirt === c));
    const appearance: Appearance = {
      skin: pick(state, APPEARANCE_PALETTE.skin),
      hair: pick(state, APPEARANCE_PALETTE.hair),
      hairStyle: Math.floor(rand(state) * 4) as Appearance['hairStyle'],
      shirt: pick(state, shirts),
      trousers: pick(state, APPEARANCE_PALETTE.trousers),
      hat: (rand(state) < 0.55 ? 0 : 1 + Math.floor(rand(state) * 2)) as Appearance['hat'],
      hatColor: pick(state, APPEARANCE_PALETTE.hatColor),
    };
    out.push({ name, appearance, specialty });
  }
  return out;
}

/** Offers newcomers whenever there is a free bed and no offer is pending. */
export function checkNewcomers(state: GameState, sink: EventSink): void {
  if (state.newcomers) return;
  if (!homeWithSpace(state)) return;
  state.newcomers = rollNewcomers(state);
  sink.push({ type: 'newcomersAvailable' });
}

export function createVillager(state: GameState, template: VillagerTemplate, homeId: number | null, pos: { x: number; z: number }): Villager {
  const skills = emptySkills();
  for (const [skill, level] of Object.entries(template.skills ?? {}) as [SkillId, number][]) {
    skills[skill] = { level, xp: BALANCE.skills.practiceThresholds[Math.min(level, BALANCE.skills.practiceThresholds.length - 1)] ?? 0 };
  }
  return {
    id: state.nextId++,
    name: template.name,
    appearance: { ...template.appearance },
    homeId,
    skills,
    job: null,
    activity: 'idle',
    purpose: null,
    pos: { ...pos },
    route: null,
    carrying: null,
    depositTargetId: null,
    workProgress: 0,
    batchWork: 0,
    energy: mealDuration(state),
    hungry: false,
    blockedReason: null,
    joinedAt: state.time,
    training: null,
  };
}
