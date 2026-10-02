import { useState } from 'react';
import { formatClock, runEconomySim, type PacingMilestone, type PacingReport } from '../../sim/economySim';

const RUNS = [
  { label: '1h', seconds: 3600 },
  { label: '4h', seconds: 4 * 3600 },
  { label: '8h', seconds: 8 * 3600 },
];

const KIND_COLOR: Record<PacingMilestone['kind'], string> = {
  build: 'var(--timber)',
  upgrade: 'var(--honey-dark)',
  research: 'var(--knowledge)',
  level: 'var(--ink)',
  villager: 'var(--leaf-dark)',
};
const KIND_LABEL: Record<PacingMilestone['kind'], string> = {
  build: 'Build',
  upgrade: 'Upgrade',
  research: 'Research',
  level: 'Level',
  villager: 'Villager',
};

/**
 * Runs the deterministic autoplayer (`sim/economySim.ts`) on a fresh village and shows
 * when things unlock and how busy the villagers were. It never touches the live game.
 */
export function EconomySimSection() {
  const [report, setReport] = useState<PacingReport | null>(null);
  const [running, setRunning] = useState(false);
  const [ms, setMs] = useState(0);
  const [showResearch, setShowResearch] = useState(false);

  const run = (seconds: number) => {
    setRunning(true);
    // Let "Running…" paint before the synchronous sim blocks the thread.
    setTimeout(() => {
      const start = performance.now();
      setReport(runEconomySim(seconds));
      setMs(performance.now() - start);
      setRunning(false);
    }, 30);
  };

  return (
    <section>
      <h4>Economy simulation</h4>
      <p className="small muted">A scripted player founds a fresh village and checks in every 15 s. Best-case pacing; the live game is untouched.</p>
      <div className="seg">
        {RUNS.map((r) => (
          <button key={r.label} disabled={running} onClick={() => run(r.seconds)}>
            Run {r.label}
          </button>
        ))}
      </div>
      {running && <p className="small">Running…</p>}
      {report && !running && (
        <div className="econ-sim">
          <p className="small">
            After {formatClock(report.seconds)}: level {report.final.level} · {report.final.villagers} villagers · {report.final.researched} research · {report.final.buildings} buildings
            <span className="muted"> ({Math.round(ms)} ms)</span>
          </p>
          <PacingChart report={report} />
          <WaitingBars report={report} />
          <label className="toggle">
            <input type="checkbox" checked={showResearch} onChange={(e) => setShowResearch(e.target.checked)} />
            Include research in the list
          </label>
          <ol className="econ-milestones">
            {report.milestones
              .filter((m) => showResearch || m.kind !== 'research')
              .map((m, i) => (
                <li key={i}>
                  <time>{formatClock(m.t)}</time>
                  <i style={{ background: KIND_COLOR[m.kind] }} />
                  {m.label}
                </li>
              ))}
          </ol>
        </div>
      )}
    </section>
  );
}

const W = 330;
const H = 132;
const PAD = { l: 22, r: 6, t: 14, b: 30 };

/** Villager count over time (step line), level-ups as labelled rules, and a strip of milestone ticks. */
function PacingChart({ report }: { report: PacingReport }) {
  const maxV = Math.max(10, ...report.samples.map((s) => s.villagers));
  const x = (t: number) => PAD.l + (t / report.seconds) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / maxV) * (H - PAD.t - PAD.b);
  const plotBottom = H - PAD.b;

  let d = '';
  report.samples.forEach((s, i) => {
    d += i === 0 ? `M${x(s.t)},${y(s.villagers)}` : `H${x(s.t)}V${y(s.villagers)}`;
  });
  const hours = Math.round(report.seconds / 3600);
  const tickEvery = hours > 4 ? 2 : 1;
  const levels = report.milestones.filter((m) => m.kind === 'level');
  const ticks = report.milestones.filter((m) => m.kind !== 'level');

  return (
    <svg className="econ-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Villagers and milestones over time">
      {[0, maxV / 2, maxV].map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={PAD.l - 4} y={y(v) + 3} textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {levels.map((m) => (
        <g key={m.label}>
          <line x1={x(m.t)} x2={x(m.t)} y1={PAD.t - 2} y2={plotBottom} className="level" />
          <text x={x(m.t)} y={PAD.t - 4} textAnchor="middle">
            L{m.label.replace(/\D/g, '')}
          </text>
        </g>
      ))}
      <path d={d} className="villagers" />
      {ticks.map((m, i) => (
        <line key={i} x1={x(m.t)} x2={x(m.t)} y1={plotBottom + 3} y2={plotBottom + 11} stroke={KIND_COLOR[m.kind]} strokeWidth={1.5}>
          <title>
            {formatClock(m.t)} · {m.label}
          </title>
        </line>
      ))}
      {Array.from({ length: hours + 1 }, (_, h) => h)
        .filter((h) => h % tickEvery === 0)
        .map((h) => (
          <text key={h} x={x(h * 3600)} y={H - 6} textAnchor="middle">
            {h}h
          </text>
        ))}
      <g className="legend">
        <text x={PAD.l + 4} y={y(maxV) + 10}>
          Villagers
        </text>
      </g>
    </svg>
  );
}

/** Share of villager time spent waiting (blocked or idle), per hour of play. */
function WaitingBars({ report }: { report: PacingReport }) {
  return (
    <div className="econ-waiting">
      <span className="small muted">Waiting per hour</span>
      <div className="bars">
        {report.hourly.map((h) => {
          const share = h.blocked + h.idle;
          return (
            <div key={h.hour} title={`Hour ${h.hour}: ${Math.round(share * 100)}% waiting, ${Math.round(h.hungry * 100)}% hungry`}>
              <span style={{ height: Math.max(2, share * 30) }} />
              <small>{Math.round(share * 100)}%</small>
            </div>
          );
        })}
      </div>
      <div className="econ-legend small">
        {(Object.keys(KIND_LABEL) as PacingMilestone['kind'][])
          .filter((k) => k !== 'level')
          .map((k) => (
            <span key={k}>
              <i style={{ background: KIND_COLOR[k] }} />
              {KIND_LABEL[k]}
            </span>
          ))}
      </div>
    </div>
  );
}
