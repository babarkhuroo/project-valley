import { game, runtime } from '../../game/runtime';
import { summarizeAway } from '../../game/offline';
import { devCommands } from '../../sim/dev';
import { playerId } from '../../game/persistence';
import { apiFetch } from '../../game/session';
import { Icon } from '../common/Icon';
import { useGameState } from '../hooks';
import { ui, useUI } from '../store';
import { EconomySimSection } from './EconomySimSection';

const SPEEDS = [1, 2, 5, 10, 50];

function skip(seconds: number, summary: boolean): void {
  const g = game();
  const before = { ...g.state.resources };
  const events = g.skip(seconds);
  if (summary) ui.set({ away: summarizeAway(before, g.state, events, seconds, seconds) });
}

/** Developer tools. The component (and its import) only exists in development builds. */
export function DevPanel() {
  const state = useGameState();
  const open = useUI((s) => s.panel === 'dev');
  const selection = useUI((s) => s.selection);
  if (!open) return null;
  const g = game();
  return (
    <div className="dev-panel panel pop-in">
      <header>
        <h3>
          <Icon name="wrench" size={20} /> Developer
        </h3>
        <button className="icon-btn" onClick={() => ui.closePanel()} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </header>
      <section>
        <h4>Simulation speed</h4>
        <div className="seg">
          {SPEEDS.map((s) => (
            <button key={s} className={g.speed === s ? 'active' : ''} onClick={() => (g.speed = s)}>
              {s}×
            </button>
          ))}
          <button className={g.paused ? 'active' : ''} onClick={() => (g.paused = !g.paused)}>
            {g.paused ? 'Resume' : 'Pause'}
          </button>
        </div>
        <p className="small muted">Sim time: {Math.floor(state.time)}s</p>
      </section>
      <RenderingSection />
      <section>
        <h4>Skip time</h4>
        <div className="seg">
          <button onClick={() => skip(60, false)}>+1m</button>
          <button onClick={() => skip(600, true)}>+10m</button>
          <button onClick={() => skip(3600, true)}>+1h</button>
          <button onClick={() => skip(8 * 3600, true)}>+8h</button>
        </div>
      </section>
      <section>
        <h4>Resources</h4>
        <div className="seg">
          <button onClick={() => g.mutate((s, w, sink) => devCommands.addResources(s, w, 100, sink))}>+100 all</button>
          <button onClick={() => g.mutate((s, w, sink) => devCommands.addResources(s, w, 1000, sink))}>+1000 all</button>
          <button onClick={() => g.mutate((s, w, sink) => devCommands.fillStorage(s, w, sink))}>Fill</button>
          <button onClick={() => g.mutate((s, w, sink) => devCommands.addResources(s, w, -100000, sink))}>Empty</button>
          <button onClick={() => g.mutate((s, w, sink) => devCommands.addResources(s, w, -100000, sink, 'stew'))}>No stew</button>
        </div>
      </section>
      <section>
        <h4>Progression</h4>
        <div className="seg">
          <button onClick={() => g.mutate((s, _w, sink) => devCommands.levelUp(s, sink))}>Level up</button>
          <button onClick={() => g.mutate((s, w, sink) => devCommands.completeActiveResearch(s, w, sink))}>Finish research</button>
          <button onClick={() => g.mutate((s, w, sink) => devCommands.unlockAllResearch(s, w, sink))}>Unlock all research</button>
          <button onClick={() => g.mutate((s, w, sink) => devCommands.completeConstructions(s, w, sink))}>Finish buildings</button>
        </div>
      </section>
      <section>
        <h4>Villagers</h4>
        <div className="seg">
          <button onClick={() => g.mutate((s, w, sink) => devCommands.addVillager(s, w, runtime.renderer?.cameraCtl.target ?? { x: 32, z: 34 }, sink))}>Add villager</button>
          <button
            disabled={selection?.kind !== 'villager'}
            onClick={() => {
              const sel = ui.get().selection;
              const t = runtime.renderer?.cameraCtl.target;
              if (sel?.kind === 'villager' && t) g.mutate((s, w, sink) => devCommands.teleportVillager(s, w, sel.id, { x: t.x, z: t.z }, sink));
            }}
          >
            Teleport selected to view
          </button>
        </div>
      </section>
      <ValleySection />
      <EconomySimSection />
      <section>
        <h4>Session</h4>
        <div className="seg">
          <button onClick={() => skip(3600, true)}>Simulate 1h offline</button>
          <button className="danger" onClick={() => ui.set({ panel: 'settings', confirmReset: true })}>
            Reset game…
          </button>
        </div>
      </section>
    </div>
  );
}

/** Live draw-call / triangle counters and switches to compare the culling features. */
function RenderingSection() {
  useGameState();
  const r = runtime.renderer;
  if (!r) return null;
  const st = r.renderStats();
  const c = r.culling;
  const toggle = (key: 'frustum' | 'lod' | 'occlusion') => (
    <label className="toggle" key={key}>
      <input type="checkbox" checked={c[key]} onChange={(e) => (c[key] = e.target.checked)} />
      {key === 'frustum' ? 'Frustum culling' : key === 'lod' ? 'Level of detail' : 'Occlusion culling'}
    </label>
  );
  return (
    <section>
      <h4>Rendering</h4>
      <p className="small">
        {st.calls} draw calls · {(st.triangles / 1000).toFixed(0)}k triangles (incl. shadows)
        <br />
        Nature: {(st.natureTriangles / 1000).toFixed(0)}k tris · chunks {st.visible}/{st.chunks} drawn, {st.inView} in view, {st.occluded} occluded
      </p>
      {toggle('frustum')}
      {toggle('lod')}
      {toggle('occlusion')}
    </section>
  );
}

/** Asks the dev server to age the Valley by `hours`, then re-syncs. */
async function skipValley(hours: number): Promise<void> {
  await apiFetch(`/api/valley/${playerId()}/dev-skip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hours }) });
  await runtime.valley?.refresh();
}

/** Lets Valley time pass on the dev server (neighbours deliver, builds finish). */
function ValleySection() {
  const state = useGameState();
  if (!runtime.valley || !state.valley.valleyId) return null;
  return (
    <section>
      <h4>Valley time</h4>
      <div className="seg">
        <button onClick={() => void skipValley(1)}>+1h</button>
        <button onClick={() => void skipValley(6)}>+6h</button>
        <button onClick={() => void skipValley(24)}>+1 day</button>
        <button onClick={() => void skipValley(24 * 7)}>+1 week</button>
      </div>
      <p className="small muted">Ages the server-side Valley; your village clock is untouched.</p>
    </section>
  );
}
