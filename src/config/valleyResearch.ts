/**
 * Valley research: a cooperative tree, separate from each village's own. Members
 * raise Valley Knowledge together (every contribution adds some; merchant crates add
 * more) and vote on which project the Great Library works on next. Effects reach every
 * member's village through the Valley bonuses.
 */

export type ValleyResearchId = 'sharedLarders' | 'merchantCharts' | 'guildTutors' | 'deepStorehouses' | 'tradeWinds' | 'masterTeachers' | 'festivalCharter';

export type ValleyResearchEffect =
  | { type: 'mealDuration'; mult: number }
  | { type: 'storage'; mult: number }
  | { type: 'tradePay'; mult: number }
  | { type: 'tradeGap'; mult: number }
  | { type: 'trainingTime'; mult: number }
  | { type: 'trainingCost'; mult: number };

export interface ValleyResearchDef {
  id: ValleyResearchId;
  name: string;
  description: string;
  /** Valley Knowledge required. */
  cost: number;
  tier: number;
  requires: ValleyResearchId[];
  effects: ValleyResearchEffect[];
}

export const VALLEY_RESEARCH: Record<ValleyResearchId, ValleyResearchDef> = {
  sharedLarders: {
    id: 'sharedLarders',
    name: 'Shared Larders',
    description: 'Every village learns the others’ preserving tricks: a bowl of Stew lasts 10% longer.',
    cost: 600,
    tier: 1,
    requires: [],
    effects: [{ type: 'mealDuration', mult: 1.1 }],
  },
  merchantCharts: {
    id: 'merchantCharts',
    name: 'Merchant Charts',
    description: 'Better maps bring richer traders: merchants pay 15% more for every crate.',
    cost: 600,
    tier: 1,
    requires: [],
    effects: [{ type: 'tradePay', mult: 1.15 }],
  },
  guildTutors: {
    id: 'guildTutors',
    name: 'Guild Tutors',
    description: 'Dedicated tutors at every guild: lessons take 25% less time.',
    cost: 600,
    tier: 1,
    requires: [],
    effects: [{ type: 'trainingTime', mult: 0.75 }],
  },
  deepStorehouses: {
    id: 'deepStorehouses',
    name: 'Deep Storehouses',
    description: 'Cellars dug under every village store: +10% storage.',
    cost: 1200,
    tier: 2,
    requires: ['sharedLarders'],
    effects: [{ type: 'storage', mult: 1.1 }],
  },
  tradeWinds: {
    id: 'tradeWinds',
    name: 'Trade Winds',
    description: 'Word spreads along the coast: merchant ships return 20% sooner.',
    cost: 1200,
    tier: 2,
    requires: ['merchantCharts'],
    effects: [{ type: 'tradeGap', mult: 0.8 }],
  },
  masterTeachers: {
    id: 'masterTeachers',
    name: 'Master Teachers',
    description: 'The guilds share their best teachers: lessons cost 25% fewer coins.',
    cost: 1200,
    tier: 2,
    requires: ['guildTutors'],
    effects: [{ type: 'trainingCost', mult: 0.75 }],
  },
  festivalCharter: {
    id: 'festivalCharter',
    name: 'Festival Charter',
    description: 'The villages agree to celebrate together: opens the Festival Grounds on Market Green.',
    cost: 1000,
    tier: 2,
    requires: ['sharedLarders'],
    effects: [],
  },
};

export const VALLEY_RESEARCH_ORDER: ValleyResearchId[] = ['sharedLarders', 'merchantCharts', 'guildTutors', 'deepStorehouses', 'tradeWinds', 'masterTeachers', 'festivalCharter'];
