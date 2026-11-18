// Tests for the BuNaMo overlay on the lexicon (tools/overlay-bunamo.mjs + data/overlay-decisions.tsv).
// "legacy" is the 0.70 lexicon alone, "now" is it merged with data/bunamo-overlay.json (src/lexicon.ts).
// They lock in the outcomes of the manual review: where the overlay must add words, and where it must
// leave Kevin's behaviour alone.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { applyLexiconCorrections, applyOverlay } from '../src/lexicon.ts';
import { loadData } from '../src/node-data.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');

type Tiers = Record<string, string>[];
let legacy: Gramadoir, now: Gramadoir;
let legacyLex: Tiers, nowLex: Tiers, pos: Record<string, string>;

const errs = (gr: Gramadoir, text: string) =>
  gr.grammaticalErrors(text).map((e) => `${String(e.ruleId).replace('Lingua::GA::Gramadoir/', '')}|${String(e.context).substr(Number(e.contextoffset), Number(e.errorlength))}`);

const tagsOf = (lex: Tiers, w: string) => {
  const out = new Set<string>();
  for (const t of lex) if (t[w] !== undefined) for (const ch of t[w]) if (pos[ch]) out.add(pos[ch]);
  return out;
};
const has = (s: Set<string>, re: RegExp) => [...s].some((t) => re.test(t));

before(() => {
  const l = loadData(path.join(dataDir, 'legacy-0.70'), dataDir, { overlay: false });
  const n = loadData(dataDir, undefined, { lexiconCorrections: false }); // the BuNaMo overlay alone, without grammar/lexicon-corrections.tsv
  legacy = new Gramadoir(l);
  now = new Gramadoir(n);
  legacyLex = l.lexicon as unknown as Tiers;
  nowLex = n.lexicon as unknown as Tiers;
  pos = n.pos as unknown as Record<string, string>;
});

describe('merging the overlay', () => {
  it('removes, adds, sorts, appends new words and keeps tiers', () => {
    const lex: Record<string, string>[] = [{ a: 'cab', b: 'zyx' }, { c: 'q' }];
    applyOverlay(lex, { add: [{ a: 'da', n: 'ba' }, {}], remove: [{ a: 'c', b: 'y' }, {}] });
    assert.deepEqual(lex, [{ a: 'abd', b: 'xz', n: 'ab' }, { c: 'q' }]);
    assert.deepEqual(Object.keys(lex[0]), ['a', 'b', 'n']);
    assert.throws(() => applyOverlay([{}], { add: [{}, {}], remove: [{}, {}] }));
  });

  it('reproduces the single merged lexicon of before the split', () => {
    // data/lexicon.json as it was when it held the 0.70 lexicon and the overlay in one file; rebuilding
    // the overlay with different BuNaMo data or decisions changes this (update it then).
    assert.deepEqual(nowLex.map((t) => Object.keys(t).length), [12660, 13794, 14080, 14483, 14999, 20174, 418218]);
    assert.equal(createHash('sha256').update(JSON.stringify(nowLex)).digest('hex'), '5730e48a2ca6f8f8d5d25940d10f69a37ce1a8a42a22bed9c0399a20224bbbdb');
  });

  it('applies our own corrections after it: replaces the codes, keeps the tier, adds new words to the last tier', () => {
    const lex: Record<string, string>[] = [{ a: 'xy' }, { b: 'q' }];
    applyLexiconCorrections(lex, { b: 'zc', nua: 'a' });
    assert.deepEqual(lex, [{ a: 'xy' }, { b: 'cz', nua: 'a' }]);
  });

  it('tags the words in grammar/lexicon-corrections.tsv as corrected', () => {
    const full = loadData(dataDir).lexicon as unknown as Tiers;
    for (const w of ['faoinarb', 'ónarb', 'trínarb', 'trínarbh', 'sularb']) assert.deepEqual([...tagsOf(full, w)], ['<V cop="y">'], w);
    assert.deepEqual([...tagsOf(full, 'eo')], ['<P>']);
    assert.deepEqual([...tagsOf(full, 'heo')], ['<P h="y">']);
    assert.ok(has(tagsOf(full, 'cabair'), /<N pl="y" gnt="n" gnd="m">/));
    assert.deepEqual([...tagsOf(full, 'geallúint')], ['<N pl="n" gnt="n" gnd="f">']); // added: upstream had it only as non-standard
  });

  it('the base lexicon is the untouched 0.70 one', () => {
    assert.deepEqual(legacyLex.map((t) => Object.keys(t).length), [12660, 13794, 14080, 14479, 14996, 20159, 269542]);
  });
});

describe('overlay adds standard words the 0.70 lexicon lacks', () => {
  for (const w of ['seipléir', 'cafarnach', 'sramadas', 'galúchán']) {
    it(`${w} is no longer reported as unknown or odd`, () => {
      const text = `Chonaic mé ${w} inné.`;
      assert.ok(errs(legacy, text).length > 0, 'the 0.70 lexicon should flag it');
      assert.deepEqual(errs(now, text), []);
    });
  }

  it('only adds: every 0.70 form is still present, in the same frequency tier', () => {
    const tierOf = (lex: Tiers) => { const m = new Map<string, number>(); lex.forEach((t, i) => { for (const w of Object.keys(t)) m.set(w, i); }); return m; };
    const a = tierOf(legacyLex), b = tierOf(nowLex);
    let moved = 0, gone = 0;
    for (const [w, i] of a) { if (!b.has(w)) gone++; else if (b.get(w) !== i) moved++; }
    assert.equal(gone, 0);
    assert.equal(moved, 0);
    assert.ok(b.size > a.size);
  });
});

