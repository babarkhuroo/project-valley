import { useState } from 'react';
import { IDENTITY } from '../../config/identity';
import { runtime } from '../../game/runtime';
import { deleteSave } from '../../game/persistence';
import { rename, tutorialRestart, tutorialSkip } from '../actions';
import { Icon } from '../common/Icon';
import { AccountSection } from './AccountSection';
import { useGameState } from '../hooks';
import { ui, useUI } from '../store';

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function SettingsPanel() {
  const state = useGameState();
  const open = useUI((s) => s.panel === 'settings');
  const saveStatus = useUI((s) => s.saveStatus);
  const saveSource = useUI((s) => s.saveSource);
  const showNames = useUI((s) => s.showNames);
  const prefs = useUI((s) => s.prefs);
  const confirmReset = useUI((s) => s.confirmReset);
  const [, force] = useState(0);
  const [name, setName] = useState(state.player.villageName);
  if (!open) return null;
  const audio = runtime.audio;
  const set = (p: Partial<typeof audio.settings>) => {
    audio.update(p);
    force((n) => n + 1);
  };
  return (
    <div className="settings panel pop-in">
      <header>
        <h3>
          <Icon name="gear" size={22} /> Settings
        </h3>
        <button className="icon-btn" onClick={() => ui.closePanel()} aria-label="Close">
          <Icon name="close" size={18} />
        </button>
      </header>
      <AccountSection />
      <section>
        <h4>Village</h4>
        <form
          className="rename"
          onSubmit={(e) => {
            e.preventDefault();
            rename(name);
          }}
        >
          <input value={name} maxLength={28} onChange={(e) => setName(e.target.value)} aria-label="Village name" />
          <button className="btn small" type="submit">
            Rename
          </button>
        </form>
      </section>
      <section>
        <h4>
          <Icon name="sound" size={18} /> Sound
        </h4>
        <label className="toggle">
          <input type="checkbox" checked={audio.settings.muted} onChange={(e) => set({ muted: e.target.checked })} /> Mute everything
        </label>
        <Slider label="Music" value={audio.settings.music} onChange={(v) => set({ music: v })} />
        <Slider label="Effects" value={audio.settings.sfx} onChange={(v) => set({ sfx: v })} />
        <Slider label="Nature" value={audio.settings.ambience} onChange={(v) => set({ ambience: v })} />
      </section>
      <section>
        <h4>Display</h4>
        <label className="toggle">
          <input type="checkbox" checked={showNames} onChange={(e) => ui.set({ showNames: e.target.checked })} /> Always show villager names
        </label>
        <label className="toggle">
          <input type="checkbox" checked={prefs.timeOfDay === 'clock'} onChange={(e) => ui.setPrefs({ timeOfDay: e.target.checked ? 'clock' : 'day' })} /> Day and night follow my clock
        </label>
      </section>
      <section>
        <h4>Accessibility</h4>
        <label className="slider">
          <span>Interface {Math.round(prefs.uiScale * 100)}%</span>
          <input type="range" min={0.8} max={1.4} step={0.05} value={prefs.uiScale} onChange={(e) => ui.setPrefs({ uiScale: Number(e.target.value) })} aria-label="Interface size" />
        </label>
        <label className="select-row">
          <span>Calm motion</span>
          <select value={prefs.reduceMotion} onChange={(e) => ui.setPrefs({ reduceMotion: e.target.value as typeof prefs.reduceMotion })}>
            <option value="system">Follow my device</option>
            <option value="on">On — fewer animations and particles</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={prefs.highContrast} onChange={(e) => ui.setPrefs({ highContrast: e.target.checked })} /> High contrast
        </label>
      </section>
      <section>
        <h4>Graphics</h4>
        <label className="select-row">
          <span>Quality</span>
          <select value={prefs.quality} onChange={(e) => ui.setPrefs({ quality: e.target.value as typeof prefs.quality })}>
            <option value="auto">Automatic — stays smooth</option>
            <option value="high">High</option>
            <option value="balanced">Balanced</option>
            <option value="low">Low — for older devices</option>
          </select>
        </label>
        <p className="small muted">Automatic lowers the resolution when frames run slow and raises it again when there’s room.</p>
      </section>
      <section>
        <h4>Tutorial</h4>
        <div className="row-buttons">
          <button className="btn small ghost" onClick={tutorialRestart}>
            Replay tutorial
          </button>
          {!state.tutorial.done && !state.tutorial.skipped ? (
            <button className="btn small ghost" onClick={tutorialSkip}>
              Skip tutorial
            </button>
          ) : null}
        </div>
      </section>
      <section>
        <h4>Controls</h4>
        <ul className="controls">
          <li><b>Drag</b> pan · <b>Wheel / pinch</b> zoom · <b>Right-drag, Q/E</b> rotate</li>
          <li><b>WASD / arrows</b> pan · <b>R</b> rotate a building · <b>Esc</b> cancel</li>
        </ul>
      </section>
      <section>
        <h4>Saving</h4>
        <p className="small muted">
          {saveSource === 'local' ? 'Playing from this device’s cache — ' : ''}
          {saveStatus.lastSavedAt
            ? `Saved ${saveStatus.outcome === 'server' ? 'to the server' : 'on this device'} at ${new Date(saveStatus.lastSavedAt).toLocaleTimeString()}.`
            : 'Saves automatically every few seconds.'}
        </p>
        {confirmReset ? (
          <div className="blocker warn">
            <span>Start over? Your whole village will be lost.</span>
            <button
              className="btn small danger"
              onClick={async () => {
                await deleteSave();
                window.location.reload();
              }}
            >
              Yes, reset
            </button>
            <button className="btn small ghost" onClick={() => ui.set({ confirmReset: false })}>
              Keep playing
            </button>
          </div>
        ) : (
          <button className="btn small danger" onClick={() => ui.set({ confirmReset: true })}>
            Reset village…
          </button>
        )}
      </section>
      <p className="small muted credit">
        {IDENTITY.gameTitle} · all art and sound are generated in your browser.
      </p>
    </div>
  );
}
