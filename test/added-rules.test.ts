// Cases worked through when we changed the rules in grammar/ (test/caighdean.test.ts
// covers the Caighdeán's own example sentences).
// - `cases`: each sentence breaks the rule of An Caighdeán Oifigiúil (2017) named with
//   it, and must get exactly the one message given, with the one-click fix shown
//   (null: the message is shown but no fix is offered).
// - `clean`: correct sentences, confirmed by a reviewer, that must not be flagged.
// Add error cases when a rule is changed. Correct sentences come from real text, not made up
// for the purpose: the Caighdeán's examples (test/caighdean/) and confirmed legislation
// (test/gaois/).
//
// The sentences and their classification (error or correct) were written while working
// on the rules, not taken from the Caighdeán. A case is enforced only once a reviewer has
// confirmed it, by adding `reviewed: true`; until then it runs as a todo (it is checked
// and reported, but does not fail the suite).
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
const LEXICON_ONLY = new Set(['ANAITHNID', 'ANKOTHVOS', 'UNKNOWN', 'MOLADH', 'GRAM', 'MOIRF', 'MOIRFREIMIR', 'COMHFHOCAL', 'COMHCHAIGH']);

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
  { section: '10.11.3', text: 'Tá sé le Aoife.', rule: 'PREFIXH', words: 'le Aoife', fixed: 'Tá sé le hAoife.' },
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
  // t- on aon, aonú, ochtú, ochtar, ochtó after an in the nominative, as before; not in the genitive after a noun (see clean)
  { section: '9.3.7(a)', text: 'Tá an aon leabhar amháin agam.', rule: 'PREFIXT', words: 'an aon leabhar', fixed: 'Tá an t-aon leabhar amháin agam.' },
  { section: '9.5.4(c)', text: 'Bhí an ochtú haois déag ann.', rule: 'PREFIXT', words: 'an ochtú haois', fixed: 'Bhí an t-ochtú haois déag ann.' },
  { section: '9.4.3(b)', text: 'Bhí an ochtar daltaí ann.', rule: 'PREFIXT', words: 'an ochtar', fixed: 'Bhí an t-ochtar daltaí ann.' },
  // ordinals above 100 (9.5.3): céad the cardinal unlenited, but lenited in the genitive; h after míliú
  { section: '9.5.4(d)', text: 'beithígh an céad is ceathrú feirmeoir', rule: 'CLAOCHLU', words: 'an céad', fixed: null },
  { section: '9.5.3', text: 'Seo an míliú eitilt.', rule: 'PREFIXH', words: 'an míliú eitilt', fixed: 'Seo an míliú heitilt.' },
  { section: '10.2.1', text: 'Bhí an céad fear ann.', rule: 'CLAOCHLU', words: 'an céad', fixed: null },
  { section: '9.2.3', text: 'Tá trí déag litir san fhocal seo.', rule: 'INPHRASE', words: 'trí déag', fixed: null },
  { section: '3.1.2', text: 'Chonaic mé fear sin inné.', rule: 'NEEDART', words: 'fear sin', fixed: 'Chonaic mé an fear sin inné.' },
  { section: '1.1.5(a)', text: 'Tháinig an Ombudsman isteach.', rule: 'PREFIXT', words: 'an Ombudsman', fixed: 'Tháinig an tOmbudsman isteach.' },
  { section: '1.1.4', text: 'Léigh mé na athbhreithnithe go léir.', rule: 'PREFIXH', words: 'na athbhreithnithe', fixed: 'Léigh mé na hathbhreithnithe go léir.' },
  // a list of adjectives after a masculine noun: a lenited one is still reported
  { section: '4.2', text: 'Chonaic mé fear láidir, chiallmhar inné.', rule: 'NISEIMHIU', words: 'chiallmhar', fixed: 'Chonaic mé fear láidir, ciallmhar inné.' },
  // ar líne is one adjective; without the article, seo still needs it
  { section: '3.1.2', text: 'Tá acmhainn ar líne seo ar fáil.', rule: 'NEEDART', words: 'acmhainn ar líne seo', fixed: null },
  // an ordinal may follow any preposition; an ordinary adjective is still reported
  { section: '9.5', text: 'Thug sé do mór é.', rule: 'CUPLA', words: 'do mór', fixed: null },
  // after the possessive dár (de/do + ár) a missing eclipsis is still reported; the particle dár takes a past verb
  { section: '8.3.5', text: 'Thugamar dár páistí é.', rule: 'URU', words: 'dár páistí', fixed: 'Thugamar dár bpáistí é.' },
  // céanna does not inflect; an adjective that does is still reported in the nominative
  { section: '4.3', text: 'Bhí sé ann oíche na gaoithe mór.', rule: 'GENITIVE', words: 'na gaoithe mór', fixed: null },
  // after gan a noun qualified by an adjective is not lenited; a verbal adjective starting its own phrase does not count
  { section: '1.2', text: 'Bhí sé gan bhia maith.', rule: 'NISEIMHIU', words: 'gan bhia maith', fixed: 'Bhí sé gan bia maith.' },
  // the article with Márta, Bealtaine, Meitheamh, Samhain and Nollaig after mí, and not with the others
  { section: '1.1.5(f)', text: 'Bhí sé ann i mí Bealtaine.', rule: 'NEEDART', words: 'mí Bealtaine', fixed: null },
  { section: '1.1.5(f)', text: 'Bhí sé ann i mí an Deireadh Fómhair.', rule: 'BADART', words: 'mí an Deireadh Fómhair', fixed: null },
  { section: '1.1.5(f)', text: 'Bhí sé ann i mí an Mheán Fómhair.', rule: 'BADART', words: 'mí an Mheán Fómhair', fixed: null },
  // CO17 chapter 1 review: gan + the article takes the nominative, so no eclipsis
  { section: '1.3.2', text: 'Bhí sé gan an gcarr.', rule: 'NIURU', words: 'gcarr', fixed: 'Bhí sé gan an carr.' },
  { section: '1.3.5', text: 'Tháinig sé fara na gardaí.', rule: 'BACHOIR', words: 'fara na', fixed: 'Tháinig sé fairis na gardaí.' },
  { section: '1.1.4', text: 'Labhair an t-Albanach liom.', rule: 'NOHYPHEN', words: 't-Albanach', fixed: null },
  { section: '1.1.5(i)', text: 'Is tír álainn í Frainc.', rule: 'NEEDART', words: 'Frainc', fixed: null },
  { section: '1.1.5(i)', text: 'Is tír álainn í an Frainc.', rule: 'SEIMHIU', words: 'an Frainc', fixed: null },
  { section: '1.1.5(i)', text: 'Is tír álainn í Albáin.', rule: 'NEEDART', words: 'Albáin', fixed: null },
  { section: '1.1.5(i)', text: 'Chuaigh sé go dtí Congó.', rule: 'NEEDART', words: 'Congó', fixed: null },
  { section: '1.1.5(i)', text: 'I Muir Chairib atá Bahámaí.', rule: 'NEEDART', words: 'Bahámaí', fixed: null },
  { section: '1.1.5(i)', text: 'Chuaigh sé go dtí an Iosrael.', rule: 'BADART', words: 'an Iosrael', fixed: null },
  { section: '1.3.2', text: 'Rinne sé mar an céanna.', rule: 'URU', words: 'mar an céanna', fixed: null },
  { section: '1.1.5(e)', text: 'Bhí mé ag caint leis an Dé Céadaoin seo caite.', rule: 'BADART', words: 'an Dé Céadaoin', fixed: null },
  { section: '1.1.5(e)', text: 'Tháinig sé Dé Déardaoin.', rule: 'BACHOIR', words: 'Dé Déardaoin', fixed: 'Tháinig sé Déardaoin.' },
  // CO17 chapter 5 review: the independent past, conditional and past habitual are lenited
  { section: '5.1.7', text: 'Siúlamar abhaile.', rule: 'SEIMHIU', words: 'Siúlamar', fixed: 'Shiúlamar abhaile.' },
  { section: '5.1.7', text: 'Beadh sé sásta.', rule: 'SEIMHIU', words: 'Beadh', fixed: 'Bheadh sé sásta.' },
  { section: '5.1.7', text: 'Tháinig sé agus ceannaigh sé carr.', rule: 'SEIMHIU', words: 'ceannaigh sé', fixed: null },
  { section: '5.1.7', text: 'Ól sé an bainne.', rule: 'PREFIXD', words: 'Ól sé', fixed: null },
  { section: '5.4.5(a)', text: 'Níor fhuair sé é.', rule: 'BACHOIR', words: 'Níor fhuair', fixed: 'Ní bhfuair sé é.' },
  { section: '5.4.5(b)', text: 'Ní dheirim é sin.', rule: 'NISEIMHIU', words: 'dheirim', fixed: 'Ní deirim é sin.' },
  { section: '5.1.10', text: 'Táimid muid anseo.', rule: 'MUID', words: 'Táimid muid', fixed: null },
  // the unmutated subjunctive read as a noun, shown to be a verb by its subject pronoun
  { section: '5.1.5', text: 'Mura cuire tú, ní bhainfidh tú.', rule: 'URU', words: 'Mura cuire tú', fixed: null },
  // the relative a + a past that is also a noun or an imperative; m and s take lenition
  { section: '5.1.8', text: 'Tá an fear a ceannaigh an carr anseo.', rule: 'CLAOCHLU', words: 'a ceannaigh', fixed: null },
  { section: '5.1.8', text: 'Sin an fear a mol an obair.', rule: 'SEIMHIU', words: 'a mol', fixed: 'Sin an fear a mhol an obair.' },
  // CO17 chapter 9 review
  { section: '9.3.1(f)', text: 'Tá ceithre leabhar dhéag agam.', rule: 'NISEIMHIU', words: 'leabhar dhéag', fixed: 'Tá ceithre leabhar déag agam.' },
  { section: '9.3.5(b)', text: 'Dún na ocht bhfuinneog.', rule: 'PREFIXH', words: 'na ocht', fixed: 'Dún na hocht bhfuinneog.' },
  { section: '9.3.9(a)', text: 'Tá fiche bhád sa chuan.', rule: 'NISEIMHIU', words: 'fiche bhád', fixed: 'Tá fiche bád sa chuan.' },
  { section: '9.3.10(c)', text: 'Tá fiche a dhá bád sa chuan.', rule: 'BACHOIR', words: 'a dhá', fixed: 'Tá fiche a dó bád sa chuan.' },
  { section: '9.6.1', text: 'Tá ceithre cúigiú den obair déanta.', rule: 'SEIMHIU', words: 'ceithre cúigiú', fixed: 'Tá ceithre chúigiú den obair déanta.' },
  { section: '9.6.1', text: 'Tá naoi deichiú den obair déanta.', rule: 'URU', words: 'naoi deichiú', fixed: 'Tá naoi ndeichiú den obair déanta.' },
  // CO17 chapter 10 review
  { section: '10.2.5', text: 'Socraigh sí gan géilleadh.', rule: 'SEIMHIU', words: 'Socraigh sí', fixed: null },
  { section: '10.2.5', text: 'Bí mise anseo inné.', rule: 'SEIMHIU', words: 'Bí mise', fixed: null },
  { section: '10.2.2', text: 'Maith sibh, a feara!', rule: 'WEAKSEIMHIUVOC', words: 'a feara', fixed: 'Maith sibh, a fheara!' },
  // after seo/sin the article starts a new noun phrase: the nominative takes t- (1.2)
  { section: '1.2', text: 'Is é sin an ainm atá air.', rule: 'PREFIXT', words: 'an ainm', fixed: 'Is é sin an t-ainm atá air.' },
  // CO17 chapter 3 review: bí before a noun phrase is the past; the article before the genitive of Alban, Gaillimhe
  { section: '5.1.7', text: 'Bí na fir shlándála ar tí na doirse a dhúnadh.', rule: 'SEIMHIU', words: 'Bí na', fixed: 'Bhí na fir shlándála ar tí na doirse a dhúnadh.' },
  { section: '3.1.4', text: 'Bhuaigh foireann Alban an cluiche.', rule: 'NEEDART', words: 'Alban', fixed: null },
  { section: '3.1.4', text: 'Tá sé i lár cathair Gaillimhe.', rule: 'NEEDART', words: 'Gaillimhe', fixed: null },
  // CO17 chapter 4 review
  { section: '4.3.5', text: 'Maidin sách fuar a bí ann.', rule: 'SEIMHIU', words: 'a bí', fixed: 'Maidin sách fuar a bhí ann.' },
  { section: '4.8.1', text: 'Bhí sé ní ba mór ná sin.', rule: 'SEIMHIU', words: 'ní ba mór', fixed: 'Bhí sé ní ba mhór ná sin.' },
  // CO17 chapter 11 review
  { section: '11.9', text: 'Ní dearna mé aon ní.', rule: 'SEIMHIU', words: 'Ní dearna mé', fixed: 'Ní dhearna mé aon ní.' },
  { section: '11.3.1(f)', text: 'Cad ina thaobh a dearna tú sin?', rule: 'URU', words: 'a dearna tú', fixed: 'Cad ina thaobh a ndearna tú sin?' },
  { section: '11.2.1(f)', text: 'Déanfar an obair de réir a céile.', rule: 'SEIMHIU', words: 'de réir a céile', fixed: 'Déanfar an obair de réir a chéile.' },
  // CO17 chapter 8 review
  { section: '8.2.2', text: 'Chonaic mé tú inné.', rule: 'SEIMHIU', words: 'Chonaic mé tú', fixed: 'Chonaic mé thú inné.' },
  { section: '8.2.2', text: 'Aithním tú go maith.', rule: 'SEIMHIU', words: 'Aithním tú', fixed: 'Aithním thú go maith.' },
  { section: '8.3.1', text: 'Chaill siad a cluichesean.', rule: 'CLAOCHLU', words: 'a cluichesean', fixed: null },
  { section: '8.3.2', text: 'Tá a teach siadsan mór.', rule: 'CLAOCHLU', words: 'a teach siadsan', fixed: null },
  { section: '8.5.1', text: 'Cad mar geall ar an gceann seo?', rule: 'SEIMHIU', words: 'mar geall', fixed: 'Cad mar gheall ar an gceann seo?' },
  // CO17 chapter 7 review
  { section: '7.2.2', text: 'Dúirt Eoin go mba cheart é a díol.', rule: 'SEIMHIU', words: 'é a díol', fixed: 'Dúirt Eoin go mba cheart é a dhíol.' },
  { section: '7.2.3', text: 'Sin an carr ba cheart duit a ceannach.', rule: 'SEIMHIU', words: 'duit a ceannach', fixed: 'Sin an carr ba cheart duit a cheannach.' },
  { section: '7.3.1', text: 'Cár tairbhe duit é?', rule: 'SEIMHIU', words: 'Cár tairbhe', fixed: 'Cár thairbhe duit é?' },
  // CO17 chapters 6 and 2 review
  { section: '6.1.1(d)', text: 'Cén caoi a bhfuil tú?', rule: 'SEIMHIU', words: 'Cén caoi', fixed: 'Cén chaoi a bhfuil tú?' },
  // a lenited noun opening a clause before the article: a noun used for the verb (a hint)
  { section: '5.1.7', text: 'Thuairisc an fear go raibh sé tinn.', rule: 'WEAKNOUNVERB', words: 'Thuairisc an', fixed: null },
  { section: '6.1.1(f)', text: 'Ba ghá dóibh dréimire níos fearr a fáil.', rule: 'SEIMHIU', words: 'níos fearr a fáil', fixed: 'Ba ghá dóibh dréimire níos fearr a fháil.' },
  { section: '7.3.4', text: 'Murar comhalta cláraithe é, ní raibh aon seans aige.', rule: 'SEIMHIU', words: 'Murar comhalta', fixed: 'Murar chomhalta cláraithe é, ní raibh aon seans aige.' },
  { section: '7.3.5', text: "Dá b'fhear saibhir é, thabharfadh sé síntiús.", rule: 'URU', words: "Dá b'fhear", fixed: "Dá mb'fhear saibhir é, thabharfadh sé síntiús." },
  { section: '8.6.3', text: "Rinne sé d'aon gnó é.", rule: 'SEIMHIU', words: "d'aon gnó", fixed: "Rinne sé d'aon ghnó é." },
  { section: '10.2.8', text: 'Deir sé go fuil na leabhair léite aige.', rule: 'URU', words: 'go fuil', fixed: 'Deir sé go bhfuil na leabhair léite aige.' },
  { section: '10.6.5', text: 'Cá fios dom?', rule: 'URU', words: 'Cá fios', fixed: 'Cá bhfios dom?' },
  { section: '10.11.1', text: 'Cliceáil faoi dó ar na híomhánna.', rule: 'SEIMHIU', words: 'faoi dó', fixed: 'Cliceáil faoi dhó ar na híomhánna.' },
  { section: '10.14.1', text: 'Níl a fios agam.', rule: 'SEIMHIU', words: 'a fios agam', fixed: null },
  { section: '10.12.3', text: 'Fuair sí bus a aon déag.', rule: 'PREFIXH', words: 'a aon déag', fixed: null },
  // the singular after a multiple of ten (9.3.9(a)); a fraction's plural ordinal denominator is allowed (see clean)
  { section: '9.3.9(a)', text: 'Tá caoga cístí milse ann.', rule: 'UATHA', words: 'caoga cístí', fixed: null },
  // sé at the start of a clause before a noun is the number, so the noun's missing lenition is reported
  { section: '9.3.3', text: 'Sé bairille a bhí ann.', rule: 'SEIMHIU', words: 'Sé bairille', fixed: 'Sé bhairille a bhí ann.' },
  // a weak genitive plural takes a singular adjective, as before, except after beirt (see clean)
  { section: '4.2.5', text: 'Tá cumas na bhfear óga níos airde.', rule: 'UATHA', words: 'bhfear óga', fixed: null },
  // ag + a feminine verbal noun in -irt: the genitive is not lenited, as before (beirt is not a verbal noun)
  { section: '10.2.7(h)', text: 'Tá sé ag baint mhóna.', rule: 'NISEIMHIU', words: 'ag baint mhóna', fixed: 'Tá sé ag baint móna.' },
  // a before a verbal noun in -ú is still the particle, so lenition is required (only an adjective-tagged ordinal makes it the possessive)
  { section: '10.2.1', text: 'Moladh do na heolaithe spóir beacán a bailiú.', rule: 'SEIMHIU', words: 'a bailiú', fixed: 'Moladh do na heolaithe spóir beacán a bhailiú.' },
  // the ordinal céad after a number but no article, as before
  { section: '10.2.1', text: 'Bhí an chéad cruinniú ann.', rule: 'SEIMHIU', words: 'chéad cruinniú', fixed: 'Bhí an chéad chruinniú ann.' },
  // dosaen + a noun with no genitive plural of the same spelling: still reported; an ordinary plural after a figure, as before
  { section: '9.3.9', text: 'Bhí dosaen ubh ann.', rule: 'GENITIVE', words: 'dosaen ubh', fixed: null },
  { section: '9.3.12', text: 'Tá 5 cathaoireacha ann.', rule: 'UATHA', words: '5 cathaoireacha', fixed: null },
  // seisean after a noun with no possessive, as before; eo and iúd after is (8.6.2); ní + iúd needs h; faoi a outside a question
  { section: '8.2.5', text: 'Chonaic mé an fear seisean.', rule: 'BACHOIR', words: 'fear seisean', fixed: 'Chonaic mé an fear eisean.' },
  { section: '8.6.2', text: 'Is iúd é.', rule: 'BACHOIR', words: 'Is iúd', fixed: 'Siúd é.' },
  { section: '8.6.2', text: 'Is eo é.', rule: 'BACHOIR', words: 'Is eo', fixed: 'Seo é.' },
  { section: '10.13.2', text: 'Ní iúd é.', rule: 'PREFIXH', words: 'Ní iúd', fixed: 'Ní hiúd é.' },
  { section: '8.3.8', text: 'Cuireann sí a neart faoi a coim.', rule: 'BACHOIR', words: 'faoi a', fixed: 'Cuireann sí a neart faoina coim.' },
  // an emphatic form is tagged as its noun, so the mutation rules apply to it; a known word is not split (daoine)
  { section: '8.3.1', text: 'Chaill siad ár páircne.', rule: 'URU', words: 'ár páircne', fixed: 'Chaill siad ár bpáircne.' },
  { section: '9.4.3', text: 'Níl a fhios agam cé mhéad daoine a bhí ann.', rule: 'UATHA', words: 'cé mhéad daoine', fixed: null },
  // na + a singular noun, as before; the place name Garraithe Náisiúnta na Lus is the exception
  { section: '1.6', text: 'Chonaic mé na lus.', rule: 'BACHOIR', words: 'na lus', fixed: 'Chonaic mé an lus.' },
  // the adjective after a number is still lenited after an ordinary noun (9.3.3)
  { section: '9.3.3', text: 'Bhí seacht leabhar móra ann.', rule: 'SEIMHIU', words: 'seacht leabhar móra', fixed: 'Bhí seacht leabhar mhóra ann.' },
  // an + a lenited personal number, not after a noun (nominative)
  { section: '9.4.2(b)', text: 'Chonaic mé an cheathrar.', rule: 'NISEIMHIU', words: 'an cheathrar', fixed: 'Chonaic mé an ceathrar.' },
  // t before a masculine noun in s, in the nominative (it belongs to the genitive and to
  // the dative of Córas an tSéimhithe)
  { section: '1.2, 1.7.4', text: 'Tá an tsalann ar an mbord.', rule: 'NITEE', words: 'tsalann', fixed: 'Tá an salann ar an mbord.' },
  { section: '1.2, 1.7.4', text: 'Tá an tSeapánach anseo.', rule: 'NITEE', words: 'tSeapánach', fixed: 'Tá an Seapánach anseo.' },
  // fairis an takes the dative like leis an
  { section: '1.3.5, 1.4.1', text: 'Rinne sé fairis an fear é.', rule: 'CLAOCHLU', words: 'fairis an fear', fixed: null },
  // Óman, a country name without the article
  { section: '1.1.5(i)', text: 'Tá sé san Óman.', rule: 'BADART', words: 'san Óman', fixed: 'Tá sé in Óman.' },
  // Oman, which CO17 spells Óman
  { section: '1.1.5(i)', text: 'Tá sé in Oman.', rule: 'CAIGHDEAN', words: 'Oman', fixed: 'Tá sé in Óman.' },
  { section: '1.1.5(i)', text: 'Chuaigh mé go hOman.', rule: 'CAIGHDEAN', words: 'hOman', fixed: 'Chuaigh mé go hÓman.' },
  // á + verbal noun with a pronoun object, unless the pronoun is the object of a verbal noun after it
  { section: '11.3.1(b)', text: 'Bhí sé ag moladh í.', rule: 'BACHOIR', words: 'ag moladh í', fixed: null },
  // nach before the autonomous past (nár craoladh); an eclipsed form is the past habitual
  { section: '11.6.2(a)', text: 'Sin é an stáisiún nach craoladh an clár.', rule: 'BACHOIR', words: 'nach craoladh', fixed: 'Sin é an stáisiún nár craoladh an clár.' },
  // the dependent form after fáth, which the interjected clause exception leaves alone
  { section: '11.3.1(h)', text: 'Cén fáth a chuaigh siad ann?', rule: 'RELATIVE', words: 'a chuaigh', fixed: null },
  // a hint after áit, fáth, caoi ...: ar unless the noun is the verb's object
  { section: '11.3.1(h)', text: 'Cén áit a chuir tú é?', rule: 'WEAKBACHOIRAR', words: 'a chuir', fixed: 'Cén áit ar chuir tú é?' },
  // Citizens Information: a noun after the article that depends on the noun before it, in the
  // nominative instead of the genitive (CO17 1.5.1, 1.5.2); a hint; its fix (the genitive) is tested in test/forms.test.ts
  { section: '1.5.1', text: "Tugtar an fhoirm seo don mháthair san ospidéal agus ba chóir é a chomhlánú agus thabhairt ar ais d'fhoireann an ospidéal sula scaoiltear amach í.", rule: 'WEAKGENITIVE', words: 'an ospidéal', fixed: null },
  // the clause only: the sentence's other flag (NIDEE: words are missing before d'fheithicil) is
  // not this rule's. After bí, which takes no object (clárú an athraithe)
  { section: '1.5.1', text: "go dtí go mbeidh clárú an athrú úinéireachta imithe tríd.", rule: 'WEAKGENITIVE', words: 'an athrú', fixed: null },
  { section: '1.5.1', text: "Cruthófar é seo trí chónaí inríofa a bheith orthu in Éirinn ar feadh 3 bliana as na 4 bliana roimh bhreith an leanbh.", rule: 'WEAKGENITIVE', words: 'an leanbh', fixed: null },
  { section: '1.5.1', text: "Ní gá go bhfuil na páistí i dteideal an chuid eile.", rule: 'WEAKGENITIVE', words: 'an chuid', fixed: null },
  { section: '1.5.1', text: "Déanfar scrúdú ar do charr chun a chinntiú go bhfuil tú ag íoc an Cháin chláraithe feithiclí ceart.", rule: 'WEAKGENITIVE', words: 'an Cháin', fixed: null },
  { section: '1.5.1', text: "Má rinne tú go leor ranníocaíochtaí ÁSPC i rith do bhlianta oibre, ag aois 66 d'fhéadfá a bheith i dteideal an Pinsean Stáit (ranníocach) a fháil.", rule: 'WEAKGENITIVE', words: 'an Pinsean', fixed: null },
  // Citizens Information, Coimisinéir Teanga: a noun spelt like its genitive, without the first letter
  // the genitive takes after an (CO17 10.9.1, Tábla 1F: an fhostaí) or the article na (na méide)
  { section: '1.5.1', text: "Íocaíocht chnapshuime bunaithe ar phá an fostaí is ea an íocaíocht reachtúil iomarcaíochta.", rule: 'WEAKGENITIVE', words: 'an fostaí', fixed: null },
  { section: '1.5.1', text: "Chun an méid sin a mheas, ba ghá féachaint ar an dualgas a bhí leagtha ar an Roinn de thoradh an méid a bhí daingnithe ina scéim teanga.", rule: 'WEAKGENITIVE', words: 'an méid', fixed: null },
  // Coimisinéir Teanga: fáisceadh as the verbal noun, which FGB gives as = fáscadh (FGB fáisc: vn.
  // fáscadh); it was read as a past verb and asked for d'. The part after brúscar, which has a flag
  // of its own (the sentence: Is féidir trealamh mór a úsáid le brúscar a fháisceadh agus ...)
  { section: 'FGB', text: 'a fháisceadh agus mar sin a thoirt a laghdú.', rule: 'CAIGHDEAN', words: 'a fháisceadh', fixed: 'a fháscadh agus mar sin a thoirt a laghdú.' },
  // made up: the same after á (his, her, their)
  { section: 'FGB', text: 'Bhí sé á fháisceadh.', rule: 'CAIGHDEAN', words: 'á fháisceadh', fixed: 'Bhí sé á fháscadh.' },
  { section: 'FGB', text: 'Bhí sí á fáisceadh.', rule: 'CAIGHDEAN', words: 'á fáisceadh', fixed: 'Bhí sí á fáscadh.' },
  { section: 'FGB', text: 'Bhí siad á bhfáisceadh.', rule: 'CAIGHDEAN', words: 'á bhfáisceadh', fixed: 'Bhí siad á bhfáscadh.' },
  // Gaois (Acts): the indirect ar after uair, where CO17 11.2.1(d) has the direct relative; the part of
  // the sentence around it (the sentence has ón uair a thosaigh before it, and another flag)
  { section: '11.2.1(d)', text: "nó ón uair ar déileáladh leis, de bhua fheidhmiú an ailt seo roimhe sin, mar dhuine a thosaigh á seoladh", rule: 'BACHOIR', words: 'uair ar', fixed: "nó ón uair a déileáladh leis, de bhua fheidhmiú an ailt seo roimhe sin, mar dhuine a thosaigh á seoladh" },
  // made up, from the CO17 11.2.1(d) examples
  { section: '11.2.1(d)', text: "An cuimhin leat an uair ar chuamar go dtí an Spáinn?", rule: 'BACHOIR', words: 'uair ar', fixed: "An cuimhin leat an uair a chuamar go dtí an Spáinn?" },
  { section: '11.2.1(d)', text: "An cuimhin leat an uair ar thit an crann?", rule: 'BACHOIR', words: 'uair ar', fixed: "An cuimhin leat an uair a thit an crann?" },
  { section: '11.2.1(d)', text: "Inseoidh mé an scéal duit nuair ar tháinig sé.", rule: 'BACHOIR', words: 'nuair ar', fixed: "Inseoidh mé an scéal duit nuair a tháinig sé." },
  { section: '11.2.1(d)', text: "Nuair ar tháinig sé abhaile, bhí sé tuirseach.", rule: 'BACHOIR', words: 'Nuair ar', fixed: "Nuair a tháinig sé abhaile, bhí sé tuirseach." },
  // Citizens Information: the object before a + a verbal noun is nominative after a noun too (CO17 3.3.2(a))
  { section: '3.3.2(a)', text: 'Má tá an praghas níos lú, tá tú fós faoi dhliteanas an easnamh a aisíoc.', rule: 'PREFIXT', words: 'an easnamh', fixed: 'Má tá an praghas níos lú, tá tú fós faoi dhliteanas an t-easnamh a aisíoc.' },
  // Citizens Information: the prefix t written without its hyphen before a lowercase vowel (CO17 1.1.4)
  { section: '1.1.4', text: 'Tabhair faoi deara nach dtugann an táireamhán iomarcaíochta ar líne aon teidlíocht maidir le méid na hiomarcaíochta reachtúla.', rule: 'CAIGHDEAN', words: 'táireamhán', fixed: 'Tabhair faoi deara nach dtugann an t-áireamhán iomarcaíochta ar líne aon teidlíocht maidir le méid na hiomarcaíochta reachtúla.', reviewed: true },
  // Citizens Information: a plural after dhá to sé, which take the singular (reported as missing lenition before)
  { section: '9.3.1(h)', text: "Déanann an tAcht um Eagrú Ama Oibre 1997 foráil do bhunshaoire íoctha de cheithre seachtainí in aghaidh na bliana, ach d'fhéadfadh cearta breise a bheith i gconradh an fhostaí.", rule: 'UATHA', words: 'cheithre seachtainí', fixed: null },
  { section: '9.3.1(h)', text: 'Caithfidh tú an achainí a fhíorú trí Mhionnscríbhinn, in éineacht le deimhnithe FITNESS sínithe ag 6 ball den ghairm dlí agus ag sé Ceannairí den phobal gnó áitiúil.', rule: 'UATHA', words: 'sé Ceannairí', fixed: null },
  // Citizens Information and Gaois: a nominative noun after the noun it depends on (a hint; no fix offered)
  { section: '1.5.1(a)', text: 'Íocann an Stát an naíonra nó an tseirbhís cúram lae as na huaireanta COLÓ sin trí mheán táille caipitíochta.', rule: 'WEAKGENITIVE', words: 'tseirbhís cúram', fixed: null },
  { section: '1.5.1(a)', text: 'Má roghnaíonn tú teach altranais príobháideach, íocfaidh tú an ranníocaíocht chuig an soláthraí teach altranais gach seachtain agus íocfaidh an Stát an t-iarmhéid ar do shon.', rule: 'WEAKGENITIVE', words: 'soláthraí teach', fixed: null },
  { section: '1.5.1(a)', text: 'Beidh táille sa bhreis ar shearmanas pháirtnéireacht shibhialta a reáchtáiltear i suíomh seachas oifig an Chláraitheora.', rule: 'WEAKGENITIVE', words: 'shearmanas pháirtnéireacht', fixed: null },
  { section: '1.5.1(a)', text: 'Teorainn a chur le méid faoiseamh áirithe a mbaineann pearsana aonair áirithe a thuilleann mór-ioncam leas astu.', rule: 'WEAKGENITIVE', words: 'méid faoiseamh', fixed: null },
  { section: '1.5.1(a)', text: 'Oibreacha a dhéanann difear do shainghné déanmhas cosanta nó déanmhas cosanta beartaithe.', rule: 'WEAKGENITIVE', words: 'shainghné déanmhas', fixed: null },
  // a masculine genitive plural after na, but not a nominative
  { section: '2.1.3(b)', text: 'Tá na neach anseo.', rule: 'NOGENITIVE', words: 'Tá na neach', fixed: null },
  // a hyphen after fo- that 2.1.7(d) does not call for: the fix keeps the prefix
  { section: '2.1.7(d)', text: 'Bhí fo-ráiteas ann.', rule: 'CAIGHDEAN', words: 'fo-ráiteas', fixed: 'Bhí foráiteas ann.' },
  // the autonomous form takes the object pronoun, and the rule still sees it before sé
  { section: '5.1.7', text: 'Rinneadh sé inné.', rule: 'BACHOIR', words: 'Rinneadh sé', fixed: 'Rinneadh é inné.' },
  // ag + verbal noun + pronoun, still read as a noun after the verb-before-pronoun tagging
  { section: '5.5', text: 'Bhí sé ag moladh mé.', rule: 'BACHOIR', words: 'ag moladh mé', fixed: null },
  // a doubled direction outside a compass point (Tábla 6C)
  { section: 'Tábla 6C', text: 'Chuaigh sé siar siar.', rule: 'DUBAILTE', words: 'siar siar', fixed: 'Chuaigh sé siar.' },
  // the genitive after tar éis / le linn when no verbal noun follows the noun in its clause (3.3.2(a))
  { section: '3.3.2(a)', text: 'Tháinig sé abhaile tar éis an cruinniú, agus é ag iarraidh dul a chodladh.', rule: 'SEIMHIU', words: 'an cruinniú', fixed: 'Tháinig sé abhaile tar éis an chruinniú, agus é ag iarraidh dul a chodladh.' },
  { section: '3.3.2(a)', text: 'Bhí sé ag caint le linn an cluiche a bhí ar siúl.', rule: 'SEIMHIU', words: 'an cluiche', fixed: 'Bhí sé ag caint le linn an chluiche a bhí ar siúl.' },
  // a + verbal noun after a compound preposition that does not govern such a clause: the object
  // is the noun before it, and the noun after the preposition is still the genitive
  { section: '3.3.2(a)', text: 'Maoin de chuid an rialtas a aistriú.', rule: 'GENITIVE', words: 'de chuid an rialtas', fixed: null },
  // a lenited adjective that describes neither noun: lampa (masculine nominative) nor the feminine genitive
  { section: '4.2', text: 'Bhí lampa comharthaíochta cheadaithe ar an mbád.', rule: 'NISEIMHIU', words: 'cheadaithe', fixed: 'Bhí lampa comharthaíochta ceadaithe ar an mbád.' },
  // a subject pronoun after a noun, not a verb
  { section: '8.1', text: 'Chuaigh an fear agus sí go dtí an siopa.', rule: 'BACHOIR', words: 'agus sí', fixed: 'Chuaigh an fear agus í go dtí an siopa.' },
  // a hint: dá "if" with a tense other than the conditional, or dá = de/do + a (11.6.1(c))
  { section: '11.6.1(c)', text: 'Dá ndéanann sé é, beidh áthas orm.', rule: 'WEAKBACHOIRMA', words: 'Dá ndéanann', fixed: 'Má dhéanann sé é, beidh áthas orm.' },
  // an old dative outside its set phrase
  { section: '2.3.3(b)', text: 'Bhí gealaigh ann.', rule: 'NODATIVE', words: 'gealaigh', fixed: null },
  // the special plural after a number (CO17 9.3.2); the ocht rule lacked </N> and never fired
  { section: '9.3.2', text: 'Bhí ocht n-orlach ann.', rule: 'BACHOIR', words: 'ocht n-orlach', fixed: 'Bhí ocht n-orlaí ann.' },
  // Book examples with a mutation taken out (test/caighdean/variants.tsv): a root form after gur or
  // nár is a past tense without its lenition (it was BACHOIR{go} / BACHOIR{nach}, whose fix gave
  // go tuig, nach pós)
  { section: '10.4.2', text: 'Sílim gur tuig sé mé.', rule: 'SEIMHIU', words: 'gur tuig', fixed: 'Sílim gur thuig sé mé.' },
  { section: '10.4.2', text: 'Nár pós sé riamh?', rule: 'SEIMHIU', words: 'Nár pós', fixed: 'Nár phós sé riamh?' },
  // dearna with sé tagged as the number six (it was SEIMHIU on the adjective)
  { section: '8.2.4', text: 'An dearna sé an dinnéar?', rule: 'URU', words: 'An dearna sé', fixed: 'An ndearna sé an dinnéar?' },
  { section: 'Tábla 5R', text: 'ní dearna sé', rule: 'SEIMHIU', words: 'ní dearna sé', fixed: 'ní dhearna sé' },
  // na (genitive feminine) + aon: h, not "an" (it was BACHOIR{an})
  { section: '9.3.7', text: 'costas na aon fhuinneoige amháin', rule: 'PREFIXH', words: 'na aon fhuinneoige', fixed: 'costas na haon fhuinneoige amháin' },
  // A unit of several words (comhshuite): the fix mutates its first word (it changed the last:
  // Átha gCliath, chun gcinn)
  { section: '3.3.11', text: 'Tá an-chuid foirgnimh cháiliúla i Baile Átha Cliath.', rule: 'URU', words: 'i Baile Átha Cliath', fixed: 'Tá an-chuid foirgnimh cháiliúla i mBaile Átha Cliath.' },
  { section: '3.3.1', text: 'luas ár dul chun cinn', rule: 'URU', words: 'ár dul chun cinn', fixed: 'luas ár ndul chun cinn' },
  // méad after cá, cé, dá: lenition (it was CAIGHDEAN{méid, mhéid})
  { section: '11.9', text: 'Cá méad leabhar atá agat?', rule: 'SEIMHIU', words: 'Cá méad', fixed: 'Cá mhéad leabhar atá agat?' },
  { section: '4.8.3', text: 'dá méad airgead a bhí aici', rule: 'SEIMHIU', words: 'dá méad', fixed: 'dá mhéad airgead a bhí aici' },
  // Unmutated forms of irregular verbs: the mutated form (they were the rare nouns cuail, feac, cuach)
  { section: 'Tábla 5Q', text: 'cuala mé', rule: 'CAIGHDEAN', words: 'cuala', fixed: 'chuala mé' },
  { section: 'Tábla 5T', text: 'go feice tú', rule: 'CAIGHDEAN', words: 'feice', fixed: 'go bhfeice tú' },
  { section: 'Tábla 5X', text: 'cuaigh mé', rule: 'CAIGHDEAN', words: 'cuaigh', fixed: 'chuaigh mé' },
  // muna is the non-standard spelling of mura (FGB: muna, ~b = mura, -b): only muna is flagged,
  // not the eclipsis after it
  { section: '5.1.5', text: 'muna bhfuil sé ann', rule: 'CAIGHDEAN', words: 'muna', fixed: 'mura bhfuil sé ann' },
  // a feminine noun after a preposition and the article takes the dative rule, not the
  // nominative one (leis an bhféile, leis an mbunscoil); the message offers no single fix
  { section: '1.4', text: 'chomh leathan leis an farraige', rule: 'CLAOCHLU', words: 'leis an farraige', fixed: null },
  // the object of an autonomous verb is thú (the book's sentence with tú for thú)
  { section: '8.2.2', text: 'An é sin an áit ar rugadh tú?', rule: 'BACHOIR', words: 'rugadh tú', fixed: 'An é sin an áit ar rugadh thú?' },
  // fail for fáil after ar is reported as such, not as a missing lenition (the rule's own example)
  { section: 'FGB fáil', text: 'Tá treoirlínte mionsonraithe curtha ar fail ag an gCoimisiún.', rule: 'IONADAI', words: 'ar fail', fixed: 'Tá treoirlínte mionsonraithe curtha ar fáil ag an gCoimisiún.' },
  // the second part of a compound is lenited after a first part the word list shows in lenited
  // compounds (Citizens Information sentences)
  { section: '10.2.12', text: 'Is forbhreathnú é seo a leanas ar na príomhforálacha den dlí a bhaineann leis na caighdeáin sin.', rule: 'COMHSEIMHIU', words: 'príomhforálacha', fixed: 'Is forbhreathnú é seo a leanas ar na príomhfhorálacha den dlí a bhaineann leis na caighdeáin sin.' },
  { section: '10.2.12', text: "Is féidir le céile colscartha nó iar-páirtnéirí sibhialta iarratas a dhéanamh sa chúirt ar ordú cothabhála nó ar leagan d'ordú cothabhála tar éis don fhoraithne colscartha/díscaoilte a bheith deonta.", rule: 'COMHSEIMHIU', words: 'iar-páirtnéirí', fixed: "Is féidir le céile colscartha nó iar-pháirtnéirí sibhialta iarratas a dhéanamh sa chúirt ar ordú cothabhála nó ar leagan d'ordú cothabhála tar éis don fhoraithne colscartha/díscaoilte a bheith deonta." },
];

