import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';
import { analyse, type ErrorView } from '../web/annotate.ts';
import { applyCorrection, matchCase, planReplacement, QUOTES_REPLACEMENT, quotedParts, sliceRange } from '../web/corrections.ts';
import { foldForEngine } from '../web/fold.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('quotedParts', () => {
  it('a single word is one choice', () => {
    assert.deepEqual(quotedParts('tá'), [{ text: 'tá', option: true }]);
  });

  it('"a (b)" offers only b: a is the intermediate form, still a mistake', () => {
    assert.deepEqual(quotedParts('conaí (cónaí)'), [
      { text: 'conaí (', option: false },
      { text: 'cónaí', option: true },
      { text: ')', option: false },
    ]);
  });

  it('keeps the whole message text when the parts are joined', () => {
    assert.equal(quotedParts('conaí (cónaí)').map((p) => p.text).join(''), 'conaí (cónaí)');
  });

  it('multi-word choices stay whole', () => {
    assert.deepEqual(quotedParts('an bhean').map((p) => p.text), ['an bhean']);
  });
});

describe('quotedParts with several alternatives', () => {
  it('splits "a, b" into separate choices', () => {
    assert.deepEqual(quotedParts('méid, mhéid').filter((p) => p.option).map((p) => p.text), ['méid', 'mhéid']);
    assert.equal(quotedParts('méid, mhéid').map((p) => p.text).join(''), 'méid, mhéid');
  });
  it('multi-word alternatives stay whole', () => {
    assert.deepEqual(quotedParts('uile, uile go léir').filter((p) => p.option).map((p) => p.text), ['uile', 'uile go léir']);
  });
  it('does not offer a placeholder X', () => {
    assert.deepEqual(quotedParts('á X').filter((p) => p.option), []);
    assert.deepEqual(quotedParts('do mo X').filter((p) => p.option), []);
  });
});

describe('planReplacement', () => {
  const plan = (line: string, from: number, to: number, w: string) => planReplacement(line, { y: 0, from, to }, w);

  it('replaces only the word the replacement stands for: "in Páras" + "i" keeps Páras', () => {
    assert.deepEqual(plan('Tá mé i mo chónaí in Páras', 18, 26, 'i')?.range, { y: 0, from: 18, to: 20 });
    assert.deepEqual(plan('in Páras', 0, 8, 'i'), { range: { y: 0, from: 0, to: 2 }, word: 'i' });
  });
  it('picks the word the replacement resembles', () => {
    assert.equal(applyPlan('an tíre', 'na'), 'na tíre');
    assert.equal(applyPlan('ceithre uaire', 'huaire'), 'ceithre huaire');
    assert.equal(applyPlan('Cad déarfaidh', 'a'), 'A déarfaidh'); // the capital of the word replaced carries over
  });
  it('replaces everything when the replacement stands for the whole flagged text', () => {
    assert.equal(applyPlan('Cé an', 'cén'), 'Cén');
    assert.equal(applyPlan('a tá', 'atá'), 'atá');
    assert.equal(applyPlan('le clos', 'le cloisteáil'), 'le cloisteáil');
    assert.equal(applyPlan('Olympics', 'Cluichí Oilimpeacha'), 'Cluichí Oilimpeacha');
  });
  it('keeps the capital of the word that is replaced', () => {
    assert.equal(applyPlan('In Páras', 'i'), 'I Páras');
  });
  it('joins an elided form to the next word', () => {
    assert.equal(applyPlan('Ba eol', "b'"), "B'eol");
    assert.equal(applyPlan('mba altra', "mb'"), "mb'altra");
  });
  it('leaves the spacing and the rest of the line alone', () => {
    assert.equal(applyPlan('a in  Páras b', 'i', 2, 11), 'a i  Páras b');
  });
  it('does not repeat words of a set phrase that are already in the text', () => {
    assert.equal(applyPlan('foláir dó', 'ní foláir', 0, 6), 'ní foláir dó');
    assert.equal(plan('is ní foláir dó', 6, 12, 'ní foláir'), null); // already there: nothing to change
    assert.equal(plan('ar son na daoine', 3, 6, 'ar son'), null);
    assert.equal(applyPlan('ar shon na daoine', 'ar son', 3, 7), 'ar son na daoine');
  });
  it('offers nothing when the result would be the same text', () => {
    assert.equal(plan('maidir le oideachas', 0, 6, 'maidir le'), null);
  });
  it('gives nothing for a range that does not fit', () => {
    assert.equal(plan('ta', 0, 9, 'tá'), null);
    assert.equal(plan('ta', 1, 1, 'tá'), null);
  });

  function applyPlan(line: string, w: string, from = 0, to = Array.from(line).length): string {
    const p = plan(line, from, to, w)!;
    return applyCorrection(line, p.range, p.word)!;
  }
});

describe('matchCase', () => {
  it('a capitalised word gets a capitalised replacement', () => {
    assert.equal(matchCase('Ta', 'tá'), 'Tá');
    assert.equal(matchCase('Conai', 'cónaí'), 'Cónaí');
    assert.equal(matchCase('A', 'á'), 'Á');
  });
  it('an all-capitals word gets an all-capitals replacement', () => {
    assert.equal(matchCase('TA', 'tá'), 'TÁ');
  });
  it('a lower-case word keeps the replacement as written', () => {
    assert.equal(matchCase('ta', 'tá'), 'tá');
    assert.equal(matchCase('gCabhan', 'gCabhán'), 'gCabhán');
    assert.equal(matchCase('ta', 'Éire'), 'Éire');
  });
  it('mixed capitals are left alone', () => {
    assert.equal(matchCase('McDonal', 'McDonald'), 'McDonald');
    assert.equal(matchCase('tA', 'tá'), 'tá');
  });
  it('only the first letter changes for a multi-word replacement', () => {
    assert.equal(matchCase('Ta me', 'tá mé'), 'Tá mé');
  });
  it('leaves a form that already has its capital after a mutation prefix', () => {
    assert.equal(matchCase('Seapánach', 'tSeapánaigh'), 'tSeapánaigh');
    assert.equal(matchCase('Éireannach', 'nÉireannach'), 'nÉireannach');
  });
  it('does nothing for an empty or letterless original', () => {
    assert.equal(matchCase('', 'tá'), 'tá');
    assert.equal(matchCase('123', 'tá'), 'tá');
  });
});

