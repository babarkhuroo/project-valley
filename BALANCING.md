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
| Crafting | Crafting | 12 | 12 construction work | site | yes | 60 work |
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
| Sawmill | 3×2 | 1 | #1: 120 Timber, 30 Stone | 60 | 45 | stores 40 Planks; 1 × crafting | Carpentry |
| Brickworks | 3×2 | 1 | #1: 100 Timber, 60 Clay, 40 Stone, 20 Planks | 70 | 55 | stores 40 Bricks; 1 × crafting | Brickmaking |
| Warehouse | 3×3 | 2 | #1: 100 Timber, 40 Stone, 40 Planks<br>#2: 140 Timber, 80 Stone, 60 Planks, 40 Bricks | 60 / 80 | 40 | stores 100 Planks, 100 Bricks | Brickmaking |
| Woodlot | 3×3 | 2 | #1: 80 Timber, 20 Planks<br>#2: 120 Timber, 20 Stone, 40 Planks | 50 / 60 | 40 | 2 × cutting timber | Managed Woodland |
| Clay Pit | 2×2 | 2 | #1: 80 Timber, 20 Stone, 20 Planks<br>#2: 120 Timber, 40 Stone, 40 Planks | 45 / 55 | 40 | 2 × digging clay | Clay Pits |
| Quarry | 3×3 | 1 | #1: 120 Timber, 40 Planks, 20 Bricks | 70 | 60 | 2 × quarrying stone | Stone Quarry |
| Cottage | 2×2 | 1 | #1: 100 Timber<br>#2: 120 Timber, 50 Clay<br>#3: 120 Timber, 60 Clay, 40 Planks, 30 Bricks | 60 / 75 / 90 | 50 | houses 1 | Cottage Craft |
| House | 3×2 | 1 | #1: 160 Timber, 40 Stone, 60 Planks, 40 Bricks<br>#2: 200 Timber, 60 Stone, 80 Planks, 60 Bricks | 100 / 120 | 80 | houses 2 | Family Homes |
| Flower Bed | 1×1 | 24 | #1: 5 Timber | instant | 1 | decoration | — |
| Lantern Post | 1×1 | 16 | #1: 12 Timber | instant | 1 | decoration | — |
| Garden Bench | 1×1 | 12 | #1: 15 Timber | instant | 1 | decoration | — |
| Valley Banner | 1×1 | 8 | #1: 10 Timber | instant | 2 | decoration | — |
| Fountain | 2×2 | 2 | #1: 30 Stone | instant | 5 | decoration | — |

## Workshop recipes

A crafter makes one item per batch: inputs are taken when the item starts, the output is stored when it finishes. Orders: 1–50 items or "keep making".

| Recipe | Workshop | Inputs | Output | Work | Per minute (untrained crafter) |
| --- | --- | --- | --- | --- | --- |
| Planks | Sawmill | 4 Timber | 2 Planks | 12 | 10 out, 20 Timber in |
| Bricks | Brickworks | 1 Timber, 3 Clay | 2 Bricks | 14 | 8.57 out, 4.3 Timber, 12.9 Clay in |

## Building upgrades

Upgrades keep the footprint, are paid up front, need builder work, and the building keeps working meanwhile. Stats replace the previous level's values.

