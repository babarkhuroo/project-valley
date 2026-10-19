import { ensureChests } from '../sim/chests';
import { settleBrewing } from '../sim/brewing';
import { ensureRequests, requestsUnlocked, REQUESTS } from '../sim/requests';
import { ensureWilds, WILDS } from '../sim/wilds';
import type { Game } from './Game';

/**
 * Keeps the later village systems going, a couple of times a second while the village is on
 * screen: chests start counting, wild finds stay planted (and move off ground a new building
 * took), finished brews go into the satchel, and the requests board opens at its level and
 * keeps its places filled. Each only mutates when there's something to do.
 */
export function villageUpkeep(game: Game): void {
  const s = game.state;
  const grid = game.world.grid;
  if (!s.chests) game.mutate((st) => ensureChests(st));
  const wilds = s.wilds;
  if (!wilds || wilds.spots.length < WILDS.spots || wilds.spots.some((sp) => grid.occupancy[grid.index(Math.floor(sp.x), Math.floor(sp.z))] !== 0)) {
    game.mutate((st, w) => ensureWilds(st, w));
  }
  if (s.brewing?.kettles.some((k) => k.doneAt <= s.time)) game.mutate((st, _w, sink) => settleBrewing(st, sink));
  if (requestsUnlocked(s) && (!s.requests || s.requests.slots.length < REQUESTS.slots)) {
    const opening = !s.requests;
    game.mutate((st, _w, sink) => {
      ensureRequests(st);
      if (opening && st.requests) sink.push({ type: 'requestsOpened' });
    });
  }
}
