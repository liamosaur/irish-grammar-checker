import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';
import { analyse } from '../web/annotate.ts';
import { applyCorrection, firstFix } from '../web/corrections.ts';
import { foldForEngine } from '../web/fold.ts';
import { addFixes, Forms } from '../web/forms.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const forms = new Forms(JSON.parse(fs.readFileSync(path.join(root, 'data', 'forms.json'), 'utf8')));

describe('Forms', () => {
  it('genitive of a noun: "an doras" needs dorais', () => {
    assert.deepEqual(forms.fixesFor('GENITIVE', 'ar chúl an doras'), ['dorais']);
    assert.deepEqual(forms.fixesFor('GENITIVE', 'an fear'), ['fhir']);
    assert.deepEqual(forms.fixesFor('GENITIVE', 'an teach'), ['tí']);
  });
  it('genitive plural of a plural noun', () => {
    assert.deepEqual(forms.fixesFor('GENITIVE', 'na nÉireannaigh'), ['nÉireannach']);
  });
  it('an adjective after a genitive noun takes that noun\'s gender', () => {
    assert.deepEqual(forms.fixesFor('GENITIVE', 'na gaoithe móra'), ['móire']);
  });
  it('keeps the capital letter, and a mutation the word already had when there is no article', () => {
    assert.deepEqual(forms.fixesFor('GENITIVE', 'Doras'), ['Dorais']);
    assert.deepEqual(forms.fixesFor('GENITIVE', 'mo bhean'), ['mhná']); // lenition from "mo" stays
    assert.deepEqual(forms.fixesFor('GENITIVE', 'na nÉireannaigh'), ['nÉireannach']);
  });
  it('unnecessary genitive goes back to the nominative', () => {
    assert.deepEqual(forms.fixesFor('NOGENITIVE', 'an dorais'), ['doras']);
    assert.deepEqual(forms.fixesFor('NOGENITIVE', 'ar na bhfuinneog'), ['fuinneoga']); // no eclipsis in the nominative plural (1G)
  });
  it('singular and plural', () => {
    assert.deepEqual(forms.fixesFor('UATHA', 'cé mhéad daoine'), ['duine']);
    assert.deepEqual(forms.fixesFor('IOLRA', 'cúig bád'), ['báid']);
    assert.deepEqual(forms.fixesFor('AIDIOLRA', 'na fir mór'), ['móra']);
  });
  it('offers nothing for other rules, unknown words, or a word that does not change', () => {
    assert.deepEqual(forms.fixesFor('SEIMHIU', 'an doras'), []);
    assert.deepEqual(forms.fixesFor('GENITIVE', 'an zzzzzz'), []);
    assert.deepEqual(forms.fixesFor('GENITIVE', 'mo siopa'), []); // siopa is its own genitive, and there is no article to change it
    assert.deepEqual(forms.fixesFor('GENITIVE', 'an siopa'), ['tsiopa']); // but after "an" the genitive takes t- before s (1F)
    assert.deepEqual(forms.fixesFor('GENITIVE', ''), []);
  });
});

