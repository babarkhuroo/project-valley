import type { ReactNode } from 'react';
import { BUILDINGS, BUILD_MENU_ORDER } from '../../config/buildings';
import { JOBS } from '../../config/jobs';
import { NODES } from '../../config/nodes';
import { RESEARCH, type ResearchId } from '../../config/research';
import { RESOURCES, type ResourceId } from '../../config/resources';
import { SKILLS, SKILL_ORDER } from '../../config/skills';
import { BALANCE } from '../../config/balance';
import { game } from '../../game/runtime';
import { jobBlocker, jobSlots, workersOn } from '../../sim/commands';
import { capacity } from '../../sim/economy';
import { buildingCenter } from '../../sim/grid';
import { mealDuration } from '../../sim/modifiers';
import { residents } from '../../sim/population';
import { practiceProgress } from '../../sim/progression';
import { researchProgress } from '../../sim/research';
import { constructionEta, constructionFraction, estimateJob, productionSummary, villagerTask, type JobEstimate } from '../../sim/selectors';
import type { BuildingInstance, GameState, Job, Villager } from '../../sim/types';
import { findBuilding, findNode, findVillager, jobTypeOf, villagerPosition } from '../../sim/villagerAI';
import { assign, beginAssign, cancelBuildingUpgrade, cancelSite, focus, selectAndFocus, startMove, unassign, upgradeBuilding } from '../actions';
import { buildingStats, canAffordUpgrade, maxLevel, nextUpgrade, upgradeBlocker } from '../../sim/levels';
import { Bar, Cost, Pill, Section } from '../common/Bits';
import { Icon } from '../common/Icon';
import { BuildingThumb, Portrait } from '../common/Portrait';
import { formatDuration, useGameState } from '../hooks';
import type { IconName } from '../icons';
import { ui, useUI } from '../store';

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function Formula({ est }: { est: JobEstimate }) {
  const def = JOBS[est.jobType];
  return (
    <div className="formula">
      <div className="formula-line">
        {est.factors.map((f, i) => (
          <span key={i} className="factor" title={f.label}>
            {i > 0 ? <em>×</em> : null}
            <b>{f.mult.toFixed(2)}</b>
            <small>{f.label}</small>
          </span>
        ))}
        <span className="factor total">
          <em>=</em>
          <b>{est.rate.toFixed(2)}</b>
          <small>work/sec</small>
        </span>
      </div>
      <p className="formula-note">
        {def.output
          ? `Each batch takes ${def.batchWork} work (${est.workSeconds.toFixed(1)}s) and yields ${def.output.amount} ${RESOURCES[def.output.resource].name.toLowerCase()}`
          : `Each batch adds ${def.batchWork} work to the site (${est.workSeconds.toFixed(1)}s)`}
        {est.travelSeconds > 0 ? `, plus ${est.travelSeconds.toFixed(1)}s walking to ${est.destination} and back.` : '.'}
        {est.resource ? (
          <>
            {' '}
            ≈ <strong>{est.perMinute.toFixed(1)}</strong> per minute.
          </>
        ) : null}
      </p>
    </div>
  );
}

function skillFor(state: GameState, job: Job) {
  const jt = jobTypeOf(state, job);
  return jt ? JOBS[jt].skill : null;
}

