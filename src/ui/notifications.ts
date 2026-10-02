import { BUILDINGS } from '../config/buildings';
import { RESEARCH } from '../config/research';
import { RESOURCES } from '../config/resources';
import { SKILLS } from '../config/skills';
import { VALLEY_BUILDINGS } from '../config/valley';
import { BOOSTS, MERCHANTS } from '../config/trade';
import { canClaimRoad } from '../sim/trade';
import type { ValleyClient } from '../game/valleyClient';
import { bagText, describeLog } from './valley/format';
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
  let roadNotified = -1;
  return game.subscribe((events, { catchUp }) => {
    if (catchUp) return;
    const state = game.state;
    if (canClaimRoad(state) && roadNotified !== state.trade.roadClaimed) {
      roadNotified = state.trade.roadClaimed;
      ui.toast({ kind: 'success', title: 'A Reputation Road reward is ready', body: 'Open the Reputation Road to claim it.', icon: 'reputation' }, 6000);
    }
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
        case 'craftQueueEmpty':
          if (once(`queue-${e.buildingId}`, 60_000)) {
            ui.toast({ kind: 'info', title: `The ${BUILDINGS[e.defId].name} has finished its orders`, body: 'Add more, or choose “Keep making”.', icon: 'craft', target: { kind: 'building', id: e.buildingId } });
          }
          break;
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
        case 'shipArrived': {
          const m = MERCHANTS[e.merchant];
          ui.toast({ kind: 'info', title: `${m.name} has docked at Saltreach Harbour`, body: `${m.ship} wants ${e.crates} crates filled — and has tonics for sale.`, icon: 'ship' }, 7000);
          runtime.audio.play('notify');
          break;
        }
        case 'shipLeft':
          ui.toast({ kind: 'info', title: `${MERCHANTS[e.merchant].ship} has sailed`, body: e.filled > 0 ? `You filled ${e.filled} crate${e.filled > 1 ? 's' : ''}. Another ship will come.` : 'Another ship will come before long.', icon: 'ship' });
          break;
        case 'crateFilled':
          ui.toast({ kind: 'success', title: `Crate loaded: +${e.coins} coins`, body: `+${e.reputation} reputation`, icon: 'coin' }, 2500);
          break;
        case 'shipComplete':
          ui.toast({ kind: 'success', title: 'Every crate filled!', body: `${MERCHANTS[e.merchant].name} adds ${e.coins} coins and +${e.reputation} reputation.`, icon: 'coin' }, 5000);
          runtime.audio.play('complete');
          break;
        case 'boostEnded':
          ui.toast({ kind: 'info', title: `${BOOSTS[e.boost].name} has worn off`, icon: 'potion' }, 3500);
          break;
        case 'valleyAccepted': {
          const name = VALLEY_BUILDINGS[e.building].name;
          const back = bagText(e.returned);
          if (e.reputation > 0) {
            ui.toast({ kind: 'success', title: `Delivered to the ${name}`, body: `+${e.reputation} reputation${back ? ` · ${back} wasn’t needed and came home` : ''}`, icon: 'reputation' }, 3500);
          } else if (back) {
            ui.toast({ kind: 'info', title: `The ${name} didn’t need that after all`, body: `${back} came back home.`, icon: 'gift' });
          }
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

/** Valley milestones (restorations, new projects) become toasts; routine deliveries don't. */
export function attachValleyNotifications(client: ValleyClient): void {
  client.onLog = (entries, snapshot) => {
    for (const e of entries) {
      if (e.kind !== 'finished') continue;
      ui.toast({ kind: 'success', title: describeLog(e, snapshot, null), body: VALLEY_BUILDINGS[e.building].levels[e.level - 1]?.summary, icon: 'valley' }, 6500);
      runtime.audio.play('complete');
    }
    // Several projects often open together (all the guilds at once): one toast for the lot.
    const opened = entries.filter((e) => e.kind === 'opened');
    if (opened.length === 1) {
      ui.toast({ kind: 'info', title: describeLog(opened[0], snapshot, null), body: VALLEY_BUILDINGS[opened[0].building].description, icon: 'valley' }, 6500);
    } else if (opened.length > 1) {
      const names = opened.map((e) => (e.kind === 'opened' ? VALLEY_BUILDINGS[e.building].name : '')).join(', ');
      ui.toast({ kind: 'info', title: `${opened.length} new Valley projects are open`, body: names, icon: 'valley' }, 6500);
    }
  };
}
