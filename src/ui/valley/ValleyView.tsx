import { useEffect, useRef } from 'react';
import { game, runtime } from '../../game/runtime';
import { ValleyRenderer } from '../../rendering/valley/ValleyRenderer';
import { ui } from '../store';
import { playerId } from '../../game/persistence';

/** Mounts the Valley scene. Lives only while the player is visiting. */
export function ValleyView() {
  const container = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = new ValleyRenderer(container.current!, overlay.current!, game(), runtime.audio, {
      onHover: (id) => {
        if (ui.get().valleyHover !== id) ui.set({ valleyHover: id });
      },
      onSelect: (id) => ui.set({ valleySelection: id }),
      onCancel: () => {
        const s = ui.get();
        if (s.panel) ui.closePanel();
        else ui.set({ valleySelection: null });
      },
    });
    runtime.valleyRenderer = r;
    r.me = playerId();
    const client = runtime.valley;
    r.setSnapshot(client?.current.snapshot ?? null);
    const unsubscribe = client?.subscribe(() => r.setSnapshot(client.current.snapshot));
    let lastTick = 0;
    r.onFrame = (t) => {
      const s = ui.get();
      r.selected = s.valleySelection;
      r.hovered = s.valleyHover;
      if (s.travelling) ui.set({ travelling: false });
      if (t - lastTick > 0.15) {
        lastTick = t;
        ui.set({ tick: s.tick + 1 });
      }
    };
    r.start();
    return () => {
      unsubscribe?.();
      r.dispose();
      runtime.valleyRenderer = null;
    };
  }, []);
  return (
    <div className="world" ref={container}>
      <div className="world-overlay" ref={overlay} />
    </div>
  );
}
