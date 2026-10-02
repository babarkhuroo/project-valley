/**
 * Economy simulation: plays a fresh village with the autoplayer and prints when things
 * happen.  npx tsx scripts/simulate.ts [hours=6]
 */
import { formatClock, runEconomySim } from '../src/sim/economySim.ts';

const hours = Number(process.argv[2] ?? 6);
const t0 = performance.now();
const report = runEconomySim(hours * 3600);
const ms = performance.now() - t0;
for (const m of report.milestones) console.log(`${formatClock(m.t).padStart(8)}  ${m.kind.padEnd(8)} ${m.label}`);
console.log('');
console.log(`final: level ${report.final.level}, ${report.final.villagers} villagers, ${report.final.researched} research, ${report.final.buildings} buildings`);
console.log(`villager time: idle ${(report.idleShare * 100).toFixed(1)}%, waiting ${(report.blockedShare * 100).toFixed(1)}%, hungry ${(report.hungryShare * 100).toFixed(1)}%`);
for (const h of report.hourly) console.log(`  hour ${String(h.hour).padStart(2)}: idle ${(h.idle * 100).toFixed(0)}%, waiting ${(h.blocked * 100).toFixed(0)}%, hungry ${(h.hungry * 100).toFixed(0)}%`);
console.log(`simulated ${hours}h in ${ms.toFixed(0)} ms`);
