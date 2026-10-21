import { describe, expect, it } from 'vitest';
import { isRude, maskRude } from '../src/valley/chatFilter';
import { postChat, createValley } from '../src/valley/valleySim';

describe('chat filter', () => {
  it('masks rude words, keeping the first letter and the rest of the message', () => {
    expect(maskRude('Oh shit, the hens escaped')).toBe('Oh s***, the hens escaped');
    expect(maskRude('FUCKING great harvest')).toBe('F****** great harvest');
    expect(maskRude('you ass')).toBe('you a**');
  });

  it('sees through look-alikes, repeated letters and spaced-out letters', () => {
    expect(maskRude('sh1iiit')).toBe('s******');
    expect(maskRude('f@g')).toBe('f**');
    expect(maskRude('$hit')).toBe('$***');
    expect(maskRude('f u c k off')).toBe('f * * * off');
    expect(maskRude('s.h.i.t')).toBe('s.*.*.*');
  });

  it('leaves innocent words alone (no matching inside words)', () => {
    for (const ok of ['Scunthorpe', 'assist', 'class', 'as we go', 'night', 'cocktail', 'grass', 'hoe the field', 'peacock', 'Dickens', 'a b c', 'rapeseed']) {
      expect(isRude(ok), ok).toBe(false);
    }
  });

  it('is applied to every chat message', () => {
    const v = createValley('v-filter', 7, 0, { id: 'p-filter-0001', name: 'Wren', villageName: 'Thistledown' }, {});
    expect(postChat(v, 'p-filter-0001', '  what   the fuck  ', 1)?.text).toBe('what the f***');
  });
});