| Building | Level | Cost | Work | Requires | Effect | XP |
| --- | --- | --- | --- | --- | --- | --- |
| Cookhouse | 1 → 2 | 120 Timber, 50 Clay, 40 Stone | 60 | — | stores 60 Stew; 2 worker slots; work ×1.2 | 40 |
| Cookhouse | 2 → 3 | 160 Timber, 60 Clay, 100 Stone, 30 Bricks | 90 | Masonry, village level 3 | stores 90 Stew; work ×1.4 | 60 |
| Founders' Lodge | 1 → 2 | 120 Timber, 60 Clay, 80 Stone, 30 Planks | 80 | Masonry | houses 3 | 60 |
| Academy | 1 → 2 | 140 Timber, 60 Clay, 50 Stone | 70 | — | stores 50 Knowledge; 2 worker slots; work ×1.2 | 45 |
| Academy | 2 → 3 | 160 Timber, 80 Clay, 120 Stone, 40 Planks, 30 Bricks | 100 | Masonry, village level 3 | stores 80 Knowledge; work ×1.4 | 70 |
| Timber Yard | 1 → 2 | 80 Timber, 30 Clay | 30 | — | stores 200 Timber | 20 |
| Timber Yard | 2 → 3 | 100 Timber, 40 Clay, 60 Stone, 20 Planks | 45 | Masonry, village level 3 | stores 320 Timber | 35 |
| Clay Shed | 1 → 2 | 90 Timber, 40 Clay | 30 | — | stores 170 Clay | 20 |
| Clay Shed | 2 → 3 | 100 Timber, 60 Clay, 60 Stone, 20 Planks | 45 | Masonry, village level 3 | stores 260 Clay | 35 |
| Stone Yard | 1 → 2 | 80 Timber, 30 Clay, 40 Stone | 35 | — | stores 170 Stone | 25 |
| Stone Yard | 2 → 3 | 100 Timber, 60 Clay, 100 Stone, 20 Planks | 50 | Masonry, village level 3 | stores 260 Stone | 40 |
| Sawmill | 1 → 2 | 140 Timber, 60 Stone, 30 Planks | 60 | — | stores 80 Planks; 2 worker slots; work ×1.2 | 45 |
| Brickworks | 1 → 2 | 120 Timber, 60 Stone, 30 Planks, 30 Bricks | 70 | — | stores 80 Bricks; 2 worker slots; work ×1.2 | 55 |
| Woodlot | 1 → 2 | 120 Timber, 40 Stone, 40 Planks | 60 | — | 3 worker slots; work ×1.2 | 40 |
| Clay Pit | 1 → 2 | 100 Timber, 40 Planks, 20 Bricks | 55 | — | 3 worker slots; work ×1.2 | 40 |
| Quarry | 1 → 2 | 160 Timber, 60 Planks, 40 Bricks | 80 | — | 3 worker slots; work ×1.2 | 60 |

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
| 2 | Carpentry | 55 | 55 | — | Saw pits and trestles: build a Sawmill and turn timber into planks. |
| 3 | Village Commons | 120 | 120 | Growing Hamlet | Plan a proper village green with room for a third Cottage. |
| 3 | Iron-shod Spades | 80 | 80 | Stonecutting | Iron edges on every spade and pick. Digging clay and quarrying stone are 20% faster. |
| 3 | Masonry | 100 | 100 | Stonecutting | Mortar, footings and true walls. Buildings can be raised to level 3, and the Founders’ Lodge can grow a third bed. |
| 3 | Woodland Tending | 110 | 110 | Sharpened Axes | Replant as you go. Felled trees regrow three times faster. |
| 3 | Builder's Plans | 90 | 90 | Study Notes | Drawn plans and measured timber. Construction is 25% faster. |
| 3 | Brickmaking | 110 | 110 | Carpentry | Moulded clay fired hard in a kiln. Build a Brickworks, and a Warehouse for finished goods. |
| 3 | The Valley Road | 100 | 100 | — | Clear the old road over the ridge to the shared Valley, where neighbouring villages build together. |
| 4 | Family Homes | 420 | 200 | Village Commons | Two storeys, a brick chimney and room for two. Unlocks the House. |
| 4 | Clay Pits | 380 | 180 | Iron-shod Spades | Dig a proper pit wherever the ground is good. Unlocks the Clay Pit — clay that never runs out. |
| 4 | Organised Stores | 400 | 190 | Masonry | Labelled bays and tidy stacks. Stone, plank and brick storage +50%. |
| 4 | Preserved Food | 360 | 170 | Field Rations | Salted, smoked and sealed. Each bowl of Stew fuels another 30% more work. |
| 4 | Managed Woodland | 380 | 180 | Woodland Tending | Coppice and replant on purpose. Unlocks the Woodlot — timber that never runs out, placed where you like. |
| 4 | Apprenticeship | 420 | 200 | Study Notes | Elders teach while they work. Villagers can practise any skill up to level 3. |
| 4 | Master Crafts | 450 | 210 | Brickmaking | Jigs, moulds and better kilns. Workshops produce 25% faster. |
| 5 | Townhouses | 800 | 320 | Family Homes | Shared walls and tidy lanes: room for a second House. |
| 5 | Stone Quarry | 720 | 300 | Clay Pits | Open a quarry face with a crane and ramps. Unlocks the Quarry — stone that never runs out. |
| 5 | Master Builders | 720 | 300 | Apprenticeship | Cranes, templates and practised crews. Construction is 30% faster. |

