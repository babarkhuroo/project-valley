import type { ResourceId } from '../config/resources';
import type { ValleyBuildingId } from '../config/valley';
import type { ValleyResearchId } from '../config/valleyResearch';
import type { FestivalId } from '../config/festivals';

/**
 * Shared Valley state. Owned by the server and advanced by the server clock (wall-clock
 * milliseconds), never by a player's village clock. Plain JSON, like GameState.
 */

export type ResourceBag = Partial<Record<ResourceId, number>>;

export interface ValleyMember {
  /** Player id for real players, `sim-N` for simulated neighbours. */
  id: string;
  name: string;
  villageName: string;
  kind: 'player' | 'simulated';
  joinedAt: number;
  /** Index into NEIGHBOURS for simulated members. */
  neighbour: number | null;
  /** Next delivery time (simulated members only). */
  nextVisitAt: number | null;
  /** Value contributed over the member's lifetime in this Valley. */
  lifetimeValue: number;
  /** When a player left, or a neighbour moved on to make room. Null while active. */
  leftAt: number | null;
}

export type ValleyBuildingStatus = 'locked' | 'collecting' | 'building' | 'complete';

export interface ValleyBuildingState {
  id: ValleyBuildingId;
  /** Finished levels (0 = still a ruin). */
  level: number;
  status: ValleyBuildingStatus;
  /** Delivered towards the next level. */
  delivered: ResourceBag;
  /** Value each member delivered towards the next level. */
  shares: Record<string, number>;
  /** When building work finishes (status 'building'). */
  doneAt: number | null;
}

export type ValleyLogEntry =
  | { id: number; at: number; kind: 'joined'; member: string }
  | { id: number; at: number; kind: 'delivery'; member: string; building: ValleyBuildingId; resources: ResourceBag }
  | { id: number; at: number; kind: 'started'; building: ValleyBuildingId; level: number }
  | { id: number; at: number; kind: 'finished'; building: ValleyBuildingId; level: number }
  | { id: number; at: number; kind: 'opened'; building: ValleyBuildingId }
  | { id: number; at: number; kind: 'knowledge'; member: string; amount: number }
  | { id: number; at: number; kind: 'left'; member: string }
  | { id: number; at: number; kind: 'movedOn'; member: string }
  | { id: number; at: number; kind: 'returned'; member: string }
  | { id: number; at: number; kind: 'researched'; research: ValleyResearchId }
  | { id: number; at: number; kind: 'festivalStarted'; festival: FestivalId }
  | { id: number; at: number; kind: 'festivalGift'; member: string; festival: FestivalId; resources: ResourceBag }
  | { id: number; at: number; kind: 'festivalWon'; festival: FestivalId }
  | { id: number; at: number; kind: 'festivalLost'; festival: FestivalId };

export interface ContributionResult {
  accepted: ResourceBag;
  /** Valley Knowledge accepted (knowledge deliveries). */
  knowledge?: number;
  /** Resources that weren't needed any more (another member got there first). */
  returned: ResourceBag;
  value: number;
  reputation: number;
}

export interface ValleyState {
  schemaVersion: number;
  id: string;
  name: string;
  /** Invite code members share with friends. */
  code: string;
  /** Listed for anyone to join. */
  open: boolean;
  seed: number;
  createdAt: number;
  /** Server time the state was last advanced to. */
  time: number;
  rng: number;
  nextLogId: number;
  members: ValleyMember[];
  buildings: Record<ValleyBuildingId, ValleyBuildingState>;
  log: ValleyLogEntry[];
  /** The current festival, or the last one until the next begins. */
  festival: ValleyFestival | null;
  /** When the next festival starts (null until the Festival Grounds open, or while one runs). */
  nextFestivalAt: number | null;
  /** Shared Valley research and the Knowledge waiting for it (banked until the Library opens). */
  research: ValleyResearchState;
  /** Recent contribution op ids per member → result, so retried requests are idempotent. */
  ops: Record<string, Record<string, ContributionResult>>;
}

export interface ValleyFestival {
  id: number;
  kind: FestivalId;
  startsAt: number;
  endsAt: number;
  goal: ResourceBag;
  delivered: ResourceBag;
  /** Value each member delivered. Everyone with a share is rewarded if the Valley wins. */
  shares: Record<string, number>;
  outcome: 'running' | 'won' | 'lost';
  /** Reward multiplier from the Festival Grounds level when it started. */
  rewardMult: number;
}

export interface ValleyResearchState {
  completed: ValleyResearchId[];
  progress: Partial<Record<ValleyResearchId, number>>;
  /** Each member's chosen next project. The most-voted available project gets the Knowledge. */
  votes: Record<string, ValleyResearchId>;
  /** Knowledge waiting: the Library isn't open yet, or nothing is left to research. */
  banked: number;
  /** Lifetime Knowledge raised. */
  raised: number;
}

/** What clients receive: the state without server bookkeeping. */
export type ValleySnapshot = Omit<ValleyState, 'ops' | 'rng'>;
