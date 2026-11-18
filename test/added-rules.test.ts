// Cases worked through when we changed the rules in grammar/ (test/caighdean.test.ts
// covers the Caighdeán's own example sentences).
// - `cases`: each sentence breaks the rule of An Caighdeán Oifigiúil (2017) named with
//   it, and must get exactly the one message given, with the one-click fix shown
//   (null: the message is shown but no fix is offered).
// - `clean`: correct sentences close to what a rule or exception is about, which
//   must not be flagged; the note says what each guards against.
// Add to both when a rule is changed.
import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';
import { analyse } from '../web/annotate.ts';
import { applyCorrection, firstFix } from '../web/corrections.ts';
import { foldForEngine } from '../web/fold.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// As in test/caighdean.test.ts: messages about the word list, not grammar.
const LEXICON_ONLY = new Set(['ANAITHNID', 'ANKOTHVOS', 'UNKNOWN', 'MOLADH', 'GRAM', 'MOIRF', 'COMHFHOCAL', 'COMHCHAIGH']);

type Case = { section: string; text: string; rule: string; words: string; fixed: string | null };
const cases: Case[] = [
  // h before a vowel after the copula ní
  { section: '10.11.8(a)', text: 'Ní iontas ar bith é sin.', rule: 'PREFIXH', words: 'Ní iontas', fixed: 'Ní hiontas ar bith é sin.' },
  { section: '10.12.2(a)', text: 'Ní amháin go raibh sé ann.', rule: 'PREFIXH', words: 'Ní amháin', fixed: 'Ní hamháin go raibh sé ann.' },
  { section: '10.11.8(c)', text: 'Ní aithne go haontíos.', rule: 'PREFIXH', words: 'Ní aithne go haontíos', fixed: 'Ní haithne go haontíos.' },
  { section: 'Tábla 10E', text: 'Ní uair chairde í.', rule: 'PREFIXH', words: 'Ní uair chairde', fixed: 'Ní huair chairde í.' },
  { section: '10.13.2', text: 'Ní eo é an rud.', rule: 'PREFIXH', words: 'Ní eo', fixed: 'Ní heo é an rud.' },
  // ná, not na, before the imperative, with h before a vowel
  { section: '10.14.1', text: 'Na abair é.', rule: 'NAIMPER', words: 'Na abair', fixed: 'Ná habair é.' },
  { section: '10.14.1', text: 'Na habair leis é.', rule: 'NAIMPER', words: 'Na habair', fixed: 'Ná habair leis é.' },
  { section: '10.14.1', text: 'Na déan é.', rule: 'NAIMPER', words: 'Na déan', fixed: 'Ná déan é.' },
  { section: '10.14.1', text: 'Na bí buartha.', rule: 'NAIMPER', words: 'Na bí', fixed: 'Ná bí buartha.' },
  { section: '10.14.1', text: 'Suigh síos agus na bí buartha.', rule: 'NAIMPER', words: 'na bí', fixed: 'Suigh síos agus ná bí buartha.' },
  { section: '10.14.1', text: 'Na hól é.', rule: 'NAIMPER', words: 'Na hól', fixed: 'Ná hól é.' },
  // h before a vowel after an ordinal
  { section: '10.11.2(a)', text: 'Tá an t-ochtú eagrán den iris ar fáil anois.', rule: 'PREFIXH', words: 't-ochtú eagrán', fixed: 'Tá an t-ochtú heagrán den iris ar fáil anois.' },
  { section: '10.11.2(a)', text: 'Déanaigí an ceathrú alt a léamh.', rule: 'PREFIXH', words: 'an ceathrú alt', fixed: 'Déanaigí an ceathrú halt a léamh.' },
  // dís lenites what follows
  { section: '10.2.7', text: 'Bhí dís fear ann.', rule: 'SEIMHIU', words: 'dís fear', fixed: 'Bhí dís fhear ann.' },
  // eclipsis after go in set phrases
  { section: '10.6.4(b)', text: 'Cath go díth ab ea é.', rule: 'URU', words: 'go díth', fixed: 'Cath go ndíth ab ea é.' },
  // in before an abbreviation; i with eclipsis before a Gaelicised name (a hint)
  { section: '10.6.4(a)(ii)', text: 'Cá mhéad stát atá i SAM?', rule: 'BACHOIR', words: 'i SAM', fixed: 'Cá mhéad stát atá in SAM?' },
  { section: '10.6.4(a)(iii)', text: 'Chaith sí seachtain ag obair in Tamhlacht.', rule: 'WEAKBACHOIRIN', words: 'in Tamhlacht', fixed: null },
  // mb', not mba, before a noun or adjective beginning with a vowel
  { section: '7.2.2B(b)', text: 'Dúirt sé go mba altra cáilithe í.', rule: 'BACHOIR', words: 'mba altra', fixed: "Dúirt sé go mb'altra cáilithe í." },
  { section: '7.3.5', text: 'Dá mba fhear saibhir é, thabharfadh sé síntiús.', rule: 'BACHOIR', words: 'mba fhear', fixed: "Dá mb'fhear saibhir é, thabharfadh sé síntiús." },
  // the adjective after an adverb is not lenited
  { section: '4.3.5', text: 'Maidin sách fhuar a bhí ann.', rule: 'NISEIMHIU', words: 'sách fhuar', fixed: 'Maidin sách fuar a bhí ann.' },
  // ... nor is the adverb itself (4.3.5's examples; 10.3.1(a) lenites only an adjective)
  { section: '4.3.5', text: 'Maidin shách fuar a bhí ann.', rule: 'NISEIMHIU', words: 'Maidin shách fuar', fixed: 'Maidin sách fuar a bhí ann.' },
  { section: '4.3.5', text: 'Bliain chuibheasach tirim atá uainn.', rule: 'NISEIMHIU', words: 'Bliain chuibheasach tirim', fixed: 'Bliain cuibheasach tirim atá uainn.' },
  { section: '4.3.5', text: 'Is bean mheasartha saibhir í.', rule: 'NISEIMHIU', words: 'bean mheasartha saibhir', fixed: 'Is bean measartha saibhir í.' },
  // an adjectival phrase is not lenited
  { section: '4.3.7', text: 'Tá tuarascáil chothrom le dáta againn.', rule: 'NISEIMHIU', words: 'chothrom le dáta', fixed: 'Tá tuarascáil cothrom le dáta againn.' },
  // dá lenites the comparative form
  { section: '4.8.3', text: 'Dá críonna é, níor éirigh an gnó leis.', rule: 'SEIMHIU', words: 'Dá críonna', fixed: 'Dá chríonna é, níor éirigh an gnó leis.' },
  // a predicative adjective is not lenited
  { section: '4.11', text: 'Tá an aimsir fhuar.', rule: 'NISEIMHIU', words: 'Tá an aimsir fhuar', fixed: 'Tá an aimsir fuar.' },
  { section: '4.11', text: 'An bhfuil an aimsir fhuar?', rule: 'NISEIMHIU', words: 'bhfuil an aimsir fhuar', fixed: 'An bhfuil an aimsir fuar?' },
  // ... but an attributive one is, as before
  { section: '10.3.1(a)', text: 'Tá an aimsir fuar ag teacht.', rule: 'SEIMHIU', words: 'aimsir fuar', fixed: 'Tá an aimsir fhuar ag teacht.' },
  // h after ní only on the listed words (as before)
  { section: '10.11.8', text: 'Ní hamadán é.', rule: 'NIAITCH', words: 'hamadán', fixed: 'Ní amadán é.' },
  // b' before a vowel, written joined to the next word
  { section: '7.2.1B(c)', text: 'Ba eol duit é.', rule: 'BACHOIR', words: 'Ba eol', fixed: "B'eol duit é." },
  // h after ná on an imperative beginning with a vowel
  { section: '10.14.1', text: 'Ná óltar sa Dánlann.', rule: 'PREFIXH', words: 'Ná óltar', fixed: 'Ná hóltar sa Dánlann.' },
  // sular, not sularb, before a consonant (sularb is tagged as the copula in grammar/lexicon-corrections.tsv)
  { section: '7.3.3', text: 'Sularb mian leat é, abair.', rule: 'BACHOIR', words: 'Sularb mian', fixed: 'Sular mian leat é, abair.' },
];

