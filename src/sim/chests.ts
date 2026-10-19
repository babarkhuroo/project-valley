import { BASE_BOOST_ORDER } from '../config/trade';
import type { ResourceId } from '../config/resources';
import { addResource, capacity } from './economy';
import { nextOf, seedFrom } from './extrasRng';
import type { CommandResult } from './commands';
import type { EventSink } from './events';
import type { ChestReward, GameState } from './types';

/**
 * A reward chest for every village level reached: coins, a good share of two goods the village
 * stores, and often a tonic — two from level 6. Chests wait until opened (the contents roll
 * then, from the chests' own random stream), so offline level-ups count; villages from before
 * chests start counting from their current level.
 */
export function ensureChests(state: GameState): void {
  state.chests ??= { baseLevel: state.player.level, opened: 0, rng: seedFrom(state.seed, 15485863, 101) };
}

/** Chests waiting to be opened. */
export const chestsPending = (state: GameState): number => (state.chests ? Math.max(0, state.player.level - state.chests.baseLevel - state.chests.opened) : 0);

/** The level the next chest to open was earned at. */
export const nextChestLevel = (state: GameState): number => (state.chests ? state.chests.baseLevel + state.chests.opened + 1 : state.player.level);

export function openChest(state: GameState, sink: EventSink): CommandResult<ChestReward> {
  const chests = state.chests;
  if (chestsPending(state) <= 0 || !chests) return { ok: false, error: 'No chest to open' };
  const level = nextChestLevel(state);
  const rand = () => nextOf(chests);
  const reward: ChestReward = { level, coins: Math.round((25 + 15 * level) * (0.8 + rand() * 0.4)), goods: {}, tonics: [] };
  state.trade.coins += reward.coins;
  const goods = (['timber', 'clay', 'stone', 'planks', 'bricks', 'grain'] as ResourceId[]).filter((r) => capacity(state, r) >= 50);
  for (let i = 0; i < 2 && goods.length > 0; i++) {
    const r = goods[Math.floor(rand() * goods.length) % goods.length];
    goods.splice(goods.indexOf(r), 1);
    const amount = Math.max(10, Math.floor((capacity(state, r) * (0.25 + rand() * 0.2)) / 5) * 5);
    reward.goods[r] = addResource(state, r, amount);
  }
  const tonics = (rand() < 0.6 ? 1 : 0) + (level >= 6 && rand() < 0.35 ? 1 : 0);
  for (let i = 0; i < tonics; i++) {
    const t = BASE_BOOST_ORDER[Math.floor(rand() * BASE_BOOST_ORDER.length) % BASE_BOOST_ORDER.length];
    state.trade.inventory[t] = (state.trade.inventory[t] ?? 0) + 1;
    reward.tonics.push(t);
  }
  chests.opened += 1;
  sink.push({ type: 'chestOpened', reward });
  return { ok: true, value: reward };
}
