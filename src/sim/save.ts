import type { GameState } from './types';

/**
 * Save schema versioning. Bump SAVE_VERSION whenever GameState changes shape and add a
 * migration from the previous version. Migrations run in order on load, so a save from
 * any older version walks forward one step at a time.
 */
export const SAVE_VERSION = 1;

export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/** `MIGRATIONS[n]` upgrades a version-n save to version n+1. */
export const MIGRATIONS: Record<number, Migration> = {};

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
