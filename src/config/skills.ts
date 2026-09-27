export type SkillId = 'woodcutting' | 'mining' | 'farming' | 'research' | 'construction' | 'crafting';

export interface SkillDef {
  id: SkillId;
  name: string;
  description: string;
  color: string;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  woodcutting: { id: 'woodcutting', name: 'Woodcutting', description: 'Felling trees for timber.', color: '#7aa84f' },
  mining: { id: 'mining', name: 'Mining', description: 'Digging clay and, later, quarrying stone.', color: '#c7764a' },
  farming: { id: 'farming', name: 'Farming', description: 'Food production — from the Cookhouse pot to future fields.', color: '#e0b040' },
  research: { id: 'research', name: 'Research', description: 'Studying at the Academy to earn Knowledge.', color: '#6f8fe0' },
  construction: { id: 'construction', name: 'Construction', description: 'Raising and improving buildings.', color: '#9a7b62' },
  crafting: { id: 'crafting', name: 'Crafting', description: 'Workshop production (arrives with crafting buildings).', color: '#b36fc2' },
};

export const SKILL_ORDER: SkillId[] = ['woodcutting', 'mining', 'farming', 'research', 'construction', 'crafting'];