// Correct sentences close to what the rules above (and our exceptions) are about,
// checked by hand when the rules were written: none of them may be flagged. The
// note says what each guards against.
const clean: { text: string; note: string; reviewed?: boolean }[] = [
  { text: 'Tharla sé le linn an cluiche a imirt.', note: 'nominative before a + verbal noun, though the genitive is spelt the same', reviewed: true },
  // Gaois: díreach before a preposition is the adverb (FGB díreach2, sense 2), not an adjective
  // to lenite after a number or a feminine noun
  { text: 'Ní foláir oibleagáid faoin alt seo a chomhlíonadh laistigh den tréimhse 5 lá díreach i ndiaidh an lae a dtagann sí i gceist.', note: 'díreach i ndiaidh: adverb, after a number in figures' },
  { text: 'Má thoilíonn siad go léir amhlaidh, beidh éifeacht leis an rogha díreach tar éis an toiliú is déanaí de na toilithe sin a thabhairt.', note: 'díreach tar éis: adverb, after a feminine noun' },
  // Citizens Information: a year in figures is not a count, so the plural after it stands
  { text: 'Rinne An tAcht um Chlárú Sibhialta 2004 athruithe ar chuid de na rialacha maidir le clárú breithe.', note: '2004 is the year of the Act' },
  // Citizens Information: a genitive after a noun takes no t- (CO17 10.9.1(a)); a + a verbal noun takes no d'
  { text: "Rialacha Cláraíonn an comhlacht a n-íocann tú cíos líne leo do rogha gan ' glaonna fuara ' a fháil ar Bhunachar Sonraí an Eolaire Náisiúnta.", note: 'an Eolaire: the genitive, which is spelt like the nominative' },
  { text: 'Féadfaidh tú leanúint le do chárta éagtha a úsáid fad a bhíonn athbhreithniú ar bun, a fhad agus a bhíonn baint agat sa phróiseas athbhreithnithe.', note: "a úsáid: a + verbal noun, not the relative with the past (a d'úsáid)" },
  // Gaois and Citizens Information: a lenited adjective whose lenition is correct but which the
  // general adjective rule (NISEIMHIU adj-lenition) reported
  { text: 'Iarratas ar shásamh i leith comhchónaitheora cháilithe atá i gcleithiúnas go heacnamaíoch.', note: 'after a word not in the dictionary: its gender is unknown' },
  { text: 'Tiocfaidh an Coinbhinsiún seo i bhfeidhm trí mhí tar éis a dhaingnithe thar ceann dhá Ard-Pháirtí Chonarthacha.', note: 'after a word not in the dictionary: its gender is unknown' },
  { text: 'Bhí sé riachtanach roimh 2007 go mbeadh an duine seo gaolmhar leat nó mar chleithiúnach agat, féach thíos.', note: 'mar lenites the adjective used as a noun (10.2.5(a))' },
  { text: 'Is é an t-aon cheart a bheidh agat ar shásamh ná sa chás go ndíoltar an carr le locht a chuirfeadh daoine a bheadh á tiomáint i gcontúirt.', note: 'aon lenites ceart, the noun (10.2.4(a))' },
  { text: 'Dualgas iniúchóirí mura bhfuil leabhair chuntais chuí á gcoimeád.', note: 'chuntais is the genitive noun, not the verb: chuí after it' },
  { text: 'Tá eolas maidir le gearán a dhéanamh maidir le seirbhísí sláinte agus cúraim shóisialta ag healthcomplaints.ie.', note: 'cúraim is the genitive of cúram, not a verb' },
  { text: 'Má theastaíonn comhairle dlí nó ghairmiúil eile uait, ba cheart duit dul i gcomhairle le duine a bhain na cáilíochtaí cearta amach.', note: 'adjective joined by nó to the genitive after a feminine noun (4.2)' },
  // Liam (2026-11-25). A compound with a prefix and a mutation reaches its root (pictiúrlann)
  // before the spelling rule for a long vowel before r + consonant (grammar/morph-ga.txt, end)
  { text: 'Chuaigh mé go dtí an tseanphictiúrlann.', note: 'an tseanphictiúrlann: t- and sean- + pictiúrlann, not a misspelling', reviewed: true },
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

// The reason shown with an error (grammar/reasons.tsv) and the section a case is filed under:
// 10.13.2 is matched by a reason citing 10.13.2 or 10.13; 10.6.4(a)(ii) by one citing 10.6.4(a).
// A mismatch is listed, not failed: a general reason (an t- before a masculine vowel, 10.9.1) is
// often right for a case filed under the specific section it came from (9.4.3(b), an t-ochtar).
// Read the list when assigning reasons; it found a case filed under the wrong section.
describe('the reasons shown and the sections cited', () => {
  it('cases whose reason cites another section', (t) => {
    const reasons: Record<string, { co17?: string }> = JSON.parse(fs.readFileSync(path.join(root, 'data', 'rules', 'reasons.json'), 'utf8'));
    const bare = (s: string) => s.replace(/^Tábla /, '').trim();
    const covers = (cited: string, section: string) => {
      const a = bare(cited), b = bare(section);
      return b === a || b.startsWith(a + '.') || b.startsWith(a + '(') || a.startsWith(b + '(');
    };
    const wrong: string[] = [];
    for (const c of cases) {
      const v = complaints(c.text)[0];
      if (!v?.reason || v.rule !== c.rule) continue;
      const cited = (reasons[v.reason]?.co17 ?? '').split(',');
      if (!cited.some((s) => covers(s, c.section))) wrong.push(`${c.text} (${c.section}): ${v.reason} cites ${cited.join(',')}`);
    }
    for (const w of wrong) t.diagnostic(w);
  });
});

describe('correct sentences near those rules are not flagged', () => {
  for (const c of clean) {
    it(`${c.text} (${c.note})`, { todo: c.reviewed ? undefined : NOT_REVIEWED }, () => {
      assert.deepEqual(complaints(c.text).map((v) => `${v.rule} [${v.words}]: ${v.msg}`), []);
    });
  }
});
