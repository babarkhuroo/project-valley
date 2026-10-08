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

Open http://localhost:5173. The dev server also serves the save API (`/api/*`), storing saves in `server/data/saves/`.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | Economy/simulation test suite (vitest) |
| `npm run typecheck` | Strict TypeScript check |
| `npm run build` | Production build into `dist/` (dev tools are stripped) |
| `npm run serve` | Production server: `dist/` + save API on `PORT` (default 8080) |
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
