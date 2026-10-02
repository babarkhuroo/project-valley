# Project Valley — Architecture

## Layers

```
src/
  config/      static, data-driven definitions (buildings, research, jobs, map, balance, names)
  world/       pure terrain math: heights, water, paths, noise
  sim/         deterministic simulation — plain data in, plain data out, no three.js, no DOM
  game/        orchestration: Game (tick/commands/events), clock, persistence, offline, tutorial
  rendering/   three.js views that *read* sim state; input → camera + picks
  audio/       synthesised sound (no sample files)
  ui/          React HUD/panels; Zustand holds UI-only state
server/        persistence API (Node http middleware + file store)
scripts/       balance-doc generator, map probe
tests/         economy tests (vitest)
```

Dependency direction: `config ← world ← sim ← game ← {rendering, ui}`. The simulation never imports rendering or UI, which is what makes offline catch-up, fast-forward, unit tests and future server-side validation possible.

## Simulation

**State** (`sim/types.ts`) is a single JSON-serialisable `GameState`: villagers, buildings, nodes, resources, research, tutorial, stats, RNG state, sim clock. Static definitions are referenced by id and never copied into saves.

**World** (`sim/world.ts`) is derived, never saved: the `Terrain` field and a `NavGrid` (walkable/buildable/road-cost/occupancy layers), rebuilt after load and after any building change.

**Discrete-event integration** (`sim/simulation.ts`). Every villager can report the exact time of its next state change:

- walking → route arrival time (routes are time-parameterised waypoints; roads are faster),
- working → `min(batch finishes, next meal due)` given its current constant work rate,
- node regrowth timers.

`advance(dt)` repeatedly jumps to the earliest event, integrates the continuous quantities (work progress, appetite) analytically over the gap, processes the event, and re-checks villagers waiting on shared state (food arriving, storage freed, research picked). The same function runs every frame (dt ≈ 16 ms), under dev speed-ups, and for a week of offline catch-up in one call. A test asserts that one 30-minute advance equals 54,000 frame-sized ones.

**Building levels** (`sim/levels.ts`): `buildingStats(defId, level)` folds the base definition and its `upgrades` into effective storage, housing, worker slots and output multiplier; capacity, housing, job slots and work rates all read it. An upgrade lives on the instance as `upgrade: { toLevel, progress, workRequired, paid }`; builders reuse the `construct` job (`siteWork()` treats new sites and upgrades alike) and the building stays operational until `completeUpgrade` bumps the level.

**Commands** (`sim/commands.ts`) are the only player mutations: assign/unassign, place/move/cancel building, choose research, accept newcomer, rename. Each validates and returns a readable refusal reason. **Events** (`sim/events.ts`) are transient facts (`deposit`, `constructionComplete`, `hungry`, `levelUp`, …) consumed by rendering (particles, sound), UI (toasts) and offline summaries.

**Pathfinding** (`sim/pathfinding.ts`): A* over the 64×64 grid, 8-way without corner cutting, road cells cheaper; greedy line-of-sight smoothing that won't leave or enter a road mid-segment. Searches reuse typed-array scratch buffers (sub-millisecond on this map, so no worker thread is needed yet). After any building change every walking villager re-plans and anyone inside a new footprint is moved out.

**ECS?** Deliberately not. Entity counts are small, behaviours are few and state must serialise cleanly; plain data plus focused system functions (`villagerAI`, `construction`, `research`, `population`, `economy`) is simpler. Revisit if Valley scenes need thousands of heterogeneous entities.

## Game layer

`Game` owns `state` + `world`, runs `tick(realDt)` (scaled by dev speed) and `run(command)`, and broadcasts events. Frames longer than 20 s (backgrounded tab) are flagged as catch-up so the UI shows a summary instead of a burst of toasts.

`boot.ts`: load save → replay elapsed time with the same `advance` → summarise. `autosave.ts`: every 15 s plus `visibilitychange`/`pagehide` (sendBeacon).

## Rendering

`GameRenderer` owns the WebGL context and composes views; every frame it ticks the game, then renders current state:

| View | Notes |
| --- | --- |
| `TerrainView` | One vertex-coloured mesh (grass variation, forest floor, meadows, roads, sand, clay earth, rock, snow) + placement-grid overlay driven by a data texture |
| `WaterView` | Single plane; shader reads a baked depth texture for shallow→deep colour and an animated foam line |
| `NatureView` | Trees/clay/stumps (instance → node id for picking) and grass/flowers/bushes/reeds/lilies/rocks as culled `InstanceField`s with a wind vertex shader; decoration hides under new buildings |
| `BuildingsView` | Procedural models; construction = foundation → scaffold → clipping plane rising with progress; storage fill shown as stacked logs/blocks; registers chimney/cauldron anchors with `SmokeSystem`; flags, telescope |
| `VillagersView` | Primitive rigs merged per pivot (≈8 draw calls each); pose from sim state (walk/carry/chop/dig/cook/read/hammer/celebrate); impact callbacks drive chips, sounds and tree shake — cosmetic only |
| `Particles` | Two pooled instanced meshes (puffs, bits), live particles packed so only they are drawn |
| `SmokeSystem` | Chimney smoke and cauldron steam in one draw call: emitter slots × looping billboard puffs animated entirely in the vertex shader from `uTime`; intensity changes are latched per puff at birth so smoke fades out naturally; CPU only touches attributes when emitters change |
| `WorldOverlay` | HTML badges pinned to world points (status icons, names, site progress, +N floaters, tutorial arrow), updated via transforms only |
| `CameraController` | Damped orbit around a ground target, pitch 34°→56° with zoom, grab-to-pan, zoom-to-cursor, inertia, bounds, terrain clearance |

