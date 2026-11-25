import fs from 'node:fs';
import path from 'node:path';
import { applyLexiconCorrections, applyOverlay, type LexiconOverlay } from './lexicon.ts';
import type { GramadoirData } from './types.ts';

export interface LoadOptions {
  /**
   * Merge the BuNaMo overlay (bunamo-overlay.json) into the lexicon. Default true; false gives the
   * untouched 0.70 lexicon (for exact Perl 0.70 parity).
   */
  overlay?: boolean;
  /**
   * Apply our own word-list corrections (lexicon-corrections.json, from grammar/lexicon-corrections.tsv) after the
   * overlay. Defaults to the value of `overlay`.
   */
  lexiconCorrections?: boolean;
}

/**
 * Loads the JSON data produced by tools/build-data.mjs + tools/generate-rules.mjs, with the lexicon
 * extended by tools/overlay-bunamo.mjs's overlay (see src/lexicon.ts).
 * Files missing from `dataDir` are taken from `fallbackDir` (used to overlay
 * data/legacy-0.70 on top of data/ for exact Perl 0.70 parity tests).
 */
export function loadData(dataDir: string, fallbackDir?: string, options: LoadOptions = {}): GramadoirData {
  const j = (f: string) => {
    let file = path.join(dataDir, f);
    if (fallbackDir && !fs.existsSync(file)) file = path.join(fallbackDir, f);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  };
  const lexicon = j('lexicon.json');
  if (options.overlay ?? true) applyOverlay(lexicon, j('bunamo-overlay.json') as LexiconOverlay);
  if (options.lexiconCorrections ?? options.overlay ?? true) applyLexiconCorrections(lexicon, j('lexicon-corrections.json'));
  return {
    lexicon,
    eile: j('eile.json'),
    earraidi: j('earraidi.json'),
    pos: j('pos.json'),
    token: j('token.json'),
    morph: j('morph.json'),
    grams: j('grams.json'),
    nocombo: j('nocombo.json'),
    messages: j('messages.json'),
    // BuNaMo's verbal nouns (ODbL, a separate file) and our additions (grammar/verbal-nouns.tsv)
    verbalNouns: [...j('verbal-nouns.json'), ...j('verbal-nouns-extra.json')],
    nouns: j('forms.json').n, // BuNaMo's noun forms (ODbL), for the plural hint
    rules: {
      aonchiall: j('rules/aonchiall.json'),
      comhshuite: j('rules/comhshuite.json'),
      giorr: j('rules/giorr.json'),
      rialacha: j('rules/rialacha.json'),
      unigram: j('rules/unigram.json'),
    },
  };
}
