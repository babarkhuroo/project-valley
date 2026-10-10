import { IDENTITY } from '../../config/identity';
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
  valley: 'valley',
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
    case 'practiceCap':
      return `Practice can raise skills ${e.add} level${e.add > 1 ? 's' : ''} higher`;
    case 'fieldYield':
      return `Harvests +${Math.round((e.mult - 1) * 100)}% grain`;
    case 'unlockValley':
      return `Opens the road to ${IDENTITY.valleyName}`;
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
  // The pan/zoom lives in a ref and is written straight to the canvas transform:
  // re-rendering the whole tree for every pointer move stutters on phones.
  const view = useRef({ x: 0, y: 0, scale: 1 });
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** How far the current press has dragged (a long drag isn't a click on a node). */
  const dragged = useRef(0);
  const setView = (next: { x: number; y: number; scale: number } | ((v: { x: number; y: number; scale: number }) => { x: number; y: number; scale: number })) => {
    view.current = typeof next === 'function' ? next(view.current) : next;
    const v = view.current;
    if (canvas.current) canvas.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
  };
  /** Zooms by `k` keeping the viewport point (mx, my) still. */
  const zoomAt = (k: number, mx: number, my: number) =>
    setView((v) => {
      const scale = Math.max(0.35, Math.min(1.6, v.scale * k));
      const f = scale / v.scale;
      return { scale, x: mx - (mx - v.x) * f, y: my - (my - v.y) * f };
    });
  /** Centre and spread of the fingers on the tree, in viewport coordinates. */
  const fingers = () => {
    const r = viewport.current!.getBoundingClientRect();
    const [a, b] = pointers.current.values();
    if (!b) return { x: a.x - r.left, y: a.y - r.top, spread: 0 };
    return { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top, spread: Math.hypot(a.x - b.x, a.y - b.y) };
  };
  const rows = Math.max(...RESEARCH_IDS.map((id) => RESEARCH[id].row)) + 1;
  const width = PAD_X * 2 + (MAX_RESEARCH_TIER - 1) * COL_W + NODE_W;
  const height = PAD_Y + rows * ROW_H + 20;
  const academy = state.buildings.find((b) => b.defId === 'academy' && b.status === 'complete');
  const rate = productionSummary(state, game().world).knowledge.gain;

  const centerOn = (id: ResearchId, scale = view.current.scale) => {
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
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.current.size === 1) dragged.current = 0;
          }}
          onPointerMove={(e) => {
            const p = pointers.current.get(e.pointerId);
            if (!p) return;
            if (e.pointerType === 'mouse' && e.buttons === 0) {
              // Released outside the tree.
              pointers.current.delete(e.pointerId);
              return;
            }
            const before = fingers();
            p.x = e.clientX;
            p.y = e.clientY;
            const after = fingers();
            dragged.current += Math.hypot(after.x - before.x, after.y - before.y) + Math.abs(after.spread - before.spread);
            // Whatever was under the fingers stays under them; a pinch scales about them.
            setView((v) => {
              const scale = before.spread > 0 && after.spread > 0 ? Math.max(0.35, Math.min(1.6, (v.scale * after.spread) / before.spread)) : v.scale;
              const f = scale / v.scale;
              return { scale, x: after.x - (before.x - v.x) * f, y: after.y - (before.y - v.y) * f };
            });
          }}
          onPointerUp={(e) => pointers.current.delete(e.pointerId)}
          onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
          onClickCapture={(e) => {
            if (dragged.current > 8) e.stopPropagation();
          }}
          onWheel={(e) => {
            const r = viewport.current!.getBoundingClientRect();
            zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
          }}
        >
          <div className="rs-canvas" ref={canvas} style={{ width, height, transform: `translate(${view.current.x}px, ${view.current.y}px) scale(${view.current.scale})` }}>
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
            <button className="icon-btn" onClick={() => zoomAt(1.2, viewport.current!.clientWidth / 2, viewport.current!.clientHeight / 2)} aria-label="Zoom in">
              <Icon name="plus" size={18} />
            </button>
            <button className="icon-btn" onClick={() => zoomAt(1 / 1.2, viewport.current!.clientWidth / 2, viewport.current!.clientHeight / 2)} aria-label="Zoom out">
              <Icon name="minus" size={18} />
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
