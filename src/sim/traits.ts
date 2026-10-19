import type { JobType } from '../config/jobs';
import type { Villager } from './types';

/** A villager's nature: a small lasting edge that makes each one a little different. */
export interface TraitDef {
  id: string;
  name: string;
  description: string;
  job?: JobType;
  jobMult?: number;
  walkMult?: number;
  mealMult?: number;
}

/**
 * Villager traits. Every villager has one, settled by their name, so it needs no saving and a
 * traveller's shows before they're welcomed. Traits only scale a villager's own rates, which
 * stay constant between events, so time away still equals play.
 */
export const TRAITS: TraitDef[] = [
  { id: 'woodsy', name: 'Woodsy', description: 'Woodcutting +25%', job: 'chop', jobMult: 1.25 },
  { id: 'stoneSure', name: 'Stone-sure', description: 'Digging and quarrying +25%', job: 'dig', jobMult: 1.25 },
  { id: 'greenThumb', name: 'Green thumb', description: 'Farming +25%', job: 'farm', jobMult: 1.25 },
  { id: 'goodCook', name: 'Good cook', description: 'Cooking +25%', job: 'cook', jobMult: 1.25 },
  { id: 'bookish', name: 'Bookish', description: 'Study +25%', job: 'study', jobMult: 1.25 },
  { id: 'handy', name: 'Handy', description: 'Building +25%', job: 'build', jobMult: 1.25 },
  { id: 'steadyHands', name: 'Steady hands', description: 'Workshop crafting +25%', job: 'craft', jobMult: 1.25 },
  { id: 'quickFeet', name: 'Quick feet', description: 'Walks 25% faster', walkMult: 1.25 },
  { id: 'lightEater', name: 'Light eater', description: 'A bowl of Stew lasts 30% longer', mealMult: 1.3 },
];

/** The trait a villager (or a traveller, before they join) with this name has: FNV-1a over the name. */
export function traitForName(name: string): TraitDef {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return TRAITS[h % TRAITS.length];
}

export const traitOf = (v: Pick<Villager, 'name'>): TraitDef => traitForName(v.name);

/** The trait's boost to this job ("dig" also covers quarrying), 1 when none. */
export function traitJobMult(v: Villager, job: JobType): number {
  const t = traitOf(v);
  return t.job === job || (t.job === 'dig' && job === 'quarry') ? (t.jobMult ?? 1) : 1;
}

export const traitWalkMult = (v: Villager): number => traitOf(v).walkMult ?? 1;
export const traitMealMult = (v: Villager): number => traitOf(v).mealMult ?? 1;
