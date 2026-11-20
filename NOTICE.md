# Notices for data in this repository

## Licence map

| Files | Licence |
|---|---|
| `data/bunamo-overlay.json`, `data/forms.json`, `data/verbal-nouns.json` (derived from BuNaMo) | Open Database License (ODbL) 1.0, see [LICENSE-ODbL.txt](LICENSE-ODbL.txt); individual contents under the Database Contents License (DbCL) 1.0 |
| `test/gaois/confirmed.tsv`: the sentences (column 4), verbatim Irish legislation from the [Gaois parallel corpus](https://www.gaois.ie/en/corpora/parallel/data/) | the Government of Ireland's text; **licence for reuse here not yet settled**, and the file may have to be removed. The verdicts in the other columns are the project's |
| everything else: the code, `data/lexicon.json` (the An Gramadóir 0.70 lexicon), the other files in `data/` (including `data/legacy-0.70/` and `data/overlay-decisions.tsv`), the tests and the tools | GNU General Public License, version 2 or (at your option) any later version, see [COPYING](COPYING) |

The BuNaMo-derived data is kept in its own files and is not merged into any
GPL-licensed file in the repository or in the built site. It is only combined
with the 0.70 lexicon in memory, when the checker loads its data:
`src/lexicon.ts` (`applyOverlay`) merges `data/bunamo-overlay.json` into the
lexicon, both in Node (`src/node-data.ts`) and in the browser (`web/worker.ts`),
which downloads the two files separately. The page reads `data/forms.json`
directly.

## Irish National Morphology Database (BuNaMo)

`data/bunamo-overlay.json` and `data/forms.json` contain information from the
**Irish National Morphology Database** (Bunachar Náisiúnta Moirfeolaíochta),
© Foras na Gaeilge, <https://github.com/michmech/BuNaMo>.

* The database is made available under the **Open Database License (ODbL) 1.0**
  <https://opendatacommons.org/licenses/odbl/1.0/>; rights in its individual
  contents are licensed under the **Database Contents License 1.0**
  <https://opendatacommons.org/licenses/dbcl/1.0/>.
* It was created as part of the New English-Irish Dictionary project and
  records the inflected forms of about 43,000 Irish nouns, adjectives, verbs and
  prepositions, conforming to the Official Standard.
* Michal Boleslav Měchura, "Irish National Morphology Database: a high-accuracy
  open-source dataset of Irish words", *Proceedings of the First Celtic Language
  Technology Workshop* (2014), pp. 50-54.

### What was changed

`tools/overlay-bunamo.mjs` reads the noun, adjective and verb entries and maps
each inflected form to the grammatical tag the checker uses (case, number,
gender, tense), together with the initial-mutation variants (lenition, eclipsis,
`h-`, `t-`, `n-`, `b'`, `m'`, `d'`) that the 0.70 lexicon also contains. It
compares the result with the lexicon inherited from An Gramadóir 0.70 and writes
only the difference to `data/bunamo-overlay.json`: the forms and tags to add
(new forms, and tags added to forms 0.70 already has) and, where a review
decision replaces 0.70's tags with BuNaMo's, the 0.70 tags to remove. The 0.70
lexicon itself (`data/lexicon.json`) is left untouched. Which forms and tags are
added, kept or left out is controlled by `data/overlay-decisions.tsv` and by the
safeguards documented at the top of the tool. Nothing is added for prepositions,
noun phrases or possessives, and no text from BuNaMo is copied other than word
forms and the tags derived from them.

`data/forms.json` is built from the same database by `tools/build-forms.mjs`. It
lists, for each noun, its nominative and genitive singular and plural, and for
each adjective its nominative, genitive (masculine and feminine) and plural,
so that the web page can offer the form a grammar note asks for (for example
the genitive of *doras*). It contains only word forms and how they are related,
is derived entirely from BuNaMo, and is kept in its own file.

`data/verbal-nouns.json` is built by the same tool: the verbal noun of each BuNaMo
verb, as a plain list of words. The checker's tag set has no verbal-noun tag, so
rules that need to know whether a word is a verbal noun use a placeholder that
`src/engine.ts` fills in from this list when the rules are loaded, in memory;
the list is not copied into the rule files.

### Why the separate files

The ODbL requires a *Derivative Database* that is publicly used to be offered
under the ODbL (or a compatible licence), and the GPL is not one. Before this
layout, the BuNaMo-derived forms and tags were merged into `data/lexicon.json`
together with the GPL-licensed 0.70 lexicon, and it was unclear under which
terms that single file could be distributed. Keeping the BuNaMo-derived data in
`data/bunamo-overlay.json` and `data/forms.json`, offered under the ODbL, and
combining it with the GPL data only in memory at load time, is meant to keep the
two sets of terms apart. This is the project's reading of the licences, not
legal advice, and has not been confirmed by Foras na Gaeilge or the original
author.

## Sources consulted but not included

The review decisions in `data/overlay-decisions.tsv` were checked against
*Foclóir Gaeilge-Béarla* (Ó Dónaill, 1977) on <https://www.teanglann.ie> and
against the hyphenation rules in *An Caighdeán Oifigiúil* (Houses of the
Oireachtas, 2017 edition, section 2.1.7). No text or data from either is
included in this repository; only the resulting decisions are.
