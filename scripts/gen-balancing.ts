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
import { RESOURCES, RESOURCE_ORDER } from '../src/config/resources.ts';
import { SKILLS, SKILL_ORDER } from '../src/config/skills.ts';

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
]);

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

writeFileSync(path.join(root, 'BALANCING.md'), lines.join('\n'));
console.log('BALANCING.md written');
