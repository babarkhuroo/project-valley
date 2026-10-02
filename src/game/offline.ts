import { BALANCE } from '../config/balance';
import { BUILDINGS } from '../config/buildings';
import { RESEARCH } from '../config/research';
import { RESOURCE_ORDER, type ResourceId } from '../config/resources';
import type { SimEvent } from '../sim/events';
import type { GameState } from '../sim/types';

export interface AwaySummary {
  seconds: number;
  cappedSeconds: number;
  gained: Partial<Record<ResourceId, number>>;
  spent: Partial<Record<ResourceId, number>>;
  built: string[];
  researched: string[];
  levels: number[];
  newcomers: boolean;
  fullStorage: ResourceId[];
  wentHungry: boolean;
  idle: string[];
}

export function clampOffline(seconds: number): number {
  return Math.max(0, Math.min(seconds, BALANCE.offline.maxSeconds));
}

/** Folds a burst of simulation events into a single "while you were away" report. */
export function summarizeAway(before: Record<ResourceId, number>, state: GameState, events: SimEvent[], seconds: number, cappedSeconds: number): AwaySummary {
  const gained: Partial<Record<ResourceId, number>> = {};
  const spent: Partial<Record<ResourceId, number>> = {};
  for (const r of RESOURCE_ORDER) {
    const d = Math.round(state.resources[r] - before[r]);
    if (d > 0) gained[r] = d;
    if (d < 0) spent[r] = -d;
  }
  const built: string[] = [];
  const researched: string[] = [];
  const levels: number[] = [];
  const full = new Set<ResourceId>();
  const idleIds = new Set<number>();
  let newcomers = false;
  let wentHungry = false;
  for (const e of events) {
    switch (e.type) {
      case 'constructionComplete':
        built.push(BUILDINGS[e.defId].name);
        break;
      case 'upgradeComplete':
        built.push(`${BUILDINGS[e.defId].name} (level ${e.level})`);
        break;
      case 'researchComplete':
        researched.push(RESEARCH[e.researchId].name);
        break;
      case 'levelUp':
        levels.push(e.level);
        break;
      case 'storageFull':
        full.add(e.resource);
        break;
      case 'newcomersAvailable':
        newcomers = true;
        break;
      case 'hungry':
        wentHungry = true;
        break;
      case 'villagerIdle':
        if (e.reason !== 'unassigned') idleIds.add(e.villagerId);
        break;
      default:
        break;
    }
  }
  const idle = state.villagers.filter((v) => idleIds.has(v.id) && !v.job).map((v) => v.name);
  return { seconds, cappedSeconds, gained, spent, built, researched, levels, newcomers, fullStorage: [...full], wentHungry, idle };
}

export function summaryIsInteresting(s: AwaySummary): boolean {
  return s.cappedSeconds >= 30 && (Object.keys(s.gained).length > 0 || s.built.length > 0 || s.researched.length > 0 || s.levels.length > 0);
}
