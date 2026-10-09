# Project Valley

A peaceful, cooperative village-building game for the browser — TypeScript, three.js and React. Assign villagers to jobs, keep the stew pot going, research new ideas, raise homes and watch a wilderness clearing become a village.

What's here (milestones 1–4):

- **The village** — a hand-authored valley floor, villagers with pathfinding and animated work, food, construction, a five-tier research tree, population growth, a contextual tutorial and developer tools.
- **Economy depth** — stone, clay, planks and bricks; building upgrades with visible levels; workshops with offline crafting queues; permanent production areas; practice skills; an economy simulator that guards pacing.
- **The shared Valley** — *The Hearthlands*, owned by the server and shared with seven simulated neighbours: communal buildings restored through contributions (with bonuses for every village), merchant ships and coins, tonics, the Reputation Road, guild training, Valley research with votes, festivals, and cooperative crafting shifts at the Millrace.

- **Playing together** — guest play with optional accounts, founding or joining Valleys (invite codes or an open list, up to ten players, neighbours making room), live updates over WebSockets, presence and chat.

Everything simulates deterministically and keeps running while you're away, measured by the server's clock. See GAME_DESIGN.md for the roadmap.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The dev server also serves the save API (`/api/*`), storing saves, Valleys and accounts as JSON files in `server/data/`.

### With PostgreSQL

Set `DATABASE_URL` and the same server stores everything in Postgres instead (the schema is created and migrated on start-up). That is also what lets several server processes run side by side behind a load balancer: they share the database, serialise each Valley with an advisory lock, and pass live updates to each other with `LISTEN`/`NOTIFY`.

```bash
createdb project_valley
```

```bash
DATABASE_URL=postgres:///project_valley npm run serve
```

To move an existing file-backed server's data across (safe to re-run):

```bash
DATABASE_URL=postgres:///project_valley npx tsx scripts/import-to-postgres.ts
```

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | Economy/simulation test suite (vitest) |
| `npm run test:pg` | Postgres store tests, in a throwaway schema of `project_valley_test` (or `TEST_DATABASE_URL`) |
| `npm run typecheck` | Strict TypeScript check |
| `npm run build` | Production build into `dist/` (dev tools are stripped) |
| `npm run serve` | Production server: `dist/` + save API on `PORT` (default 8080); Postgres when `DATABASE_URL` is set |
| `npm run balance-doc` | Regenerate [BALANCING.md](BALANCING.md) from the config |
| `npx tsx scripts/probe-map.ts` | ASCII view of the village grid and early production rates |

## Controls

- **Drag** to pan · **wheel / pinch** to zoom · **right-drag** or **Q/E** to rotate · **WASD / arrows** to pan
- **Click** a villager, building, tree or clay bank to inspect it and assign workers
- **R** rotates a building while placing · **Esc** cancels / deselects
- The wrench button (development builds only) opens speed controls (1×–50×), time skips, resources, research and villager cheats

## Documentation

- [GAME_DESIGN.md](GAME_DESIGN.md) — loop, systems, UX rules, roadmap
- [ARCHITECTURE.md](ARCHITECTURE.md) — simulation, rendering, persistence, multiplayer plan
- [BALANCING.md](BALANCING.md) — generated tables of costs, rates, XP and timers

## Renaming

Every player-facing proper noun (game title, village and valley names, storage key prefix) is in `src/config/identity.ts`. All art and audio are procedurally generated and original.
