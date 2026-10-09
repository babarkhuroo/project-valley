/**
 * Playtest report: what real players reached and how long it took, next to the
 * autoplayer's times, plus the latest feedback notes.
 *
 *   ADMIN_TOKEN=… npx tsx scripts/playtest-report.ts https://project-valley.onrender.com
 *
 * (Defaults to http://localhost:5173 with the dev token "dev".)
 */
import { formatClock, runEconomySim } from '../src/sim/economySim.ts';
import type { PlaytestReport } from '../server/playtest.ts';

const base = (process.argv[2] ?? 'http://localhost:5173').replace(/\/$/, '');
const token = process.env.ADMIN_TOKEN ?? (base.includes('localhost') ? 'dev' : '');
if (!token) {
  console.error('Set ADMIN_TOKEN to the token configured on the server.');
  process.exit(1);
}
const res = await fetch(`${base}/api/admin/playtest`, { headers: { Authorization: `Bearer ${token}` } });
if (!res.ok) {
  console.error(`The server said ${res.status}: ${await res.text()}`);
  process.exit(1);
}
const report = (await res.json()) as PlaytestReport;

// The autoplayer's first time to each milestone, by the same labels.
const auto = new Map<string, number>();
for (const m of runEconomySim(6 * 3600).milestones) if (!auto.has(m.label)) auto.set(m.label, m.t);
const autoFor = (label: string): string => {
  const key = label.replace(/^(Built|Researched) /, '');
  const t = auto.get(key);
  return t === undefined ? '—' : formatClock(t);
};
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m` : `${Math.round(m)}m`);

console.log(`Players seen: ${report.players} · sharing progress: ${report.sharing}\n`);
if (report.milestones.length > 0) {
  console.log('Milestone                                   players   median game time   median play time   autoplayer');
  for (const m of report.milestones) {
    console.log(`${m.label.slice(0, 42).padEnd(44)}${String(m.players).padStart(7)}   ${mins(m.medianSimMinutes).padStart(16)}   ${mins(m.medianPlayMinutes).padStart(16)}   ${autoFor(m.label).padStart(10)}`);
  }
  console.log('\n“Game time” includes time away (the village keeps working); “play time” is time with the game open.\n');
}
if (report.roster.length > 0) {
  console.log('Players (most recent first)');
  for (const p of report.roster.slice(0, 30)) {
    console.log(`  ${p.playerId}  level ${p.level}  ${p.buildings} built  ${mins(p.playMinutes)} played  last seen ${new Date(p.lastSeen).toISOString().slice(0, 16).replace('T', ' ')}`);
  }
  console.log();
}
console.log(`Feedback (${report.feedback.length}, newest first)`);
for (const f of report.feedback) {
  const c = f.context as Record<string, unknown>;
  console.log(`\n— ${new Date(f.at).toISOString().slice(0, 16).replace('T', ' ')} · ${f.mood ?? 'no mood'} · level ${c.level ?? '?'}, ${c.playMinutes ?? '?'} min played, ${c.touch ? 'touch' : 'mouse'} ${c.screen ?? ''}`);
  if (f.text) console.log(`  ${f.text}`);
}
