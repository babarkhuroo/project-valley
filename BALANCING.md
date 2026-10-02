# Balancing

> Generated from `src/config/*` by `npm run balance-doc`. Edit the config, not this file.

All rates assume an untrained, fed villager (work rate 1.0/s). Skill, research and hunger multiply the rate — see *Worker productivity*.

## Worker productivity

`work rate = base × skill multiplier × research multiplier × (hungry ? hungry multiplier : 1)`

| Setting | Value |
| --- | --- |
| Base work rate | 1 work/s |
| Hungry multiplier | ×0.3 |
| Walk speed | 2.2 tiles/s (×1.3 on roads, ×0.85 carrying) |
| Builders per site | 2 |
| Auto-continue radius | 14 tiles |

## Jobs & production

| Job | Skill | Work / batch | Output / batch | Delivery | Eats Stew | Output / min (no travel) |
| --- | --- | --- | --- | --- | --- | --- |
| Cutting timber | Woodcutting | 6 | 4 Timber | carry | yes | 40 |
| Digging clay | Mining | 8 | 4 Clay | carry | yes | 30 |
| Quarrying stone | Mining | 10 | 3 Stone | carry | yes | 18 |
| Cooking stew | Farming | 8 | 1 Stew | direct | no | 7.50 |
| Studying | Research | 6 | 1 Knowledge | direct | yes | 10 |
| Building | Construction | 5 | 5 construction work | site | yes | 60 work |

## Food

| Setting | Value |
| --- | --- |
| Work fuelled by one Stew | 20 s |
| Stew eaten per full-time worker | 3 / min |
| One cook produces | 7.50 Stew / min |
| Full-time workers one cook sustains | 2.50 |

## Resource nodes

| Node | Job | Amount | Regrow | Workers | Unlocked by |
| --- | --- | --- | --- | --- | --- |
| Tree | Cutting timber | 24 | 15 min | 1 | start |
| Clay Deposit | Digging clay | 40 | 20 min | 1 | Clay Digging |
| Rock Outcrop | Quarrying stone | 60 | 40 min | 1 | Stonecutting |

## Buildings

| Building | Footprint | Max (base) | Cost by copy | Work by copy | XP | Provides | Unlocked by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cookhouse | 3×3 | start only | — | — | 0 | stores 40 Stew; 1 × cooking stew | — |
| Founders' Lodge | 3×2 | start only | — | — | 0 | houses 2 | — |
| Academy | 3×3 | 1 | #1: 60 Timber | 40 | 40 | stores 30 Knowledge; 1 × studying | — |
| Timber Yard | 2×2 | 3 | #1: 40 Timber<br>#2: 40 Timber<br>#3: 70 Timber, 20 Clay | 20 / 20 / 35 | 15 | stores 120 Timber | — |
| Clay Shed | 2×2 | 2 | #1: 50 Timber<br>#2: 80 Timber, 30 Clay | 30 / 40 | 20 | stores 100 Clay | Clay Digging |
| Stone Yard | 2×2 | 2 | #1: 60 Timber, 20 Clay<br>#2: 90 Timber, 40 Clay | 35 / 45 | 25 | stores 100 Stone | Stonecutting |
| Cottage | 2×2 | 1 | #1: 100 Timber<br>#2: 120 Timber, 50 Clay<br>#3: 160 Timber, 90 Clay | 60 / 75 / 90 | 50 | houses 1 | Cottage Craft |
| Flower Bed | 1×1 | 24 | #1: 5 Timber | instant | 1 | decoration | — |
| Lantern Post | 1×1 | 16 | #1: 12 Timber | instant | 1 | decoration | — |
| Garden Bench | 1×1 | 12 | #1: 15 Timber | instant | 1 | decoration | — |

## Building upgrades

Upgrades keep the footprint, are paid up front, need builder work, and the building keeps working meanwhile. Stats replace the previous level's values.

