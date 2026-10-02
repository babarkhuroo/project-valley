import { useEffect, useMemo, useRef, useState } from 'react';
import { BUILDINGS } from '../../config/buildings';
import { NODES } from '../../config/nodes';
import { MAX_RESEARCH_TIER, RESEARCH, RESEARCH_CATEGORY_LABEL, RESEARCH_IDS, type ResearchCategory, type ResearchEffect, type ResearchId } from '../../config/research';
import { JOBS } from '../../config/jobs';
import { RESOURCES } from '../../config/resources';
import { game } from '../../game/runtime';
import { researchProgress, researchStatus } from '../../sim/research';
import { productionSummary } from '../../sim/selectors';
import { chooseResearch } from '../actions';
import { Bar } from '../common/Bits';
import { Icon } from '../common/Icon';
import { formatDuration, useGameState } from '../hooks';
import type { IconName } from '../icons';
import { ui, useUI } from '../store';

const NODE_W = 210;
const NODE_H = 92;
const COL_W = 290;
const ROW_H = 118;
const PAD_X = 40;
const PAD_Y = 70;

const CATEGORY_ICON: Record<ResearchCategory, IconName> = {
  villagers: 'villager',
  resources: 'leaf',
  storage: 'crate',
  food: 'stew',
  production: 'build',
  knowledge: 'study',
  crafting: 'craft',
};

function effectText(e: ResearchEffect): string {
  switch (e.type) {
    case 'unlockBuilding':
      return `Unlocks the ${BUILDINGS[e.building].name}`;
    case 'maxCount':
      return `+${e.add} ${BUILDINGS[e.building].name} allowed`;
    case 'unlockNode':
      return `Villagers can work ${NODES[e.node].name}s`;
    case 'jobRate':
      return `${JOBS[e.job].verb} +${Math.round((e.mult - 1) * 100)}%`;
    case 'storage':
      return `${e.resources.map((r) => RESOURCES[r].name).join(' & ')} storage +${Math.round((e.mult - 1) * 100)}%`;
    case 'mealDuration':
      return `Each bowl of Stew lasts +${Math.round((e.mult - 1) * 100)}%`;
    case 'regrow':
      return `${NODES[e.node].name}s regrow ${e.mult}× faster`;
    case 'upgradeTier':
      return `Buildings can be upgraded to level ${e.level}`;
  }
}

function pos(id: ResearchId): { x: number; y: number } {
  const d = RESEARCH[id];
  return { x: PAD_X + (d.tier - 1) * COL_W, y: PAD_Y + d.row * ROW_H };
}

export function ResearchScreen() {
  const open = useUI((s) => s.panel === 'research');
  if (!open) return null;
  return <ResearchInner />;
}