// Correct sentences close to what the rules above (and our exceptions) are about,
// checked by hand when the rules were written: none of them may be flagged. The
// note says what each guards against.
const clean: { text: string; note: string }[] = [
  { text: 'Ní amadán é.', note: 'no h after ní on a word outside the CO17 list' },
  { text: 'Ní Eoin is ainm dom.', note: 'no h after ní on a name' },
  { text: 'Ní eolas oideachas.', note: 'eolas takes h after ní only in the proverb' },
  { text: 'Rinne sé aon ní amháin.', note: 'ní the noun, not the copula: no h on amháin' },
  { text: 'Bhí sé san AE.', note: 'with the article, san, not in, before an abbreviation' },
  { text: 'Bhí sé in bhur gcónaí.', note: 'in before bhur' },
  { text: 'Bhí sé in dhá áit.', note: 'in before dhá' },
  { text: 'Is bean shách í.', note: 'sách as an adjective (sated) is lenited after a feminine noun' },
  { text: 'Tá an aimsir fhuar ag teacht.', note: 'attributive, not predicative: lenited' },
  { text: 'Bhí an bhean bheag ann.', note: 'attributive adjective before ann: lenited' },
  { text: 'Bhí an fhadhb chéanna.', note: 'céanna is lenited after a feminine noun at the end of a clause too' },
  { text: 'Thug sé dá mhac é.', note: 'dá + noun, not the comparative construction' },
  { text: 'Is fear an duine mór.', note: 'after the copula, an duine is the subject (nominative)' },
  { text: 'Chonaic mé a pheann mór.', note: 'possessive a, not the vocative' },
  { text: 'Seo cóta Mháire Bheag.', note: "adjective after a woman's name in the genitive" },
  { text: 'Ba é an fear é.', note: 'the copula ba' },
  { text: 'Chonaic mé na ba.', note: 'ba, the plural of bó, after the article' },
  { text: 'Ba mhaith liom an carr.', note: 'the copula ba before a lenited word' },
  { text: 'Chonaic mé na fir.', note: 'na the article' },
  { text: 'Bhí na fir agus na mná ann.', note: 'agus na + plural noun' },
  { text: 'Na fir a bhí ann.', note: 'na + a noun with no imperative reading, at the start of the sentence' },
  { text: 'Bhí siad i lár na bí.', note: 'na + bí in mid-clause is the article (genitive noun)' },
  { text: 'Is iad na habair iad.', note: 'na + a plural noun that is also an imperative, in mid-clause' },
  { text: 'Thóg sé na leabhair leis.', note: 'na + plural noun + prepositional pronoun' },
  { text: 'Ná déan é.', note: 'ná before a consonant' },
  { text: 'Ná habair é.', note: 'ná + h before a vowel' },
  { text: 'Abair leis teacht.', note: 'the imperative abair' },
  { text: 'An eo é?', note: 'eo the pronoun (grammar/lexicon-corrections.tsv)' },
  { text: 'Tháinig an cabar anuas.', note: 'cabar, now in the word list (grammar/lexicon-corrections.tsv)' },
  { text: 'Dúirt sé gur cheart é a dhíol.', note: 'gur, as well as go mba, is still accepted' },
  { text: 'Tá tuarascáil cothrom le dáta againn.', note: 'cothrom le dáta is one adjective, not lenited' },
];

let engine: Gramadoir | undefined;
const complaints = (text: string) => {
  engine ??= new Gramadoir(loadData(path.join(root, 'data')), { fixSpelling: true });
  return analyse(text, engine.grammaticalErrors(foldForEngine(text))).views.filter((v) => !LEXICON_ONLY.has(v.rule));
};

describe('errors reported by the rules we added', () => {
  for (const c of cases) {
    it(`${c.text} (${c.section})`, () => {
      const views = complaints(c.text);
      assert.deepEqual(views.map((v) => `${v.rule} [${v.words}]`), [`${c.rule} [${c.words}]`]);
      const plan = firstFix(views[0], c.text);
      assert.equal(plan ? applyCorrection(c.text, plan.range, plan.word) : null, c.fixed);
    });
  }
});

describe('correct sentences near those rules are not flagged', () => {
  for (const c of clean) {
    it(`${c.text} (${c.note})`, () => {
      assert.deepEqual(complaints(c.text).map((v) => `${v.rule} [${v.words}]: ${v.msg}`), []);
    });
  }
});
