import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';
import { analyse } from '../web/annotate.ts';
import {
  applyCorrection, dPrefix, firstFix, eclipse, hPrefix, lenite, proposeFix, sliceRange, tPrefix,
  unDPrefix, unHPrefix, unTPrefix, uneclipse, unlenite,
} from '../web/corrections.ts';
import { foldForEngine } from '../web/fold.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('lenition', () => {
  it('adds h after a lenitable consonant', () => {
    assert.equal(lenite('cónaí'), 'chónaí');
    assert.equal(lenite('bean'), 'bhean');
    assert.equal(lenite('fear'), 'fhear');
    assert.equal(lenite('Pádraig'), 'Phádraig');
    assert.equal(lenite('móir'), 'mhóir');
  });
  it('lenites s only before a vowel, l, n or r', () => {
    assert.equal(lenite('sráid'), 'shráid');
    assert.equal(lenite('súil'), 'shúil');
    assert.equal(lenite('slat'), 'shlat');
    assert.equal(lenite('scian'), null);
    assert.equal(lenite('spéir'), null);
    assert.equal(lenite('stad'), null);
    assert.equal(lenite('smaoineamh'), null);
  });
  it('leaves words that cannot be lenited, or already are', () => {
    assert.equal(lenite('arán'), null);
    assert.equal(lenite('lámh'), null);
    assert.equal(lenite('bhean'), null);
    assert.equal(lenite('n-ainm'), null);
  });
  it('removes lenition', () => {
    assert.equal(unlenite('chónaí'), 'cónaí');
    assert.equal(unlenite('Ghaeilge'), 'Gaeilge');
    assert.equal(unlenite('theilifíse'), 'teilifíse');
    assert.equal(unlenite('cat'), null);
  });
});

describe('lenition of an eclipsed word', () => {
  it('replaces the eclipsis with lenition', () => {
    assert.equal(lenite('gCabhán'), 'Chabhán');
    assert.equal(lenite('mbean'), 'bhean');
    assert.equal(lenite('gcat'), 'chat');
    assert.equal(lenite('bhfear'), 'fhear');
    assert.equal(lenite('dtír'), 'thír');
  });
});

describe('eclipsis', () => {
  it('eclipses consonants', () => {
    assert.equal(eclipse('bord'), 'mbord');
    assert.equal(eclipse('cat'), 'gcat');
    assert.equal(eclipse('doras'), 'ndoras');
    assert.equal(eclipse('fear'), 'bhfear');
    assert.equal(eclipse('gort'), 'ngort');
    assert.equal(eclipse('páirc'), 'bpáirc');
    assert.equal(eclipse('tír'), 'dtír');
  });
  it('puts n before a vowel, with a hyphen only before lower case', () => {
    assert.equal(eclipse('ainm'), 'n-ainm');
    assert.equal(eclipse('Éirinn'), 'nÉirinn');
  });
  it('keeps the capital on the word', () => {
    assert.equal(eclipse('Baile'), 'mBaile');
    assert.equal(eclipse('Corcaigh'), 'gCorcaigh');
    assert.equal(eclipse('Francach'), 'bhFrancach');
  });
  it('starts from the plain word when it is already lenited', () => {
    assert.equal(eclipse('dhearna'), 'ndearna');
  });
  it('refuses words that cannot, or already do, carry eclipsis', () => {
    assert.equal(eclipse('mbord'), null);
    assert.equal(eclipse('bhfear'), null);
    assert.equal(eclipse('n-ainm'), null);
    assert.equal(eclipse('lá'), null);
    assert.equal(eclipse('sráid'), null);
  });
  it('removes eclipsis', () => {
    assert.equal(uneclipse('mbord'), 'bord');
    assert.equal(uneclipse('gcat'), 'cat');
    assert.equal(uneclipse('ndoras'), 'doras');
    assert.equal(uneclipse('ngort'), 'gort');
    assert.equal(uneclipse('bpáirc'), 'páirc');
    assert.equal(uneclipse('dtír'), 'tír');
    assert.equal(uneclipse('bhfear'), 'fear');
    assert.equal(uneclipse('n-ainm'), 'ainm');
    assert.equal(uneclipse('nÉirinn'), 'Éirinn');
    assert.equal(uneclipse('mBaile'), 'Baile');
    assert.equal(uneclipse('cat'), null);
  });
});

