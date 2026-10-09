import path from 'node:path';
import { AuthService, FileAuthStore, type AuthStore } from './auth.ts';
import type { LiveBus } from './bus.ts';
import { connectPostgres, PgAuthStore, PgBus, PgSaveStore, PgValleyStore } from './db/pgStores.ts';
import { LiveHub } from './live.ts';
import { FileSaveStore, FileValleyStore, type SaveStore } from './saveStore.ts';
import { ValleyService, type ValleyStore } from './valleyService.ts';

/**
 * Picks the storage for a server process: Postgres when `DATABASE_URL` is set (any
 * number of processes may share it), JSON files under `dataDir` otherwise (one
 * process only). Everything above the stores is the same either way.
 */
export interface Backend {
  kind: 'postgres' | 'files';
  saves: SaveStore;
  valleys: ValleyService;
  auth: AuthService;
  hub: LiveHub;
  close(): Promise<void>;
}

export async function createBackend(options: { dataDir: string; databaseUrl?: string | null }): Promise<Backend> {
  let saves: SaveStore;
  let valleyStore: ValleyStore;
  let authStore: AuthStore;
  let bus: LiveBus | null = null;
  let closeDb = async () => {};
  const url = options.databaseUrl?.trim();
  if (url) {
    const db = await connectPostgres(url);
    saves = new PgSaveStore(db);
    valleyStore = new PgValleyStore(db);
    authStore = new PgAuthStore(db);
    bus = await PgBus.start(db);
    closeDb = () => db.close();
  } else {
    saves = new FileSaveStore(path.join(options.dataDir, 'saves'));
    valleyStore = new FileValleyStore(options.dataDir);
    authStore = new FileAuthStore(path.join(options.dataDir, 'auth.json'));
  }
  const valleys = new ValleyService(valleyStore);
  const auth = new AuthService(authStore);
  const hub = new LiveHub(valleys, auth, { bus: bus ?? undefined });
  return {
    kind: url ? 'postgres' : 'files',
    saves,
    valleys,
    auth,
    hub,
    async close() {
      hub.close();
      await bus?.close();
      await closeDb();
    },
  };
}
