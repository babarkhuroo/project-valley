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
| Southern meadow | Open, flowery land beyond the bridge — fertile farmland: Grain Fields here yield 25% more |
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
| Grain | Grain Fields (after *Field Sowing*) → Granaries | Cooking: 1 grain makes a pot of 3 Stew instead of 1; merchant crates |
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

## Farming

*Field Sowing* (tier 3, food) unlocks the **Grain Field** (3×3, two farmers, Farming skill) and the **Granary**. A farmer's batch does whatever the field needs: **sow** a fallow field, **tend** a growing crop (each tending batch brings the harvest 45 s closer), or **cut** a load of 4 grain and carry it to a Granary. A sown crop also ripens untended in 10 minutes, so fields keep growing while nobody — or nobody online — is there; ripening is an exact event in the sim. A ripe field holds 24 grain (30 on the southern meadow; *Crop Rotation* adds 25% and a third field), cut row by row from the open side.

Grain is what lets food scale past the Cookhouse's one or two cooks: with grain in store each pot takes one handful and makes three bowls. Two farmers keep one cook's pot full. The farmer's animation follows the field — scattering seed, hoeing, a low sickle sweep, carrying sheaves — and the crop visibly sprouts, grows, turns gold and is cut down. Farmer's Tea and the Cooks' Guild speed farming as well as cooking; merchants start asking for grain once a village has a Granary.

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

Skill level multiplies work rate (+10 % per level early on). Villagers gain practice XP from every batch, up to level 2 (3 with *Apprenticeship*); beyond that is guild training in the Valley (see *Guild training*).

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

## The Valley: The Hearthlands

Researching **The Valley Road** (tier 3) opens a road over the ridge to a shared valley twice the width of a village. It is cooperative, never competitive: neighbouring villages restore its communal buildings together, and every restored level helps **every** member's village.

| District | What's there |
| --- | --- |
| Hearth Plaza | Hearth Hall — restore it first; it opens everything else |
| Guild Row | Six guild halls (Foresters, Miners, Cooks, Scholars, Builders, Craftsfolk) |
| Saltreach Harbour | The Trading Post and its pier, where merchant ships dock |
| Lantern Hill | The Great Library — Valley research |
| Market Green | The Festival Grounds — rotating festivals |
| Millrace | The Millrace Workshop — cooperative crafting shifts |
| Goldfurrow Fields | Farmland — reserved for farming (later) |
| Old Wood, Greystep Quarry, Silverrun, The Far Reach | Scenery now; the Far Reach is fenced off for future expansion |

- **Contributing:** pick a project, choose amounts per resource (or *All I can*) and send. Resources leave the village immediately; anything the project no longer needs (a neighbour got there first) comes back. Each delivery earns **reputation** (1 per 10 timber's worth; stone, planks and bricks count more).
- **Restoration:** once a level's materials are all in, builders work for 1–12 hours, scaffolding and a crane go up, then the building visibly gains its level and the bonus switches on everywhere: Hearth Hall (Stew lasts longer, more storage), guilds (+5% per level to their trade: woodcutting, digging & quarrying, cooking, study, construction, crafting).
- **Neighbours:** seven simulated villages (Rowan of Brackenford, Ilse of Millbrook, …) deliver parcels through the day, sleep at night, and favour projects that are nearly done. They and their helpers walk the Valley carrying parcels and hammering on site. Shares are shown per member in a fixed order — who's helping, not a leaderboard.
- **News:** the Valley log shows deliveries and milestones; restorations and newly opened projects arrive as notifications even while you're in your village.

## Merchants, coins and tonics

Restoring the Valley's **Trading Post** (Saltreach Harbour) brings merchant ships to every member's village. A ship docks beside the pier for 4 hours with 3–5 crates to fill (more and better-paid with Trading Post levels) — each asks for one good the village can actually make, sized to its storage, and pays **coins** and reputation. Prices swing per crate and per merchant, so some crates are a bargain and some are better left for building; filling all of them earns a bonus. Ships keep calling while you're away (the summary says if one sailed without trading), and a "Next steps" tip and toast announce each arrival.

**Coins** buy **tonics** from the ship (two on offer, limited stock) and, next, guild training. Tonics are the boost system: Woodworker Tonic, Miner's Meal, Farmer's Tea, Research Brew, Builder's Brew, Crafter's Oil — +50% to their trade for 30 minutes; another dose extends it. They show in the work-rate formula like any other factor.

## Valley research

The Valley has its own research, separate from each village's Academy, run from the **Great Library** on Lantern Hill. **Valley Knowledge** comes from cooperation: every delivery to a Valley project adds some (neighbours' too), and every merchant crate a member fills adds more. Until the Library is restored only a little can wait on its old shelves.

Members **vote** on what to research next — the most-voted available project gets the Knowledge (ties go to whatever is furthest along). Neighbours vote according to their own tastes, so the player's vote can tip a choice, and everyone can see who wants what. Finished projects help every member's village: longer-lasting Stew, more storage, better merchant pay, ships returning sooner, shorter and cheaper guild lessons.

## Festivals

The *Festival Charter* Valley research opens the **Festival Grounds** on Market Green. Once restored, the Valley holds a festival every few days — Harvest Festival, Great Construction Project, Expedition Supplies, Lantern Fair — each a 48-hour shared goal (Stew counts here, unlike building projects). Neighbours join in; if the goal is met, every member who delivered anything gets coins and reputation (more with Festival Grounds levels), the first win of some festivals unlocks Festival Lanterns for the village, and the Valley gets Valley Knowledge. Missing the goal costs nothing — there's always another. The sidebar shows the running festival and a "Next steps" tip points to it from the village.