describe('overlay keeps the checks the review protected', () => {
  const must: [string, string][] = [
    // second gender on mí / ré would silence "lenition missing"
    ['Bhí an aimsir go maith an mí seo caite.', 'SEIMHIU|an mí'],
    ['Sa ré digiteach.', 'SEIMHIU|ré digiteach'],
    // son / clos are phrase words: giving them a gender would silence the phrase rules
    ['Labhair mé ar shon na daoine.', 'INPHRASE{ar son}|shon'],
    ['Tá sé tábhachtach bheith ag obair an son na cearta.', 'INPHRASE{ar son}|son'],
    ['Ní raibh guth an séiléara le clos a thuilleadh.', 'CAIGHDEAN{le cloisteáil}|le clos'],
    // domhain as a feminine noun would accept "ar an domhain"
    ['Do achan Gael thart ar an domhain.', 'NOGENITIVE|ar an domhain'],
    // bare unlenited conditional is a "lenition missing" error, not a valid form
    ['Caithfinn an cheann sin a sheoladh.', 'COMHFHOCAL{Caith+finn}|Caithfinn'],
    // known misspellings must not be shadowed by obscure BuNaMo homographs
    ['Tá sé mor.', 'MICHEART{mór}|mor'],
    ['Beidh mé ann amarach.', 'MICHEART{amárach}|amarach'],
    ['Conas ata tú?', 'IONADAI{atá}|ata'],
    // hyphenation follows An Caighdeán Oifigiúil 2017, s.2.1.7
    ['Tá an anchuid daoine ann.', 'MICHEART{an-chuid}|anchuid'],
    ['Tá an iarbhunscoil dúnta.', 'CAIGHDEAN{iar-bhunscoil}|iarbhunscoil'],
  ];
  for (const [text, want] of must) {
    it(`${want} in "${text}"`, () => {
      assert.ok(errs(now, text).includes(want), `got: ${errs(now, text).join(' ; ') || '(none)'}`);
    });
  }

  it('does not invent a subjunctive error for ata', () => {
    assert.ok(!errs(now, 'Conas ata tú?').some((e) => e.startsWith('NOSUBJ')));
  });

  it('accepts the standard hyphenated forms', () => {
    assert.deepEqual(errs(now, 'Tá an-chuid daoine ann.'), []);
    assert.deepEqual(errs(now, 'Tá an iar-bhunscoil dúnta.'), []);
  });
});

describe('overlay decisions are reflected in the tags', () => {
  const N = (g: string) => new RegExp(`^<N [^>]*gnd="${g}"`);
  it('buile stays feminine (teanglann agrees with 0.70, not BuNaMo)', () => {
    const t = tagsOf(nowLex, 'buile');
    assert.ok(has(t, N('f')) && !has(t, N('m')));
  });
  it('impí becomes feminine (teanglann agrees with BuNaMo)', () => {
    const t = tagsOf(nowLex, 'impí');
    assert.ok(has(t, N('f')) && !has(t, N('m')));
  });
  it('sí stays masculine: the feminine sí is the pronoun', () => {
    const t = tagsOf(nowLex, 'sí');
    assert.ok(has(t, N('m')) && !has(t, N('f')));
  });
  it('mí and domhain get no second gender', () => {
    assert.ok(!has(tagsOf(nowLex, 'mí'), N('m')));
    assert.ok(!has(tagsOf(nowLex, 'domhain'), N('f')));
  });
  it('mám keeps both genders (separate senses in the dictionary)', () => {
    const t = tagsOf(nowLex, 'mám');
    assert.ok(has(t, N('f')) && has(t, N('m')));
  });
  it('phrase words stay ungendered', () => {
    // they keep a plain noun tag with no gender attribute, exactly as in 0.70
    for (const w of ['son', 'clos', 'éis']) assert.ok(!has(tagsOf(nowLex, w), /^<N [^>]*gnd=/), w);
  });
  it('adjective readings follow the dictionary', () => {
    const cab = tagsOf(nowLex, 'cabhlaigh');
    assert.ok(has(cab, /^<A pl="n" gnt="y" gnd="m"/) && !has(cab, /^<A pl="n" gnt="n">/));
    const olla = tagsOf(nowLex, 'olla');
    assert.ok(has(olla, /^<A pl="y" gnt="n"/) && !has(olla, /^<A pl="n" gnt="n">/));
    const hansa = tagsOf(nowLex, 'hansa');
    assert.ok(has(hansa, /^<A pl="n" gnt="n" h="y"/) && has(hansa, /^<A pl="n" gnt="y" gnd="f"/));
  });
  it('past-type verb forms exist only in their lenited shape', () => {
    assert.ok(!has(tagsOf(nowLex, 'caithfinn'), /t="coinn"/));
    assert.ok(has(tagsOf(nowLex, 'chaithfinn'), /t="coinn"/));
  });
});
