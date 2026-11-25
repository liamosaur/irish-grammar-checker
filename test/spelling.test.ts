// Tests for spelling suggestions (the fixSpelling option; Perl: fix_spelling / --aspell).
//
// Three layers:
//  1. golden: output of the real Perl engine with the real String::Approx (tools/perl-wsl.sh), 0.70 data;
//  2. brute force: every suggestion re-derived by scanning the whole lexicon, on the 0.70 AND the current
//     (BuNaMo-extended) lexicon, which the Perl oracle cannot see;
//  3. behaviours worth pinning down.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');

const unent = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const sortSugg = (list: string) => list.split(', ').sort().join(', ');
/** Perl returns suggestions in random hash order, so they are compared as sets. */
const normRule = (id: string) => {
  const r = unent(id);
  const m = /^(.*MOLADH)\{(.*)\}$/.exec(r);
  return m ? `${m[1]}{${sortSugg(m[2])}}` : r;
};
const normMsg = (msg: string, id: string) => {
  const m = /MOLADH\{(.*)\}$/.exec(unent(id));
  return m ? `Unknown word: /${sortSugg(m[1])}/?` : unent(msg);
};

let legacy: Gramadoir, legacyLex: Record<string, string>[];
let current: Gramadoir, currentLex: Record<string, string>[];

before(() => {
  const l = loadData(path.join(dataDir, 'legacy-0.70'), dataDir, { overlay: false });
  const c = loadData(dataDir);
  legacy = new Gramadoir(l, { fixSpelling: true, hyphenFix: false, skipDigitWords: false, fadaSuggestions: false, prefixSuggestions: false, compoundLenition: false, nonStandardCompounds: true, namedParts: false, rareNeedsMatch: false, capsNoNearMiss: false, derivedWords: true });
  current = new Gramadoir(c, { fixSpelling: true });
  legacyLex = l.lexicon as unknown as Record<string, string>[];
  currentLex = c.lexicon as unknown as Record<string, string>[];
});

describe('spelling suggestions match the Perl original (golden, real String::Approx)', () => {
  const g = JSON.parse(fs.readFileSync(path.join(root, 'test', 'spelling', 'perl-golden.json'), 'utf8')) as { text: string; api: Record<string, string>[] };
  it('every error, with suggestion lists compared as sets', () => {
    const keys = ['fromy', 'fromx', 'toy', 'tox', 'contextoffset', 'errorlength'] as const;
    const ours = legacy.grammaticalErrors(g.text).map((e) => ({
      ...Object.fromEntries(keys.map((k) => [k, String(e[k])])),
      ruleId: normRule(e.ruleId),
      msg: normMsg(e.msg, e.ruleId),
    }));
    const want = g.api.map((e) => ({
      ...Object.fromEntries(keys.map((k) => [k, e[k]])),
      ruleId: normRule(e.ruleId),
      msg: normMsg(e.msg, e.ruleId),
    }));
    assert.equal(want.filter((e) => e.ruleId.includes('MOLADH')).length > 300, true, 'the golden file should contain many suggestions');
    assert.deepEqual(ours, want);
  });
});

// ------------------------------------------------------------------ brute force

const foldAscii = (s: string) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
const hasCapital = (w: string) => /[A-ZÁÉÍÓÚ]/.test(w);
const deletes = (long: string, short: string) => {
  if (long.length !== short.length + 1) return false;
  let i = 0;
  while (i < short.length && long[i] === short[i]) i++;
  return long.slice(i + 1) === short.slice(i);
};
/** Independent re-statement of the Perl semantics, scanning every key of the tier. */
function bruteForce(word: string, tier: Record<string, string>): Set<string> {
  const ci = hasCapital(word);
  const a = ci ? foldAscii(word) : word;
  const out = new Set<string>();
  for (const k of Object.keys(tier)) {
    if (Math.abs(k.length - word.length) > 1) continue;
    // transposition (always exact case)
    if (k.length === word.length) {
      let i = 0;
      while (i < word.length && word[i] === k[i]) i++;
      if (i < word.length - 1 && word[i] === k[i + 1] && word[i + 1] === k[i] && word.slice(i + 2) === k.slice(i + 2)) { out.add(k); continue; }
    }
    const b = ci ? foldAscii(k) : k;
    if (k.length === word.length) {
      let diff = 0;
      for (let i = 0; i < a.length && diff < 2; i++) if (a[i] !== b[i]) diff++;
      if (diff === 1 || (diff === 0 && ci)) out.add(k);
    } else if (deletes(a, b) || deletes(b, a)) out.add(k);
  }
  return out;
}