describe("h-, t- and d'-prefixes", () => {
  it('h before a vowel', () => {
    assert.equal(hPrefix('iontach'), 'hiontach');
    assert.equal(hPrefix('Éire'), 'hÉire');
    assert.equal(hPrefix('bean'), null);
    assert.equal(unHPrefix('hiontach'), 'iontach');
    assert.equal(unHPrefix('hÉire'), 'Éire');
    assert.equal(unHPrefix('holc'), 'olc');
    assert.equal(unHPrefix('bean'), null);
  });
  it('t- before a vowel, t before s', () => {
    assert.equal(tPrefix('alt'), 't-alt');
    assert.equal(tPrefix('Acht'), 'tAcht');
    assert.equal(tPrefix('sráid'), 'tsráid');
    assert.equal(tPrefix('Sráid'), 'tSráid');
    assert.equal(tPrefix('scian'), null);
    assert.equal(tPrefix('bord'), null);
    assert.equal(unTPrefix('t-alt'), 'alt');
    assert.equal(unTPrefix('tAonach'), 'Aonach');
    assert.equal(unTPrefix('tsráid'), 'sráid');
    assert.equal(unTPrefix('tSualainnis'), 'Sualainnis');
    assert.equal(unTPrefix('tá'), null);
  });
  it("d' before a vowel or fh", () => {
    assert.equal(dPrefix('fhéach'), "d'fhéach");
    assert.equal(dPrefix('ól'), "d'ól");
    assert.equal(dPrefix('bris'), null);
    assert.equal(unDPrefix("d'fhoghlaim"), 'fhoghlaim');
    assert.equal(unDPrefix('bris'), null);
  });
});

describe('proposeFix', () => {
  it('applies the change to the last word and keeps the rest', () => {
    assert.equal(proposeFix('SEIMHIU', 'mo cónaí'), 'mo chónaí');
    assert.equal(proposeFix('SEIMHIU', 'don craic'), 'don chraic');
    assert.equal(proposeFix('URU', 'deich tobar'), 'deich dtobar');
    assert.equal(proposeFix('PREFIXH', 'chomh iontach'), 'chomh hiontach');
    assert.equal(proposeFix('PREFIXT', 'an ochtapas'), 'an t-ochtapas');
    assert.equal(proposeFix('NISEIMHIU', 'ach mhallacht'), 'ach mallacht');
    assert.equal(proposeFix('NITEE', 'san t-ionad'), 'san ionad');
  });
  it('adds the plain article where one is required', () => {
    assert.equal(proposeFix('NEEDART', 'teanga seo'), 'an teanga seo');
    assert.equal(proposeFix('NEEDART', 'gCabhán'), 'an gCabhán');
    assert.equal(proposeFix('NEEDART', ''), null);
  });
  it('removes an unnecessary initial mutation, whichever it is', () => {
    assert.equal(proposeFix('NICLAOCHLU', 'an dhíograis'), 'an díograis');
    assert.equal(proposeFix('NICLAOCHLU', 'faoin dtionscnamh'), 'faoin tionscnamh');
    assert.equal(proposeFix('NICLAOCHLU', 'an cat'), null);
  });
  it("removes an unnecessary b'", () => {
    assert.equal(proposeFix('NIBEE', "gur b'fhéidir"), 'gur fhéidir');
  });
  it('removes an unnecessary definite article and the mutation it caused', () => {
    assert.equal(proposeFix('BADART', 'an bharr gach leathanaigh'), 'barr gach leathanaigh');
    assert.equal(proposeFix('BADART', 'an t-ainm do mháthar'), 'ainm do mháthar');
    assert.equal(proposeFix('BADART', 'An bharr'), 'Barr');
    assert.equal(proposeFix('BADART', 'san Iosrael'), 'in Iosrael');
    assert.equal(proposeFix('ONEART', 'an fear an phortaigh'), 'fear an phortaigh');
    assert.equal(proposeFix('BADART', 'ag an doras'), null);
  });
  it('removes a repeated word', () => {
    assert.equal(proposeFix('DUBAILTE', 'na na'), 'na');
    assert.equal(proposeFix('DUBAILTE', 'mór  mór'), 'mór');
    assert.equal(proposeFix('DUBAILTE', 'Na na'), 'Na');
    assert.equal(proposeFix('DUBAILTE', 'leor leor leor'), 'leor');
    assert.equal(proposeFix('DUBAILTE', 'na'), null);
    assert.equal(proposeFix('DUBAILTE', 'na ná'), null);
  });
  it('lenites an eclipsed word after sa', () => {
    assert.equal(proposeFix('SEIMHIU', 'sa gCabhán'), 'sa Chabhán');
  });
  it('preserves spacing between the words', () => {
    assert.equal(proposeFix('SEIMHIU', 'mo  cónaí'), 'mo  chónaí');
  });
  it('offers nothing for rules it does not understand, or words it cannot change', () => {
    assert.equal(proposeFix('GENITIVE', 'an doras'), null);
    assert.equal(proposeFix('CLAOCHLU', 'ar an cuntar'), null);
    assert.equal(proposeFix('SEIMHIU', 'mo arán'), null);
    assert.equal(proposeFix('SEIMHIU', ''), null);
  });
});

