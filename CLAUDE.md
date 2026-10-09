# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Project Valley is a peaceful, cooperative village-building browser game (TypeScript, three.js, React, Zustand, Vite). Milestones 1–4 are done (village, economy depth, the shared Valley, real multiplayer: accounts, joining Valleys, live updates, chat); polish is under way and storage can be Postgres with several server processes; the roadmap (stone/upgrades/crafting → shared Valley → multiplayer) is in GAME_DESIGN.md. It is inspired by Everdale's gameplay structure but must never use Everdale/Supercell names, assets or UI art — all models, icons and audio are procedurally generated in code.

## Commands

```bash
npm run dev            # Vite dev server on :5173, also serves the save API (/api/*)
npm test               # vitest run (tests/*.test.ts); Postgres tests are skipped unless TEST_DATABASE_URL is set
npm run test:pg        # Postgres store tests against the local project_valley_test database (throwaway schema)
npx vitest run tests/offline.test.ts          # one file
npx vitest run -t "moves on to the next tree"  # one test by name
npm run typecheck      # tsc -b (TypeScript 7; unused locals/params are errors)
npm run build          # tsc -b && vite build → dist/ (dev tools are stripped)
npm run serve          # production server: dist/ + save API on $PORT (default 8080); DATABASE_URL=postgres:///project_valley → Postgres
DATABASE_URL=… npx tsx scripts/import-to-postgres.ts  # copy server/data (files) into Postgres
npm run balance-doc    # regenerate BALANCING.md from src/config — never hand-edit BALANCING.md
npm run simulate [-- 8]        # autoplayer pacing report (milestone times, hourly waiting share)
npx tsx scripts/probe-map.ts   # ASCII dump of the village grid + early production rates
node scripts/headless.mjs <cmd> # drive a headless Chrome (CDP on :9333) for screenshots/eval — usage in the file header
```

Set `VITE_CONFIG_NATIVE_IGNORE_WARNING=true` to silence Vite 8's config-loader warning. Node is installed via nvm, so `.claude/launch.json` runs Vite through an absolute node path.

## Architecture

Dependency direction is strict: `config ← world ← sim ← valley ← game ← {rendering, ui}`; `server/` may import `config` and `valley` only. `src/sim` and `src/valley` must never import three.js, the DOM, rendering or UI.

- **`src/config/`** — all static, data-driven definitions and balance numbers (buildings with per-copy cost tables, research effects, jobs, nodes, map layout, tutorial text). `identity.ts` holds every proper noun so the game can be renamed in one place. Add content here, not in logic.
- **`src/world/`** — pure terrain math (`Terrain`: precomputed height/water/path fields). Shared by the sim (walkability) and the renderer (meshes).
- **`src/sim/`** — deterministic simulation over a single JSON-serialisable `GameState` (`types.ts`). Key ideas that span several files:
  - **Discrete-event integration** (`simulation.ts` + `villagerAI.ts`): each villager reports the exact time of its next state change (route arrival, batch done, meal due); `advance(state, world, dt, sink)` jumps event to event and integrates work/appetite analytically. The same call runs per frame, under dev speed-ups, and for days of offline catch-up — `tests/offline.test.ts` asserts one big step equals thousands of small ones. Anything added to the sim must keep this property (report next-event times; rates constant between events).
  - Walks are time-parameterised `Route`s; a villager's position is a function of sim time (`villagerPosition`), which is also how the renderer draws them.
  - `World` (terrain + `NavGrid` occupancy/walkability) is derived and never saved; call `syncWorld` + `refreshAfterGridChange` after buildings change (commands already do).
  - Building stats depend on level: always read storage/housing/slots/speed through `levels.ts` (`buildingStats`), never straight from the definition. Upgrades reuse the `construct` job via `siteWork()`.
  - Grain Fields (`farming.ts`): a farm batch acts on the field's stage (sow / tend / harvest); crops ripen on a `ripeAt` timer that is an event in the loop (`fieldsNextEvent`/`processFields`), and tending pulls it earlier. Cooking consumes grain at batch end for extra bowls (`cookPot`).
  - All player mutations go through `commands.ts` (validated, return readable refusal reasons). Research effects are aggregated in `modifiers.ts`. UI read-models (task labels, rate breakdowns, estimates, "next steps") live in `selectors.ts`.
  - `SimEvent`s are transient (never saved) and feed particles/sound, toasts and offline summaries.
  - Balancing: `autoplay.ts` (scripted player using only commands) + `economySim.ts` (`runEconomySim` → `PacingReport`). `tests/pacing.test.ts` guards pacing; after tuning config, re-run `npm run simulate` and `npm run balance-doc`, and update the autoplayer's goal and research lists when you add content.
  - Saves: `save.ts` has `SAVE_VERSION` + ordered `MIGRATIONS`; bump and add a migration whenever `GameState` changes shape. New map nodes reach old saves through `ensureMapNodes` (append-only; new node kinds go at the end of `generateNodes` so existing ids never shift).