## Cooperative crafting: the Millrace Workshop

*Millrace Works* (Valley research) opens the **Millrace Workshop** on the Silverrun — a waterwheel-driven saw and a shared kiln. A village sends one of its villagers for a 2-hour **shift** with materials from home (100 timber for sawn beams, 60 stone to dress, 120 timber for planks, 100 clay + 20 timber for bricks). The shared machinery makes more than a village could alone, and more again with company: +5% for every neighbour on shift at the time (they take turns through their waking hours, and the panel shows who's there), +5% per level of the villager's Crafting skill, and up to +32% from the workshop's own levels. The goods go straight to the Valley project the player picks; anything it no longer needs comes home. Like lessons, a shift takes the villager away from their job — they walk back to it afterwards.

## Guild training

Practice teaches a skill up to level 2 (3 with *Apprenticeship*). Past that, a villager must train at the matching Valley guild — Foresters' Lodge (woodcutting), Miners' Guild (mining), Cooks' Guild (farming/cooking), Scholars' Guild (research), Builders' Guild (construction), Craftsfolk's Guild (crafting). Each guild level opens one more skill level (4 / 5 / 6).

Training is a real trade-off: the lesson costs coins (100 → 480) and the villager leaves the village — walking out along the road, then away for 1–8 hours — so their job sits empty. They come home a level higher (+10–15% speed) and walk straight back to their old job if nobody took the slot. Lessons are offered on the villager panel and on each guild's Valley panel; trainees are seen standing at their guild, and lessons finish during offline time like everything else.

## Reputation Road

Reputation (from Valley deliveries and trade) unlocks a road of twelve rewards claimed in order: coins, tonics, bundles of planks/bricks/stone, and two decorations only it gives (the Valley Banner and the Fountain). Nothing on it is paid; it rewards taking part.

## Playing together (milestone 4)

- **Sign-in.** Every browser plays straight away as a guest; *Settings → You* adds a username and password so the same village can be played on any device, and sets the name other players see.
- **Finding a Valley.** The first trip over the ridge asks how: **found** a Valley (name it, open or invite-only), **join friends** with a six-letter invite code, or **browse** open Valleys with room (busiest first). A Valley holds up to ten players; the simulated neighbours make room as players arrive (the least involved family moves on first, keeping the Valley at eight) and come back if players leave. Leaving keeps your past help on the Valley's record; parcels still on the road come home.
- **Live.** While you're connected, everything other members do arrives as it happens — deliveries filling bars, builds finishing, votes, festival goals, chat. A dot shows who is here now (players while connected, neighbours while awake).
- **Chat.** One friendly thread per Valley, reachable from the top bar anywhere; other players' messages pop up while it's closed. Neighbours chime in too — welcoming newcomers, cheering finished buildings and festivals.

## Polish

- **Day and night.** The world follows the player's local clock: warm sunrise, bright day, golden dusk, a soft blue night where windows and lanterns glow, stars come out, chimney smoke and water dim, and fireflies replace the birds and butterflies. The sun crosses the sky so shadows move through the day. It is only a look — nothing in the simulation depends on it — and *Settings → Display* can keep it always day.
- **Accessibility.** *Settings → Accessibility*: interface size (80–140%, scales every panel and button), calm motion (follows the device's reduced-motion setting by default; stops UI animations and thins particle effects), high contrast. Every control is keyboard-reachable with a visible focus ring, Esc backs out of anything, and notifications are announced to screen readers.
- **Sound.** Everything is synthesised in the browser. The running-water bed swells as the camera nears the creek or the bay; birds sing by day and fall quiet at night, when crickets take over and the wind calms; walkers' footsteps are heard when zoomed in. The generative music changes mood with the day — warm by day, a softer Lydian colour at dusk, a slow music-box at night — and the Valley has its own livelier market-day theme. Moods change on a bar line, never mid-phrase.
- **Feature introductions.** After the opening tutorial, each later system — clay, stone, upgrades, workshops, production areas, the Valley, merchants, tonics, the Reputation Road, guild training, Valley research, festivals, the Millrace — gets one short card the first time it becomes available, with a "Show me" that opens the right place. One at a time; villages from before this existed start with what they already use marked as seen.
- **Quality.** *Settings → Graphics*: Automatic (default) watches frame times and lowers resolution — and then shadows — when frames run slow, raising them again when there's headroom; or fixed High / Balanced / Low. This is what keeps phones smooth.

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
- **Milestone 3:** ✅ The Hearthlands map, travel, server-owned Valley state with simulated neighbours, communal buildings restored through contributions, shared bonuses, reputation · ✅ Trading Post, merchant ships, coins, tonics, the Reputation Road · ✅ guild training · ✅ Valley research (Great Library, Valley Knowledge, votes) · ✅ festivals at Market Green · ✅ cooperative crafting at the Millrace.
- **Milestone 4:** ✅ Accounts and authorised API · ✅ found / join (code or open list) / leave Valleys, real players replacing neighbours · ✅ live updates over WebSockets, presence, chat · next: a database-backed store and multi-process hosting.
- **Polish:** ✅ day/night ambience · ✅ accessibility and quality settings · ✅ sound (water, night, footsteps, music moods) · ✅ feature introductions · ✅ farming (Grain Fields, Granary, hearty Stew) · next: balancing from playtests.