/** Deterministic unknown-looking words: lexicon words with one edit, plus a capitalised and an accented-capital share. */
function testWords(lex: Record<string, string>[], n: number): string[] {
  const keys = lex.map((t) => Object.keys(t));
  const letters = 'abcdefghilmnoprstuáéíóú';
  const words: string[] = [];
  for (let i = 0; words.length < n; i++) {
    const t = i % 7;
    const pool = keys[t];
    let w = pool[(i * 7919 + 13) % pool.length];
    const want = i % 5 === 3 ? /^[A-Z][a-z]{3,9}$/ : i % 5 === 4 ? /^[ÁÉÍÓÚ][a-záéíóú]{3,9}$/ : /^[a-záéíóú]{4,10}$/;
    for (let k = 1; !want.test(w) && k < 300; k++) w = pool[(i * 7919 + 13 + k * 104729) % pool.length];
    if (!want.test(w)) continue;
    const p = (i * 31) % w.length;
    const c = letters[(i * 17) % letters.length];
    const e = [
      p < w.length - 1 ? w.slice(0, p) + w[p + 1] + w[p] + w.slice(p + 2) : w.slice(0, p - 1) + w[p] + w[p - 1],
      w.slice(0, p) + w.slice(p + 1),
      w.slice(0, p) + c + w.slice(p),
      w.slice(0, p) + c + w.slice(p + 1),
    ][i % 4];
    if (!lex.some((x) => e in x)) words.push(e);
  }
  return words;
}

describe('suggestions equal a brute-force scan of the lexicon', () => {
  for (const [name, get] of [['0.70 lexicon', () => ({ gr: legacy, lex: legacyLex })], ['current (extended) lexicon', () => ({ gr: current, lex: currentLex })]] as const) {
    it(`every tier, ${name}`, () => {
      const { gr, lex } = get();
      for (const w of testWords(lex, 70)) {
        for (let t = 0; t < lex.length; t++) {
          const fast = gr.nearMisses(w, t, hasCapital(w));
          const slow = bruteForce(w, lex[t]);
          assert.deepEqual(new Set(fast), slow, `${w} in tier ${t}`);
        }
      }
    });
    it(`the first tier with a suggestion wins, ${name}`, () => {
      const { gr, lex } = get();
      let checked = 0;
      for (const w of testWords(lex, 120)) {
        const err = gr.grammaticalErrors(`Chonaic mé ${w} inné.`).find((e) => e.ruleId.includes('MOLADH'));
        if (!err) continue;
        let want: Set<string> | null = null;
        for (let t = 0; t < lex.length && !want; t++) { const s = bruteForce(w, lex[t]); if (s.size) want = s; }
        assert.deepEqual(new Set(err.suggestions), want, w);
        checked++;
      }
      assert.ok(checked > 30, `only ${checked} words produced suggestions`);
    });
  }
});

// ------------------------------------------------------------------ behaviours

