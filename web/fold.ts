// Characters the engine would otherwise turn into '?' (it only reads Latin-1).
// Typographic quotes, dashes and the ellipsis are everywhere in pasted text
// and phone keyboards, and as '?' they cause false errors (d’imigh -> d?imigh)
// and bogus sentence breaks. We map each of them to the plain ASCII character
// it stands for. The mapping is strictly one code point to one code point, so
// error positions still refer to the user's original text.

const MAP: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '‛': "'", 'ʼ': "'", '´': "'", '′': "'",
  '“': '"', '”': '"', '„': '"', '‟': '"', '«': '"', '»': '"', '″': '"',
  '‐': '-', '‑': '-', '‒': '-', '–': '-', '—': '-', '―': '-', '−': '-',
  '…': '.',
  '​': ' ', '‌': ' ', '﻿': ' ', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ',
};

/** Same number of code points out as in. */
export function foldForEngine(text: string): string {
  let out = '';
  for (const ch of text) out += MAP[ch] ?? ch;
  return out;
}

/** What the engine does to whatever is still left: anything above Latin-1 becomes '?'. */
export function latin1(text: string): string {
  let out = '';
  for (const ch of text) out += ch.codePointAt(0)! < 256 ? ch : '?';
  return out;
}

/** Number of characters the engine cannot read even after folding (emoji, other scripts). */
export function unreadableCount(text: string): number {
  let n = 0;
  for (const ch of foldForEngine(text)) if (ch.codePointAt(0)! > 255 && !/\s/.test(ch)) n++;
  return n;
}
