import type { BuildingId } from '../config/buildings';
import type { JobType } from '../config/jobs';
import type { ResearchId } from '../config/research';
import type { ResourceId } from '../config/resources';
import type { SkillId } from '../config/skills';

/**
 * Transient facts emitted while the simulation advances. They are not saved: the
 * renderer turns them into particles and sounds, the UI into notifications, and the
 * offline catch-up into a "while you were away" summary.
 */
export type SimEvent =
  | { type: 'deposit'; villagerId: number; buildingId: number; resource: ResourceId; amount: number }
  | { type: 'produced'; villagerId: number; buildingId: number; resource: ResourceId; amount: number }
  | { type: 'batch'; villagerId: number; job: JobType }
  | { type: 'nodeDepleted'; nodeId: number }
  | { type: 'nodeRegrown'; nodeId: number }
  | { type: 'constructionStarted'; buildingId: number; defId: BuildingId }
  | { type: 'constructionComplete'; buildingId: number; defId: BuildingId }
  | { type: 'researchComplete'; researchId: ResearchId }
  | { type: 'xp'; amount: number; reason: string }
  | { type: 'levelUp'; level: number }
  | { type: 'storageFull'; resource: ResourceId; villagerId: number }
  | { type: 'villagerIdle'; villagerId: number; reason: IdleReason }
  | { type: 'hungry'; villagerId: number }
  | { type: 'ate'; villagerId: number }
  | { type: 'skillUp'; villagerId: number; skill: SkillId; level: number }
  | { type: 'newcomersAvailable' }
  | { type: 'villagerJoined'; villagerId: number }
  | { type: 'autoContinue'; villagerId: number; nodeId: number };

export type IdleReason = 'depleted' | 'unassigned' | 'finished' | 'unreachable' | 'removed';

export type EventSink = SimEvent[];