describe('applyCorrection', () => {
  it('replaces just the flagged range', () => {
    assert.equal(applyCorrection('ta me', { y: 0, from: 0, to: 2 }, 'tá'), 'tá me');
  });

  it('works on later lines and leaves other lines alone', () => {
    assert.equal(applyCorrection('Tá sé.\nta me\nAgus.', { y: 1, from: 3, to: 5 }, 'mé'), 'Tá sé.\nta mé\nAgus.');
  });

  it('counts code points, so an emoji before the word does not shift it', () => {
    assert.equal(applyCorrection('😀 ta', { y: 0, from: 2, to: 4 }, 'tá'), '😀 tá');
  });

  it('can lengthen or shorten the text', () => {
    assert.equal(applyCorrection('conai', { y: 0, from: 0, to: 5 }, 'cónaí'), 'cónaí');
  });

  it('refuses a range that does not fit the text', () => {
    assert.equal(applyCorrection('ta', { y: 0, from: 0, to: 9 }, 'tá'), null);
    assert.equal(applyCorrection('ta', { y: 3, from: 0, to: 2 }, 'tá'), null);
    assert.equal(applyCorrection('ta', { y: 0, from: -1, to: 2 }, 'tá'), null);
  });
});

describe('corrections with the real engine', () => {
  let gr: Gramadoir;
  before(() => { gr = new Gramadoir(loadData(path.join(root, 'data')), { fixSpelling: true }); });
  const views = (text: string): ErrorView[] => analyse(text, gr.grammaticalErrors(foldForEngine(text))).views;
  const fix = (text: string, v: ErrorView, word: string) => applyCorrection(text, v.range!, word);

  it('"ta me": clicking tá gives "tá me"', () => {
    const v = views('ta me')[0];
    assert.ok(QUOTES_REPLACEMENT.has(v.rule));
    assert.deepEqual(quotedParts(/\/([^/]+)\//.exec(v.msg)![1]).map((p) => p.text), ['tá']);
    assert.equal(fix('ta me', v, 'tá'), 'tá me');
  });

  it('"Ta me": the engine quotes "tá", and the capitalised word gets "Tá"', () => {
    const v = views('Ta me')[0];
    const quoted = quotedParts(/\/([^/]+)\//.exec(v.msg)![1])[0].text;
    assert.equal(quoted, 'tá');
    assert.equal(fix('Ta me', v, matchCase(v.words, quoted)), 'Tá me');
  });

  it('"conai": only the correct form cónaí is offered, and it is what gets inserted', () => {
    const v = views('conai')[0];
    const choices = quotedParts(/\/([^/]+)\//.exec(v.msg)![1]).filter((p) => p.option).map((p) => p.text);
    assert.deepEqual(choices, ['cónaí']);
    assert.equal(fix('conai', v, choices[0]), 'cónaí');
  });

  it('an unknown word offers engine suggestions that replace it', () => {
    const text = 'Coicís sa bhaile i gCabhan agam.';
    const v = views(text).find((x) => x.suggestions.length)!;
    assert.ok(v.range);
    assert.equal(fix(text, v, v.suggestions[0]), 'Coicís sa bhaile i gCabhán agam.');
  });

  it('every offered replacement lines up with the flagged word', () => {
    for (const text of ['ta me', 'conai', 'Coicís sa bhaile i gCabhan agam.']) {
      for (const v of views(text)) {
        if (!v.range) continue;
        const line = text.split('\n')[v.range.y];
        assert.equal(Array.from(line).slice(v.range.from, v.range.to).join(''), v.words);
      }
    }
  });

  it('quoted replacements on the checker\'s own test texts make their error go away', () => {
    let tried = 0;
    let cleared = 0;
    const failures: string[] = [];
    for (const f of ['triail', 'corpas', 'edge']) {
      const text: string = JSON.parse(fs.readFileSync(path.join(root, 'test', 'golden', `${f}.json`), 'utf8')).text;
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        for (const v of views(line)) {
          if (!v.range || !QUOTES_REPLACEMENT.has(v.rule)) continue;
          const quoted = /\/([^/]+)\//.exec(v.msg)?.[1];
          const first = quoted && quotedParts(quoted).find((p) => p.option)?.text;
          if (!first) continue;
          const plan = planReplacement(line, v.range, first);
          if (!plan) continue;
          tried++;
          const after = applyCorrection(line, plan.range, plan.word)!;
          const still = views(after).some((x) => x.rule === v.rule && x.range?.from === v.range!.from);
          if (still) failures.push(`${v.rule}: ${sliceRange(line, v.range)} + ${first} -> ${after.slice(0, 60)}`); else cleared++;
        }
      }
    }
    console.log(`  ${cleared}/${tried} quoted replacements cleared their error`);
    if (failures.length) console.log('  e.g.', failures.slice(0, 10));
    assert.ok(tried > 100);
    assert.ok(cleared / tried >= 0.85, `only ${cleared}/${tried} cleared their error`);
  });
});
