# Project Valley — Architecture

## Layers

```
src/
  config/      static, data-driven definitions (buildings, research, jobs, map, balance, names)
  world/       pure terrain math: heights, water, paths, noise
  sim/         deterministic simulation — plain data in, plain data out, no three.js, no DOM
  valley/      shared-Valley simulation (server-owned): projects, contributions, simulated neighbours
  game/        orchestration: Game (tick/commands/events), clock, persistence, offline, tutorial
  rendering/   three.js views that *read* sim state; input → camera + picks
  audio/       synthesised sound (no sample files)
  ui/          React HUD/panels; Zustand holds UI-only state
server/        persistence + Valley API (Node http middleware, ValleyService, file stores)
scripts/       balance-doc generator, pacing simulator, map probe, headless-Chrome driver
tests/         economy tests (vitest)
```

Dependency direction: `config ← world ← sim ← valley ← game ← {rendering, ui}`, and `server` imports `config`/`valley` only. The simulation never imports rendering or UI, which is what makes offline catch-up, fast-forward, unit tests and future server-side validation possible.

## Simulation

**State** (`sim/types.ts`) is a single JSON-serialisable `GameState`: villagers, buildings, nodes, resources, research, tutorial, stats, RNG state, sim clock. Static definitions are referenced by id and never copied into saves.

**World** (`sim/world.ts`) is derived, never saved: the `Terrain` field and a `NavGrid` (walkable/buildable/road-cost/occupancy layers), rebuilt after load and after any building change.

**Discrete-event integration** (`sim/simulation.ts`). Every villager can report the exact time of its next state change:

- walking → route arrival time (routes are time-parameterised waypoints; roads are faster),
- working → `min(batch finishes, next meal due)` given its current constant work rate,
- node regrowth timers.

`advance(dt)` repeatedly jumps to the earliest event, integrates the continuous quantities (work progress, appetite) analytically over the gap, processes the event, and re-checks villagers waiting on shared state (food arriving, storage freed, research picked). The same function runs every frame (dt ≈ 16 ms), under dev speed-ups, and for a week of offline catch-up in one call. A test asserts that one 30-minute advance equals 54,000 frame-sized ones.

**Building levels** (`sim/levels.ts`): `buildingStats(defId, level)` folds the base definition and its `upgrades` into effective storage, housing, worker slots and output multiplier; capacity, housing, job slots and work rates all read it. An upgrade lives on the instance as `upgrade: { toLevel, progress, workRequired, paid }`; builders reuse the `construct` job (`siteWork()` treats new sites and upgrades alike) and the building stays operational until `completeUpgrade` bumps the level.

**Production areas** reuse the `operate` job: when the building's job has `delivery: 'carry'` (Woodlot, Clay Pit, Quarry) a finished batch becomes a carried load that walks to storage exactly like gathering from a node, and multi-worker crews are spread around the footprint (`spreadSpot`).

**Crafting** (`sim/crafting.ts`, recipes in `config/recipes.ts`): workshops carry `craft: { orders, current }`. The crafter's `operate` job runs one batch per item — `startNextItem` checks output space and takes the inputs (setting `current`), `finishItem` stores the output and counts the head order down (`-1` = keep making). Blocked states (`noOrders`, `noInputs`, `storageFull`) are re-checked in `settleVillagers`, so workshops resume on their own and offline catch-up stays exact.

**Commands** (`sim/commands.ts`) are the only player mutations: assign/unassign, place/move/cancel building, choose research, accept newcomer, rename. Each validates and returns a readable refusal reason. **Events** (`sim/events.ts`) are transient facts (`deposit`, `constructionComplete`, `hungry`, `levelUp`, …) consumed by rendering (particles, sound), UI (toasts) and offline summaries.

**Pathfinding** (`sim/pathfinding.ts`): A* over the 64×64 grid, 8-way without corner cutting, road cells cheaper; greedy line-of-sight smoothing that won't leave or enter a road mid-segment. Searches reuse typed-array scratch buffers (sub-millisecond on this map, so no worker thread is needed yet). After any building change every walking villager re-plans and anyone inside a new footprint is moved out.

