import { CHAT_FILTER } from '../config/chatFilter';

const LOOKALIKE: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', $: 's', '7': 't', '8': 'b', '9': 'g', '+': 't' };

/** "shit" → /s+h+i+t+/: any letter may repeat. */
function pattern(word: string): string {
  return [...word].map((c) => `${c}+`).join('');
}

const EXACT = new RegExp(`^(?:${CHAT_FILTER.exact.map(pattern).join('|')})$`);
const PREFIX = new RegExp(`^(?:${CHAT_FILTER.prefix.map(pattern).join('|')})`);

/** A word as the filter sees it: lower case, look-alikes folded, anything else dropped. */
function fold(word: string): string {
  let out = '';
  for (const ch of word.toLowerCase()) {
    const c = LOOKALIKE[ch] ?? ch;
    if (c >= 'a' && c <= 'z') out += c;
  }
  return out;
}

function rude(word: string): boolean {
  const f = fold(word);
  return f !== '' && (EXACT.test(f) || PREFIX.test(f));
}

/**
 * Masks rude words with asterisks (first letter kept), so the rest of the message still
 * reads. Words are runs of letters, digits and look-alike symbols; spaced-out letters
 * ("f u c k", "s.h.i.t") are caught as one word too.
 */
export function maskRude(text: string): string {
  const out = text.replace(/[\p{L}\p{N}@$!|+]+/gu, (w) => (rude(w) ? w[0] + '*'.repeat(w.length - 1) : w));
  return out.replace(/(?<![\p{L}\p{N}])(?:[\p{L}\p{N}@$][ ._-]){2,}[\p{L}\p{N}@$](?![\p{L}\p{N}])/gu, (run) =>
    rude(run.replace(/[ ._-]/g, '')) ? run[0] + run.slice(1).replace(/[^ ._-]/g, '*') : run,
  );
}

/** Whether a text contains something the filter would mask. */
export function isRude(text: string): boolean {
  return maskRude(text) !== text;
}