describe('sliceRange', () => {
  it('returns the flagged text, counting code points', () => {
    assert.equal(sliceRange('😀 mo cónaí', { y: 0, from: 2, to: 10 }), 'mo cónaí');
    assert.equal(sliceRange('a\nmo cónaí', { y: 1, from: 0, to: 8 }), 'mo cónaí');
    assert.equal(sliceRange('a', { y: 4, from: 0, to: 1 }), null);
  });
});

describe('proposed fixes against the real engine', () => {
  let gr: Gramadoir;
  before(() => { gr = new Gramadoir(loadData(path.join(root, 'data')), { fixSpelling: true }); });
  const errorsOf = (text: string) => analyse(text, gr.grammaticalErrors(foldForEngine(text))).views;

  it('"mo cónaí" -> "mo chónaí" clears the error', () => {
    const text = 'Tá mo cónaí i mBaile Átha Cliath.';
    const v = errorsOf(text).find((x) => x.rule === 'SEIMHIU');
    assert.ok(v?.range, 'engine flags the missing lenition');
    const fixed = applyCorrection(text, v.range, proposeFix(v.rule, sliceRange(text, v.range)!)!)!;
    assert.equal(fixed, 'Tá mo chónaí i mBaile Átha Cliath.');
    assert.ok(!errorsOf(fixed).some((x) => x.rule === 'SEIMHIU'));
  });

  it("most proposed fixes on the checker's own test texts make that error go away", () => {
    let tried = 0;
    let cleared = 0;
    const failures: string[] = [];
    for (const f of ['triail', 'corpas', 'edge']) {
      const text: string = JSON.parse(fs.readFileSync(path.join(root, 'test', 'golden', `${f}.json`), 'utf8')).text;
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        for (const v of errorsOf(line)) {
          if (!v.range) continue;
          const flagged = sliceRange(line, v.range);
          const proposal = flagged === null ? null : proposeFix(v.rule, flagged);
          if (proposal === null) continue;
          tried++;
          const after = applyCorrection(line, v.range, proposal)!;
          const still = errorsOf(after).some((x) => x.rule === v.rule && x.range?.from === v.range!.from);
          if (still) failures.push(`${v.rule}: ${flagged} -> ${proposal}`); else cleared++;
        }
      }
    }
    console.log(`  ${cleared}/${tried} proposed fixes cleared their error`);
    if (failures.length) console.log('  e.g.', failures.slice(0, 12));
    assert.ok(tried > 100, 'the corpus exercises the feature');
    assert.ok(cleared / tried >= 0.9, `only ${cleared}/${tried} fixes cleared their error`);
  });

  it('following the first fix each time repairs the Cabhán example sentence', () => {
    let text = 'Coicís sa bhaile i gCabhan agam ansin don craic!';
    const steps: string[] = [text];
    for (let i = 0; i < 10; i++) {
      const next = errorsOf(text).map((v) => ({ v, plan: firstFix(v, text) })).find((x) => x.plan);
      if (!next) break;
      text = applyCorrection(text, next.plan!.range, next.plan!.word)!;
      steps.push(text);
    }
    assert.equal(text, 'Coicís sa bhaile sa Chabhán agam ansin don chraic!', steps.join(' => '));
    assert.deepEqual(errorsOf(text), []);
  });
});
