import { useEffect, useRef } from 'react';
import { runtime, game } from '../game/runtime';
import { summarizeAway, summaryIsInteresting } from '../game/offline';
import { GameRenderer } from '../rendering/GameRenderer';
import type { ResourceId } from '../config/resources';
import { interaction } from './interaction';
import type { PickTarget } from '../rendering/InputController';
import { openArea } from './layout';
import { reducedMotion, sameTarget, ui } from './store';

/** Mounts the 3D world and keeps renderer view state in step with the UI store. */
export function GameView() {
  const container = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const g = game();
    const r = new GameRenderer(container.current!, overlay.current!, g, runtime.audio, interaction);
    runtime.renderer = r;
    let lastTick = 0;
    let lastSelection: PickTarget | null = null;
    let revealIn = 0;
    r.onFrame = (t) => {
      const s = ui.get();
      // Once the selection sheet has rendered, make sure the selection isn't under it.
      if (s.selection ? !sameTarget(s.selection, lastSelection) : lastSelection !== null) {
        lastSelection = s.selection;
        revealIn = 2;
        if (!s.selection) r.cameraCtl.focusAt.set(0, 0);
      }
      if (revealIn > 0 && --revealIn === 0 && s.selection) r.reveal(s.selection, openArea());
      r.view.selection = s.selection;
      r.view.hover = s.mode.kind === 'place' || s.mode.kind === 'move' ? null : s.hover;
      r.view.showNames = s.showNames;
      r.dayCycle.mode = s.prefs.timeOfDay;
      r.quality.preset = s.prefs.quality;
      r.post.miniature = s.prefs.miniature;
      r.weather.enabled = s.prefs.weather;
      r.weather.amount = reducedMotion(s.prefs) ? 0.35 : 1;
      r.particles.amount = reducedMotion(s.prefs) ? 0.3 : 1;
      const placing = s.mode.kind === 'place' || s.mode.kind === 'move';
      r.view.ghost =
        placing && s.placement && (s.mode.kind === 'place' || s.mode.kind === 'move')
          ? { defId: s.mode.defId, cellX: s.placement.cellX, cellZ: s.placement.cellZ, rotation: s.mode.rotation, valid: s.placement.valid }
          : null;
      r.view.movingBuildingId = s.mode.kind === 'move' ? s.mode.buildingId : null;
      r.view.showGrid = placing;
      if (s.travelling) ui.set({ travelling: false });
      // HUD re-renders cost frame time; while a finger moves the view, the view comes first.
      if (t - lastTick > (r.interacting ? 1 : 0.15)) {
        lastTick = t;
        ui.set({ tick: s.tick + 1 });
      }
    };
    r.onCatchUp = (events, before, seconds) => {
      const summary = summarizeAway(before as Record<ResourceId, number>, g.state, events, seconds, seconds);
      if (summaryIsInteresting(summary)) ui.set({ away: summary });
    };
    r.start();
    // Frame the village on first load.
    const lodge = g.state.buildings.find((b) => b.defId === 'cookhouse');
    if (lodge) r.focusOn({ kind: 'building', id: lodge.id }, 26);
    return () => {
      r.dispose();
      runtime.renderer = null;
    };
  }, []);
  return (
    <div className="world" ref={container}>
      <div className="world-overlay" ref={overlay} />
    </div>
  );
}