- **`src/valley/`** — the shared Valley's simulation, **owned by the server** and clocked in wall-clock ms (`advanceValley(v, now)`; same one-step-equals-many property, tested). Simulated neighbours deliver seeded parcels; `contribute` is idempotent per `opId`. The village side lives in `sim/valley.ts` (`sendToValley` → saved outbox → `settleValleyOp`), and restored-building bonuses are cached in `state.valley.bonuses` so village catch-up stays deterministic. `game/valleyClient.ts` polls, joins, flushes the outbox. Valley content (districts, buildings, neighbours, pacing) is in `config/valley.ts`, the map in `config/valleyMap.ts`; new Valley buildings reach existing Valleys through `upgradeValley` (bump `VALLEY_SCHEMA`). Merchants/tonics/Reputation Road are village-side timers in `sim/trade.ts` (config in `config/trade.ts`), gated by the Valley's Trading Post level in `state.valley.bonuses.tradeLevel`. Valley research (Great Library, votes, Knowledge) and festivals are server-side in `valleySim.ts`; Valley buildings can require research. Trips to the Valley — guild lessons (`sim/training.ts`) and Millrace shifts (`sim/millrace.ts`) — share `sim/away.ts`: the villager is `away` (job null, `away` set, finished by the event loop) — idle checks must use `!v.job && !v.away`. The outbox carries typed targets (`building` / `knowledge` / `festival`). Pseudo-states built for rendering (Valley scenery) must carry every `GameState` field the shared views read (`trade`, `valley`, `research`).
- **`src/game/`** — `Game` owns state/world and is the only entry point for time (`tick`, `skip`) and commands (`run`, `mutate`); it broadcasts events. `boot.ts` loads and replays offline time; `persistence.ts`/`autosave.ts` talk to the API. Offline elapsed time uses the **server** clock (`serverNow − serverSavedAt`); save `revision`s reject stale writes; localStorage is only a cache.
- **`src/rendering/`** — `GameRenderer` owns WebGL, ticks the game each frame, then renders state through views (terrain, water, bridges, instanced nature, buildings with clip-plane construction stages, villager rigs, particles, HTML `WorldOverlay`). Rendering only reads state; animation "impacts" are cosmetic callbacks. Models are procedural and hidden behind `createBuildingModel` / `createVillagerRig` so real assets can replace them. Performance matters: static building parts are merged per material, villager parts per pivot, particles pack live instances. Instanced scenery goes through `rendering/culling/` (`ChunkGrid` frustum + distance, `InstanceField` per-LOD packing with constant draw calls, `OcclusionQueries` WebGL2 queries) — add new scattered layers as `InstanceField`s, not raw `InstancedMesh`es. Chimney smoke/steam is GPU-animated in `SmokeSystem`.
- **`src/ui/`** — React HUD. Zustand (`store.ts`) holds UI-only state; components re-read live game state via `useGameState()` which re-renders on a ~7 Hz `tick`, not per frame. `actions.ts` wraps commands with feedback; `interaction.ts` implements the renderer's `InteractionHandler`. `runtime` (in `src/game/runtime.ts`) holds the long-lived game/renderer/audio singletons. The dev panel is lazily imported behind `import.meta.env.DEV`.
- **`server/`** — Connect-style API middleware (`api.ts`) over `SaveStore` / `ValleyStore` / `AuthStore` interfaces; `backend.ts` picks Postgres (`db/pgStores.ts`, migrations in `db/schema.ts`) when `DATABASE_URL` is set, else JSON files in `server/data/` (gitignored, single process only). Anything that must not race across processes lives in the store: `SaveStore.write` refuses stale revisions atomically, `ValleyStore.lock` wraps each Valley load→advance→save (Postgres advisory lock), auth claims/usernames are unique inserts. `bus.ts` (`LiveBus`; Postgres LISTEN/NOTIFY) lets hubs on different processes share commits, membership moves and presence. `auth.ts`: guest sessions + accounts; every `/api/save|valley/:id` call needs that player's token (`apiFetch` on the client). `live.ts` + `ws.ts`: the WebSocket hub at `/api/live` pushing Valley snapshots/presence. Mounted into Vite in dev (`vite.config.ts`, incl. upgrade routing) and served by `server/index.ts` in production. Tests that import Node modules live in `tests/server/` (type-checked by `tsconfig.node.json`).

In dev builds `window.valley` exposes `{ game, renderer, valleyRenderer, valley (client), audio }` for debugging. The Valley scene (`rendering/valley/`) replaces the village renderer while visiting (`ui.scene`); the dev server alone exposes `POST /api/valley/:id/dev-skip` (dev panel → *Valley time*) to age a Valley.

## Docs

GAME_DESIGN.md (systems, UX rules, roadmap), ARCHITECTURE.md (detailed design incl. planned Postgres model and multiplayer approach), BALANCING.md (generated).
