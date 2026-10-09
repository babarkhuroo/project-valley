import type { BuildingId } from '../config/buildings';
import type { JobType } from '../config/jobs';
import type { NodeKind } from '../config/nodes';
import type { RecipeId } from '../config/recipes';
import type { ResearchId } from '../config/research';
import type { ResourceId } from '../config/resources';
import type { SkillId } from '../config/skills';
import type { ValleyBuildingId } from '../config/valley';
import type { BoostId } from '../config/trade';
import type { CoopRecipeId } from '../config/millrace';
import type { IntroId } from '../config/intros';
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
  /** The crop on a Grain Field (null for everything else). */
  field: FieldState | null;
}

/**
 * A Grain Field's crop: fallow → sown and growing → ripe → harvested load by load →
 * fallow again. Growth is a timer (`ripeAt`) that tending brings forward, so the field
 * ripens at an exact sim time like any other event.
 */
export interface FieldState {
  stage: 'fallow' | 'growing' | 'ripe';
  /** Sim time the current crop was sown (growing/ripe). */
  sownAt: number | null;
  /** Sim time the crop ripens (growing). */
  ripeAt: number | null;
  /** Grain still standing (ripe). */
  stock: number;
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

/** `away`: off in the Valley (guild training) — not in the village at all. */
export type Activity = 'idle' | 'walking' | 'working' | 'blocked' | 'away';
export type WalkPurpose = 'toWork' | 'toStorage' | 'toRest' | 'toValley';
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
  /** A trip to the Valley (guild lesson or workshop shift): walking out, or away. */
  away: AwayTrip | null;
}

interface AwayCommon {
  /** Sim time the trip ends (set when the villager reaches the Valley road). */
  until: number | null;
  /** Trip length in seconds, fixed when it starts (research can shorten later lessons). */
  duration?: number;
  /** Job to go back to afterwards, if its slot is still free. */
  resumeJob: Job | null;
}

/** A guild lesson: one skill level higher on return. */
export interface Lesson extends AwayCommon {
  kind: 'lesson';
  skill: SkillId;
  toLevel: number;
}

/** A shift at the Valley's cooperative workshop: inputs taken, goods delivered to a project. */
export interface Shift extends AwayCommon {
  kind: 'shift';
  recipe: CoopRecipeId;
  project: ValleyBuildingId;
  /** Output multiplier fixed when the shift starts (skill, helpers on site). */
  yield: number;
}

export type AwayTrip = Lesson | Shift;

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
  /** Feature introductions already shown (null until first seeded on load). */
  intros: IntroId[] | null;
}

/** Village-side bonuses from restored Valley buildings (cached from the last Valley sync). */
export interface ValleyBonuses {
  jobRate: Partial<Record<JobType, number>>;
  storageMult: number;
  mealDurationMult: number;
  /** Trading Post level in the Valley (0 = no merchants yet). */
  tradeLevel: number;
  /** Level of the Valley guild that trains each skill (missing = not restored). */
  guildLevels: Partial<Record<SkillId, number>>;
  /** Valley research: merchant pay, time between ships, lesson time and lesson cost. */
  tradePayMult: number;
  tradeGapMult: number;
  trainingTimeMult: number;
  trainingCostMult: number;
  /** Millrace Workshop level (0 = no shifts yet) and its output multiplier. */
  workshopLevel: number;
  workshopYield: number;
}

export interface MerchantCrate {
  resource: ResourceId;
  amount: number;
  coins: number;
  reputation: number;
  /** Valley Knowledge it brings the shared research (sent when filled). */
  knowledge: number;
  filled: boolean;
}

export interface MerchantWare {
  boost: BoostId;
  price: number;
  stock: number;
}

export interface MerchantShip {
  id: number;
  /** Index into MERCHANTS. */
  merchant: number;
  arrivedAt: number;
  leavesAt: number;
  crates: MerchantCrate[];
  wares: MerchantWare[];
  /** Paid once, when the last crate is filled. */
  bonusPaid: boolean;
}

export interface ActiveBoost {
  boost: BoostId;
  /** Sim time it wears off. */
  until: number;
}

/** Coins, merchant visits, tonics and Reputation Road progress. */
export interface TradeState {
  coins: number;
  ship: MerchantShip | null;
  /** When the next ship arrives; null while no ship is due (no Trading Post yet, or one is in port). */
  nextShipAt: number | null;
  shipsSeen: number;
  inventory: Partial<Record<BoostId, number>>;
  active: ActiveBoost[];
  /** Reputation Road milestones claimed (always the first N). */
  roadClaimed: number;
  unlockedDecor: BuildingId[];
  /** Valley festivals whose rewards this village has collected (by festival id). */
  festivalsClaimed: number[];
}

/** What a Valley op is for: a building project, or Valley Knowledge for shared research. */
export type ValleyTarget = { kind: 'building'; id: ValleyBuildingId } | { kind: 'knowledge' } | { kind: 'festival'; festivalId: number };

/** A delivery to the Valley that has left the village but isn't confirmed by the server yet. */
export interface ValleyOp {
  opId: string;
  target: ValleyTarget;
  resources: Partial<Record<ResourceId, number>>;
  /** Valley Knowledge carried (knowledge ops). */
  knowledge?: number;
  /** Village sim time it was sent. */
  at: number;
}

export interface VillageValleyState {
  /** Valley this village belongs to, once it has joined one. */
  valleyId: string | null;
  reputation: number;
  /** Deliveries waiting for the server; retried until confirmed (idempotent by opId). */
  outbox: ValleyOp[];
  /** Lifetime resources accepted by the Valley. */
  given: Partial<Record<ResourceId, number>>;
  /** Kept in the save so offline catch-up uses the same bonuses as live play. */
  bonuses: ValleyBonuses;
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
  valley: VillageValleyState;
  trade: TradeState;
  /** Wall-clock (server-synchronised) ms at which `time` was last current. */
  lastProcessedAt: number;
  /** Monotonic save counter used to reject stale writes. */
  revision: number;
}
