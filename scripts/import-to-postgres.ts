/**
 * Copies a file-backed server's data (server/data) into Postgres, so an existing
 * deployment can switch to DATABASE_URL without anyone losing their village.
 *
 *   DATABASE_URL=postgres:///project_valley npx tsx scripts/import-to-postgres.ts [dataDir]
 *
 * Safe to re-run: saves only replace older revisions, everything else is upserted.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuthData } from '../server/auth.ts';
import { connectPostgres, PgAuthStore, PgSaveStore, PgValleyStore } from '../server/db/pgStores.ts';
import type { StoredSave } from '../server/saveStore.ts';
import type { ValleyState } from '../src/valley/types.ts';
import { upgradeValley } from '../src/valley/valleySim.ts';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL to the Postgres database to import into.');
  process.exit(1);
}
const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.argv[2] ?? path.join(root, '../server/data'));

async function jsonFiles<T>(dir: string): Promise<[string, T][]> {
  let names: string[] = [];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: [string, T][] = [];
  for (const n of names) out.push([n.slice(0, -5), JSON.parse(await fs.readFile(path.join(dir, n), 'utf8')) as T]);
  return out;
}

const db = await connectPostgres(url);
try {
  const valleyStore = new PgValleyStore(db);
  const valleys = await jsonFiles<ValleyState>(path.join(dataDir, 'valleys'));
  for (const [, v] of valleys) {
    // Old files may predate invite codes and newer buildings: bring them up to date, as the server does on load.
    upgradeValley(v, Date.now());
    await valleyStore.save(v);
  }
  const members = await jsonFiles<{ valleyId: string }>(path.join(dataDir, 'members'));
  const known = new Set(valleys.map(([, v]) => v.id));
  let memberships = 0;
  for (const [playerId, m] of members) {
    if (!known.has(m.valleyId)) continue;
    await valleyStore.setMembership(playerId, m.valleyId);
    memberships++;
  }

  const saveStore = new PgSaveStore(db);
  let saves = 0;
  for (const [, s] of await jsonFiles<StoredSave>(path.join(dataDir, 'saves'))) if ((await saveStore.write(s)).ok) saves++;

  const auth = new PgAuthStore(db);
  let accounts = 0;
  let sessions = 0;
  try {
    const data = JSON.parse(await fs.readFile(path.join(dataDir, 'auth.json'), 'utf8')) as AuthData;
    for (const a of Object.values(data.accounts)) if (await auth.createAccount(a)) accounts++;
    for (const [playerId, o] of Object.entries(data.owned)) {
      if (o.username) await auth.setOwner(playerId, o.username);
      else await auth.claim(playerId);
    }
    for (const [hash, s] of Object.entries(data.sessions)) {
      await auth.putSession(hash, s);
      sessions++;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  console.log(`Imported ${valleys.length} Valleys, ${memberships} memberships, ${saves} saves, ${accounts} accounts and ${sessions} sessions from ${dataDir}.`);
} finally {
  await db.close();
}