**Economy simulation** (`sim/autoplay.ts`, `sim/economySim.ts`): a deterministic scripted player (a build/upgrade priority list, a research order and a priority-role allocator for cooking, building, studying, crafting and gathering whatever is scarcest) acts only through the normal commands every 15 s of sim time while `advance` runs in between. `runEconomySim(seconds)` returns a `PacingReport`: milestone times, per-minute samples and per-hour idle/waiting/hungry shares. Since it shares the real sim, every config change shows up in it immediately. It drives `npm run simulate`, the *Simulated pacing* section of BALANCING.md, the dev panel's *Economy simulation* chart, and `tests/pacing.test.ts`, which guards early-game speed and late-game length.

**ECS?** Deliberately not. Entity counts are small, behaviours are few and state must serialise cleanly; plain data plus focused system functions (`villagerAI`, `construction`, `research`, `population`, `economy`) is simpler. Revisit if Valley scenes need thousands of heterogeneous entities.

## The Valley (milestone 3)

The Valley is a second, independent simulation whose state is **owned by the server** and advanced by the **server's wall clock** (ms), never by a player's village clock.

- **State** (`valley/types.ts`): members (players and simulated neighbours), one record per communal building (`level`, `status` locked → collecting → building → collecting/complete, `delivered`, per-member `shares`, `doneAt`), a capped news log (deliveries make way before milestones), seeded RNG, and per-member op results for idempotency.
- **Simulation** (`valley/valleySim.ts`): discrete-event like the village — `advanceValley(v, now)` jumps between neighbour visits and build completions; neighbours wake, sleep (8 h a day at their own hour), and deliver seeded parcels to the projects closest to done. One big advance equals many small ones (tested), so a Valley left alone for a week replays exactly.
- **Server** (`server/valleyService.ts`): every read or write first advances the Valley to `Date.now()`; calls on one Valley are serialised by a promise lock so concurrent members can't overwrite each other. `ValleyStore` has file, in-memory and Postgres implementations. Until matchmaking (milestone 4) each player founds their own Valley shared with seven simulated neighbours.
- **Village side** (`sim/valley.ts`): `sendToValley` takes resources out of the village at once and queues a `ValleyOp` in the saved **outbox**; `game/valleyClient.ts` posts ops oldest-first with their `opId` (the server returns the stored result for a repeat, so retries after a dropped connection are safe) and applies the answer with `settleValleyOp` — reputation for what was accepted, anything no longer needed comes home. Nothing is ever lost or double-counted, even across reloads and offline play.
- **Bonuses** from restored buildings (guild job rates, storage, meal length) are copied from each snapshot into `state.valley.bonuses`, so village offline catch-up stays deterministic: it uses the bonuses known when the save was made.

```
GET  /api/valley/:playerId              → { valley, memberId, now } | 404
POST /api/valley/:playerId/join         ← { name, villageName }
POST /api/valley/:playerId/contribute   ← { opId, building, resources } → { result, valley, now } | 422
POST /api/valley/:playerId/dev-skip     ← { hours }   (dev server only: ages the Valley)
```

**Merchants** (`sim/trade.ts`, `config/trade.ts`) are deliberately *village-side*: once the Valley's Trading Post level reaches the village (via `state.valley.bonuses.tradeLevel`), ship arrival/departure and tonic expiry become ordinary timer events in the village simulation (`tradeNextEvent` / `processTrade` in the event loop), rolled from the village RNG. So ships come and go during offline catch-up, and a tonic's rate change lands exactly on its expiry (one-step-equals-many is tested with ships and tonics). Coins, tonics and Reputation Road progress live in `state.trade`; crates, purchases, tonics and road claims are plain commands.

**Trips to the Valley** (`sim/away.ts`) — guild lessons (`sim/training.ts`) and Millrace shifts (`sim/millrace.ts`) — share one shape (`Villager.away`, a `lesson | shift` union). Guild training adds an `away` activity: the villager walks to the village road (`toValley` purpose), then `training.until` is just another next-event time, and the event loop brings them back (`returnFromTraining`: level up, re-enter at the road, resume the stored job if its slot is free). Guild levels reach the village through `state.valley.bonuses.guildLevels`. Away villagers are hidden from the village scene and mirrored at their guild in the Valley scene.

