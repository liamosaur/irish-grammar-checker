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
  // t- on aon, aonú, ochtú, ochtar, ochtó after an in the nominative, as before; not in the genitive after a noun (see clean)
  { section: '9.3.7(a)', text: 'Tá an aon leabhar amháin agam.', rule: 'PREFIXT', words: 'an aon leabhar', fixed: 'Tá an t-aon leabhar amháin agam.' },
  { section: '9.5.4(c)', text: 'Bhí an ochtú haois déag ann.', rule: 'PREFIXT', words: 'an ochtú haois', fixed: 'Bhí an t-ochtú haois déag ann.' },
  { section: '9.4.3(b)', text: 'Bhí an ochtar daltaí ann.', rule: 'PREFIXT', words: 'an ochtar', fixed: 'Bhí an t-ochtar daltaí ann.' },
  // ordinals above 100 (9.5.3): céad the cardinal unlenited, but lenited in the genitive; h after míliú
  { section: '9.5.4(d)', text: 'beithígh an céad is ceathrú feirmeoir', rule: 'CLAOCHLU', words: 'an céad', fixed: null },
  { section: '9.5.3', text: 'Seo an míliú eitilt.', rule: 'PREFIXH', words: 'an míliú eitilt', fixed: 'Seo an míliú heitilt.' },
  { section: '10.2.1', text: 'Bhí an céad fear ann.', rule: 'CLAOCHLU', words: 'an céad', fixed: null },
  { section: '9.2.3', text: 'Tá trí déag litir san fhocal seo.', rule: 'INPHRASE', words: 'trí déag', fixed: null },
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
  { text: 'Seo ainm an aon duine amháin.', note: 'no t- on aon after an in the genitive (9.3.7(a)(iii))' },
  { text: 'Thosaigh sé ag tús an ochtú haois déag.', note: 'no t- on ochtú in the genitive (9.5.4(c))' },
  { text: 'Rinne siad cístí an ochtar báicéirí.', note: 'no t- on ochtar with a noun after it, in the genitive (Tábla 9T)' },
  { text: 'Bhí an céad is ceathrú feirmeoir ann.', note: 'céad the cardinal in an ordinal above 100 (9.5.3)' },
  { text: 'Chonaic sé an deich míliú duine.', note: 'no na before a number followed by míliú (9.5.3)' },
  { text: 'Bhí sé bhó ann.', note: 'bhó is lenited: LENITED now covers three-letter words in bh' },
  { text: 'Ní chreidfeá a uaigní a bhí an áit.', note: 'a before the verb tagged as the relative particle (4.8.3)' },
  { text: 'Tá caoga císte milis ann.', note: 'after a decade the noun is nominative singular, so the adjective is not lenited (9.3.9(a))' },
  { text: 'Bhí seachtó bliain fhada ann.', note: 'a feminine noun after a decade: the adjective agrees with it (9.3.9(b))' },
  { text: 'Sé leabhar mhóra a bhí ann.', note: 'sé the number at the start of a clause; plural adjective lenited (9.3.3)' },
  { text: 'Thóg siad seolta na n-ocht mbád bheaga.', note: 'eclipsed n-ocht in the genitive plural, adjective lenited (9.3.7)' },
  { text: 'Tá 7 bhfeirmeoir shaibhre ann.', note: 'a number in figures, plural adjective lenited (9.4.4)' },
  { text: 'Bhí sé ag beirt bhan.', note: 'beirt is not a verbal noun; the noun after it is lenited (9.4.3(a)(i))' },
  { text: 'Chonaic mé beirt ghirseach chruthaitheacha.', note: 'after beirt + noun the adjective is plural and lenited (9.4.3(c)(i))' },
  { text: 'Seo oifig na beirte ban mhisniúla.', note: 'the same after na beirte (9.4.3(c))' },
  { text: 'Tá soitheach dháréag bádóirí ann.', note: 'dháréag is spelt with dh, not lenited (Tábla 9S)' },
  { text: 'Seo a tríú bliain.', note: 'a before an ordinal is the possessive (9.5.2(c))' },
  { text: "Is ball d'eagraíocht tríú tír é.", note: 'an ordinal goes with the noun after it, not the feminine noun before (9.5.4(b))' },
  { text: 'Bhí an dá chéad fiche duine ann.', note: 'an dá chéad is 200 after the article (9.3.7(b))' },
  { text: 'Bhí dosaen amhrán ann.', note: 'the genitive plural after dosaen (Tábla 9M note); the alternatives in the rule were not bracketed' },
  { text: 'Bhí scór daoine ann.', note: 'the genitive plural after scór (Tábla 9M note)' },
  { text: 'Tá 89 dtroithe cearnacha ann.', note: 'a special plural after a figure (9.3.2, Tábla 9G)' },
  { text: 'Is é a trí ar fiche a ceathair an codán.', note: 'fiche is not lenited in a fraction (9.6.1(e)(i))' },
  { text: 'Tá trí fichiú fágtha.', note: 'trí before an ordinal is the number; fichiú is not lenited (9.6.1(e)(iii))' },
  { text: 'Chonaic mé a gheansaí seisean.', note: 'the emphatic seisean after a possessive and its noun (8.3.2)' },
  { text: 'Bhuail sé a dhá bhos ar a chéile.', note: 'the singular after dhá, not the dual bois (8.3.3)' },
  { text: 'Is dócha gurbh iúd é é.', note: 'iúd after the copula (8.6.2); now a pronoun in the word list' },
  { text: 'Beidh mé ann óna ceathair a chlog.', note: 'the numeral a joined to the preposition (8.3.8(b))' },
  { text: 'Céard faoi a raibh sibh ag caint?', note: 'no faoina after an interrogative (8.5.5)' },
  { text: 'Bhí siad ag imeacht ar cosa in airde.', note: 'the set phrase ar cosa in airde' },
  { text: 'Bhí sé ag caint lena mhodúil.', note: 'after lena the noun is plural, not genitive (8.3.2, 8.3.8(a))' },
  { text: 'Chonaic mé mo chapallsa ansin.', note: 'an emphatic suffix on a noun (8.3.1); not read as the pre-standard chapal' },
  { text: 'Tháinig ár mbádna isteach.', note: 'an emphatic suffix on a noun (8.3.1); not read as mbánna' },
  { text: 'Ní aithnímse an fear sin.', note: 'an emphatic suffix on a verb (8.2.2)' },
  { text: 'Mhill sé a chuidsean gruaige.', note: 'emphatic cuid before a genitive, not lenited (8.3.4(b))' },
  { text: 'Déan do chuidse oibre.', note: 'cuidse, a rare word in the word list, tagged as cuid' },
  { text: 'Chuaigh sé go dtí an teach mór.', note: 'a known word ending like a suffix is not changed (mór)' },
  { text: 'Tá an bhean cabhrach.', note: 'predicative adjective, not lenited' },
  { text: 'Cuideachta áitiúil atá i mbun an teach a thógáil.', note: 'nominative before a + verbal noun after a compound preposition' },
  { text: 'Bhí siad ag obair sa gcistin.', note: 'eclipsis after sa (CO17 1.4 N.B. (b))' },
  { text: 'Thug sé don bhfear é.', note: 'eclipsis after don (1.4 N.B. (a))' },
  { text: 'Chuaigh sé fairis na fir.', note: 'fairis before the article (1.6.2)' },
  { text: 'Tháinig sé fairis.', note: 'fairis as a prepositional pronoun' },
  { text: 'Bhí torthaí an tsuirbhé go maith.', note: 't before s in the masculine genitive, a word whose genitive is the same' },
  { text: 'Shuigh sé ar an urlár fhuar.', note: 'Córas an tSéimhithe: lenited adjective after a masculine noun in a vowel (1.7.5)' },
  { text: 'Labhair sé leis an tSeanadóir.', note: 'Córas an tSéimhithe: t before a masculine noun in s (1.7.4)' },
  { text: 'Chuaigh mé go hÓman.', note: 'Óman, as CO17 spells it (1.1.5(i))' },
  { text: 'Bhí sé ag iarraidh í a phósadh.', note: 'pronoun object of the verbal noun after it (11.3.1(b))' },
  { text: 'Sin é an fear nach gcuireadh aon cheist.', note: 'past habitual after nach, not the autonomous past (11.6.2(a)(i))' },
  { text: 'Cén áit a cheapann tú a bhfuil sé?', note: 'interjected clause after áit is direct (11.4)' },
  { text: 'Sin é an bord ar ar leag mé an leabhar.', note: 'preposition ar before the relative particle ar (11.3.1(c)(i))' },
  { text: 'Is duine é ar mhór aige an t-airgead.', note: 'copula ar and a lenited adjective (11.8.3)' },
  { text: 'Sin é an fear a cheannós an teach.', note: 'relative form of the future (11.7.4(a))' },
  { text: 'Chuala mé glór na neach.', note: 'masculine genitive plural like the nominative singular after na (2.1.3(b))' },
  { text: 'Bhí fo-ghlantóir ann.', note: 'hyphen after fo- before gla- (2.1.7(d))' },
  { text: 'Is duine iar-nua-aimseartha é.', note: 'a prefix keeps its hyphen before a hyphenated compound (2.1.7 Nóta)' },
  { text: 'Bhí an cruinniú ar athló.', note: 'old dative in its set phrase (2.7 Nóta)' },
  { text: 'Moladh sé an Tiarna.', note: 'third person imperative with sé (Tábla 5B)' },
  { text: 'Ithimis ár ndinnéar.', note: "imperative in a vowel needs no d' (Tábla 5U)" },
  { text: 'Mholfaí é dá ndéanfadh sé é.', note: 'lenited autonomous conditional at the start of a clause (Tábla 5B)' },
  { text: 'Chloisfeadh muid é.', note: 'muid with the analytic form (5.1.10)' },
  { text: 'Fanfaidh mé ach a dtaga sé.', note: 'subjunctive after ach a (5.1.5(a)(i))' },
  { text: 'Bhí an long sí ar an bhfarraige.', note: 'sí the noun after the article and a noun (10.2.7)' },
  { text: 'An bhfuil sé ann?', note: 'interrogative an and an eclipsed verb before a pronoun' },
  { text: 'Tá sé siar siar ó thuaidh.', note: 'a compass point between west and north-west (Tábla 6C)' },
  { text: "D'imigh sé tar éis an cinneadh sin a dhéanamh.", note: 'object of a verbal noun with sin between (3.3.2(a))' },
  { text: 'Bhí sé ann le linn an cluiche mór a imirt.', note: 'object of a verbal noun with an adjective between (3.3.2(a))' },
  { text: 'Tháinig sé isteach tar éis an toiliú deireanach ón mbord a thabhairt.', note: 'object of a verbal noun further back in its clause (3.3.2(a))' },
  { text: 'Cuireadh an tuarascáil faoi bhráid an Aire.', note: 'Aire, the same in the genitive, after a compound preposition' },
  { text: 'Rinneadh é de réir an phróisis chéanna.', note: 'céanna in the genitive after a lenited masculine genitive' },
  { text: 'Tháinig siad tar éis an obair a dhéanamh inné.', note: 'object of a verbal noun, with more words after it (3.3.2(a))' },
  { text: 'Íocfar é i gcás an foras sin a bheith dúnta.', note: 'i gcás governs a verbal-noun clause (3.3.2(a))' },
  { text: "D'fhan sé in ionad an comhchoiste a bheith ann.", note: 'in ionad governs a verbal-noun clause (3.3.2(a))' },
  { text: "Leanfaidh sé d'ainneoin an comhlacht a dhíscaoileadh.", note: "d'ainneoin governs a verbal-noun clause (3.3.2(a))" },
  { text: 'Tháinig sé i ndiaidh an fógra sin a thabhairt.', note: 'i ndiaidh governs a verbal-noun clause (3.3.2(a))' },
  { text: 'Bhí an fheiste chomharthaíochta cheadaithe ar an mbád.', note: 'adjective describing the feminine noun before a genitive (4.2)' },
  { text: 'Is ráitis bhréagacha agus mhíthreoracha iad.', note: 'two adjectives joined by agus take the same lenition (4.2)' },
  { text: 'Fuair sé post mar fhostaí téarma shocraithe.', note: 'adjective on a masculine genitive spelt like its nominative (4.2)' },
  { text: 'Cuireadh ar fáil é do sholáthraí seirbhíse poist uilechoitinne.', note: 'adjective after two genitives, describing the first (4.2)' },
  { text: 'Is fostaí de chuid údaráis cheaptha nó aistrithigh é.', note: 'a second genitive adjective after nó (4.2)' },
  { text: 'Má sháraíonn sé nó sí an dlí, gearrfar fíneáil.', note: 'a second subject pronoun joined by nó' },
  { text: 'Rinne sé é chun é nó í a shábháil.', note: 'two pronouns, the object of the verbal noun after chun' },
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
