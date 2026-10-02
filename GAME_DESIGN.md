# Project Valley — Game Design

> Living document. Working title and every proper noun live in `src/config/identity.ts`; numbers live in `src/config/*` and are tabulated in [BALANCING.md](BALANCING.md).

## Pillars

1. **Every villager matters.** A handful of named people, each doing one visible job. Choosing who does what is the core decision.
2. **Peaceful progression.** No combat, raids or loss states. Tension comes from allocating labour, food and storage.
3. **Always something happening.** The village is enjoyable to watch: chopping, carrying, stirring, reading, hammering, smoke, water, wildlife.
4. **Never trial and error.** Every rate, blocker and requirement is explained where the player is looking.

## Core loop

```
assign villagers ─▶ they walk, work, carry ─▶ resources fill storage
      ▲                                              │
      │                                              ▼
 new villagers ◀── homes ◀── research ◀── Knowledge ◀── Academy
      │                                              │
      └────────── Stew keeps workers at full speed ◀─┘
```

The opening minute: *tap a tree → pick a villager → they walk over, chop, carry logs to the Timber Yard → the HUD ticks up.*

## Village: Thistledown

A hand-authored 64×64 tile valley floor (`src/config/villageMap.ts`):

| Area | Purpose |
| --- | --- |
| Central clearing | Starting buildings, open space to build |
| North-west forest | Dense timber; lone trees near the Timber Yard make the first minutes quick |
| Creek (east → south-west) | Clay banks on both sides; two footbridges |
| Lake (south-west) | Scenery, reeds, lilies |
| Rocky hills (north-east) | Boulders — future stone quarrying |
| Southern meadow | Open, flowery land beyond the bridge — future farmland |
| Mountain rim (N/E/W) | Natural boundary; the south edge stays low so the camera never looks through hills |

The map is data: forests are polygons scattered with a seeded, spacing-aware sampler, so procedural or seeded maps can reuse the same pipeline.

## Villagers

Each villager is persistent: name, appearance, home, six skills (Woodcutting, Mining, Farming, Research, Construction, Crafting), job, position, carried load, appetite.

State machine (`src/sim/villagerAI.ts`):

```
idle ─assign─▶ walking(toWork) ─arrive─▶ working ─batch─▶ walking(toStorage) ─deliver─▶ walking(toWork) …
                                            │
                                            ├─ direct output (Stew, Knowledge) → next batch
                                            └─ blocked (storage full / no storage / pick research) → resumes automatically
```

- One primary job at a time. Assigning to a full job replaces the longest-serving worker (the UI labels this “Replace …”).
- When a tree or clay bank runs out, the gatherer moves on to the nearest free one within 14 tiles, otherwise goes idle with a notification.
- Idle villagers stroll to their home's door and show a floating “z” badge; the worker list highlights them.

## Food

The Cookhouse cook makes **Stew** into a shared pantry. Anyone doing labour eats one bowl per 20 s of work. With no Stew they keep working at **30 % speed** — never a silent stop. The HUD shows stew income vs. consumption, the chip turns red when low, a throttled toast warns once, and “Next steps” suggests assigning a cook. Cooks don't eat while cooking, so the kitchen can always recover.

The opening tension: two villagers, one cook sustains ≈2.5 full-time workers. Cook for a while, then send both to gather.

## Resources

| Resource | Source | Uses |
| --- | --- | --- |
| Timber | Trees → carried to Timber Yards | Every building |
| Clay | Clay banks (after *Clay Digging*) → Clay Sheds | Later homes, third Timber Yard, every upgrade |
| Stone | Rock Outcrops in the north-east hills (after *Stonecutting*) → Stone Yards | Building upgrades |
| Planks | Sawmill: 4 timber → 2 planks (after *Carpentry*) | Level-3 upgrades, Lodge extension, third Cottage, Warehouse |
| Bricks | Brickworks: 3 clay + 1 timber → 2 bricks (after *Brickmaking*) | Level-3 Cookhouse/Academy, third Cottage |
| Stew | Cookhouse | Keeps labour at full speed |
| Knowledge | Academy scholars | Research |

Storage is shared across buildings of a kind; building more storage raises the cap. Storage buildings show their fill visually (log stacks, clay blocks).

## Construction

Costs are paid when placed; a builder then contributes work (up to two per site). Visual stages: foundation slab → scaffold → walls rising (clipping plane) → finished bounce with confetti. Cancelling refunds everything. Moving any building is free and instant; decorations place instantly.

## Permanent production areas

Natural trees, clay banks and outcrops are finite and regrow slowly. Mid-game research unlocks buildings that never run out and can be placed anywhere — the decision becomes *where*: close to the matching store, because gatherers still carry every load.

| Building | Research (tier) | Job | Workers | Level 2 |
| --- | --- | --- | --- | --- |
| Woodlot | Managed Woodland (4) | Cutting timber | 2 | 3 workers, ×1.2 |
| Clay Pit | Clay Pits (4) | Digging clay | 2 | 3 workers, ×1.2 |
| Quarry | Stone Quarry (5) | Quarrying stone | 2 | 3 workers, ×1.2 |

## Workshops & crafting

Processing moves the economy from gathering to manufacturing. A workshop (Sawmill, Brickworks) holds up to 4 **orders** — 1–50 items or *keep making* — that can be reordered or cancelled. Its assigned crafter (Crafting skill) works through them one item per batch: an item's inputs are taken when it starts (cancelling refunds a started item) and its output is stored when it finishes. Everything is part of the deterministic sim, so workshops keep producing while you are away.