**Valley research** lives in `ValleyState.research` (server side): Knowledge raised by any contribution (`raiseKnowledge`), banked (capped) until the Great Library opens, then poured into `leadingResearch` — most votes, then most progress, then tree order. Simulated neighbours always hold a vote (`settleVotes`); players vote through `POST /api/valley/:id/vote`. Knowledge earned in the village (merchant crates) travels as an outbox op with `target: { kind: 'knowledge' }` — the outbox now names a typed target, so new kinds of Valley delivery reuse the same idempotent pipeline. Completed projects fold into `valleyBonuses` (trade pay/gap and training time/cost multipliers, plus storage and meals).

**Festivals** are part of the Valley timeline: `nextFestivalAt` and a running festival's `endsAt` are events in `advanceValley`, neighbours split visits between projects and the festival, and deliveries use the outbox with `target: { kind: 'festival', festivalId }`. Rewards are village-side: when a snapshot shows a won festival the village has a share in, the client applies `claimFestival` once (ids kept in `state.trade.festivalsClaimed`). Valley buildings can now require Valley research (`requires: { research }`).

Valley content versioning: `VALLEY_SCHEMA` plus `upgradeValley` (run on every server load) adds buildings introduced after a Valley was founded, so existing Valleys pick up new content (schema 2: the Trading Post).

Rendering: `rendering/valley/ValleyRenderer` is a second scene built from the same parts — the Valley map uses the village map format (`config/valleyMap.ts`), so `Terrain`, `TerrainView`, water, bridges, `NatureView` and ambient wildlife are reused; `ValleyBuildingsView` shows each communal building as a ruin, under scaffolding (with a crane) or restored with visible levels; `ValleyFolk` walks the neighbours (reusing `VillagersView` over a scenery-only state) between projects and districts. Travelling swaps renderers (only one WebGL context exists at a time); the village keeps ticking while you visit.

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
| `VillagersView` | One skinned mesh per villager (primitives rigidly bound to 18 bones: elbows, knees, eyelids, mouth, hair, job clothing; one draw call). Poses are flat lists of joint values built each frame from sim state — walk/carry cycles with knee bend and turn lean, every job's work cycle, waiting with folded arms, celebrate — and blended over 0.22 s whenever the animation changes. Idle villagers breathe, shift weight, fidget (look around, stretch, scratch, yawn — more after dark) and chat with a neighbour standing close by (taking turns: gestures and mouth for the speaker, nods for the listener); everyone blinks. Impact callbacks drive chips, sounds and tree shake — cosmetic only |
| `Hens` | A pair of hens per home and the Cookhouse (two instanced meshes): peck, scratch, wander their yard, scatter with a cluck from walkers, settle by the door at night. Never saved |
| `Particles` | Two pooled instanced meshes (puffs, bits), live particles packed so only they are drawn |
| `SmokeSystem` | Chimney smoke and cauldron steam in one draw call: emitter slots × looping billboard puffs animated entirely in the vertex shader from `uTime`; intensity changes are latched per puff at birth so smoke fades out naturally; CPU only touches attributes when emitters change |
| `WorldOverlay` | HTML badges pinned to world points (status icons, names, site progress, +N floaters, tutorial arrow), updated via transforms only |
| `CameraController` | Damped orbit around a ground target, pitch 34°→56° with zoom, grab-to-pan, zoom-to-cursor, inertia, bounds, terrain clearance |