Models are procedural placeholders built behind stable interfaces (`createBuildingModel`, `createVillagerRig`), so authored glTF assets can replace them without touching gameplay. Building models merge static parts per material at build time. Thumbnails (portraits, build-menu icons) are rendered from the same models by an offscreen renderer.

### Culling and LOD (`rendering/culling/`)

- **`ChunkGrid`** partitions the world (including the scenic margin) into 12-tile chunks. Each frame it tests every chunk's bounds — grown by a shadow margin so off-screen casters still shadow the view — against the camera frustum, records the closest camera distance, and drops chunks beyond the fog.
- **`InstanceField`** is one instanced layer. Instances are stored sorted by chunk; each LOD level is a *single* `InstancedMesh`, and the instances of chunks visible at that level are packed into its buffer (only when visibility, LOD or an instance changes). Draw calls stay constant while submitted triangles follow what the camera sees. Trees: detailed canopy → low-poly beyond 38 units; small decoration fades out per layer (mushrooms 34 … lilies 60). A small hysteresis band stops LOD flicker; packed indices map back to source instances for picking.
- **`OcclusionQueries`**: WebGL2 `ANY_SAMPLES_PASSED_CONSERVATIVE` queries on invisible proxy boxes drawn after opaque geometry. Results are read a frame later (no GPU stalls); a chunk hides after two negative answers, hidden chunks are re-tested every frame, visible ones round-robin (6/frame), and anything leaving the frustum or containing the camera is reset to visible. Verified pixel-identical to rendering without occlusion.
- Terrain is split into 4×4 tiles (normals from the height field, so seams are invisible) for frustum culling; wildlife meshes refresh bounds each frame; villagers swap to a one-draw-call far model beyond 46 units; decoration buildings hide beyond 60.
- The dev panel shows live draw calls/triangles/chunk counts with a toggle per feature.

Measured (village from the slice, desktop, triangles include the shadow pass): mid zoom 602k → 305k triangles with all three features; close zoom 572k → 201k; full zoom-out 642k → 367k. Shadows use a frustum that follows the camera target with texel snapping.

## UI

React for HUD/panels; Zustand stores UI concerns only (selection, mode, panels, toasts). Components re-render ~7×/s via a `tick` counter and read live state from `runtime.game`, avoiding per-frame React work. The renderer receives UI intent through a plain `ViewState` object; world input comes back through an `InteractionHandler`. Dev tools are a lazily imported component guarded by `import.meta.env.DEV`, so they are absent from production bundles.

## Persistence & backend

```
GET    /api/time
GET    /api/save/:playerId      → { revision, serverSavedAt, payload, now }
PUT    /api/save/:playerId      ← { revision, payload }   (POST for sendBeacon)
DELETE /api/save/:playerId
```

- The **server clock is authoritative** for offline time: elapsed = `serverNow − serverSavedAt`, both stamped by the server.
- Saves carry a monotonically increasing `revision`; the server rejects stale writes (409), and the client prefers a newer local cache only when the server copy is older (offline play).
- `localStorage` is a cache, never the only copy.
- **Schema versions:** `SAVE_VERSION` + an ordered `MIGRATIONS` table; loading walks old saves forward one version at a time and rejects saves from the future. v2 added stone and building upgrades. Map content that needs the world to place (new resource nodes) is reconciled after loading by `ensureMapNodes`, which appends missing nodes without touching existing ids.

The API is Connect-style middleware mounted in Vite for development and in `server/index.ts` for production, over a `SaveStore` interface (file-backed today).

### Planned relational model (PostgreSQL via Prisma, milestone 4)

Static definitions stay in code/config; only per-player and shared runtime state is stored:

```
User(id, auth…)                       Player(id, userId, name, level, xp)
Village(playerId, stateJson, revision, savedAt)   -- the personal sim stays a versioned document
Valley(id, name, seed, stateJson, revision)
ValleyMember(valleyId, playerId, joinedAt, role)
ValleyBuilding(valleyId, defId, level, status, progress)
ValleyContribution(valleyId, buildingId, playerId, resource, amount, at)
ValleyResearch(valleyId, researchId, progress, completedAt)
Merchant(valleyId, arrivesAt, leavesAt) / TradeTask(merchantId, playerId, request, reward, status)
Event(id, kind, startsAt, endsAt, goal) / EventContribution(eventId, playerId, amount)
```

Personal villages remain single documents (their state is highly interlinked and simulated as a whole); shared Valley state is relational because many players write to it concurrently.

## Multiplayer direction

- The Valley server is authoritative for shared resources, contributions, Valley research, trades, events and timers; clients send intents, the server validates and broadcasts deltas over WebSockets.
- Villager transforms are **not** streamed: routes are deterministic functions of time, so clients can render other players' villagers from job assignments alone.
- Because the personal sim is deterministic and dependency-free, the server can re-run it to validate a client's claimed state (anti-cheat) before accepting contributions.

## Testing

`npm test` covers production, storage caps and resumption, food/hunger, skill and research bonuses, construction (costs, builders, cancel, move), research (flow, switching, banking, gating), offline determinism and long catch-ups, pathfinding (obstacles, water, bridges, re-planning), XP/levels, population, and save round-trip/migrations.
