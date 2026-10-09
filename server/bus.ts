import { randomBytes } from 'node:crypto';

/**
 * How server processes tell each other about Valley activity, so a player connected
 * to one process sees what a player on another just did. Messages are tiny (ids and
 * presence lists): a process that hears "Valley X changed" reads the new state from
 * the shared store itself. In-memory for tests and single-process setups, Postgres
 * LISTEN/NOTIFY (`server/db/pgStores.ts`) in production.
 */
export type BusMessage =
  /** A Valley was committed; reload it and push to local members. */
  | { type: 'changed'; valleyId: string }
  /** A player joined (valleyId) or left (null) a Valley — move their connections, wherever they are. */
  | { type: 'member'; playerId: string; valleyId: string | null }
  /** Who is connected to a Valley through the sending process (sent on change and as a heartbeat). */
  | { type: 'presence'; valleyId: string; online: string[] };

export type Envelope = BusMessage & { origin: string };

export interface LiveBus {
  /** Unique per process; messages from yourself are never delivered back. */
  readonly origin: string;
  publish(msg: BusMessage): void;
  subscribe(fn: (msg: Envelope) => void): () => void;
  close(): Promise<void>;
}

export function newOrigin(): string {
  return `${process.pid.toString(36)}-${randomBytes(4).toString('hex')}`;
}

/** Several in-process "servers" sharing one bus — how tests stand in for separate processes. */
export class MemoryBusNetwork {
  private readonly buses = new Set<MemoryBus>();

  connect(): LiveBus {
    const bus = new MemoryBus(this.buses);
    this.buses.add(bus);
    return bus;
  }
}

class MemoryBus implements LiveBus {
  readonly origin = newOrigin();
  private readonly handlers = new Set<(msg: Envelope) => void>();

  constructor(private readonly peers: Set<MemoryBus>) {}

  publish(msg: BusMessage): void {
    const env: Envelope = { ...msg, origin: this.origin };
    // Asynchronous, like a real network hop.
    for (const peer of this.peers) if (peer !== this) queueMicrotask(() => peer.deliver(env));
  }

  deliver(env: Envelope): void {
    for (const h of this.handlers) h(env);
  }

  subscribe(fn: (msg: Envelope) => void): () => void {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  async close(): Promise<void> {
    this.peers.delete(this);
    this.handlers.clear();
  }
}