Models are procedural placeholders built behind stable interfaces (`createBuildingModel`, `createVillagerRig`), so authored glTF assets can replace them without touching gameplay. Building models merge static parts per material at build time; moving parts are anchors the view drives (spinners, wavers, flames, storage fills, parts that only move while someone works, and `animate` callbacks for multi-part motion such as the Clay Pit's windlass). Storage buildings give a small hop when a load is delivered. Thumbnails (portraits, build-menu icons) are rendered from the same models by an offscreen renderer.

### Day and night (`rendering/DayCycle.ts`)

One `DayCycle` per renderer blends keyframes (sky/fog colour, sun colour and intensity, hemisphere and ambient fill, exposure, lamp glow) on the local clock, moves the sun east → west (a dimmer moon at night), fades a star dome in, scales every emissive material's glow (`setNightGlow`, materials are shared so it's one pass), and sets `sharedUniforms.uDayTint` for unlit shaders (water, smoke). `AmbientLife` hides day creatures at night and `Fireflies` (one additive instanced mesh) fades in. It only runs on frames where the hour moved, and never touches simulation state.

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
- **Schema versions:** `SAVE_VERSION` + an ordered `MIGRATIONS` table; loading walks old saves forward one version at a time and rejects saves from the future. v2 added stone and building upgrades; v3 added planks, bricks and workshop queues; v4 added Valley membership, reputation and the delivery outbox; v5 added coins, merchant ships, tonics and the Reputation Road; v6 added guild training (`Villager.training`, `away` activity); v7 added Valley research multipliers and typed outbox targets; v8 added collected festival rewards; v9 merged lessons into `away` trips and added the workshop bonuses. Valley schema 3 added `research`, schema 4 festivals. A shift's output multiplier (skill, neighbours on shift from the shared pure `millraceCrew`, workshop level) is fixed when it starts, and its goods are queued as an ordinary building delivery when it ends. Map content that needs the world to place (new resource nodes) is reconciled after loading by `ensureMapNodes`, which appends missing nodes without touching existing ids.

**Identity** (`server/auth.ts`, `src/game/session.ts`): every browser holds a session token proving it owns its player id — guests get one automatically (an existing local village is claimed first-come), and a username + password account (scrypt-hashed, tokens stored as sha-256, a short lockout after repeated failures) lets the same village be played on any device. With an `AuthService`, every `/api/save/:id` and `/api/valley/:id` call must carry a token for that id (`Authorization: Bearer`, or `token` in the body for `sendBeacon`). While the browser switches identity nothing is saved, so the old village can never be written under the new id.

The API is Connect-style middleware mounted in Vite for development and in `server/index.ts` for production, over `SaveStore` / `ValleyStore` / `AuthStore` interfaces (files, or Postgres — below).

### Storage: files or PostgreSQL

`server/backend.ts` chooses the stores for a process: **PostgreSQL** when `DATABASE_URL` is set, JSON files in `server/data/` otherwise (one process only). Everything above the `SaveStore` / `ValleyStore` / `AuthStore` interfaces is identical.

