// Cases worked through when we changed the rules in grammar/ (test/caighdean.test.ts
// covers the Caighdeán's own example sentences).
// - `cases`: each sentence breaks the rule of An Caighdeán Oifigiúil (2017) named with
//   it, and must get exactly the one message given, with the one-click fix shown
//   (null: the message is shown but no fix is offered).
// - `clean`: correct sentences close to what a rule or exception is about, which
//   must not be flagged; the note says what each guards against.
// Add to both when a rule is changed.
//
// The sentences and their classification (error or correct) were written while working
// on the rules, not taken from the Caighdeán. A case is enforced only once a reviewer has
// confirmed it, by adding `reviewed: true`; until then it runs as a todo (it is checked
// and reported, but does not fail the suite).
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

type Case = { section: string; text: string; rule: string; words: string; fixed: string | null; reviewed?: boolean };
const NOT_REVIEWED = 'not yet reviewed: add reviewed: true once the case is confirmed';
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
  // a verbal-noun unit after the article: genitive mutation in genitive position, none in the nominative
  { section: '3.3.1(b)', text: 'Bhí sé le linn an cur síos.', rule: 'GENITIVE', words: 'le linn an cur síos', fixed: null },
  { section: '3.3.1(b)', text: 'Rinne sé an chur síos.', rule: 'NISEIMHIU', words: 'an chur síos', fixed: 'Rinne sé an cur síos.' },
  { section: '3.3.1(b)', text: 'Bhí an éirí amach ann.', rule: 'PREFIXT', words: 'an éirí amach', fixed: 'Bhí an t-éirí amach ann.' },
  // h after le, as before, but not on an abbreviation (see clean)
  { section: '10.11.1', text: 'Tá sé le Aoife.', rule: 'PREFIXH', words: 'le Aoife', fixed: 'Tá sé le hAoife.' },
  // the genitive after a compound preposition, as before, unless a + verbal noun follows (see clean)
  { section: '3.3.2(a)', text: 'Cuideachta áitiúil atá i mbun an teach.', rule: 'GENITIVE', words: 'i mbun an teach', fixed: null },
  // an adjective after a feminine noun is lenited, as before (the ag + verbal noun exception does not apply)
  { section: '10.3.1(a)', text: 'Is bean cabhrach í.', rule: 'SEIMHIU', words: 'bean cabhrach', fixed: 'Is bean chabhrach í.' },
  // the genitive adjective after a definite genitive, as before, when not predicative after bí
  { section: '4.4.1', text: 'Chonaic mé teach an fhir mór.', rule: 'GENITIVE', words: 'an fhir mór', fixed: null },
  { section: '4.4.1', text: 'Tá teach an fhir mór ann.', rule: 'GENITIVE', words: 'an fhir mór', fixed: null },
  // a noun joined to a verbal noun by a stays nominative (3.3.2(a)); the genitive otherwise
  { section: '3.3.2(a)', text: 'Tharla sé le linn an chluiche a imirt.', rule: 'NISEIMHIU', words: 'an chluiche', fixed: 'Tharla sé le linn an cluiche a imirt.' },
  { section: '10.2.1', text: 'Tharla sé le linn an cluiche.', rule: 'SEIMHIU', words: 'an cluiche', fixed: 'Tharla sé le linn an chluiche.' },
  // a simple preposition that does not take the genitive, as before (d'ainneoin now does)
  { section: '3.3.2(b)', text: 'Chuaigh sé ar na scoile.', rule: 'NOGENITIVE', words: 'ar na scoile', fixed: null },
  // a lenited adjective after a masculine noun and a trade name is still reported
  { section: '3.1.5', text: 'Bhí an fear Excel chéanna ann.', rule: 'NISEIMHIU', words: 'chéanna', fixed: 'Bhí an fear Excel céanna ann.' },
  // na + a singular noun, as before; the place name Garraithe Náisiúnta na Lus is the exception
  { section: '1.6', text: 'Chonaic mé na lus.', rule: 'BACHOIR', words: 'na lus', fixed: 'Chonaic mé an lus.' },
  // the adjective after a number is still lenited after an ordinary noun (9.3.3)
  { section: '9.3.3', text: 'Bhí seacht leabhar móra ann.', rule: 'SEIMHIU', words: 'seacht leabhar móra', fixed: 'Bhí seacht leabhar mhóra ann.' },
  // an + a lenited personal number, not after a noun (nominative)
  { section: '9.4.2(b)', text: 'Chonaic mé an cheathrar.', rule: 'NISEIMHIU', words: 'an cheathrar', fixed: 'Chonaic mé an ceathrar.' },
];