- Tier 1: 60 Knowledge in total ≈ 6 scholar-minutes.
- Tier 2: 340 Knowledge in total ≈ 34 scholar-minutes.
- Tier 3: 710 Knowledge in total ≈ 71 scholar-minutes.

## Village levels

| Level | Total XP | Opens |
| --- | --- | --- |
| 1 | 0 | Research tier 1: Cottage Craft, Clay Digging, Hearty Recipes |
| 2 | 80 | Research tier 2: Growing Hamlet, Sturdy Racks, Field Rations, Sharpened Axes, Study Notes, Carpentry, Stonecutting |
| 3 | 250 | Research tier 3: Brickmaking, Village Commons, Iron-shod Spades, Masonry, Woodland Tending, Builder's Plans, The Valley Road |
| 4 | 700 | Research tier 4: Family Homes, Clay Pits, Organised Stores, Preserved Food, Managed Woodland, Apprenticeship, Master Crafts |
| 5 | 1500 | Research tier 5: Townhouses, Stone Quarry, Master Builders |
| 6 | 2800 | — |
| 7 | 4600 | — |

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

## The Valley

Shared projects restored by every member. Costs are Valley-wide totals. Reputation: 0.1 per point of value (Timber 1, Clay 1, Stone 1.5, Planks 2.5, Bricks 3).

| Building | Level | Cost (whole Valley) | Build time | Effect | Opens after |
| --- | --- | --- | --- | --- | --- |
| Hearth Hall | 1 | 3000 Timber, 1500 Clay | 1h | Shared suppers: a bowl of Stew lasts 10% longer |  |
|  | 2 | 6000 Timber, 3000 Stone, 1500 Planks | 4h | Valley storehouse: +10% storage in every village |  |
|  | 3 | 12000 Timber, 6000 Stone, 3000 Planks, 3000 Bricks | 10h | Great feasts: Stew +10% longer and storage +10% more |  |
| Trading Post | 1 | 2000 Timber, 1000 Clay | 2h | Merchant ships call on every member: 3 crates a ship | Hearth Hall 1 |
|  | 2 | 4000 Timber, 1500 Stone, 800 Planks | 6h | 4 crates a ship, pay +10%, ships return sooner |  |
|  | 3 | 8000 Timber, 3000 Stone, 1500 Planks, 1500 Bricks | 12h | 5 crates a ship, pay +20%, ships return sooner still |  |
| Foresters' Lodge | 1 | 2400 Timber, 1200 Clay | 2h | Woodcutting +5% in every member's village | Hearth Hall 1 |
|  | 2 | 5000 Timber, 2000 Stone, 800 Planks | 6h | Woodcutting +5% more (×1.10 in all) |  |
|  | 3 | 9000 Timber, 4000 Stone, 1500 Planks, 1500 Bricks | 12h | Woodcutting +5% more (×1.16 in all) |  |
| Miners' Guild | 1 | 2400 Timber, 1200 Clay | 2h | Digging and quarrying +5% in every member's village | Hearth Hall 1 |
|  | 2 | 5000 Timber, 2000 Stone, 800 Bricks | 6h | Digging and quarrying +5% more (×1.10 in all) |  |
|  | 3 | 9000 Timber, 4000 Stone, 1500 Planks, 1500 Bricks | 12h | Digging and quarrying +5% more (×1.16 in all) |  |
| Cooks' Guild | 1 | 2400 Timber, 1200 Clay | 2h | Cooking +5% in every member's village | Hearth Hall 1 |
|  | 2 | 5000 Timber, 2000 Stone, 800 Bricks | 6h | Cooking +5% more (×1.10 in all) |  |
|  | 3 | 9000 Timber, 4000 Stone, 1500 Planks, 1500 Bricks | 12h | Cooking +5% more (×1.16 in all) |  |
| Scholars' Guild | 1 | 2400 Timber, 1200 Clay | 2h | Study +5% in every member's village | Hearth Hall 1 |
|  | 2 | 5000 Timber, 2000 Stone, 800 Planks | 6h | Study +5% more (×1.10 in all) |  |
|  | 3 | 9000 Timber, 4000 Stone, 1500 Planks, 1500 Bricks | 12h | Study +5% more (×1.16 in all) |  |
| Builders' Guild | 1 | 2400 Timber, 1200 Clay | 2h | Construction +5% in every member's village | Hearth Hall 1 |
|  | 2 | 5000 Timber, 2000 Stone, 800 Planks | 6h | Construction +5% more (×1.10 in all) |  |
|  | 3 | 9000 Timber, 4000 Stone, 1500 Planks, 1500 Bricks | 12h | Construction +5% more (×1.16 in all) |  |
| Craftsfolk's Guild | 1 | 2400 Timber, 1200 Clay | 2h | Crafting +5% in every member's village | Hearth Hall 1 |
|  | 2 | 5000 Timber, 2000 Stone, 800 Bricks | 6h | Crafting +5% more (×1.10 in all) |  |
|  | 3 | 9000 Timber, 4000 Stone, 1500 Planks, 1500 Bricks | 12h | Crafting +5% more (×1.16 in all) |  |