describe('spelling suggestions: behaviour', () => {
  const off = () => new Gramadoir(loadData(path.join(dataDir, 'legacy-0.70'), dataDir, { overlay: false }), { hyphenFix: false, skipDigitWords: false, compoundLenition: false, nonStandardCompounds: true, namedParts: false, rareNeedsMatch: false, capsNoNearMiss: false, derivedWords: true });

  it('is off by default, as in the Perl library', () => {
    assert.ok(!off().grammaticalErrors('An bhfuil uachtar roeite agattt?').some((e) => e.ruleId.includes('MOLADH')));
  });

  it("gives Kevin's own example: roeite -> reoite", () => {
    const e = legacy.grammaticalErrors('An bhfuil uachtar roeite agattt?')[0];
    assert.equal(e.ruleId, 'Lingua::GA::Gramadoir/MOLADH{reoite}');
    assert.equal(e.msg, 'Unknown word: /reoite/?');
    assert.deepEqual(e.suggestions, ['reoite']);
    assert.equal(e.errortext, 'roeite');
  });

  it('ignores one- and two-letter words', () => {
    assert.ok(!legacy.grammaticalErrors('Chonaic mé zq inné.').some((e) => e.ruleId.includes('MOLADH')));
  });

  it('puts transpositions before the other kinds of edit', () => {
    // "teahc": swapping the last two letters gives "teach"; the substitution "tearc" comes after it
    const s = legacy.grammaticalErrors('Chonaic mé teahc inné.').find((e) => e.suggestions)?.suggestions;
    assert.deepEqual(s, ['teach', 'tearc']);
  });

  it('case-insensitive matching folds ASCII letters only, like String::Approx on byte strings', () => {
    // Perl suggests Éilís for "Éils" but not "éis": É does not fold to é
    const s = legacy.grammaticalErrors('Chonaic mé Éils inné.').find((e) => e.suggestions)?.suggestions ?? [];
    assert.ok(s.includes('Éilís'));
    assert.ok(!s.includes('éis'));
  });

  it('suggestions are only added for words that are otherwise unknown', () => {
    assert.deepEqual(legacy.grammaticalErrors('Tá an madra mór.').map((e) => e.ruleId), []);
    assert.ok(!legacy.grammaticalErrors('Tá an madra mór.').some((e) => e.suggestions));
  });
});

// Judgements of which spelling is right are Liam's: these run as todos until he confirms them.
const UNCONFIRMED = 'not yet reviewed: drop the todo once the spelling verdict is confirmed';

describe('spelling suggestions beyond the Perl library', () => {
  const sugg = (text: string, word: string) => current.grammaticalErrors(text).find((e) => e.errortext === word)?.suggestions;

  it('an abbreviation in capitals gets the unknown-word message, no suggestions (Citizens Information: COLÓ, not Colm)', () => {
    const text = 'Íocann an Stát an naíonra nó an tseirbhís cúram lae as na huaireanta COLÓ sin trí mheán táille caipitíochta.';
    const e = current.grammaticalErrors(text).find((x) => x.errortext === 'COLÓ');
    assert.equal(e?.ruleId, 'Lingua::GA::Gramadoir/ANAITHNID');
    assert.equal(e?.suggestions, undefined);
  });

  it('a prefix + a root one edit away from a listed word (Citizens Information)', { todo: UNCONFIRMED }, () => {
    const text = 'Is comhchónatheoir duine a chónaíonn i gcaidreamh caidreamhach agus domhain le duine den ghnéas céanna nó den ghnéas eile nach céile, páirtnéir sibhialta, nó muintir an duine sin é/í.';
    assert.deepEqual(sugg(text, 'comhchónatheoir'), ['comhchónaitheoir']);
  });

  it('sain- does not lenite d, t or s (CO17 10.2.12): saintrealamh is read as sain + trealamh, so not flagged (Citizens Information)', { todo: UNCONFIRMED }, () => {
    const text = 'Tá sé de chumhacht ag an údarás áitiúil scrúdú a dhéanamh ar Ghearáin maidir le torann sa chomharsanacht agus tá saintrealamh aige freisin a dhéanann leibhéil torainn a thomhas.';
    const shown = new Gramadoir(loadData(dataDir), { fixSpelling: true, derivedWords: true });
    assert.ok(shown.grammaticalErrors(text).some((e) => e.errortext === 'saintrealamh' && e.ruleId.endsWith('/MOIRFREIMIR{sain+trealamh}')));
    assert.ok(!current.grammaticalErrors(text).some((e) => e.errortext === 'saintrealamh'));
  });
});
