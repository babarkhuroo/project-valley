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
| Clay | Clay banks (after *Clay Digging*) → Clay Sheds | Later homes, third Timber Yard |
| Stew | Cookhouse | Keeps labour at full speed |
| Knowledge | Academy scholars | Research |

Storage is shared across buildings of a kind; building more storage raises the cap. Storage buildings show their fill visually (log stacks, clay blocks).

## Construction

Costs are paid when placed; a builder then contributes work (up to two per site). Visual stages: foundation slab → scaffold → walls rising (clipping plane) → finished bounce with confetti. Cancelling refunds everything. Moving any building is free and instant; decorations place instantly.

## Research & levels

Two intertwined progressions:

- **Village level** (XP from construction, research, tutorial beats) opens research **tiers**.
- **Research** decides what is actually unlocked. Knowledge flows into the active project; switching keeps progress; with no project it banks up to the Academy's capacity and the scholar pauses when full.

Tier 1 offers a real choice from minute five: more villagers (*Cottage Craft*), a new resource (*Clay Digging*), or faster food (*Hearty Recipes*). Tiers 2–3 branch into storage, food efficiency, woodcutting/clay speed, faster regrowth, faster construction and more homes.

## Population

Start with two founders in the Founders' Lodge. Each Cottage (limited by research: 1 → 2 → 3) adds a bed; a free bed brings three travellers to choose from, each already practised (level 1) in one skill. Newcomers walk in along the southern road.

## Skills

Skill level multiplies work rate (+10 % per level early on). Villagers gain practice XP from every batch, up to level 2; beyond that is guild training in the Valley (milestone 3).

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

## Roadmap

- **Milestone 2:** Stone, building upgrades with visual levels, larger research tree, crafting queues, advanced materials (planks, bricks), more homes, balancing tools.
- **Milestone 3:** The Hearthlands (shared Valley) map, Valley buildings & research, contributions, guild training, merchants, reputation — with simulated neighbours first.
- **Milestone 4:** Real multiplayer (auth, Valley membership, synced contributions, chat, presence, events).
- **Polish:** Richer models and animation, VFX, day/night, accessibility pass, mobile tuning, balancing from playtests.
