import { BALANCE } from '../config/balance';
import { BUILDINGS } from '../config/buildings';
import { IDENTITY } from '../config/identity';
import { FOUNDERS } from '../config/villagers';
import { SAVE_VERSION } from './save';
import { createVillager } from './population';
import type { BuildingInstance, GameState } from './types';
import { frontSpot } from './villagerAI';
import { generateNodes, syncWorld, type World } from './world';

export function createInitialState(world: World, now: number, seed = world.map.seed): GameState {
  const state: GameState = {
    schemaVersion: SAVE_VERSION,
    seed,
    time: 0,
    rng: seed ^ 0x9e3779b9,
    nextId: 1,
    player: { name: 'Founder', villageName: IDENTITY.defaultVillageName, xp: 0, level: BALANCE.start.level },
    resources: { ...BALANCE.start.resources },
    villagers: [],
    buildings: [],
    nodes: [],
    research: { completed: [], progress: {}, active: null },
    newcomers: null,
    tutorial: { step: 0, done: false, skipped: false },
    stats: {},
    lastProcessedAt: now,
    revision: 0,
  };

  for (const sb of world.map.startBuildings) {
    const def = BUILDINGS[sb.building];
    const b: BuildingInstance = {
      id: state.nextId++,
      defId: sb.building,
      cellX: sb.cellX,
      cellZ: sb.cellZ,
      rotation: sb.rotation,
      level: 1,
      status: 'complete',
      progress: def.costs[0].work,
      workRequired: def.costs[0].work,
      paid: {},
      completedAt: 0,
      variant: 0,
      upgrade: null,
    };
    state.buildings.push(b);
  }

  state.nodes = generateNodes(world, state.nextId);
  state.nextId += state.nodes.length;
  syncWorld(world, state);

  const lodge = state.buildings.find((b) => b.defId === 'lodge') ?? null;
  const door = lodge ? frontSpot(world, lodge) : { x: world.map.width / 2, z: world.map.height / 2 };
  FOUNDERS.forEach((template, i) => {
    const v = createVillager(state, template, lodge?.id ?? null, { x: door.x - 0.6 + i * 1.2, z: door.z + 0.5 });
    state.villagers.push(v);
  });
  return state;
}
