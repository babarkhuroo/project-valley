export type ResourceId = 'timber' | 'clay' | 'stone' | 'planks' | 'bricks' | 'grain' | 'stew' | 'knowledge';

export interface ResourceDef {
  id: ResourceId;
  name: string;
  description: string;
  /** Accent colour used by HUD chips, floating numbers and particles. */
  color: string;
  /** Whether the resource is shown in the top resource bar. */
  hud: boolean;
}

export const RESOURCES: Record<ResourceId, ResourceDef> = {
  timber: {
    id: 'timber',
    name: 'Timber',
    description: 'Felled logs. The backbone of every early building.',
    color: '#b7773f',
    hud: true,
  },
  clay: {
    id: 'clay',
    name: 'Clay',
    description: 'Dug from the creek banks. Needed for sturdier homes and storage.',
    color: '#d0673f',
    hud: true,
  },
  stone: {
    id: 'stone',
    name: 'Stone',
    description: 'Quarried from the rocky hills. Foundations, chimneys and every serious upgrade need it.',
    color: '#8f97a3',
    hud: true,
  },
  planks: {
    id: 'planks',
    name: 'Planks',
    description: 'Sawn timber boards from the Sawmill. Floors, shutters and finer building work.',
    color: '#d9a865',
    hud: true,
  },
  bricks: {
    id: 'bricks',
    name: 'Bricks',
    description: 'Fired clay from the Brickworks. Chimneys, ovens and solid walls.',
    color: '#b8553a',
    hud: true,
  },
  grain: {
    id: 'grain',
    name: 'Grain',
    description: 'Golden sheaves from the Grain Fields, kept dry in a Granary. A handful in the pot makes three bowls of Stew instead of one.',
    color: '#e6c25a',
    hud: true,
  },
  stew: {
    id: 'stew',
    name: 'Stew',
    description: 'Hearty food cooked at the Cookhouse. Working villagers eat it to keep up their pace.',
    color: '#e8a93a',
    hud: true,
  },
  knowledge: {
    id: 'knowledge',
    name: 'Knowledge',
    description: 'Earned by studying at the Academy. Spent on research.',
    color: '#6f8fe0',
    hud: true,
  },
};

export const RESOURCE_ORDER: ResourceId[] = ['timber', 'clay', 'stone', 'planks', 'bricks', 'grain', 'stew', 'knowledge'];
