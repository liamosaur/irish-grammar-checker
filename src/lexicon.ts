// Merges the BuNaMo overlay (data/bunamo-overlay.json, ODbL) into the An Gramadóir 0.70 lexicon
// (data/lexicon.json, GPL). The two are kept in separate files and only combined in memory, when the
// checker loads. No Node dependencies: used by src/node-data.ts and by the web worker.
// The overlay is written by tools/overlay-bunamo.mjs.

/** 7 frequency tiers: word -> grammar code chars (see GramadoirData.lexicon). */
export type Lexicon = Record<string, string>[];

/** Per tier, the code chars to add to / remove from a word (new words are only in `add`). */
export interface LexiconOverlay {
  add: Record<string, string>[];
  remove: Record<string, string>[];
}

const merged = (chars: Iterable<string>) => [...new Set(chars)].sort().join('');

/**
 * Applies `overlay` to `lexicon` in place and returns it. Per tier: every word in `remove` loses those
 * chars, every word in `add` gains those chars (new words are appended), and each changed entry is
 * stored as its unique chars, sorted. No word changes tier.
 */
export function applyOverlay(lexicon: Lexicon, overlay: LexiconOverlay): Lexicon {
  if (overlay.add.length !== lexicon.length || overlay.remove.length !== lexicon.length) {
    throw new Error(`lexicon overlay has ${overlay.add.length}/${overlay.remove.length} tiers, lexicon has ${lexicon.length}`);
  }
  lexicon.forEach((tier, t) => {
    const remove = overlay.remove[t];
    for (const w of Object.keys(remove)) {
      if (!Object.hasOwn(tier, w)) continue;
      tier[w] = merged([...tier[w]].filter((ch) => !remove[w].includes(ch)));
    }
    const add = overlay.add[t];
    for (const w of Object.keys(add)) {
      tier[w] = merged((Object.hasOwn(tier, w) ? tier[w] : '') + add[w]);
    }
  });
  return lexicon;
}

/**
 * Applies our own corrections (data/lexicon-corrections.json, built from grammar/lexicon-corrections.tsv) to
 * `lexicon` in place and returns it: each word's code chars are replaced, in the tier it is in.
 * Applied after the BuNaMo overlay.
 */
export function applyLexiconCorrections(lexicon: Lexicon, corrections: Record<string, string>): Lexicon {
  for (const [w, codes] of Object.entries(corrections)) {
    const tiers = lexicon.filter((tier) => Object.hasOwn(tier, w));
    if (!tiers.length) throw new Error(`local word-list correction for a word not in the word list: ${w}`);
    for (const tier of tiers) tier[w] = merged(codes);
  }
  return lexicon;
}
