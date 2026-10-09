import type { BuildingId } from './buildings';

/**
 * Short introductions shown once each, the first time a system becomes available
 * after the opening tutorial — so new mechanics arrive one at a time, explained where
 * the player is looking.
 */

export type IntroId = 'clay' | 'stone' | 'upgrades' | 'workshops' | 'productionAreas' | 'valley' | 'merchants' | 'tonics' | 'road' | 'training' | 'valleyResearch' | 'festivals' | 'millrace' | 'farming' | 'goldfurrow';

export type IntroAction =
  | { type: 'openBuild'; building: BuildingId }
  | { type: 'openValley' }
  | { type: 'openHarbour' }
  | { type: 'openSatchel' }
  | { type: 'openRoad' }
  | { type: 'selectUpgradable' }
  | { type: 'selectTrainable' }
  | { type: 'openValleyBuilding'; building: 'greatLibrary' | 'festivalGrounds' | 'millraceWorkshop' | 'goldfurrowCommons' };

export interface IntroDef {
  id: IntroId;
  title: string;
  body: string;
  /** Icon name (see ui/icons). */
  icon: string;
  action: IntroAction;
  actionLabel: string;
}

export const INTROS: IntroDef[] = [
  { id: 'clay', title: 'Clay along the creek', body: 'Your villagers can dig the clay banks now. Build a Clay Shed nearby to store it — homes and upgrades need clay.', icon: 'clay', action: { type: 'openBuild', building: 'clayShed' }, actionLabel: 'Build a Clay Shed' },
  { id: 'stone', title: 'Stone in the hills', body: 'Rock outcrops in the north-east hills can be quarried. A Stone Yard close by keeps the walk short.', icon: 'stone', action: { type: 'openBuild', building: 'stoneYard' }, actionLabel: 'Build a Stone Yard' },
  { id: 'upgrades', title: 'Upgrades', body: 'Buildings grow: an upgrade adds storage, workers or speed, and the building keeps working while builders improve it.', icon: 'upgrade', action: { type: 'selectUpgradable' }, actionLabel: 'Show me one' },
  { id: 'workshops', title: 'Workshops', body: 'The Sawmill turns timber into planks. Give it orders — a number, or “keep making” — and a crafter works through them, even while you’re away.', icon: 'craft', action: { type: 'openBuild', building: 'sawmill' }, actionLabel: 'Build a Sawmill' },
  { id: 'farming', title: 'Grain Fields', body: 'Plough a field and sow grain — the meadow south of the bridge has the richest soil. Farmers tend and harvest it, a Granary stores the grain, and every handful in the pot makes three bowls of Stew.', icon: 'grain', action: { type: 'openBuild', building: 'field' }, actionLabel: 'Plough a field' },
  { id: 'productionAreas', title: 'Sources that never run out', body: 'Woodlots, Clay Pits and Quarries are permanent sources — place them near their store, because villagers still carry every load.', icon: 'build', action: { type: 'openBuild', building: 'woodlot' }, actionLabel: 'See the Woodlot' },
  { id: 'valley', title: 'The road over the ridge', body: 'Neighbouring villages share a Valley. Restore it together and every village gets the bonuses — and new things to do.', icon: 'valley', action: { type: 'openValley' }, actionLabel: 'Visit the Valley' },
  { id: 'merchants', title: 'Merchant ships', body: 'Ships now call at Saltreach Harbour. Fill their crates for coins and reputation — but not every price is worth your goods.', icon: 'ship', action: { type: 'openHarbour' }, actionLabel: 'Go to the harbour' },
  { id: 'tonics', title: 'Tonics', body: 'A tonic speeds one trade by half for a while. Use them when it counts — a big build, a long study.', icon: 'potion', action: { type: 'openSatchel' }, actionLabel: 'Open your satchel' },
  { id: 'road', title: 'The Reputation Road', body: 'Helping the Valley earns reputation, and reputation earns rewards: coins, tonics, materials and decorations.', icon: 'reputation', action: { type: 'openRoad' }, actionLabel: 'See the road' },
  { id: 'training', title: 'Guild training', body: 'Practice only goes so far. A restored guild can teach a villager more — they’re away for the lesson, then back to work, faster.', icon: 'xp', action: { type: 'selectTrainable' }, actionLabel: 'Show me who' },
  { id: 'valleyResearch', title: 'Valley research', body: 'The Great Library turns the Valley’s shared Knowledge into research for everyone. Vote for what comes next.', icon: 'knowledge', action: { type: 'openValleyBuilding', building: 'greatLibrary' }, actionLabel: 'Open the Library' },
  { id: 'festivals', title: 'Festivals', body: 'A festival is on at Market Green: a shared goal for two days. Everyone who helps shares the rewards.', icon: 'gift', action: { type: 'openValleyBuilding', building: 'festivalGrounds' }, actionLabel: 'Join in' },
  { id: 'millrace', title: 'The Millrace Workshop', body: 'Send a villager for a shift with materials: the shared saws and kiln make more than you would alone, straight into a Valley project.', icon: 'travel', action: { type: 'openValleyBuilding', building: 'millraceWorkshop' }, actionLabel: 'Open the Millrace' },
  { id: 'goldfurrow', title: 'Sowing at Goldfurrow', body: 'The Commons is restored. While sowing is open, put grain in alongside the other villages — at the harvest it all comes back multiplied, more so the more villages sowed.', icon: 'grain', action: { type: 'openValleyBuilding', building: 'goldfurrowCommons' }, actionLabel: 'Go to Goldfurrow' },
];