// The first letter of the noun after the article, as An Caighdeán Oifigiúil 2017 (chapter 1) gives it.
// Each row is [rule, flagged text, the form expected, the Caighdeán's own example / table].
const CAIGHDEAN: [string, string, string, string][] = [
  // 1F genitive singular, masculine ("an"): lenition of b c f g m p; none for d, t; t- before s; none before vowels
  ['GENITIVE', 'barr an cnoc', 'chnoic', 'barr an chnoic'],
  ['GENITIVE', 'hata an fear', 'fhir', 'hata an fhir'],
  ['GENITIVE', 'chun an diabhal', 'diabhail', 'chun an diabhail'],
  ['GENITIVE', 'doras an teach', 'tí', 'doras an tí'],
  ['GENITIVE', 'tús an saol', 'tsaoil', 'tús an tsaoil'],
  ['GENITIVE', 'pas an Seapánach', 'tSeapánaigh', 'pas an tSeapánaigh'],
  ['GENITIVE', 'pas an Albanach', 'Albanaigh', 'pas an Albanaigh'],
  // 1F genitive singular, feminine ("na"): none before consonants, h- before vowels
  ['GENITIVE', 'leac an fhuinneog', 'fuinneoige', 'leac na fuinneoige'],
  ['GENITIVE', 'bun an sráid', 'sráide', 'bun na sráide'],
  ['GENITIVE', 'timpeall an áit', 'háite', 'timpeall na háite'],
  // 1I genitive plural ("na"): eclipsis, n- before vowels
  ['GENITIVE', 'trasna na cnoic', 'gcnoc', 'trasna na gcnoc'],
  ['GENITIVE', 'leaca na fuinneoga', 'bhfuinneog', 'leaca na bhfuinneog'],
  ['GENITIVE', 'i measc na daoine', 'ndaoine', 'i measc na ndaoine'],
  ['GENITIVE', 'líon na háiteanna', 'n-áiteanna', 'líon na n-áiteanna'],
  ['GENITIVE', 'líon na hAlbanaigh', 'nAlbanach', 'líon na nAlbanach'],
  // 1A nominative singular: masculine t- before vowels; feminine lenition, t- before s
  ['NOGENITIVE', 'ag an dorais', 'doras', 'an doras'],
  ['NOGENITIVE', 'ag an chnoic', 'cnoc', 'an cnoc'],
  ['NOGENITIVE', 'ag an fhir', 'fear', 'an fear'],
  ['NOGENITIVE', 'ag an tsaoil', 'saol', 'an saol'],
  ['NOGENITIVE', 'ag an fuinneoige', 'fhuinneog', 'an fhuinneog'],
  ['NOGENITIVE', 'ag an sráide', 'tsráid', 'an tsráid'],
  ['NOGENITIVE', 'ag an háite', 'áit', 'an áit'],
  // 1G nominative plural ("na"): none before consonants, h- before vowels
  ['NOGENITIVE', 'ag na gcnoc', 'cnoic', 'na cnoic'],
  ['NOGENITIVE', 'ag na bhfuinneog', 'fuinneoga', 'na fuinneoga'],
  ['NOGENITIVE', 'ag na nAlbanach', 'hAlbanaigh', 'na hAlbanaigh'],
];

describe('the first letter after the article follows An Caighdeán Oifigiúil', () => {
  for (const [rule, flagged, want, example] of CAIGHDEAN) {
    it(`${rule} "${flagged}" -> ${want} (${example})`, () => {
      assert.equal(forms.fixesFor(rule, flagged)[0], want);
    });
  }
});

describe('genitive and plural fixes against the real engine', () => {
  let gr: Gramadoir;
  before(() => { gr = new Gramadoir(loadData(path.join(root, 'data')), { fixSpelling: true }); });
  const views = (line: string) => {
    const errors = gr.grammaticalErrors(foldForEngine(line));
    addFixes(errors, forms);
    return analyse(line, errors).views;
  };

  it('the "Scriúáil sé an glas seo ar chúl an doras." example gets "dorais"', () => {
    const line = 'Scriúáil sé an glas seo ar chúl an doras.';
    const v = views(line).find((x) => x.rule === 'GENITIVE')!;
    assert.deepEqual(v.fixes, ['dorais']);
    const plan = firstFix(v, line)!;
    const fixed = applyCorrection(line, plan.range, plan.word)!;
    assert.equal(fixed, 'Scriúáil sé an glas seo ar chúl an dorais.');
    assert.ok(!views(fixed).some((x) => x.rule === 'GENITIVE'));
  });

  it("most of these fixes on the checker's own test texts make their error go away", () => {
    const rules = ['GENITIVE', 'NOGENITIVE', 'UATHA', 'IOLRA', 'AIDIOLRA'];
    let tried = 0;
    let cleared = 0;
    const failures: string[] = [];
    for (const f of ['triail', 'corpas', 'edge']) {
      const text: string = JSON.parse(fs.readFileSync(path.join(root, 'test', 'golden', `${f}.json`), 'utf8')).text;
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        for (const v of views(line)) {
          if (!rules.includes(v.rule) || !v.fixes.length || !v.range) continue;
          const plan = firstFix(v, line);
          if (!plan) continue;
          tried++;
          const after = applyCorrection(line, plan.range, plan.word)!;
          const still = views(after).some((x) => x.rule === v.rule && x.range?.from === v.range!.from);
          if (still) failures.push(`${v.rule}: ${v.words} -> ${plan.word}`); else cleared++;
        }
      }
    }
    console.log(`  ${cleared}/${tried} form fixes cleared their error`);
    if (failures.length) console.log('  e.g.', failures.slice(0, 10));
    assert.ok(tried >= 5, 'the corpus exercises the feature');
    assert.ok(cleared / tried >= 0.7, `only ${cleared}/${tried} cleared their error`);
  });
});
