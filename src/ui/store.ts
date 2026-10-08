import { create } from 'zustand';
import type { BuildingId } from '../config/buildings';
import type { ValleyBuildingId } from '../config/valley';
import type { ResearchId } from '../config/research';
import type { AwaySummary } from '../game/offline';
import type { SaveStatus } from '../game/autosave';
import type { SaveSource } from '../game/persistence';
import type { PickTarget } from '../rendering/InputController';
import type { Rotation } from '../sim/types';
import type { IconName } from './icons';

export type Mode =
  | { kind: 'normal' }
  | { kind: 'place'; defId: BuildingId; rotation: Rotation }
  | { kind: 'move'; buildingId: number; defId: BuildingId; rotation: Rotation }
  | { kind: 'assign'; villagerId: number };

export interface Placement {
  cellX: number;
  cellZ: number;
  valid: boolean;
  reason: string | null;
}

export type Panel = 'build' | 'research' | 'settings' | 'dev' | 'notifications' | 'workers' | 'satchel' | 'road' | 'chat' | null;

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warning' | 'level';
  title: string;
  body?: string;
  icon?: IconName;
  target?: PickTarget;
  at: number;
}

export type SceneId = 'village' | 'valley';

export interface UIState {
  booted: boolean;
  /** Which world is on screen. The village keeps simulating either way. */
  scene: SceneId;
  /** True for the moment between choosing to travel and the new world's first frame. */
  travelling: boolean;
  valleySelection: ValleyBuildingId | null;
  valleyHover: ValleyBuildingId | null;
  /** The "find your Valley" dialog (first visit, or after leaving). */
  valleyChooser: boolean;
  /** Last Valley chat message id the player has seen. */
  chatSeen: number;
  bootError: string | null;
  saveSource: SaveSource | null;
  saveStatus: SaveStatus;
  /** Bumped a few times per second so HUD components re-read game state. */
  tick: number;
  selection: PickTarget | null;
  hover: PickTarget | null;
  mode: Mode;
  placement: Placement | null;
  panel: Panel;
  researchFocus: ResearchId | null;
  buildHighlight: BuildingId | null;
  toasts: Toast[];
  history: Toast[];
  unread: number;
  away: AwaySummary | null;
  levelUp: number | null;
  newcomersHidden: boolean;
  showNames: boolean;
  confirmReset: boolean;
}

let toastId = 1;

export const useUI = create<UIState>(() => ({
  booted: false,
  scene: 'village',
  travelling: false,
  valleySelection: null,
  valleyHover: null,
  valleyChooser: false,
  chatSeen: 0,
  bootError: null,
  saveSource: null,
  saveStatus: { lastSavedAt: null, outcome: null },
  tick: 0,
  selection: null,
  hover: null,
  mode: { kind: 'normal' },
  placement: null,
  panel: null,
  researchFocus: null,
  buildHighlight: null,
  toasts: [],
  history: [],
  unread: 0,
  away: null,
  levelUp: null,
  newcomersHidden: false,
  showNames: false,
  confirmReset: false,
}));

export const ui = {
  get: useUI.getState,
  set: useUI.setState,
  select(selection: PickTarget | null): void {
    useUI.setState({ selection });
  },
  openPanel(panel: Panel): void {
    useUI.setState((s) => ({ panel: s.panel === panel ? null : panel, unread: panel === 'notifications' ? 0 : s.unread }));
  },
  closePanel(): void {
    useUI.setState({ panel: null });
  },
  toast(t: Omit<Toast, 'id' | 'at'>, ttlMs = 4800): void {
    const toast: Toast = { ...t, id: toastId++, at: Date.now() };
    useUI.setState((s) => ({
      toasts: [...s.toasts.slice(-3), toast],
      history: [toast, ...s.history].slice(0, 40),
      unread: s.panel === 'notifications' ? 0 : s.unread + 1,
    }));
    window.setTimeout(() => ui.dismissToast(toast.id), ttlMs);
  },
  dismissToast(id: number): void {
    useUI.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
};

export function sameTarget(a: PickTarget | null, b: PickTarget | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}
