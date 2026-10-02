import type { ResourceId } from './resources';
import type { SkillId } from './skills';

export type JobType = 'chop' | 'dig' | 'quarry' | 'cook' | 'study' | 'craft' | 'build';

/** Visual hint for the villager animation layer. The simulation never reads it. */
export type WorkAnim = 'chop' | 'dig' | 'mine' | 'cook' | 'research' | 'craft' | 'build';
export type ToolId = 'axe' | 'shovel' | 'pickaxe' | 'ladle' | 'book' | 'saw' | 'hammer';

export interface JobDef {
  id: JobType;
  /** Short present-tense label for the worker list, e.g. "Cutting timber". */
  verb: string;
  skill: SkillId;
  /** Work units needed per batch. A villager produces work at `workRate` units/second. */
  batchWork: number;
  /** Whether villagers doing this job eat Stew while they work. */
  consumesFood: boolean;
  /**
   * What one finished batch yields. `carry` outputs are physically walked to storage;
   * `direct` outputs appear where the work happens (e.g. the Cookhouse pantry).
   */
  output?: { resource: ResourceId; amount: number; delivery: 'carry' | 'direct' };
  anim: WorkAnim;
  tool: ToolId;
}

export const JOBS: Record<JobType, JobDef> = {
  chop: {
    id: 'chop',
    verb: 'Cutting timber',
    skill: 'woodcutting',
    batchWork: 6,
    consumesFood: true,
    output: { resource: 'timber', amount: 4, delivery: 'carry' },
    anim: 'chop',
    tool: 'axe',
  },
  dig: {
    id: 'dig',
    verb: 'Digging clay',
    skill: 'mining',
    batchWork: 8,
    consumesFood: true,
    output: { resource: 'clay', amount: 4, delivery: 'carry' },
    anim: 'dig',
    tool: 'shovel',
  },
  quarry: {
    id: 'quarry',
    verb: 'Quarrying stone',
    skill: 'mining',
    batchWork: 10,
    consumesFood: true,
    output: { resource: 'stone', amount: 3, delivery: 'carry' },
    anim: 'mine',
    tool: 'pickaxe',
  },
  cook: {
    id: 'cook',
    verb: 'Cooking stew',
    skill: 'farming',
    batchWork: 8,
    consumesFood: false,
    output: { resource: 'stew', amount: 1, delivery: 'direct' },
    anim: 'cook',
    tool: 'ladle',
  },
  study: {
    id: 'study',
    verb: 'Studying',
    skill: 'research',
    batchWork: 6,
    consumesFood: true,
    output: { resource: 'knowledge', amount: 1, delivery: 'direct' },
    anim: 'research',
    tool: 'book',
  },
  craft: {
    id: 'craft',
    verb: 'Crafting',
    skill: 'crafting',
    // Workshop batches take their work and output from the current recipe (config/recipes.ts).
    batchWork: 12,
    consumesFood: true,
    anim: 'craft',
    tool: 'saw',
  },
  build: {
    id: 'build',
    verb: 'Building',
    skill: 'construction',
    batchWork: 5,
    consumesFood: true,
    anim: 'build',
    tool: 'hammer',
  },
};
