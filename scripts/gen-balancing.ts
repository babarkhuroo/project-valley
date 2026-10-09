/**
 * Generates BALANCING.md straight from the config files so the balance tables can
 * never drift from the game.  Run: npm run balance-doc
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BALANCE } from '../src/config/balance.ts';
import { BUILDINGS, BUILD_MENU_ORDER } from '../src/config/buildings.ts';
import { JOBS } from '../src/config/jobs.ts';
import { NODES } from '../src/config/nodes.ts';
import { RESEARCH, RESEARCH_IDS } from '../src/config/research.ts';
import { MAX_ORDER, RECIPES, RECIPE_IDS } from '../src/config/recipes.ts';
import { formatClock, runEconomySim } from '../src/sim/economySim.ts';
import { RESOURCES, RESOURCE_ORDER } from '../src/config/resources.ts';
import { SKILLS, SKILL_ORDER } from '../src/config/skills.ts';
import { NEIGHBOURS, VALLEY_BALANCE, VALLEY_BUILDING_ORDER, VALLEY_BUILDINGS, VALLEY_RESOURCES } from '../src/config/valley.ts';
import { advanceValley, createValley } from '../src/valley/valleySim.ts';
import { TRAINING } from '../src/config/training.ts';
import { FARMING } from '../src/config/farming.ts';
import { FESTIVALS, FESTIVAL_BALANCE, FESTIVAL_ORDER } from '../src/config/festivals.ts';
import { COOP_RECIPES, COOP_RECIPE_ORDER, MILLRACE } from '../src/config/millrace.ts';
import { VALLEY_RESEARCH, VALLEY_RESEARCH_ORDER } from '../src/config/valleyResearch.ts';
import { BOOSTS, BOOST_ORDER, MERCHANTS, REPUTATION_ROAD, TRADE_BALANCE, TRADE_GOODS, TRADING_POST_LEVELS } from '../src/config/trade.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lines: string[] = [];
const out = (s = '') => lines.push(s);
const table = (head: string[], rows: (string | number)[][]) => {
  out(`| ${head.join(' | ')} |`);
  out(`| ${head.map(() => '---').join(' | ')} |`);
  for (const r of rows) out(`| ${r.join(' | ')} |`);
  out();
};
const bundle = (b: Record<string, number | undefined>) =>
  RESOURCE_ORDER.filter((r) => b[r])
    .map((r) => `${b[r]} ${RESOURCES[r].name}`)
    .join(', ') || '—';
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

out('# Balancing');
out();
out('> Generated from `src/config/*` by `npm run balance-doc`. Edit the config, not this file.');
out();
out('All rates assume an untrained, fed villager (work rate 1.0/s). Skill, research and hunger multiply the rate — see *Worker productivity*.');
out();

out('## Worker productivity');
out();
out('`work rate = base × skill multiplier × research multiplier × (hungry ? hungry multiplier : 1)`');
out();
table(['Setting', 'Value'], [
  ['Base work rate', `${BALANCE.work.baseRate} work/s`],
  ['Hungry multiplier', `×${BALANCE.villager.hungryWorkMult}`],
  ['Walk speed', `${BALANCE.villager.walkSpeed} tiles/s (×${BALANCE.villager.pathSpeedMult} on roads, ×${BALANCE.villager.carrySpeedMult} carrying)`],
  ['Builders per site', BALANCE.villager.buildersPerSite],
  ['Auto-continue radius', `${BALANCE.autoContinueRadius} tiles`],
]);

out('## Jobs & production');
out();
table(
  ['Job', 'Skill', 'Work / batch', 'Output / batch', 'Delivery', 'Eats Stew', 'Output / min (no travel)'],
  Object.values(JOBS).map((j) => [
    j.verb,
    SKILLS[j.skill].name,
    j.batchWork,
    j.output ? `${j.output.amount} ${RESOURCES[j.output.resource].name}` : `${j.batchWork} construction work`,
    j.output?.delivery ?? 'site',
    j.consumesFood ? 'yes' : 'no',
    j.output ? fmt((j.output.amount / j.batchWork) * 60 * BALANCE.work.baseRate) : fmt(60 * BALANCE.work.baseRate) + ' work',
  ]),
);

out('## Food');
out();
table(['Setting', 'Value'], [
  ['Work fuelled by one Stew', `${BALANCE.villager.mealDuration} s`],
  ['Stew eaten per full-time worker', `${fmt(60 / BALANCE.villager.mealDuration)} / min`],
  ['One cook produces', `${fmt((JOBS.cook.output!.amount / JOBS.cook.batchWork) * 60)} Stew / min`],
  ['Full-time workers one cook sustains', fmt((JOBS.cook.output!.amount / JOBS.cook.batchWork) * BALANCE.villager.mealDuration)],
  ['With grain: one pot takes', `${FARMING.cookGrain} Grain → ${JOBS.cook.output!.amount + FARMING.cookBonus} Stew (when there's room for them)`],
  ['One cook with grain produces', `${fmt(((JOBS.cook.output!.amount + FARMING.cookBonus) / JOBS.cook.batchWork) * 60)} Stew / min, using ${fmt((FARMING.cookGrain / JOBS.cook.batchWork) * 60)} Grain / min`],
]);

out('## Farming');
out();
{
  const load = JOBS.farm.output!.amount;
  const batch = JOBS.farm.batchWork / BALANCE.work.baseRate;
  const tends = Math.ceil(FARMING.growSeconds / (batch + FARMING.tendSeconds));
  const cuts = Math.ceil(FARMING.yield / load);
  const cycle = (1 + tends + cuts) * batch;
  table(['Setting', 'Value'], [
    ['Untended crop ripens in', `${FARMING.growSeconds / 60} min`],
    ['Each tending batch saves', `${FARMING.tendSeconds} s of growing`],
    ['Grain per ripe field', `${FARMING.yield} (× ${FARMING.fertileMult} on the southern meadow; Crop Rotation × 1.25)`],
    ['Harvest load', `${load} Grain per batch, carried to a Granary`],
    ['One untrained farmer, alone, per crop', `1 sow + ${tends} tend + ${cuts} harvest batches ≈ ${fmt(cycle / 60)} min of work + walking`],
    ['…so at best', `${fmt((FARMING.yield / cycle) * 60)} Grain / min before walking`],
  ]);
}

out('## Resource nodes');
out();
table(
  ['Node', 'Job', 'Amount', 'Regrow', 'Workers', 'Unlocked by'],
  Object.values(NODES).map((n) => [n.name, JOBS[n.job].verb, n.amount, `${n.regrowSeconds / 60} min`, n.maxWorkers, n.requiresResearch ? RESEARCH[n.requiresResearch].name : 'start']),
);

out('## Buildings');
out();
const listed = [...new Set<string>(['cookhouse', 'lodge', ...BUILD_MENU_ORDER])] as (keyof typeof BUILDINGS)[];
table(
  ['Building', 'Footprint', 'Max (base)', 'Cost by copy', 'Work by copy', 'XP', 'Provides', 'Unlocked by'],
  listed.map((id) => {
    const b = BUILDINGS[id];
    const provides = [
      b.storage ? `stores ${bundle(b.storage)}` : '',
      b.housing ? `houses ${b.housing}` : '',
      b.operate ? `${b.operate.slots} × ${JOBS[b.operate.job].verb.toLowerCase()}` : '',
    ]
      .filter(Boolean)
      .join('; ');
    return [
      b.name,
      `${b.footprint.w}×${b.footprint.d}`,
      b.buildable ? b.maxCount : 'start only',
      b.buildable ? b.costs.map((c, i) => `#${i + 1}: ${bundle(c.resources)}`).join('<br>') : '—',
      b.buildable ? b.costs.map((c) => (c.work ? c.work : 'instant')).join(' / ') : '—',
      b.xp,
      provides || 'decoration',
      b.requiresResearch ? RESEARCH[b.requiresResearch].name : '—',
    ];
  }),
);

out('## Workshop recipes');
out();
out('A crafter makes one item per batch: inputs are taken when the item starts, the output is stored when it finishes. Orders: 1–' + MAX_ORDER + ' items or "keep making".');
out();
table(
  ['Recipe', 'Workshop', 'Inputs', 'Output', 'Work', 'Per minute (untrained crafter)'],
  RECIPE_IDS.map((id) => {
    const r = RECIPES[id];
    const perMin = (60 / r.work) * BALANCE.work.baseRate;
    return [r.name, BUILDINGS[r.building].name, bundle(r.inputs), `${r.output.amount} ${RESOURCES[r.output.resource].name}`, r.work, `${fmt(perMin * r.output.amount)} out, ${bundle(Object.fromEntries(Object.entries(r.inputs).map(([k, v]) => [k, Math.round((v ?? 0) * perMin * 10) / 10])))} in`];
  }),
);

out('## Building upgrades');
out();
out('Upgrades keep the footprint, are paid up front, need builder work, and the building keeps working meanwhile. Stats replace the previous level\'s values.');
out();
table(
  ['Building', 'Level', 'Cost', 'Work', 'Requires', 'Effect', 'XP'],
  listed.flatMap((id) =>
    (BUILDINGS[id].upgrades ?? []).map((u, i) => {
      const effect = [
        u.storage ? `stores ${bundle(u.storage)}` : '',
        u.housing !== undefined ? `houses ${u.housing}` : '',
        u.slots !== undefined ? `${u.slots} worker slots` : '',
        u.outputMult !== undefined ? `work ×${u.outputMult}` : '',
      ]
        .filter(Boolean)
        .join('; ');
      const req = [u.requiresResearch ? RESEARCH[u.requiresResearch].name : '', u.minPlayerLevel ? `village level ${u.minPlayerLevel}` : ''].filter(Boolean).join(', ');
      return [BUILDINGS[id].name, `${i + 1} → ${i + 2}`, bundle(u.cost.resources), u.cost.work, req || '—', effect, u.xp];
    }),
  ),
);

out('## Research');
out();
table(
  ['Tier (level)', 'Project', 'Knowledge', 'XP', 'Requires', 'Effect'],
  [...RESEARCH_IDS]
    .sort((a, b) => RESEARCH[a].tier - RESEARCH[b].tier || RESEARCH[a].row - RESEARCH[b].row)
    .map((id) => {
      const r = RESEARCH[id];
      return [r.tier, r.name, r.cost, r.xp, r.prereqs.map((p) => RESEARCH[p].name).join(', ') || '—', r.description];
    }),
);
const studyPerMin = (JOBS.study.output!.amount / JOBS.study.batchWork) * 60;
for (let tier = 1; tier <= 3; tier++) {
  const total = RESEARCH_IDS.filter((id) => RESEARCH[id].tier === tier).reduce((s, id) => s + RESEARCH[id].cost, 0);
  out(`- Tier ${tier}: ${total} Knowledge in total ≈ ${fmt(total / studyPerMin)} scholar-minutes.`);
}
out();

out('## Village levels');
out();
table(
  ['Level', 'Total XP', 'Opens'],
  BALANCE.progression.levelXp.map((xp, i) => {
    const tier = RESEARCH_IDS.filter((id) => RESEARCH[id].tier === i + 1).map((id) => RESEARCH[id].name);
    return [i + 1, xp, tier.length ? `Research tier ${i + 1}: ${tier.join(', ')}` : '—'];
  }),
);
out(`Level-up gift: ${bundle(BALANCE.progression.levelUpGift)} (capped by storage). Tutorial beats: +${BALANCE.tutorialXp} XP each.`);
out();

out('## Skills');
out();
table(
  ['Level', 'Work-rate multiplier', 'Practice XP needed (cumulative)'],
  BALANCE.skills.levelMultipliers.map((m, lvl) => [lvl, `×${m}`, lvl <= BALANCE.skills.practiceCap ? (BALANCE.skills.practiceThresholds[lvl] ?? '—') : 'guild training']),
);
out(`Practice: +${BALANCE.skills.practiceXpPerBatch} XP per finished batch in the job's skill, up to level ${BALANCE.skills.practiceCap}. Skills: ${SKILL_ORDER.map((s) => SKILLS[s].name).join(', ')}.`);
out();

out('## Timers & persistence');
out();
table(['Setting', 'Value'], [
  ['Offline progress cap', `${BALANCE.offline.maxSeconds / 3600} h`],
  ['Autosave interval', '15 s (plus on tab hide / close)'],
  ['Starting resources', bundle(BALANCE.start.resources)],
]);

out('## The Valley');
out();
out(`Shared projects restored by every member. Costs are Valley-wide totals. Reputation: ${VALLEY_BALANCE.reputationPerValue} per point of value (${VALLEY_RESOURCES.map((r) => `${RESOURCES[r].name} ${VALLEY_BALANCE.value[r]}`).join(', ')}).`);
out();
table(
  ['Building', 'Level', 'Cost (whole Valley)', 'Build time', 'Effect', 'Opens after'],
  VALLEY_BUILDING_ORDER.flatMap((id) => {
    const d = VALLEY_BUILDINGS[id];
    return d.levels.map((l, i) => [
      i === 0 ? d.name : '',
      i + 1,
      bundle(l.cost),
      `${l.buildHours}h`,
      l.summary,
      i === 0 && d.requires ? ('research' in d.requires ? `Research: ${VALLEY_RESEARCH[d.requires.research].name}` : `${VALLEY_BUILDINGS[d.requires.building].name} ${d.requires.level}`) : '',
    ]);
  }),
);
const nb = VALLEY_BALANCE.neighbours;
out(`Simulated neighbours (${NEIGHBOURS.length}): a delivery worth ${nb.parcelValue.min}–${nb.parcelValue.max} value × generosity every ${nb.intervalMinutes.min}–${nb.intervalMinutes.max} min while awake (${24 - nb.sleepHours}h a day), growing ${nb.growthPerLevel * 100}% per finished Valley level. A new Valley starts with Hearth Hall ${VALLEY_BALANCE.foundingProgress * 100}% supplied.`);
out();
{
  const t0 = Date.UTC(2026, 0, 1, 12);
  const v = createValley('v-doc', 1234, t0, { id: 'p-doc', name: 'Founder', villageName: 'Thistledown' });
  const finished: string[][] = [];
  const seen = new Set<number>();
  for (let h = 1; h <= 24 * 28; h++) {
    advanceValley(v, t0 + h * 3_600_000);
    for (const e of v.log) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (e.kind === 'finished') finished.push([`${(h / 24).toFixed(1)} days`, `${VALLEY_BUILDINGS[e.building].name} → level ${e.level}`]);
    }
  }
  out('Neighbours alone (no help from the player), seeded run over four weeks:');
  out();
  table(['Valley time', 'Finished'], finished);
}

out('## Valley research');
out();
out(`Valley Knowledge: ${VALLEY_BALANCE.knowledgePerValue} per point of contributed value (every member, neighbours included) plus ${TRADE_BALANCE.knowledgePerValue} per point of each filled merchant crate; ×1.25 per Great Library level above 1. Before the Library is restored at most ${VALLEY_BALANCE.knowledgeBankCap} can wait. Knowledge flows into the available project with the most votes (ties: most progress, then order).`);
out();
table(['Project', 'Tier', 'Knowledge', 'After', 'Effect'], VALLEY_RESEARCH_ORDER.map((id) => {
  const r = VALLEY_RESEARCH[id];
  return [r.name, r.tier, r.cost, r.requires.map((q) => VALLEY_RESEARCH[q].name).join(', ') || '—', r.description];
}));

out('## Festivals');
out();
out(`Once the Festival Grounds are restored (after the Festival Charter research), a festival starts ${FESTIVAL_BALANCE.firstDelayHours}h later and runs ${FESTIVAL_BALANCE.durationHours}h; the next follows ${FESTIVAL_BALANCE.gapHours.min}–${FESTIVAL_BALANCE.gapHours.max}h after one ends. Neighbours send ${FESTIVAL_BALANCE.neighbourShare * 100}% of their visits to a running festival. If the goal is met, every member who delivered gets the reward (× Festival Grounds level bonus); the Valley gets the Knowledge.`);
out();
table(['Festival', 'Goal', 'Reward per helper', 'Valley Knowledge', 'Decoration'], FESTIVAL_ORDER.map((id) => {
  const f = FESTIVALS[id];
  return [f.name, bundle(f.goal), `${f.reward.coins} coins, ${f.reward.reputation} reputation`, f.reward.knowledge, f.decor ? BUILDINGS[f.decor].name : '—'];
}));

out('## Millrace shifts');
out();
out(`A shift lasts ${MILLRACE.shiftHours}h (villager away). Output × (1 + ${MILLRACE.craftingBonusPerLevel} × Crafting level) × (1 + ${MILLRACE.helperBonus} × neighbours on shift, max ${MILLRACE.maxHelpers}) × Millrace level bonus (1 / 1.15 / 1.32), delivered to the chosen Valley project.`);
out();
table(['Recipe', 'Inputs', 'Base output', 'Value in → out'], COOP_RECIPE_ORDER.map((id) => {
  const r = COOP_RECIPES[id];
  const vIn = Object.entries(r.inputs).reduce((s, [res, n]) => s + (n ?? 0) * (VALLEY_BALANCE.value[res as keyof typeof VALLEY_BALANCE.value] ?? 1), 0);
  const vOut = r.output.amount * (VALLEY_BALANCE.value[r.output.resource] ?? 1);
  return [r.name, bundle(r.inputs), `${r.output.amount} ${RESOURCES[r.output.resource].name}`, `${vIn} → ${vOut}`];
}));

out('## Guild training');
out();
out(`Practice stops at level ${BALANCE.skills.practiceCap} (${BALANCE.skills.practiceCap + 1} with Apprenticeship); beyond that a villager must be at the practice cap and travel to the restored Valley guild for their skill. Guild level 1/2/3 teaches up to skill level ${TRAINING.maxLevelByGuild.slice(1).join('/')}. The villager is away (no work) for the lesson and returns to their old job if the slot is free.`);
out();
table(['To skill level', 'Coins', 'Time away', 'Work-rate multiplier'], Object.entries(TRAINING.lessons).map(([lvl, l]) => [lvl, l.coins, `${l.hours}h`, `×${BALANCE.skills.levelMultipliers[Number(lvl)]}`]));
table(['Skill', 'Guild'], VALLEY_BUILDING_ORDER.filter((id) => VALLEY_BUILDINGS[id].trains).map((id) => [SKILLS[VALLEY_BUILDINGS[id].trains!].name, VALLEY_BUILDINGS[id].name]));

out('## Merchants & coins');
out();
{
  const B = TRADE_BALANCE;
  out(`Ships call once the Valley's Trading Post is restored: the first ${B.firstShipDelay / 60} min later, each staying ${B.stayHours}h, the next arriving ${B.gapHours.min}–${B.gapHours.max}h after one sails (shorter with Trading Post levels). A crate is worth ${B.crateValue.base} + ${B.crateValue.perLevel} × village level (±${B.crateValue.spread * 100}%) and never asks for more than ${B.maxShareOfStorage * 100}% of the village's storage of that good. Pay: ${B.coinsPerValue} coins per point of value × merchant × Trading Post, ±${B.priceSpread * 100}% per crate; ${B.reputationPerValue} reputation per point. Filling every crate adds ${B.fullShipBonus.coinShare * 100}% of the crates' coins and +${B.fullShipBonus.reputation} reputation.`);
  out();
  table(['Trading Post level', 'Crates', 'Pay', 'Time between ships'], TRADING_POST_LEVELS.map((l, i) => [i + 1, l.crates, `×${l.pay}`, `×${l.gap}`]));
  table(['Good', 'Value', 'Needs'], TRADE_GOODS.map((g) => [RESOURCES[g.resource].name, g.value, g.requires ? RESEARCH[g.requires].name : '—']));
  table(['Merchant', 'Ship', 'Likes', 'Pay'], MERCHANTS.map((m) => [m.name, m.ship, m.likes.map((r) => RESOURCES[r].name).join(', '), `×${m.premium}`]));
  out('### Tonics');
  out();
  table(['Tonic', 'Effect', 'Lasts', 'Price'], BOOST_ORDER.map((b) => [BOOSTS[b].name, `${BOOSTS[b].jobs.join(', ')} ×${BOOSTS[b].mult}`, `${BOOSTS[b].seconds / 60} min`, `${BOOSTS[b].price} coins ±${B.priceHaggle * 100}%`]));
  out('### Reputation Road');
  out();
  table(['Reputation', 'Reward'], REPUTATION_ROAD.map((m) => [m.at, JSON.stringify(m.reward).replace(/[{}"]/g, '').replace(/,/g, ', ')]));
}

out('## Simulated pacing');
out();
out('A deterministic autoplayer (`src/sim/autoplay.ts`) plays a fresh village for 4 hours, checking in every 15 s. It plays faster than most people, so read these as best-case times; `tests/pacing.test.ts` guards them.');
out();
const report = runEconomySim(4 * 3600);
table(
  ['Time', 'Milestone'],
  report.milestones.filter((m) => m.kind !== 'research').map((m) => [formatClock(m.t), m.label]),
);
out(`Research completed: ${report.milestones.filter((m) => m.kind === 'research').length} projects. Villager time per hour — ${report.hourly.map((h) => `h${h.hour}: ${Math.round(h.blocked * 100)}% waiting`).join(', ')} (waiting rises once everything unlocked is built and research is the bottleneck).`);
out();

writeFileSync(path.join(root, 'BALANCING.md'), lines.join('\n'));
console.log('BALANCING.md written');