/** Workers on a job plus everyone who could take it, with the numbers to choose well. */
function AssignList({ job }: { job: Job }) {
  const state = useGameState();
  const g = game();
  const workers = workersOn(state, job);
  const slots = jobSlots(state, job);
  const blocker = jobBlocker(state, job);
  const skill = skillFor(state, job);
  const full = workers.length >= slots;
  const others = state.villagers
    .filter((v) => !workers.includes(v))
    .sort((a, b) => {
      const ai = a.job ? 1 : 0;
      const bi = b.job ? 1 : 0;
      if (ai !== bi) return ai - bi;
      return skill ? b.skills[skill].level - a.skills[skill].level : 0;
    });
  return (
    <>
      <Section title={`${job.kind === 'construct' ? 'Builders' : 'Workers'} ${workers.length}/${slots}`}>
        {workers.length === 0 ? <p className="empty-slot">Nobody is working here yet.</p> : null}
        {workers.map((v) => {
          const est = estimateJob(state, g.world, v, job);
          const task = villagerTask(state, v);
          return (
            <div key={v.id} className="worker-card">
              <button className="worker-head" onClick={() => selectAndFocus({ kind: 'villager', id: v.id }, 14)}>
                <Portrait appearance={v.appearance} size={40} ring={task.warning ? 'warn' : null} />
                <span>
                  <strong>{v.name}</strong>
                  <small>{task.label}</small>
                </span>
              </button>
              <button className="btn small ghost" onClick={() => unassign(v.id)}>
                Remove
              </button>
              {est ? <Formula est={est} /> : null}
            </div>
          );
        })}
      </Section>
      {blocker ? (
        <div className="blocker">
          <Icon name="lock" size={22} />
          <span>{blocker}</span>
          {blocker.startsWith('Research') ? (
            <button className="btn small" onClick={() => ui.set({ panel: 'research' })}>
              Research
            </button>
          ) : blocker.startsWith('Build') ? (
            <button className="btn small" onClick={() => ui.set({ panel: 'build', buildHighlight: BUILD_MENU_ORDER.find((id) => blocker.includes(BUILDINGS[id].name)) ?? null })}>
              Build
            </button>
          ) : null}
        </div>
      ) : (
        <Section title={full ? 'Swap in someone else' : 'Assign a villager'}>
          <ul className="assign-list">
            {others.map((v) => {
              const est = estimateJob(state, g.world, v, job);
              const task = villagerTask(state, v);
              const replace = full ? workers.slice().sort((a, b) => a.id - b.id)[0] : null;
              return (
                <li key={v.id}>
                  <Portrait appearance={v.appearance} size={36} ring={task.idle ? 'idle' : null} />
                  <span className="al-info">
                    <strong>
                      {v.name} {task.idle ? <Pill tone="idle">Idle</Pill> : null}
                    </strong>
                    <small>
                      {skill ? `${SKILLS[skill].name} ${v.skills[skill].level}` : ''}
                      {est?.resource ? ` · ≈${est.perMinute.toFixed(1)}/min` : est ? ` · ${est.rate.toFixed(2)} work/s` : ''}
                      {!task.idle ? ` · now: ${task.label.toLowerCase()}` : ''}
                    </small>
                  </span>
                  <button className="btn small green" onClick={() => assign(v.id, job)}>
                    {replace ? `Replace ${replace.name}` : 'Assign'}
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </>
  );
}

function PanelHeader({ title, subtitle, media, onClose }: { title: string; subtitle?: string; media: ReactNode; onClose: () => void }) {
  return (
    <header className="sp-header">
      {media}
      <span className="sp-title">
        <h3>{title}</h3>
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
      <button className="icon-btn" onClick={onClose} aria-label="Close">
        <Icon name="close" size={18} />
      </button>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Villager
// ---------------------------------------------------------------------------

function nearbyPlace(state: GameState, v: Villager): string {
  const p = villagerPosition(v, state.time);
  let best = 'the wilds';
  let bestD = 6;
  for (const b of state.buildings) {
    const c = buildingCenter(b);
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    if (d < bestD) {
      bestD = d;
      best = `the ${BUILDINGS[b.defId].name}`;
    }
  }
  if (bestD >= 6) {
    const node = state.nodes.find((n) => Math.hypot(n.x - p.x, n.z - p.z) < 2);
    if (node) best = node.kind === 'tree' ? 'the woods' : 'the creek banks';
  }
  return best;
}

function VillagerPanel({ v }: { v: Villager }) {
  const state = useGameState();
  const g = game();
  const task = villagerTask(state, v);
  const home = v.homeId !== null ? findBuilding(state, v.homeId) : undefined;
  const est = v.job ? estimateJob(state, g.world, v, v.job) : null;
  const jt = v.job ? jobTypeOf(state, v.job) : null;
  const eats = jt ? JOBS[jt].consumesFood : false;
  const meal = mealDuration(state);
  const level = 1 + SKILL_ORDER.reduce((s, k) => s + v.skills[k].level, 0);
  return (
    <>
      <PanelHeader
        title={v.name}
        subtitle={`Villager level ${level} · ${home ? `lives in the ${BUILDINGS[home.defId].name}` : 'no home yet'}`}
        media={<Portrait appearance={v.appearance} size={64} ring={task.idle ? 'idle' : task.warning ? 'warn' : null} />}
        onClose={() => ui.select(null)}
      />
      <div className={`task-card ${task.idle ? 'is-idle' : ''} ${task.warning ? 'is-warn' : ''}`}>
        <Icon name={task.icon as IconName} size={30} />
        <span>
          <strong>{task.label}</strong>
          <small>{task.idle ? 'Waiting for your instructions.' : `Near ${nearbyPlace(state, v)}`}</small>
          {task.progress !== null ? <Bar value={task.progress} thin /> : null}
        </span>
      </div>
      <div className="row-buttons">
        <button className="btn green" onClick={() => beginAssign(v.id)}>
          <Icon name="target" size={18} /> {v.job ? 'Change job' : 'Choose a job'}
        </button>
        {v.job ? (
          <>
            <button className="btn ghost" onClick={() => v.job && focus(v.job.kind === 'gather' ? { kind: 'node', id: v.job.nodeId } : { kind: 'building', id: v.job.buildingId })}>
              Go to job
            </button>
            <button className="btn ghost" onClick={() => unassign(v.id)}>
              Stop
            </button>
          </>
        ) : null}
      </div>
      {eats ? (
        <Section title="Appetite">
          {v.hungry ? (
            <div className="blocker warn">
              <Icon name="hungry" size={22} />
              <span>Hungry! Working at {Math.round(BALANCE.villager.hungryWorkMult * 100)}% speed until there is Stew.</span>
            </div>
          ) : (
            <Bar value={v.energy / meal} tone="honey" label={`${Math.ceil(v.energy)}s of work before the next bowl`} />
          )}
        </Section>
      ) : null}
      {est ? (
        <Section title="Productivity">
          <Formula est={est} />
        </Section>
      ) : null}
      <Section title="Skills" aside={<small className="muted">+10% speed per level</small>}>
        <ul className="skills">
          {SKILL_ORDER.map((k) => {
            const s = v.skills[k];
            const prog = practiceProgress(v, k);
            return (
              <li key={k} className={jt && JOBS[jt].skill === k ? 'active' : ''}>
                <span className="sk-name" style={{ color: SKILLS[k].color }}>
                  {SKILLS[k].name}
                </span>
                <span className="sk-pips">
                  {Array.from({ length: 6 }, (_, i) => (
                    <i key={i} className={i < s.level ? 'on' : ''} />
                  ))}
                </span>
                <span className="sk-prog">{prog === null ? <small className="muted">Guild training</small> : <Bar value={prog} thin tone="blue" />}</span>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Resource node
// ---------------------------------------------------------------------------

function NodePanel({ id }: { id: number }) {
  const state = useGameState();
  const node = findNode(state, id);
  if (!node) return null;
  const def = NODES[node.kind];
  const out = JOBS[def.job].output!;
  const job: Job = { kind: 'gather', nodeId: node.id };
  const regrowing = node.regrowAt !== null;
  return (
    <>
      <PanelHeader title={def.name} subtitle={def.description} media={<span className="sp-icon"><Icon name={out.resource as IconName} size={44} /></span>} onClose={() => ui.select(null)} />
      {regrowing ? (
        <Section title="Regrowing">
          <Bar
            value={(state.time - (node.depletedAt ?? state.time)) / Math.max(1, (node.regrowAt ?? 0) - (node.depletedAt ?? 0))}
            tone="green"
            label={`Ready in ${formatDuration((node.regrowAt ?? 0) - state.time)}`}
          />
        </Section>
      ) : (
        <Section title="Remaining">
          <Bar value={node.amount / def.amount} tone={node.kind === 'clay' ? 'clay' : 'honey'} label={`${Math.round(node.amount)} / ${def.amount} ${RESOURCES[out.resource].name.toLowerCase()}`} />
        </Section>
      )}
      <AssignList job={job} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

function StorageBars({ resources }: { resources: ResourceId[] }) {
  const state = useGameState();
  return (
    <>
      {resources.map((r) => {
        const cap = capacity(state, r);
        return <Bar key={r} value={cap ? state.resources[r] / cap : 0} tone={r === 'clay' ? 'clay' : r === 'knowledge' ? 'blue' : 'honey'} label={`${Math.floor(state.resources[r])} / ${cap} ${RESOURCES[r].name}`} />;
      })}
    </>
  );
}

const PERCENT = (m: number) => `+${Math.round((m - 1) * 100)}%`;

/** What the next level brings, what it costs, and exactly why it can't start yet. */
function UpgradeSection({ b }: { b: BuildingInstance }) {
  const state = useGameState();
  const up = nextUpgrade(b.defId, b.level);
  const top = maxLevel(b.defId);
  if (!up) {
    return top > 1 ? (
      <Section title="Upgrades">
        <p className="muted small">Fully upgraded — level {top} is the highest for now.</p>
      </Section>
    ) : null;
  }
  const def = BUILDINGS[b.defId];
  const now = buildingStats(b.defId, b.level);
  const next = buildingStats(b.defId, b.level + 1);
  const perks: string[] = [];
  for (const r of Object.keys(next.storage) as ResourceId[]) {
    if ((next.storage[r] ?? 0) !== (now.storage[r] ?? 0)) perks.push(`Stores ${now.storage[r] ?? 0} → ${next.storage[r]} ${RESOURCES[r].name}`);
  }
  if (next.housing !== now.housing) perks.push(`Beds ${now.housing} → ${next.housing} (room for a new villager)`);
  if (next.slots !== now.slots && def.operate) perks.push(`Worker slots ${now.slots} → ${next.slots}`);
  if (next.outputMult !== now.outputMult && def.operate) perks.push(`${JOBS[def.operate.job].verb} ${PERCENT(next.outputMult)} (was ${now.outputMult === 1 ? '+0%' : PERCENT(now.outputMult)})`);
  const blocker = upgradeBlocker(state, b);
  const research = blocker?.startsWith('needs-research:') ? (blocker.slice(15) as ResearchId) : null;
  const affordable = canAffordUpgrade(state, b);
  return (
    <Section title={`Upgrade to level ${b.level + 1}`} aside={<small className="muted">+{up.xp} XP</small>}>
      <ul className="perks">
        {perks.map((p) => (
          <li key={p}>
            <Icon name="upgrade" size={16} /> {p}
          </li>
        ))}
        <li className="muted">Looks grander, too — and keeps working while builders upgrade it.</li>
      </ul>
      <div className="upgrade-cost">
        <Cost bundle={up.cost.resources} state={state} />
        <small className="muted">
          <Icon name="build" size={14} /> {up.cost.work} work
        </small>
      </div>
      {research ? (
        <div className="blocker">
          <Icon name="lock" size={20} />
          <span>Needs {RESEARCH[research].name} research</span>
          <button className="btn small" onClick={() => ui.set({ panel: 'research', researchFocus: research })}>
            Research
          </button>
        </div>
      ) : blocker ? (
        <p className="blocker">
          <Icon name="lock" size={20} /> {blocker}
        </p>
      ) : (
        <button className="btn green wide" disabled={!affordable} onClick={() => upgradeBuilding(b.id)}>
          <Icon name="upgrade" size={18} /> {affordable ? `Upgrade to level ${b.level + 1}` : 'Need more resources'}
        </button>
      )}
    </Section>
  );
}

function BuildingPanel({ id }: { id: number }) {
  const state = useGameState();
  const g = game();
  const b = findBuilding(state, id);
  if (!b) return null;
  const def = BUILDINGS[b.defId];
  const building = b.status === 'construction';
  const stats = buildingStats(b.defId, b.level);
  const storage = Object.keys(stats.storage) as ResourceId[];
  const rates = productionSummary(state, g.world);
  return (
    <>
      <PanelHeader
        title={building ? `${def.name} (building)` : def.name}
        subtitle={`${maxLevel(b.defId) > 1 && !building ? `Level ${b.level} of ${maxLevel(b.defId)} · ` : ''}${def.description}`}
        media={<BuildingThumb id={b.defId} size={64} />}
        onClose={() => ui.select(null)}
      />
      {building ? (
        <>
          <Section title="Construction">
            <Bar value={constructionFraction(state, b)} tone="green" label={`${Math.floor(constructionFraction(state, b) * 100)}%`} />
            <p className="muted small">
              {constructionEta(state, b) !== null ? `About ${formatDuration(constructionEta(state, b)!)} left with the current builders.` : 'Assign a builder to start work.'} Needs {b.workRequired} work in total; up to{' '}
              {BALANCE.villager.buildersPerSite} builders.
            </p>
          </Section>
          <AssignList job={{ kind: 'construct', buildingId: b.id }} />
          <div className="row-buttons">
            <button className="btn ghost" onClick={() => startMove(b.id)}>
              <Icon name="move" size={18} /> Move
            </button>
            <button className="btn danger" onClick={() => cancelSite(b.id)}>
              <Icon name="trash" size={18} /> Cancel & refund
            </button>
          </div>
        </>
      ) : (
        <>
          {b.upgrade ? (
            <>
              <Section title={`Upgrading to level ${b.upgrade.toLevel}`}>
                <Bar value={constructionFraction(state, b)} tone="green" label={`${Math.floor(constructionFraction(state, b) * 100)}%`} />
                <p className="muted small">
                  {constructionEta(state, b) !== null ? `About ${formatDuration(constructionEta(state, b)!)} left.` : 'Assign a builder to start the upgrade.'} The building keeps working meanwhile.
                </p>
              </Section>
              <AssignList job={{ kind: 'construct', buildingId: b.id }} />
            </>
          ) : null}
          {b.defId === 'cookhouse' ? (
            <Section title="Pantry">
              <StorageBars resources={['stew']} />
              <p className="muted small">
                Cooking ≈ {rates.stew.gain.toFixed(1)}/min · eaten ≈ {rates.stew.use.toFixed(1)}/min by working villagers.
              </p>
            </Section>
          ) : null}
          {b.defId === 'academy' ? (
            <Section title="Research">
              {state.research.active ? (
                <>
                  <Bar
                    value={researchProgress(state, state.research.active) / RESEARCH[state.research.active].cost}
                    tone="blue"
                    label={`${RESEARCH[state.research.active].name} — ${Math.floor(researchProgress(state, state.research.active))}/${RESEARCH[state.research.active].cost}`}
                  />
                  <p className="muted small">≈ {rates.knowledge.gain.toFixed(1)} Knowledge/min from scholars.</p>
                </>
              ) : (
                <p className="blocker">
                  <Icon name="info" size={20} /> No project chosen — Knowledge is banked (up to {capacity(state, 'knowledge')}).
                </p>
              )}
              <StorageBars resources={['knowledge']} />
              <button className="btn" onClick={() => ui.set({ panel: 'research' })}>
                <Icon name="research" size={18} /> Open research
              </button>
            </Section>
          ) : null}
          {storage.length > 0 && b.defId !== 'cookhouse' && b.defId !== 'academy' ? (
            <Section title="Storage (shared across buildings)">
              <StorageBars resources={storage} />
            </Section>
          ) : null}
          {stats.housing ? (
            <Section title={`Residents ${residents(state, b.id).length}/${stats.housing}`}>
              <div className="residents">
                {residents(state, b.id).map((v) => (
                  <button key={v.id} onClick={() => selectAndFocus({ kind: 'villager', id: v.id }, 14)}>
                    <Portrait appearance={v.appearance} size={40} />
                    <small>{v.name}</small>
                  </button>
                ))}
                {residents(state, b.id).length < stats.housing ? <span className="muted small">A bed is free — someone will arrive soon.</span> : null}
              </div>
            </Section>
          ) : null}
          {def.operate ? <AssignList job={{ kind: 'operate', buildingId: b.id }} /> : null}
          {!b.upgrade ? <UpgradeSection b={b} /> : null}
          <div className="row-buttons">
            <button className="btn ghost" onClick={() => startMove(b.id)}>
              <Icon name="move" size={18} /> Move
            </button>
            {b.upgrade ? (
              <button className="btn danger" onClick={() => cancelBuildingUpgrade(b.id)}>
                <Icon name="trash" size={18} /> Cancel upgrade
              </button>
            ) : null}
          </div>
        </>
      )}
    </>
  );
}

export function SelectionPanel() {
  const state = useGameState();
  const sel = useUI((s) => s.selection);
  const mode = useUI((s) => s.mode.kind);
  if (!sel || mode === 'place' || mode === 'move') return null;
  let body: ReactNode = null;
  if (sel.kind === 'villager') {
    const v = findVillager(state, sel.id);
    if (v) body = <VillagerPanel v={v} />;
  } else if (sel.kind === 'node') body = <NodePanel id={sel.id} />;
  else body = <BuildingPanel id={sel.id} />;
  if (!body) return null;
  return (
    <aside className="selection-panel panel slide-in" key={`${sel.kind}-${sel.id}`}>
      {body}
    </aside>
  );
}

