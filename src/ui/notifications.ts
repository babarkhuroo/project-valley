import { BUILDINGS } from '../config/buildings';
import { RESEARCH } from '../config/research';
import { RESOURCES } from '../config/resources';
import { SKILLS } from '../config/skills';
import type { Game } from '../game/Game';
import { runtime } from '../game/runtime';
import { findVillager } from '../sim/villagerAI';
import { ui } from './store';

const IDLE_REASON: Record<string, string> = {
  depleted: 'Nothing left to gather nearby.',
  finished: 'Construction finished.',
  unreachable: 'Couldn’t find a way to the job.',
  removed: 'Their job no longer exists.',
};

/**
 * Turns simulation events into player notifications. Repetitive warnings are
 * throttled so the player hears about a problem once, not every few seconds.
 */
export function attachNotifications(game: Game): () => void {
  const lastAt = new Map<string, number>();
  const once = (key: string, ms: number): boolean => {
    const now = Date.now();
    if ((lastAt.get(key) ?? 0) + ms > now) return false;
    lastAt.set(key, now);
    return true;
  };
  return game.subscribe((events, { catchUp }) => {
    if (catchUp) return;
    const state = game.state;
    for (const e of events) {
      switch (e.type) {
        case 'constructionComplete': {
          const def = BUILDINGS[e.defId];
          if (def.category === 'decor') break;
          ui.toast({ kind: 'success', title: `${def.name} complete!`, body: def.xp ? `+${def.xp} village XP` : undefined, icon: 'hammerHouse', target: { kind: 'building', id: e.buildingId } });
          break;
        }
        case 'upgradeComplete': {
          const def = BUILDINGS[e.defId];
          ui.toast({ kind: 'success', title: `${def.name} reached level ${e.level}!`, body: `+${def.upgrades?.[e.level - 2]?.xp ?? 0} village XP`, icon: 'upgrade', target: { kind: 'building', id: e.buildingId } });
          break;
        }
        case 'researchComplete':
          ui.toast({ kind: 'success', title: `Research complete: ${RESEARCH[e.researchId].name}`, body: RESEARCH[e.researchId].description, icon: 'research' }, 6000);
          break;
        case 'levelUp':
          ui.set({ levelUp: e.level });
          break;
        case 'storageFull':
          if (e.resource === 'knowledge') break;
          if (once(`full-${e.resource}`, 90_000)) {
            ui.toast({
              kind: 'warning',
              title: `${RESOURCES[e.resource].name} storage is full`,
              body: e.resource === 'stew' ? 'The cook will wait until someone eats.' : 'Production pauses until you build more storage or spend some.',
              icon: 'full',
            });
          }
          break;
        case 'villagerIdle': {
          if (e.reason === 'unassigned') break;
          const v = findVillager(state, e.villagerId);
          if (v && once(`idle-${v.id}`, 8000)) {
            ui.toast({ kind: 'info', title: `${v.name} is idle`, body: IDLE_REASON[e.reason], icon: 'idle', target: { kind: 'villager', id: v.id } });
          }
          break;
        }
        case 'hungry':
          if (once('hungry', 60_000)) {
            ui.toast({ kind: 'warning', title: 'The stew pot is empty', body: 'Hungry villagers work at 30% speed. Put someone in the Cookhouse.', icon: 'hungry' }, 7000);
          }
          break;
        case 'newcomersAvailable':
          ui.set({ newcomersHidden: false });
          runtime.audio.play('notify');
          break;
        case 'villagerJoined': {
          const v = findVillager(state, e.villagerId);
          if (v) ui.toast({ kind: 'success', title: `${v.name} joined ${state.player.villageName}!`, body: 'Give them something to do.', icon: 'villager', target: { kind: 'villager', id: v.id } });
          break;
        }
        case 'skillUp': {
          const v = findVillager(state, e.villagerId);
          if (v) ui.toast({ kind: 'info', title: `${v.name} improved at ${SKILLS[e.skill].name}`, body: `Now level ${e.level} — works faster.`, icon: 'xp', target: { kind: 'villager', id: v.id } });
          break;
        }
        default:
          break;
      }
    }
  });
}
