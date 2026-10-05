import type { GameState } from './types';

/**
 * Save schema versioning. Bump SAVE_VERSION whenever GameState changes shape and add a
 * migration from the previous version. Migrations run in order on load, so a save from
 * any older version walks forward one step at a time.
 */
export const SAVE_VERSION = 9;

export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** `MIGRATIONS[n]` upgrades a version-n save to version n+1. */
export const MIGRATIONS: Record<number, Migration> = {
  // v2 (milestone 2): stone resource and building upgrades. Stone outcrops are added to
  // old villages by `ensureMapNodes` on load, since node placement needs the world.
  1: (d) => {
    const out = { ...d };
    if (d.resources && typeof d.resources === 'object') out.resources = { stone: 0, ...(d.resources as Record<string, number>) };
    if (Array.isArray(d.buildings)) out.buildings = (d.buildings as Record<string, unknown>[]).map((b) => ({ upgrade: null, ...b }));
    return out;
  },
  // v3: planks and bricks, workshop order queues.
  2: (d) => {
    const out = { ...d };
    if (d.resources && typeof d.resources === 'object') out.resources = { planks: 0, bricks: 0, ...(d.resources as Record<string, number>) };
    if (Array.isArray(d.buildings)) out.buildings = (d.buildings as Record<string, unknown>[]).map((b) => ({ craft: null, ...b }));
    return out;
  },
  // v4 (milestone 3): Valley membership, reputation and the delivery outbox.
  3: (d) => ({ ...d, valley: newValleyState() }),
  // v5: merchants, coins, tonics and the Reputation Road; Trading Post level in the bonuses.
  4: (d) => {
    const valley = (d.valley ?? newValleyState()) as GameState['valley'];
    return { ...d, valley: { ...valley, bonuses: { ...valley.bonuses, tradeLevel: 0 } }, trade: newTradeState() };
  },
  // v6: guild training (villagers can be away in the Valley); guild levels in the bonuses.
  5: (d) => {
    const out = { ...d };
    if (Array.isArray(d.villagers)) out.villagers = (d.villagers as Record<string, unknown>[]).map((v) => ({ training: null, ...v }));
    const valley = d.valley as GameState['valley'] | undefined;
    if (valley) out.valley = { ...valley, bonuses: { ...valley.bonuses, guildLevels: valley.bonuses.guildLevels ?? {} } };
    return out;
  },
  // v7: Valley research multipliers in the bonuses; outbox ops name their target.
  6: (d) => {
    const valley = d.valley as Record<string, unknown> | undefined;
    if (!valley) return d;
    const outbox = ((valley.outbox ?? []) as Record<string, unknown>[]).map(({ building, ...op }) => (op.target ? op : { ...op, target: { kind: 'building', id: building } }));
    return { ...d, valley: { ...valley, outbox, bonuses: { ...newValleyBonuses(), ...(valley.bonuses as object) } } };
  },
  // v8: festival rewards collected.
  7: (d) => ({ ...d, trade: { festivalsClaimed: [], ...((d.trade as object) ?? newTradeState()) } }),
  // v9: guild lessons and Millrace shifts share one `away` trip; workshop bonuses.
  8: (d) => {
    const out = { ...d };
    if (Array.isArray(d.villagers)) {
      out.villagers = (d.villagers as Record<string, unknown>[]).map(({ training, ...v }) => ({ ...v, away: training ? { kind: 'lesson', ...(training as object) } : (v.away ?? null) }));
    }
    const valley = d.valley as Record<string, unknown> | undefined;
    if (valley) out.valley = { ...valley, bonuses: { ...newValleyBonuses(), ...(valley.bonuses as object) } };
    return out;
  },
};

/** Bonuses for a village with no Valley (or nothing restored yet). */
export function newValleyBonuses(): GameState['valley']['bonuses'] {
  return { jobRate: {}, storageMult: 1, mealDurationMult: 1, tradeLevel: 0, guildLevels: {}, tradePayMult: 1, tradeGapMult: 1, trainingTimeMult: 1, trainingCostMult: 1, workshopLevel: 0, workshopYield: 1 };
}

export function newTradeState(): GameState['trade'] {
  return { coins: 0, ship: null, nextShipAt: null, shipsSeen: 0, inventory: {}, active: [], roadClaimed: 0, unlockedDecor: [], festivalsClaimed: [] };
}

export function newValleyState(): GameState['valley'] {
  return { valleyId: null, reputation: 0, outbox: [], given: {}, bonuses: newValleyBonuses() };
}

export class SaveError extends Error {}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function migrate(
  raw: unknown,
  migrations: Record<number, Migration> = MIGRATIONS,
  targetVersion: number = SAVE_VERSION,
): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') throw new SaveError('Save data is not an object');
  let data = raw as Record<string, unknown>;
  let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
  if (version > targetVersion) throw new SaveError(`Save is from a newer version (${version}) of the game`);
  while (version < targetVersion) {
    const step = migrations[version];
    if (!step) throw new SaveError(`No migration from save version ${version}`);
    data = step({ ...data });
    version += 1;
    data.schemaVersion = version;
  }
  return data;
}

/** Parses, migrates and sanity-checks a save. Throws SaveError on anything unusable. */
export function deserialize(json: string | unknown): GameState {
  const raw = typeof json === 'string' ? (JSON.parse(json) as unknown) : json;
  const data = migrate(raw);
  const required = ['time', 'player', 'resources', 'villagers', 'buildings', 'nodes', 'research'];
  for (const key of required) {
    if (!(key in data)) throw new SaveError(`Save is missing "${key}"`);
  }
  if (!Array.isArray(data.villagers) || !Array.isArray(data.buildings) || !Array.isArray(data.nodes)) {
    throw new SaveError('Save has malformed collections');
  }
  return data as unknown as GameState;
}
