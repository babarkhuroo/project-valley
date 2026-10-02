import { BUILDINGS } from '../config/buildings';
import { RESEARCH } from '../config/research';
import type { ResourceId } from '../config/resources';
import { autoplayStep } from './autoplay';
import type { SimEvent } from './events';
import { createInitialState } from './initialState';
import { advance } from './simulation';
import type { GameState } from './types';
import { createWorld } from './world';

export interface PacingMilestone {
  /** Sim seconds since founding. */
  t: number;
  label: string;
  kind: 'build' | 'upgrade' | 'research' | 'level' | 'villager';
}

export interface PacingSample {
  t: number;
  level: number;
  villagers: number;
  resources: Record<ResourceId, number>;
}

export interface PacingReport {
  seconds: number;
  milestones: PacingMilestone[];
  samples: PacingSample[];
  /** Share of villager-time spent idle / waiting (blocked) / hungry. */
  idleShare: number;
  blockedShare: number;
  hungryShare: number;
  /** Same shares per hour of play, so the late game doesn't hide early-game problems. */
  hourly: { hour: number; idle: number; blocked: number; hungry: number }[];
  final: { level: number; villagers: number; researched: number; buildings: number };
}

/** Seconds of sim time between autoplayer decisions (a player checking in). */
const DECISION_SECONDS = 15;
const SAMPLE_SECONDS = 60;

/**
 * Fast-forwards a brand-new village under the autoplayer and records when things
 * happen. Deterministic: the same config always produces the same report, so it works
 * as a regression test for pacing as well as a balancing aid.
 */
export function runEconomySim(seconds: number, onProgress?: (t: number) => void): PacingReport {
  const world = createWorld();
  const state: GameState = createInitialState(world, 0);
  state.tutorial.skipped = true;
  const milestones: PacingMilestone[] = [];
  const samples: PacingSample[] = [];
  let villagerTime = 0;
  let idleTime = 0;
  let blockedTime = 0;
  let hungryTime = 0;
  let nextSample = 0;
  const hourly: { hour: number; total: number; idle: number; blocked: number; hungry: number }[] = [];

  const record = (events: SimEvent[]) => {
    for (const e of events) {
      const t = Math.round(state.time);
      switch (e.type) {
        case 'constructionComplete':
          if (BUILDINGS[e.defId].category !== 'decor') milestones.push({ t, label: BUILDINGS[e.defId].name, kind: 'build' });
          break;
        case 'upgradeComplete':
          milestones.push({ t, label: `${BUILDINGS[e.defId].name} → level ${e.level}`, kind: 'upgrade' });
          break;
        case 'researchComplete':
          milestones.push({ t, label: RESEARCH[e.researchId].name, kind: 'research' });
          break;
        case 'levelUp':
          milestones.push({ t, label: `Village level ${e.level}`, kind: 'level' });
          break;
        case 'villagerJoined':
          milestones.push({ t, label: `Villager #${state.villagers.length} joins`, kind: 'villager' });
          break;
        default:
          break;
      }
    }
  };

  while (state.time < seconds) {
    if (state.time >= nextSample) {
      samples.push({ t: Math.round(state.time), level: state.player.level, villagers: state.villagers.length, resources: { ...state.resources } });
      nextSample += SAMPLE_SECONDS;
      onProgress?.(state.time);
    }
    const sink: SimEvent[] = [];
    autoplayStep(state, world, sink);
    record(sink);
    const hour = Math.floor(state.time / 3600);
    hourly[hour] ??= { hour: hour + 1, total: 0, idle: 0, blocked: 0, hungry: 0 };
    for (const v of state.villagers) {
      villagerTime += DECISION_SECONDS;
      hourly[hour].total += DECISION_SECONDS;
      if (!v.job) {
        idleTime += DECISION_SECONDS;
        hourly[hour].idle += DECISION_SECONDS;
      } else if (v.activity === 'blocked') {
        blockedTime += DECISION_SECONDS;
        hourly[hour].blocked += DECISION_SECONDS;
      }
      if (v.hungry) {
        hungryTime += DECISION_SECONDS;
        hourly[hour].hungry += DECISION_SECONDS;
      }
    }
    const events: SimEvent[] = [];
    advance(state, world, Math.min(DECISION_SECONDS, seconds - state.time), events);
    record(events);
  }
  samples.push({ t: Math.round(state.time), level: state.player.level, villagers: state.villagers.length, resources: { ...state.resources } });
  return {
    seconds,
    milestones,
    samples,
    idleShare: idleTime / Math.max(1, villagerTime),
    blockedShare: blockedTime / Math.max(1, villagerTime),
    hungryShare: hungryTime / Math.max(1, villagerTime),
    hourly: hourly.map((h) => ({ hour: h.hour, idle: h.idle / h.total, blocked: h.blocked / h.total, hungry: h.hungry / h.total })),
    final: {
      level: state.player.level,
      villagers: state.villagers.length,
      researched: state.research.completed.length,
      buildings: state.buildings.filter((b) => b.status === 'complete').length,
    },
  };
}

export function formatClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
}

