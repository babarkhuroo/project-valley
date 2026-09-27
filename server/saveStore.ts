import { promises as fs } from 'node:fs';
import path from 'node:path';

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
