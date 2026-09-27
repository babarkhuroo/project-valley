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

## Buildings

| Building | Footprint | Max (base) | Cost by copy | Work by copy | XP | Provides | Unlocked by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cookhouse | 3×3 | start only | — | — | 0 | stores 40 Stew; 1 × cooking stew | — |
| Founders' Lodge | 3×2 | start only | — | — | 0 | houses 2 | — |
| Academy | 3×3 | 1 | #1: 60 Timber | 40 | 40 | stores 30 Knowledge; 1 × studying | — |
| Timber Yard | 2×2 | 3 | #1: 40 Timber<br>#2: 40 Timber<br>#3: 70 Timber, 20 Clay | 20 / 20 / 35 | 15 | stores 120 Timber | — |
| Clay Shed | 2×2 | 2 | #1: 50 Timber<br>#2: 80 Timber, 30 Clay | 30 / 40 | 20 | stores 100 Clay | Clay Digging |
| Cottage | 2×2 | 1 | #1: 100 Timber<br>#2: 120 Timber, 50 Clay<br>#3: 160 Timber, 90 Clay | 60 / 75 / 90 | 50 | houses 1 | Cottage Craft |
| Flower Bed | 1×1 | 24 | #1: 5 Timber | instant | 1 | decoration | — |
| Lantern Post | 1×1 | 16 | #1: 12 Timber | instant | 1 | decoration | — |
| Garden Bench | 1×1 | 12 | #1: 15 Timber | instant | 1 | decoration | — |

## Research

| Tier (level) | Project | Knowledge | XP | Requires | Effect |
| --- | --- | --- | --- | --- | --- |
| 1 | Cottage Craft | 20 | 20 | — | Learn to raise a snug Cottage — a home for one more villager. |
| 1 | Clay Digging | 15 | 15 | — | Work the soft creek banks for Clay, and build a Clay Shed to store it. |
| 1 | Hearty Recipes | 25 | 25 | — | Better recipes let the cook fill bowls 25% faster. |
| 2 | Growing Hamlet | 60 | 60 | Cottage Craft | Room for a second Cottage — and a second newcomer. |
| 2 | Sturdy Racks | 45 | 45 | Clay Digging | Reinforced shelving: Timber Yards and Clay Sheds hold 50% more. |
| 2 | Field Rations | 40 | 40 | Hearty Recipes | Packed lunches: each bowl of Stew fuels 30% more work. |
| 2 | Sharpened Axes | 40 | 40 | — | A whetstone for every axe. Woodcutting is 20% faster. |
| 2 | Study Notes | 50 | 50 | — | Shared notebooks help scholars earn Knowledge 25% faster. |
| 3 | Village Commons | 120 | 120 | Growing Hamlet | Plan a proper village green with room for a third Cottage. |
| 3 | Clay Spades | 80 | 80 | Clay Digging | Narrow, sharpened spades make digging clay 20% faster. |
| 3 | Woodland Tending | 110 | 110 | Sharpened Axes | Replant as you go. Felled trees regrow three times faster. |
| 3 | Builder's Plans | 90 | 90 | Study Notes | Drawn plans and measured timber. Construction is 25% faster. |

- Tier 1: 60 Knowledge in total ≈ 6 scholar-minutes.
- Tier 2: 235 Knowledge in total ≈ 23.50 scholar-minutes.
- Tier 3: 400 Knowledge in total ≈ 40 scholar-minutes.

## Village levels

| Level | Total XP | Opens |
| --- | --- | --- |
| 1 | 0 | Research tier 1: Cottage Craft, Clay Digging, Hearty Recipes |
| 2 | 80 | Research tier 2: Growing Hamlet, Sturdy Racks, Field Rations, Sharpened Axes, Study Notes |
| 3 | 250 | Research tier 3: Village Commons, Clay Spades, Woodland Tending, Builder's Plans |
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