// Correct sentences close to what the rules above (and our exceptions) are about,
// checked by hand when the rules were written: none of them may be flagged. The
// note says what each guards against.
const clean: { text: string; note: string; reviewed?: boolean }[] = [
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
  { text: 'Rinne sé cur síos.', note: 'a verbal-noun unit, indefinite' },
  { text: 'Rinne sé an cur síos.', note: 'a verbal-noun unit after the article in the nominative: not lenited' },
  { text: 'Ba é an dul chun cinn is mó é.', note: 'a verbal-noun unit in the nominative' },
  { text: 'Thug sé an cur i láthair.', note: 'cur i láthair, joined before i láthair is' },
  { text: 'Tá sé i láthair.', note: 'i láthair on its own is still a phrase' },
  { text: 'Tháinig sé i bhfeidhm.', note: 'i bhfeidhm on its own is still a phrase' },
  { text: 'Rinne sé é le ÍMAT.', note: 'an abbreviation is not mutated after le' },
  { text: 'Is fostaí de chuid CIN rannpháirteach í.', note: 'an abbreviation in capitals is not reported as the rare word cin' },
  { text: 'Tharla sé le linn an cluiche a imirt.', note: 'nominative before a + verbal noun, though the genitive is spelt the same', reviewed: true },
  { text: 'Tharla sé le linn an chluiche a bhí ann.', note: 'a + verb is the relative particle: genitive, lenited' },
  { text: 'Bhí sé ann ar feadh uair an chloig.', note: 'uair an chloig taken as one noun' },
  { text: 'Tá sí ag déanamh a cuid oibre.', note: 'cuid after a possessive and a verbal noun has no genitive reading and is left alone' },
  { text: 'Tá sé ag iarraidh a dheimhniú go mbeidh gach ní ina cheart.', note: 'a before a verbal noun is the particle, not a possessive' },
  { text: 'Bhí ceathrar daltaí ann.', note: 'a weak plural after a personal number is the genitive plural' },
  { text: 'Bhí sé ann naoi mbliana fada ó shin.', note: 'no lenition after a special plural form ending in a vowel' },
  { text: 'Chuir sé na chéad cheithre ghloine ar an mbord.', note: 'céad lenites the number after it' },
  { text: 'Tá cúig cheathrú den chíste fágtha.', note: 'a fraction: the denominator is lenited after 2-6' },
  { text: 'Tá an bhean cabhrach.', note: 'predicative adjective, not lenited' },
  { text: 'Cuideachta áitiúil atá i mbun an teach a thógáil.', note: 'nominative before a + verbal noun after a compound preposition' },
];

let engine: Gramadoir | undefined;
const complaints = (text: string) => {
  engine ??= new Gramadoir(loadData(path.join(root, 'data')), { fixSpelling: true });
  return analyse(text, engine.grammaticalErrors(foldForEngine(text))).views.filter((v) => !LEXICON_ONLY.has(v.rule));
};

describe('errors reported by the rules we added', () => {
  for (const c of cases) {
    it(`${c.text} (${c.section})`, { todo: c.reviewed ? undefined : NOT_REVIEWED }, () => {
      const views = complaints(c.text);
      assert.deepEqual(views.map((v) => `${v.rule} [${v.words}]`), [`${c.rule} [${c.words}]`]);
      const plan = firstFix(views[0], c.text);
      assert.equal(plan ? applyCorrection(c.text, plan.range, plan.word) : null, c.fixed);
    });
  }
});

describe('correct sentences near those rules are not flagged', () => {
  for (const c of clean) {
    it(`${c.text} (${c.note})`, { todo: c.reviewed ? undefined : NOT_REVIEWED }, () => {
      assert.deepEqual(complaints(c.text).map((v) => `${v.rule} [${v.words}]: ${v.msg}`), []);
    });
  }
});
