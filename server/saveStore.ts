import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ValleyState } from '../src/valley/types.ts';
import type { ValleyStore } from './valleyService.ts';

/** A persisted save record. `serverSavedAt` is always stamped by the server clock. */
export interface StoredSave {
  playerId: string;
  revision: number;
  serverSavedAt: number;
  /** Opaque, schema-versioned game payload produced by the client simulation. */
  payload: unknown;
}

/**
 * Storage abstraction for player saves. The vertical slice ships a JSON-file
 * implementation; the multiplayer milestone swaps in a PostgreSQL-backed store
 * behind the same interface (see ARCHITECTURE.md).
 */
export interface SaveStore {
  load(playerId: string): Promise<StoredSave | null>;
  save(record: StoredSave): Promise<void>;
  remove(playerId: string): Promise<void>;
}

export class FileSaveStore implements SaveStore {
  constructor(private readonly dir: string) {}

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

  async save(record: StoredSave): Promise<void> {
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

  async load(valleyId: string): Promise<ValleyState | null> {
    return this.readJson<ValleyState>(path.join(this.dir, 'valleys', `${valleyId}.json`));
  }

  async save(valley: ValleyState): Promise<void> {
    await this.writeJson(path.join(this.dir, 'valleys', `${valley.id}.json`), valley);
  }
}