function ResearchInner() {
  const state = useGameState();
  const focusId = useUI((s) => s.researchFocus);
  const [selected, setSelected] = useState<ResearchId>(() => focusId ?? state.research.active ?? RESEARCH_IDS.find((id) => researchStatus(state, id) === 'available') ?? 'cottageCraft');
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const rows = Math.max(...RESEARCH_IDS.map((id) => RESEARCH[id].row)) + 1;
  const width = PAD_X * 2 + (MAX_RESEARCH_TIER - 1) * COL_W + NODE_W;
  const height = PAD_Y + rows * ROW_H + 20;
  const academy = state.buildings.find((b) => b.defId === 'academy' && b.status === 'complete');
  const rate = productionSummary(state, game().world).knowledge.gain;

  const centerOn = (id: ResearchId, scale = view.scale) => {
    const el = viewport.current;
    if (!el) return;
    const p = pos(id);
    setView({ scale, x: el.clientWidth / 2 - (p.x + NODE_W / 2) * scale, y: el.clientHeight / 2 - (p.y + NODE_H / 2) * scale });
  };
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const fit = Math.min(1, el.clientWidth / width, el.clientHeight / height);
    const scale = Math.max(0.55, fit);
    setView({ scale, x: Math.max(10, (el.clientWidth - width * scale) / 2), y: Math.max(10, (el.clientHeight - height * scale) / 2) });
  }, [width, height]);

  const edges = useMemo(() => {
    const out: { from: ResearchId; to: ResearchId }[] = [];
    for (const id of RESEARCH_IDS) for (const p of RESEARCH[id].prereqs) out.push({ from: p, to: id });
    return out;
  }, []);

  const tiers = Array.from({ length: MAX_RESEARCH_TIER }, (_, i) => i + 1);
  const sel = RESEARCH[selected];
  const selStatus = researchStatus(state, selected);
  const progress = researchProgress(state, selected);

  return (
    <div className="research-screen fade-in" role="dialog" aria-label="Research">
      <header className="rs-header">
        <h2>
          <Icon name="research" size={32} /> Research
        </h2>
        <div className="rs-stats">
          <span className="res-chip res-knowledge">
            <Icon name="knowledge" size={26} />
            <span className="res-vals">
              <span className="res-amt">{Math.floor(state.resources.knowledge)}</span>
              <span className="res-sub">{rate > 0 ? `+${rate.toFixed(1)}/min` : 'banked'}</span>
            </span>
          </span>
          {!academy ? <span className="rs-warn">Build an Academy and assign a scholar to earn Knowledge.</span> : rate === 0 ? <span className="rs-warn">Assign a scholar at the Academy to earn Knowledge.</span> : null}
        </div>
        <button className="icon-btn big" onClick={() => ui.set({ panel: null, researchFocus: null })} aria-label="Close research">
          <Icon name="close" size={22} />
        </button>
      </header>
      <div className="rs-body">
        <div
          className="rs-viewport"
          ref={viewport}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
          }}
          onPointerUp={() => (drag.current = null)}
          onWheel={(e) => {
            const el = viewport.current!;
            const r = el.getBoundingClientRect();
            const mx = e.clientX - r.left;
            const my = e.clientY - r.top;
            setView((v) => {
              const scale = Math.max(0.45, Math.min(1.6, v.scale * Math.exp(-e.deltaY * 0.0015)));
              const k = scale / v.scale;
              return { scale, x: mx - (mx - v.x) * k, y: my - (my - v.y) * k };
            });
          }}
        >
          <div className="rs-canvas" style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
            {tiers.map((t) => {
              const locked = state.player.level < t;
              return (
                <div key={t} className={`rs-tier ${locked ? 'locked' : ''}`} style={{ left: PAD_X + (t - 1) * COL_W - 18, width: NODE_W + 36, height: height - 20 }}>
                  <span>
                    Tier {t} · Level {t}
                    {locked ? <Icon name="lock" size={16} /> : null}
                  </span>
                </div>
              );
            })}
            <svg className="rs-edges" width={width} height={height}>
              {edges.map(({ from, to }) => {
                const a = pos(from);
                const b = pos(to);
                const x1 = a.x + NODE_W;
                const y1 = a.y + NODE_H / 2;
                const x2 = b.x;
                const y2 = b.y + NODE_H / 2;
                const mx = (x1 + x2) / 2;
                const done = state.research.completed.includes(from);
                return <path key={`${from}-${to}`} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} className={done ? 'done' : ''} />;
              })}
            </svg>
            {RESEARCH_IDS.map((id) => {
              const d = RESEARCH[id];
              const p = pos(id);
              const status = researchStatus(state, id);
              const prog = researchProgress(state, id);
              return (
                <button
                  key={id}
                  className={`rs-node st-${status} ${selected === id ? 'selected' : ''}`}
                  style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setSelected(id)}
                  onDoubleClick={() => status === 'available' && chooseResearch(id)}
                >
                  <span className={`rs-icon cat-${d.category}`}>
                    <Icon name={status === 'locked-level' || status === 'locked-prereq' ? 'lock' : CATEGORY_ICON[d.category]} size={30} />
                  </span>
                  <span className="rs-text">
                    <strong>{d.name}</strong>
                    <small>{status === 'completed' ? 'Researched ✓' : status === 'locked-level' ? `Needs level ${d.tier}` : status === 'locked-prereq' ? 'Needs earlier research' : `${d.cost} Knowledge`}</small>
                    {prog > 0 && status !== 'completed' ? <Bar value={prog / d.cost} tone="blue" thin /> : null}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="rs-zoom">
            <button className="icon-btn" onClick={() => setView((v) => ({ ...v, scale: Math.min(1.6, v.scale * 1.2) }))} aria-label="Zoom in">
              <Icon name="plus" size={18} />
            </button>
            <button className="icon-btn" onClick={() => centerOn(selected)} aria-label="Center selected">
              <Icon name="target" size={18} />
            </button>
          </div>
        </div>
        <aside className="rs-detail panel">
          <span className={`rs-icon big cat-${sel.category}`}>
            <Icon name={CATEGORY_ICON[sel.category]} size={44} />
          </span>
          <h3>{sel.name}</h3>
          <p className="muted small">
            {RESEARCH_CATEGORY_LABEL[sel.category]} · Tier {sel.tier}
          </p>
          <p>{sel.description}</p>
          <ul className="effects">
            {sel.effects.map((e, i) => (
              <li key={i}>
                <Icon name="check" size={16} /> {effectText(e)}
              </li>
            ))}
          </ul>
          {sel.prereqs.length > 0 ? (
            <p className="small">
              Requires:{' '}
              {sel.prereqs.map((p) => (
                <button key={p} className={`link ${state.research.completed.includes(p) ? 'done' : ''}`} onClick={() => setSelected(p)}>
                  {RESEARCH[p].name}
                </button>
              ))}
            </p>
          ) : null}
          <Bar value={progress / sel.cost} tone="blue" label={`${Math.floor(progress)} / ${sel.cost} Knowledge`} />
          {selStatus === 'available' || selStatus === 'active' ? (
            <p className="small muted">
              {(() => {
                const remaining = sel.cost - progress - (selStatus === 'active' ? 0 : state.resources.knowledge);
                if (remaining <= 0) return 'Your banked Knowledge covers this — it completes as soon as you start.';
                if (rate <= 0) return 'No scholars are studying right now.';
                return `≈ ${formatDuration((remaining / rate) * 60)} at the current pace.`;
              })()}
            </p>
          ) : null}
          {selStatus === 'available' ? (
            <button className="btn green wide" onClick={() => chooseResearch(selected)}>
              {progress > 0 ? 'Resume research' : 'Research this'}
            </button>
          ) : selStatus === 'active' ? (
            <button className="btn ghost wide" onClick={() => chooseResearch(null)}>
              Pause (progress is kept)
            </button>
          ) : selStatus === 'completed' ? (
            <p className="done-note">
              <Icon name="check" size={18} /> Already researched
            </p>
          ) : (
            <p className="rs-warn">{selStatus === 'locked-level' ? `Reach village level ${sel.tier} to study this.` : 'Finish the required research first.'}</p>
          )}
          <p className="small muted">Level ups open new tiers; research decides what you actually unlock. Switching projects never loses progress.</p>
        </aside>
      </div>
    </div>
  );
}