The schema lives in `server/db/schema.ts` as ordered, append-only migrations, applied at start-up under an advisory lock (so processes starting together don't race):

```
village_saves(player_id PK, revision, server_saved_at, payload jsonb)
valleys(id PK, name, code, open, players, neighbours, levels, state jsonb, updated_at)   -- code + open-list indexes
valley_members(player_id PK, valley_id → valleys, joined_at)
accounts(username PK, display_name, player_id, salt, hash, created_at)
players(player_id PK, username → accounts)        -- ids someone owns (guest or account)
sessions(token_hash PK, player_id, username, created_at)
```

Villages and Valleys are stored as **versioned JSON documents**, not normalised tables. This departs from the earlier plan (a relational Valley model through Prisma): both are simulated as a whole — the client's deterministic village sim, the server's Valley sim with idempotent op ids — so the document is the unit that is read, advanced and written, and splitting it into rows would only add joins to every request. What has to be found or unique on its own (membership, invite codes, the open-Valley list, accounts, sessions, guest claims) has real columns and indexes. Plain `pg` with hand-written SQL keeps the dependency small.

**What keeps several processes correct:**

| Risk | Where it's handled |
| --- | --- |
| A stale save overwriting a newer one | `SaveStore.write`: one conditional upsert (`… WHERE revision <= EXCLUDED.revision`) |
| Two processes advancing the same Valley at once (lost deliveries) | `ValleyStore.lock`: a session advisory lock per Valley, held on its own connection pool for the whole load → advance → save; released by Postgres if the process dies. `tests/server/postgres.test.ts` shows deliveries are lost without it |
| Two browsers claiming one player id, or one username | `INSERT … ON CONFLICT DO NOTHING` |
| Login lockout | Per process (it only needs to slow guessing down) |
| Chat rate limit | Per process, as before |

### Live updates across processes

Each process keeps its own WebSocket connections. The `LiveHub` publishes three small messages on a `LiveBus` (`server/bus.ts`; Postgres `LISTEN`/`NOTIFY` in production, an in-memory network in tests):

- `changed {valleyId}` after every commit: other processes with members of that Valley reload it from the database and push the snapshot.
- `member {playerId, valleyId}` when someone joins or leaves: their socket may be on another process.
- `presence {valleyId, online}` whenever a process's connected players change, and as a 10 s heartbeat. Each process merges the others' lists; a process that goes silent (crash) is forgotten after 35 s.

Measured with two production processes on one database: a delivery or chat line through one reaches a player on the other immediately, a graceful shutdown updates presence in ≈0.2 s, a `kill -9` in ≈40 s, and a dropped `LISTEN` connection reconnects by itself. `scripts/import-to-postgres.ts` copies a file-backed server's data into Postgres.

## Multiplayer (milestone 4)

- **Membership** (`valleySim.ts` + `server/valleyService.ts`): Valleys carry a name, an invite `code` and an `open` flag; members have `leftAt` (players who left, neighbours who moved on). `addPlayer` / `removePlayer` call `rebalanceNeighbours`, which keeps active members at `TARGET_MEMBERS` (8) by retiring or recalling simulated neighbours; at most `MAX_PLAYERS` (10) players. Routes: `GET /api/valleys` (open Valleys with room), `POST /api/valley/:id/{create,join,leave,settings,profile,chat}`; joining takes `{ code }` or an open `{ valleyId }`.
- **Live link** (`server/ws.ts`, `server/live.ts`, client in `game/valleyClient.ts`): a dependency-free RFC 6455 endpoint at `/api/live?token=…` (Vite's dev server and the production server both route upgrades to it). `ValleyService` notifies listeners after every committed change; the `LiveHub` pushes a snapshot to every connected member (serialised once per change) and the list of connected players on every arrival/departure, and advances connected Valleys every 10 s so neighbours' activity streams in. All writes stay on the HTTP API (validated, idempotent); the socket is server → client only, so a dropped connection loses nothing — the client reconnects with backoff and keeps a slow poll as a safety net.
- **Chat** lives in `ValleyState.chat` (last 80, tidied, 200 chars, rate-limited per member); simulated neighbours add seeded lines on welcomes, finished buildings and festivals, so replays stay deterministic.
- **Scaling:** with `DATABASE_URL` set, any number of processes can serve players behind a load balancer (no sticky sessions needed): per-Valley locks are Postgres advisory locks and the hubs share commits and presence over `LISTEN`/`NOTIFY` (see *Storage* above). Without it, files and one process.

## Multiplayer direction

- The Valley server is authoritative for shared resources, contributions, Valley research, trades, events and timers; clients send intents, the server validates and broadcasts deltas over WebSockets. Milestone 3 already works this way over polling (12 s while visiting, 45 s otherwise); WebSockets replace the poll in milestone 4, and real players replace simulated neighbours one membership at a time.
- Villager transforms are **not** streamed: routes are deterministic functions of time, so clients can render other players' villagers from job assignments alone.
- Because the personal sim is deterministic and dependency-free, the server can re-run it to validate a client's claimed state (anti-cheat) before accepting contributions.

## Performance budget (measured 2026-10-08, Node, M-series Mac)

| What | Time |
| --- | --- |
| Village: a week of offline catch-up for a 10-villager mid-game village (25 merchant ships, tonics) | ≈ 11 ms |
| Valley: 30 days of neighbours, builds, research, festivals and chat | ≈ 20 ms |
| Economy simulator: 4 hours of autoplay with decisions every 15 s | ≈ 0.5 s |

Both simulations are event-driven, so cost scales with events, not elapsed time. Rendering cost is bounded by culling/LOD (above) and, on slow devices, by the automatic quality governor.

## Testing

`npm test` covers production, storage caps and resumption, food/hunger, skill and research bonuses, construction (costs, builders, cancel, move), research (flow, switching, banking, gating), offline determinism and long catch-ups, pathfinding (obstacles, water, bridges, re-planning), XP/levels, population, save round-trip/migrations, upgrades, crafting, tiers 4–5, culling, the Valley (founding, determinism, neighbour pacing, idempotent contributions, build phases, bonuses in the village, outbox settle-once, the server service's locking), and simulated pacing (`tests/pacing.test.ts`: e.g. Academy < 5 min, level 2 < 12 min, Quarry not before 2 h).
