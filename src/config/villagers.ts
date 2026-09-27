import type { SkillId } from './skills';

export interface Appearance {
  skin: string;
  hair: string;
  hairStyle: 0 | 1 | 2 | 3;
  shirt: string;
  trousers: string;
  hat: 0 | 1 | 2;
  hatColor: string;
}

export interface VillagerTemplate {
  name: string;
  appearance: Appearance;
  skills?: Partial<Record<SkillId, number>>;
}

/** The two founders every new settlement starts with. */
export const FOUNDERS: VillagerTemplate[] = [
  {
    name: 'Wren',
    appearance: { skin: '#f1c7a2', hair: '#8a4b2a', hairStyle: 1, shirt: '#4f9a6a', trousers: '#5b4a3a', hat: 0, hatColor: '#c96b3b' },
  },
  {
    name: 'Tobin',
    appearance: { skin: '#c98c62', hair: '#2f2622', hairStyle: 0, shirt: '#d4893b', trousers: '#40506a', hat: 1, hatColor: '#6c8c3a' },
  },
];

/** Names offered to newcomers. Original, cosy, and deliberately varied. */
export const NEWCOMER_NAMES = [
  'Maple', 'Fennick', 'Odile', 'Bram', 'Juniper', 'Pip', 'Rosalind', 'Hollis', 'Tamsin', 'Corwin',
  'Elspeth', 'Barnaby', 'Ivy', 'Mirela', 'Sorrel', 'Quill', 'Agnes', 'Thaddeus', 'Nell', 'Osric',
  'Clementine', 'Rowan', 'Birdie', 'Linus', 'Marigold', 'Emrys', 'Poppy', 'Alder', 'Saffi', 'Gideon',
];

export const APPEARANCE_PALETTE = {
  skin: ['#f6d3b3', '#f1c7a2', '#e0ac84', '#c98c62', '#a8704a', '#7e5236'],
  hair: ['#2f2622', '#5a3a26', '#8a4b2a', '#c77b3a', '#e3c27a', '#9a9aa3', '#6b3a5e'],
  shirt: ['#4f9a6a', '#d4893b', '#6c86c9', '#c9575b', '#8f6cc2', '#e0b640', '#3f9aa8', '#d97aa0'],
  trousers: ['#5b4a3a', '#40506a', '#4d5b3a', '#6a4a5b', '#3f3f4a'],
  hatColor: ['#c96b3b', '#6c8c3a', '#3a6c8c', '#b8963a', '#8c3a5a'],
};

/** Short flavour line shown with each newcomer's specialty. */
export const SPECIALTY_BLURB: Record<SkillId, string> = {
  woodcutting: 'Grew up among the tall pines.',
  mining: 'Never happier than knee-deep in a clay bank.',
  farming: 'Makes a stew people cross valleys for.',
  research: 'Always has a book tucked under one arm.',
  construction: 'Can square a beam by eye.',
  crafting: 'Clever with tools and small repairs.',
};
