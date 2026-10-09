import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ValleyState } from '../src/valley/types.ts';
import { listingOf, rankOpen, type ValleyListing, type ValleyStore } from './valleyService.ts';

/** A persisted save record. `serverSavedAt` is always stamped by the server clock. */
export interface StoredSave {
  playerId: string;
  revision: number;
  serverSavedAt: number;
  /** Opaque, schema-versioned game payload produced by the client simulation. */
  payload: unknown;
}

/** A write either lands, or loses to a newer revision already stored. */
export type SaveWrite = { ok: true } | { ok: false; revision: number };

/**
 * Storage for player saves: JSON files for a single process, Postgres
 * (`server/db/pgStores.ts`) for several. `write` refuses a revision older than the
 * stored one atomically, so two processes can never let a stale save win.
 */
export interface SaveStore {
  load(playerId: string): Promise<StoredSave | null>;
  write(record: StoredSave): Promise<SaveWrite>;
  remove(playerId: string): Promise<void>;
}

/** Revision check + write for stores that can only do it as two steps (one process). */
async function checkedWrite(store: { load(id: string): Promise<StoredSave | null>; put(r: StoredSave): Promise<void> }, record: StoredSave): Promise<SaveWrite> {
  const existing = await store.load(record.playerId);
  if (existing && existing.revision > record.revision) return { ok: false, revision: existing.revision };
  await store.put(record);
  return { ok: true };
}

export class MemorySaveStore implements SaveStore {
  readonly saves = new Map<string, StoredSave>();
  async load(playerId: string): Promise<StoredSave | null> {
    return this.saves.get(playerId) ?? null;
  }
  async put(record: StoredSave): Promise<void> {
    this.saves.set(record.playerId, record);
  }
  write(record: StoredSave): Promise<SaveWrite> {
    return checkedWrite(this, record);
  }
  async remove(playerId: string): Promise<void> {
    this.saves.delete(playerId);
  }
}

export class FileSaveStore implements SaveStore {
  private readonly queues = new Map<string, Promise<unknown>>();
  constructor(private readonly dir: string) {}

  /** Check-and-write per player, one at a time (this store is single-process). */
  write(record: StoredSave): Promise<SaveWrite> {
    const prev = this.queues.get(record.playerId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(() => checkedWrite(this, record));
    this.queues.set(record.playerId, run);
    void run.finally(() => {
      if (this.queues.get(record.playerId) === run) this.queues.delete(record.playerId);
    });
    return run;
  }

  private fileFor(playerId: string): string {
    return path.join(this.dir, `${playerId}.json`);
  }

  async load(playerId: string): Promise<StoredSave | null> {
    try {
      const raw = await fs.readFile(this.fileFor(playerId), 'utf8');
      return JSON.parse(raw) as StoredSave;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async put(record: StoredSave): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const target = this.fileFor(record.playerId);
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(record));
    await fs.rename(tmp, target);
  }

  async remove(playerId: string): Promise<void> {
    await fs.rm(this.fileFor(playerId), { force: true });
  }
}

/** File-backed ValleyStore: one JSON file per Valley plus a small membership index. */
export class FileValleyStore implements ValleyStore {
  constructor(private readonly dir: string) {}

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8')) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  private async writeJson(file: string, data: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data));
    await fs.rename(tmp, file);
  }

  async valleyFor(playerId: string): Promise<string | null> {
    return (await this.readJson<{ valleyId: string }>(path.join(this.dir, 'members', `${playerId}.json`)))?.valleyId ?? null;
  }

  async setMembership(playerId: string, valleyId: string): Promise<void> {
    await this.writeJson(path.join(this.dir, 'members', `${playerId}.json`), { valleyId });
  }

  async clearMembership(playerId: string): Promise<void> {
    await fs.rm(path.join(this.dir, 'members', `${playerId}.json`), { force: true });
  }

  private async ids(): Promise<string[]> {
    try {
      return (await fs.readdir(path.join(this.dir, 'valleys'))).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
    } catch {
      return [];
    }
  }

  private async all(): Promise<ValleyState[]> {
    const out: ValleyState[] = [];
    for (const id of await this.ids()) {
      const v = await this.load(id);
      if (v) out.push(v);
    }
    return out;
  }

  async listOpen(limit: number): Promise<ValleyListing[]> {
    return rankOpen((await this.all()).map(listingOf), limit);
  }

  async findByCode(code: string): Promise<string | null> {
    return (await this.all()).find((v) => v.code === code)?.id ?? null;
  }

  lock<T>(_valleyId: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async load(valleyId: string): Promise<ValleyState | null> {
    return this.readJson<ValleyState>(path.join(this.dir, 'valleys', `${valleyId}.json`));
  }

  async save(valley: ValleyState): Promise<void> {
    await this.writeJson(path.join(this.dir, 'valleys', `${valley.id}.json`), valley);
  }
}
