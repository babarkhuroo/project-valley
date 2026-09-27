import type { JobType } from './jobs';
import type { ResearchId } from './research';

export type NodeKind = 'tree' | 'clay';

export interface NodeDef {
  kind: NodeKind;
  name: string;
  description: string;
  job: JobType;
  /** Research needed before villagers can work this node. */
  requiresResearch: ResearchId | null;
  /** Resource units in a fresh node. */
  amount: number;
  /** Seconds for an exhausted node to recover. */
  regrowSeconds: number;
  /** Villagers that can work the node at once. */
  maxWorkers: number;
}

export const NODES: Record<NodeKind, NodeDef> = {
  tree: {
    kind: 'tree',
    name: 'Tree',
    description: 'A wild tree. Fell it for timber — it will slowly grow back from the stump.',
    job: 'chop',
    requiresResearch: null,
    amount: 24,
    regrowSeconds: 900,
    maxWorkers: 1,
  },
  clay: {
    kind: 'clay',
    name: 'Clay Deposit',
    description: 'A soft bank of creek clay. It refills slowly after being dug out.',
    job: 'dig',
    requiresResearch: 'clayDigging',
    amount: 40,
    regrowSeconds: 1200,
    maxWorkers: 1,
  },
};
