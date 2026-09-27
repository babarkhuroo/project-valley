import type { InteractionHandler, PickResult, PickTarget } from '../rendering/InputController';
import { runtime, game } from '../game/runtime';
import { findBuilding, findNode } from '../sim/villagerAI';
import { NODES } from '../config/nodes';
import { BUILDINGS } from '../config/buildings';
import type { Job } from '../sim/types';
import { assign, cancelMode, confirmPlacement, rotatePlacement, updatePlacementFromGround } from './actions';
import { sameTarget, ui } from './store';

/** Job implied by clicking a target while assigning a villager. */
export function jobForTarget(target: PickTarget): Job | null {
  const state = game().state;
  if (target.kind === 'node') {
    const n = findNode(state, target.id);
    return n ? { kind: 'gather', nodeId: n.id } : null;
  }
  if (target.kind === 'building') {
    const b = findBuilding(state, target.id);
    if (!b) return null;
    if (b.status === 'construction') return { kind: 'construct', buildingId: b.id };
    if (BUILDINGS[b.defId].operate) return { kind: 'operate', buildingId: b.id };
  }
  return null;
}

/** Bridges raw world input (from the renderer) to UI state and game actions. */
export const interaction: InteractionHandler = {
  onHover(target) {
    const cur = ui.get().hover;
    if (!sameTarget(cur, target) && !(cur === null && target === null)) ui.set({ hover: target });
    const canvas = runtime.renderer?.renderer.domElement;
    if (canvas) canvas.style.cursor = target ? 'pointer' : '';
  },
  onGroundMove(ground) {
    if (ground) updatePlacementFromGround(ground.x, ground.z);
  },
  onClick(result: PickResult, touch: boolean) {
    const { mode } = ui.get();
    if (mode.kind === 'place' || mode.kind === 'move') {
      if (result.ground) updatePlacementFromGround(result.ground.x, result.ground.z);
      // On touch screens a tap positions the ghost; the ✓ button confirms.
      if (!touch) confirmPlacement();
      return;
    }
    if (mode.kind === 'assign') {
      const job = result.target ? jobForTarget(result.target) : null;
      if (job) assign(mode.villagerId, job);
      else if (result.target?.kind === 'villager') ui.set({ mode: { kind: 'normal' }, selection: result.target });
      else if (result.target?.kind === 'node') {
        const n = findNode(game().state, result.target.id);
        if (n) ui.toast({ kind: 'warning', title: `${NODES[n.kind].name} can't be worked right now`, icon: 'info' }, 2500);
      } else cancelMode();
      return;
    }
    if (result.target) {
      ui.select(result.target);
      runtime.audio.play('click');
    } else if (ui.get().selection) {
      ui.select(null);
    }
  },
  onCancel() {
    const s = ui.get();
    if (s.mode.kind !== 'normal') cancelMode();
    else if (s.panel) ui.closePanel();
    else ui.select(null);
  },
  onRotate() {
    rotatePlacement();
  },
};