Simulated neighbours (7): a delivery worth 50–150 value × generosity every 25–70 min while awake (16h a day), growing 4% per finished Valley level. A new Valley starts with Hearth Hall 55.00000000000001% supplied.

Neighbours alone (no help from the player), seeded run over four weeks:

| Valley time | Finished |
| --- | --- |
| 0.2 days | Hearth Hall → level 1 |
| 1.3 days | Trading Post → level 1 |
| 1.4 days | Builders' Guild → level 1 |
| 1.5 days | Scholars' Guild → level 1 |
| 1.6 days | Cooks' Guild → level 1 |
| 2.2 days | Miners' Guild → level 1 |
| 2.3 days | Foresters' Lodge → level 1 |
| 2.3 days | Craftsfolk's Guild → level 1 |
| 5.2 days | Trading Post → level 2 |
| 5.4 days | Scholars' Guild → level 2 |
| 5.5 days | Cooks' Guild → level 2 |
| 6.1 days | Builders' Guild → level 2 |
| 6.2 days | Hearth Hall → level 2 |
| 6.7 days | Foresters' Lodge → level 2 |
| 6.7 days | Miners' Guild → level 2 |
| 7.2 days | Craftsfolk's Guild → level 2 |
| 11.5 days | Trading Post → level 3 |
| 11.9 days | Cooks' Guild → level 3 |
| 13.5 days | Miners' Guild → level 3 |
| 13.8 days | Scholars' Guild → level 3 |
| 13.8 days | Builders' Guild → level 3 |
| 14.6 days | Foresters' Lodge → level 3 |
| 14.8 days | Craftsfolk's Guild → level 3 |
| 15.4 days | Hearth Hall → level 3 |

## Merchants & coins

Ships call once the Valley's Trading Post is restored: the first 10 min later, each staying 4h, the next arriving 2–5h after one sails (shorter with Trading Post levels). A crate is worth 40 + 30 × village level (±30%) and never asks for more than 80% of the village's storage of that good. Pay: 0.6 coins per point of value × merchant × Trading Post, ±35% per crate; 0.05 reputation per point. Filling every crate adds 25% of the crates' coins and +10 reputation.

| Trading Post level | Crates | Pay | Time between ships |
| --- | --- | --- | --- |
| 1 | 3 | ×1 | ×1 |
| 2 | 4 | ×1.1 | ×0.85 |
| 3 | 5 | ×1.2 | ×0.7 |

