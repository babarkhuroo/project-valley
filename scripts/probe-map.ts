/**
 * Prints an ASCII view of the village grid plus a few economy numbers. Handy when
 * editing config/villageMap.ts:  npx tsx scripts/probe-map.ts
 */
import { createWorld } from '../src/sim/world.ts';
import { createInitialState } from '../src/sim/initialState.ts';
import { estimateJob } from '../src/sim/selectors.ts';
import { buildingCenter } from '../src/sim/grid.ts';

const world = createWorld();
const state = createInitialState(world, 0);
const g = world.grid;
const trees = state.nodes.filter((n) => n.kind === 'tree');
console.log(`nodes=${state.nodes.length} trees=${trees.length} clay=${state.nodes.length - trees.length}`);
const yard = buildingCenter(state.buildings.find((b) => b.defId === 'timberYard')!);
const nearest = [...trees].sort((a, b) => Math.hypot(a.x - yard.x, a.z - yard.z) - Math.hypot(b.x - yard.x, b.z - yard.z));
for (const t of nearest.slice(0, 5)) {
  const e = estimateJob(state, world, state.villagers[0], { kind: 'gather', nodeId: t.id })!;
  console.log(`tree@${t.x.toFixed(1)},${t.z.toFixed(1)} travel=${e.travelSeconds.toFixed(1)}s perMin=${e.perMinute.toFixed(1)}`);
}
let buildable = 0;
for (let i = 0; i < g.width * g.height; i++) if (g.terrainBuildable[i]) buildable++;
console.log(`buildable tiles=${buildable}`);
console.log('legend: # building, T tree, c clay, ~ blocked, = bridge, : road, . buildable, , walkable only');
for (let z = 0; z < g.height; z++) {
  let row = '';
  for (let x = 0; x < g.width; x++) {
    const i = g.index(x, z);
    const node = g.nodeAt[i] ? state.nodes.find((n) => n.id === g.nodeAt[i]) : null;
    row += g.occupancy[i] ? '#' : node ? (node.kind === 'tree' ? 'T' : 'c') : !g.terrainWalkable[i] ? '~' : g.bridge[i] ? '=' : g.moveCost[i] < 1 ? ':' : g.terrainBuildable[i] ? '.' : ',';
  }
  console.log(`${String(z).padStart(2)} ${row}`);
}
