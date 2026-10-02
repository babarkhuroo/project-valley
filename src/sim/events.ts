import type { BuildingId } from '../config/buildings';
import type { JobType } from '../config/jobs';
import type { ResearchId } from '../config/research';
import type { ResourceId } from '../config/resources';
import type { SkillId } from '../config/skills';
import type { ValleyBuildingId } from '../config/valley';
import type { BoostId } from '../config/trade';

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
  | { type: 'upgradeStarted'; buildingId: number; defId: BuildingId; level: number }
  | { type: 'craftQueueEmpty'; buildingId: number; defId: BuildingId }
  | { type: 'upgradeComplete'; buildingId: number; defId: BuildingId; level: number }
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
  | { type: 'autoContinue'; villagerId: number; nodeId: number }
  | { type: 'valleySent'; building: ValleyBuildingId; resources: Partial<Record<ResourceId, number>> }
  | { type: 'trainingStarted'; villagerId: number; skill: SkillId; level: number }
  | { type: 'trainingDone'; villagerId: number; skill: SkillId; level: number }
  | { type: 'shipArrived'; merchant: number; crates: number }
  | { type: 'shipLeft'; merchant: number; filled: number }
  | { type: 'crateFilled'; resource: ResourceId; amount: number; coins: number; reputation: number }
  | { type: 'shipComplete'; merchant: number; coins: number; reputation: number }
  | { type: 'boostBought'; boost: BoostId }
  | { type: 'boostStarted'; boost: BoostId }
  | { type: 'boostEnded'; boost: BoostId }
  | { type: 'roadReward'; index: number }
  | { type: 'valleyAccepted'; building: ValleyBuildingId; accepted: Partial<Record<ResourceId, number>>; returned: Partial<Record<ResourceId, number>>; reputation: number };

export type IdleReason = 'depleted' | 'unassigned' | 'finished' | 'unreachable' | 'removed';

export type EventSink = SimEvent[];