| Good | Value | Needs |
| --- | --- | --- |
| Timber | 1 | — |
| Stew | 1.2 | — |
| Clay | 1 | Clay Digging |
| Stone | 1.5 | Stonecutting |
| Planks | 2.5 | Carpentry |
| Bricks | 3 | Brickmaking |

| Merchant | Ship | Likes | Pay |
| --- | --- | --- | --- |
| Captain Mabel Quill | the Gull's Promise | Timber, Planks | ×1 |
| Peregrine Stout | the Amber Lantern | Bricks, Clay | ×1.15 |
| The Brine Sisters | the Twin Herons | Stone, Bricks | ×0.95 |
| Old Hollis | the Patient Otter | Stew, Timber | ×0.9 |
| Juniper Vale | the Silver Thimble | Planks, Stone | ×1.1 |

### Tonics

| Tonic | Effect | Lasts | Price |
| --- | --- | --- | --- |
| Woodworker Tonic | chop ×1.5 | 30 min | 60 coins ±15% |
| Miner's Meal | dig, quarry ×1.5 | 30 min | 70 coins ±15% |
| Farmer's Tea | cook ×1.5 | 30 min | 50 coins ±15% |
| Research Brew | study ×1.5 | 30 min | 80 coins ±15% |
| Builder's Brew | build ×1.5 | 30 min | 70 coins ±15% |
| Crafter's Oil | craft ×1.5 | 30 min | 70 coins ±15% |

### Reputation Road

| Reputation | Reward |
| --- | --- |
| 25 | type:coins, amount:50 |
| 75 | type:boost, boost:woodTonic, count:2 |
| 150 | type:decor, building:valleyBanner |
| 250 | type:resources, resources:planks:40, bricks:40 |
| 400 | type:coins, amount:150 |
| 600 | type:boost, boost:researchBrew, count:2 |
| 850 | type:decor, building:fountain |
| 1150 | type:boost, boost:buildersBrew, count:3 |
| 1500 | type:coins, amount:300 |
| 2000 | type:resources, resources:stone:150, planks:100, bricks:100 |
| 2600 | type:boost, boost:minersMeal, count:3 |
| 3300 | type:coins, amount:500 |

## Simulated pacing

A deterministic autoplayer (`src/sim/autoplay.ts`) plays a fresh village for 4 hours, checking in every 15 s. It plays faster than most people, so read these as best-case times; `tests/pacing.test.ts` guards them.

| Time | Milestone |
| --- | --- |
| 1m 45s | Academy |
| 6m 45s | Cottage |
| 6m 45s | Village level 2 |
| 6m 45s | Villager #3 joins |
| 9m 00s | Clay Shed |
| 12m 45s | Timber Yard → level 2 |
| 16m 30s | Stone Yard |
| 16m 30s | Village level 3 |
| 22m 30s | Cottage |
| 22m 30s | Villager #4 joins |
| 28m 00s | Cookhouse → level 2 |
| 35m 45s | Sawmill |
| 37m 30s | Clay Shed → level 2 |
| 38m 30s | Village level 4 |
| 53m 00s | Academy → level 2 |
| 54m 00s | Stone Yard → level 2 |
| 1h 00m | Brickworks |
| 1h 09m | Warehouse |
| 1h 16m | Founders' Lodge → level 2 |
| 1h 16m | Village level 5 |
| 1h 16m | Villager #5 joins |
| 1h 23m | Cottage |
| 1h 23m | Villager #6 joins |
| 1h 28m | Timber Yard → level 3 |
| 1h 40m | House |
| 1h 40m | Villager #7 joins |
| 1h 40m | Villager #8 joins |
| 1h 44m | Woodlot |
| 1h 48m | Cookhouse → level 3 |
| 1h 53m | Clay Pit |
| 2h 05m | Academy → level 3 |
| 2h 13m | Village level 6 |
| 2h 51m | House |
| 2h 51m | Villager #9 joins |
| 2h 51m | Villager #10 joins |
| 3h 06m | Quarry |

Research completed: 26 projects. Villager time per hour — h1: 0% waiting, h2: 0% waiting, h3: 34% waiting, h4: 87% waiting (waiting rises once everything unlocked is built and research is the bottleneck).
