import { describe, expect, it } from 'vitest';
import { assignVillager } from '../src/sim/commands';
import { deserialize, migrate, SAVE_VERSION, SaveError, serialize, type Migration } from '../src/sim/save';
import { makeGame, nearestNode, villager } from './helpers';

describe('save system', () => {
  it('round-trips a running game exactly', () => {
    const h = makeGame();
    assignVillager(h.state, h.world, villager(h).id, { kind: 'gather', nodeId: nearestNode(h, 'tree').id }, h.events);
    h.run(45);
    const restored = deserialize(serialize(h.state));
    expect(restored).toEqual(h.state);
    expect(restored.schemaVersion).toBe(SAVE_VERSION);
  });

  it('walks old saves forward through every migration step', () => {
    const migrations: Record<number, Migration> = {
      0: (d) => ({ ...d, wood: undefined, resources: { timber: d.wood } }),
      1: (d) => ({ ...d, stats: {} }),
    };
    const out = migrate({ schemaVersion: 0, wood: 12 }, migrations, 2);
    expect(out.schemaVersion).toBe(2);
    expect(out.resources).toEqual({ timber: 12 });
    expect(out.stats).toEqual({});
  });

  it('rejects saves from the future and gaps in the migration chain', () => {
    expect(() => migrate({ schemaVersion: SAVE_VERSION + 1 })).toThrow(SaveError);
    expect(() => migrate({ schemaVersion: 0 }, {}, 1)).toThrow(/No migration/);
    expect(() => deserialize('{"schemaVersion":1}')).toThrow(SaveError);
  });
});