| Building | Level | Cost | Work | Requires | Effect | XP |
| --- | --- | --- | --- | --- | --- | --- |
| Cookhouse | 1 → 2 | 120 Timber, 50 Clay, 40 Stone | 60 | — | stores 60 Stew; 2 worker slots; work ×1.2 | 40 |
| Cookhouse | 2 → 3 | 200 Timber, 100 Clay, 120 Stone | 90 | Masonry, village level 3 | stores 90 Stew; work ×1.4 | 60 |
| Founders' Lodge | 1 → 2 | 150 Timber, 80 Clay, 80 Stone | 80 | Masonry | houses 3 | 60 |
| Academy | 1 → 2 | 140 Timber, 60 Clay, 50 Stone | 70 | — | stores 50 Knowledge; 2 worker slots; work ×1.2 | 45 |
| Academy | 2 → 3 | 220 Timber, 120 Clay, 140 Stone | 100 | Masonry, village level 3 | stores 80 Knowledge; work ×1.4 | 70 |
| Timber Yard | 1 → 2 | 80 Timber, 30 Clay | 30 | — | stores 200 Timber | 20 |
| Timber Yard | 2 → 3 | 120 Timber, 40 Clay, 60 Stone | 45 | Masonry, village level 3 | stores 320 Timber | 35 |
| Clay Shed | 1 → 2 | 90 Timber, 40 Clay | 30 | — | stores 170 Clay | 20 |
| Clay Shed | 2 → 3 | 120 Timber, 60 Clay, 60 Stone | 45 | Masonry, village level 3 | stores 260 Clay | 35 |
| Stone Yard | 1 → 2 | 80 Timber, 30 Clay, 40 Stone | 35 | — | stores 170 Stone | 25 |
| Stone Yard | 2 → 3 | 120 Timber, 60 Clay, 100 Stone | 50 | Masonry, village level 3 | stores 260 Stone | 40 |

## Research

| Tier (level) | Project | Knowledge | XP | Requires | Effect |
| --- | --- | --- | --- | --- | --- |
| 1 | Cottage Craft | 20 | 20 | — | Learn to raise a snug Cottage — a home for one more villager. |
| 1 | Clay Digging | 15 | 15 | — | Work the soft creek banks for Clay, and build a Clay Shed to store it. |
| 1 | Hearty Recipes | 25 | 25 | — | Better recipes let the cook fill bowls 25% faster. |
| 2 | Growing Hamlet | 60 | 60 | Cottage Craft | Room for a second Cottage — and a second newcomer. |
| 2 | Stonecutting | 50 | 50 | Clay Digging | Learn to split the hillside rock. Quarry Rock Outcrops and store stone in a Stone Yard. |
| 2 | Sturdy Racks | 45 | 45 | Clay Digging | Reinforced shelving: Timber Yards and Clay Sheds hold 50% more. |
| 2 | Field Rations | 40 | 40 | Hearty Recipes | Packed lunches: each bowl of Stew fuels 30% more work. |
| 2 | Sharpened Axes | 40 | 40 | — | A whetstone for every axe. Woodcutting is 20% faster. |
| 2 | Study Notes | 50 | 50 | — | Shared notebooks help scholars earn Knowledge 25% faster. |
| 3 | Village Commons | 120 | 120 | Growing Hamlet | Plan a proper village green with room for a third Cottage. |
| 3 | Iron-shod Spades | 80 | 80 | Stonecutting | Iron edges on every spade and pick. Digging clay and quarrying stone are 20% faster. |
| 3 | Masonry | 100 | 100 | Stonecutting | Mortar, footings and true walls. Buildings can be raised to level 3, and the Founders’ Lodge can grow a third bed. |
| 3 | Woodland Tending | 110 | 110 | Sharpened Axes | Replant as you go. Felled trees regrow three times faster. |
| 3 | Builder's Plans | 90 | 90 | Study Notes | Drawn plans and measured timber. Construction is 25% faster. |

- Tier 1: 60 Knowledge in total ≈ 6 scholar-minutes.
- Tier 2: 285 Knowledge in total ≈ 28.50 scholar-minutes.
- Tier 3: 500 Knowledge in total ≈ 50 scholar-minutes.

## Village levels

| Level | Total XP | Opens |
| --- | --- | --- |
| 1 | 0 | Research tier 1: Cottage Craft, Clay Digging, Hearty Recipes |
| 2 | 80 | Research tier 2: Growing Hamlet, Sturdy Racks, Field Rations, Sharpened Axes, Study Notes, Stonecutting |
| 3 | 250 | Research tier 3: Village Commons, Iron-shod Spades, Masonry, Woodland Tending, Builder's Plans |
| 4 | 550 | — |
| 5 | 1000 | — |
| 6 | 1700 | — |
| 7 | 2600 | — |

Level-up gift: 40 Timber, 25 Stew (capped by storage). Tutorial beats: +5 XP each.

## Skills

| Level | Work-rate multiplier | Practice XP needed (cumulative) |
| --- | --- | --- |
| 0 | ×1 | 0 |
| 1 | ×1.1 | 30 |
| 2 | ×1.2 | 90 |
| 3 | ×1.3 | guild training |
| 4 | ×1.42 | guild training |
| 5 | ×1.55 | guild training |
| 6 | ×1.7 | guild training |

Practice: +1 XP per finished batch in the job's skill, up to level 2. Skills: Woodcutting, Mining, Farming, Research, Construction, Crafting.

## Timers & persistence

| Setting | Value |
| --- | --- |
| Offline progress cap | 168 h |
| Autosave interval | 15 s (plus on tab hide / close) |
| Starting resources | 20 Timber, 30 Stew |