The crafter never stalls silently: *Waiting for timber*, *Planks storage full* and *No orders* show in the worker list and the panel, resolve by themselves when the situation changes, and an emptied queue sends one notification. The Warehouse stores finished goods for both workshops.

## Building upgrades

Most buildings have levels (data in `config/buildings.ts`, `upgrades`). An upgrade is paid up front, then builders work on it while the building **keeps working**. Each level is visible: stone footings, awnings, extra chimneys, a dormer, ovens, kilns, hoists, a second observatory, plus a blue (level 2) or gold (level 3) pennant.

| Building | Level 2 | Level 3 (needs *Masonry*, village level 3) |
| --- | --- | --- |
| Timber Yard / Clay Shed / Stone Yard | more storage (no stone needed for the first two) | more storage |
| Cookhouse | bigger pantry, 2 cooks, cooking ×1.2 | bigger pantry, cooking ×1.4 |
| Academy | bigger bank, 2 scholars, study ×1.2 | bigger bank, study ×1.4 |
| Founders' Lodge | third bed (needs *Masonry*) | — |

Speed bonuses appear as their own factor in the productivity formula ("Cookhouse level 2 ×1.20"). When storage is full, *Next steps* points at an affordable upgrade before suggesting a new building.

## Research & levels

Two intertwined progressions:

- **Village level** (XP from construction, research, tutorial beats) opens research **tiers**.
- **Research** decides what is actually unlocked. Knowledge flows into the active project; switching keeps progress; with no project it banks up to the Academy's capacity and the scholar pauses when full.

Tier 1 offers a real choice from minute five: more villagers (*Cottage Craft*), a new resource (*Clay Digging*), or faster food (*Hearty Recipes*). Tiers 2–3 branch into stone, workshops, storage, food efficiency, gathering speed, faster regrowth, faster construction and more homes. Tiers 4–5 (village levels 4–5) bring permanent production areas, Houses, Organised Stores, Preserved Food, Apprenticeship (practice up to skill level 3), Master Crafts and Master Builders.

## Population

Start with two founders in the Founders' Lodge (a third bed once extended with *Masonry*). Each Cottage (limited by research: 1 → 2 → 3) adds a bed and each House (*Family Homes*, a second with *Townhouses*) adds two — at most 10 villagers in this milestone; a free bed brings three travellers to choose from, each already practised (level 1) in one skill. Newcomers walk in along the southern road.

## Skills

Skill level multiplies work rate (+10 % per level early on). Villagers gain practice XP from every batch, up to level 2 (3 with *Apprenticeship*); beyond that is guild training in the Valley (milestone 3).

## Offline progress

The simulation is event-driven and deterministic, so time away is replayed exactly — villagers finish batches, eat, deliver, fill storage and stop. Elapsed time comes from the **server clock**. Up to 7 days are simulated. A “While you were away” summary lists gains, completed work and warnings.

## Tutorial

Contextual coach card + world arrow, each beat completes by doing the thing (and steps satisfied early are skipped):

1. Welcome · 2. Assign a woodcutter · 3. Assign a cook · 4. Reach 60 Timber · 5. Build the Academy · 6. Research Cottage Craft · 7. Build a Cottage · 8. Welcome a newcomer · 9. Done → “Next steps” takes over.

## UX rules (always answerable)

| Question | Where |
| --- | --- |
| What are my villagers doing? | Worker list (task + progress), badges over heads |
| What resources do I have? | Resource bar with capacity and net rate/min |
| What am I working toward? | Tutorial coach, active research, XP ring |
| What can I unlock next? | Research tree (states, costs, requirements) |
| Why can't I build/assign this? | Red costs + reasons on build cards; blockers in panels |
| What should I do next? | “Next steps” card |

## Pacing targets

Measured by the autoplayer (`npm run simulate`, see BALANCING.md); it plays faster than most people, so real play is slower.

| Target | Autoplayer today |
| --- | --- |
| Academy within 5 min | 1m 45s |
| Village level 2 and a third villager within ~12 min | 6m 45s |
| A real unlock every few minutes in the first hour; villagers never waiting | 0 % waiting in hours 1–2 |
| Later tiers spread over days of casual play | level 6 at ~2h 15m, all M2 content by ~3h |

Once everything is built (from hour 3 in the autoplayer), villagers mostly wait on full storage and research. The Valley (milestone 3) adds the long-term resource sink: contributions.

## Roadmap

- **Milestone 2:** ✅ Stone, quarrying and the Stone Yard · ✅ building upgrades with visual levels · ✅ processing chains (Sawmill → planks, Brickworks → bricks, Warehouse) with offline crafting queues · ✅ research tiers 4–5, Houses, permanent production areas · ✅ economy simulation / balancing tools (scripted autoplayer → pacing report, chart in the dev panel, pacing tests).
- **Milestone 3:** The Hearthlands (shared Valley) map, Valley buildings & research, contributions, guild training, merchants, reputation — with simulated neighbours first.
- **Milestone 4:** Real multiplayer (auth, Valley membership, synced contributions, chat, presence, events).
- **Polish:** Richer models and animation, VFX, day/night, accessibility pass, mobile tuning, balancing from playtests.
