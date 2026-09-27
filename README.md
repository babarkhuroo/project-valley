# Project Valley

A peaceful, cooperative village-building game for the browser — TypeScript, three.js and React. Assign villagers to jobs, keep the stew pot going, research new ideas, raise homes and watch a wilderness clearing become a village.

This repository currently contains the **vertical slice**: one hand-authored village, villagers with pathfinding and animated work, timber/clay/stew/knowledge economy, construction, a research tree, population growth, save/load with server-authoritative offline progress, a contextual tutorial and developer tools.

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
