import type { BuildingId } from '../config/buildings';
import type { NodeKind } from '../config/nodes';
import type { RecipeId } from '../config/recipes';
import type { ResearchId } from '../config/research';
import type { ResourceId } from '../config/resources';
import type { SkillId } from '../config/skills';
import type { Appearance } from '../config/villagers';

/**
 * Runtime game state. Everything in here is plain, JSON-serialisable data: it is what
 * gets saved, migrated, simulated offline and (later) validated by the server.
 * Static definitions live in /config and are referenced by id only.
 */

export interface Vec2 {
  x: number;
  z: number;
}

export type Rotation = 0 | 1 | 2 | 3;

export interface ResourceNode {
  id: number;
  kind: NodeKind;
  x: number;
  z: number;
  /** Visual variant (tree species, size). Rendering only. */
  variant: number;
  amount: number;
  /** Sim time at which an exhausted node is whole again, or null when available. */
  regrowAt: number | null;
  /** Sim time the node was exhausted (for sapling growth visuals). */
  depletedAt: number | null;
}

export type BuildingStatus = 'construction' | 'complete';

export interface BuildingInstance {
  id: number;
  defId: BuildingId;
  cellX: number;
  cellZ: number;
  rotation: Rotation;
  level: number;
  status: BuildingStatus;
  /** Construction work applied so far. */
  progress: number;
  /** Total construction work required (captured when placed). */
  workRequired: number;
  /** Resources paid, refunded if construction is cancelled. */
  paid: Partial<Record<ResourceId, number>>;
  completedAt: number | null;
  /** Cosmetic variant (roof colour, etc.). */
  variant: number;
  /** In-progress upgrade; the building keeps working meanwhile. */
  upgrade: UpgradeProgress | null;
  /** Workshop orders (null for non-workshops). */
  craft: CraftState | null;
}

export interface CraftOrder {
  recipe: RecipeId;
  /** Items left to make; REPEAT_ORDER (-1) keeps making until cancelled. */
  count: number;
}

export interface CraftState {
  orders: CraftOrder[];
  /** Recipe of the item in progress — its inputs have already been taken. */
  current: RecipeId | null;
}

export interface UpgradeProgress {
  toLevel: number;
  progress: number;
  workRequired: number;
  /** Resources paid, refunded if the upgrade is cancelled. */
  paid: Partial<Record<ResourceId, number>>;
}

export type Job =
  | { kind: 'gather'; nodeId: number }
  | { kind: 'operate'; buildingId: number }
  | { kind: 'construct'; buildingId: number };

export type Activity = 'idle' | 'walking' | 'working' | 'blocked';
export type WalkPurpose = 'toWork' | 'toStorage' | 'toRest';
export type BlockReason = 'storageFull' | 'noStorage' | 'knowledgeFull' | 'unreachable' | 'noOrders' | 'noInputs';

/** A time-parameterised walk: `times[i]` is the absolute sim time the villager reaches `points[i]`. */
export interface Route {
  points: Vec2[];
  times: number[];
}

export interface SkillState {
  level: number;
  /** Practice XP accumulated towards the next level. */
  xp: number;
}

export interface Carry {
  resource: ResourceId;
  amount: number;
}

export interface Villager {
  id: number;
  name: string;
  appearance: Appearance;
  homeId: number | null;
  skills: Record<SkillId, SkillState>;
  job: Job | null;
  activity: Activity;
  purpose: WalkPurpose | null;
  /** Authoritative position when not walking; route origin while walking. */
  pos: Vec2;
  route: Route | null;
  carrying: Carry | null;
  /** Storage building the current load is headed to. */
  depositTargetId: number | null;
  workProgress: number;
  batchWork: number;
  /** Seconds of work left on the current meal. */
  energy: number;
  hungry: boolean;
  blockedReason: BlockReason | null;
  /** Sim time the villager joined the village. */
  joinedAt: number;
}

export interface NewcomerCandidate {
  name: string;
  appearance: Appearance;
  specialty: SkillId;
}

export interface ResearchState {
  completed: ResearchId[];
  /** Knowledge invested per project. Kept when switching projects. */
  progress: Partial<Record<ResearchId, number>>;
  active: ResearchId | null;
}

export interface PlayerState {
  name: string;
  villageName: string;
  xp: number;
  level: number;
}

export interface TutorialState {
  step: number;
  done: boolean;
  skipped: boolean;
}

export interface GameState {
  schemaVersion: number;
  /** Seed for the map and deterministic choices. */
  seed: number;
  /** Simulation clock in seconds since the village was founded. */
  time: number;
  /** PRNG state for in-game randomness (newcomer rolls). */
  rng: number;
  nextId: number;
  player: PlayerState;
  resources: Record<ResourceId, number>;
  villagers: Villager[];
  buildings: BuildingInstance[];
  nodes: ResourceNode[];
  research: ResearchState;
  newcomers: NewcomerCandidate[] | null;
  tutorial: TutorialState;
  /** Lifetime counters (resources produced, buildings built, ...). */
  stats: Record<string, number>;
  /** Wall-clock (server-synchronised) ms at which `time` was last current. */
  lastProcessedAt: number;
  /** Monotonic save counter used to reject stale writes. */
  revision: number;
}
