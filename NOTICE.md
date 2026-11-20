# Notices for data in this repository

## Licence map

| Files | Licence |
|---|---|
| `data/bunamo-overlay.json`, `data/forms.json`, `data/verbal-nouns.json` (derived from BuNaMo) | Open Database License (ODbL) 1.0, see [LICENSE-ODbL.txt](LICENSE-ODbL.txt); individual contents under the Database Contents License (DbCL) 1.0 |
| `test/caighdean/ch01.json` … `ch11.json`, and the `original` column of `test/caighdean/variants.tsv`: example sentences quoted verbatim from *An Caighdeán Oifigiúil* (2017) | © Houses of the Oireachtas; re-used with acknowledgement, see [An Caighdeán Oifigiúil](#an-caighdeán-oifigiúil-2017) below |
| `test/gaois/confirmed.tsv`: the sentences (column 4), verbatim Irish legislation from the Gaois parallel corpus | Creative Commons Attribution 4.0 (CC BY 4.0), see [Gaois](#gaois-parallel-corpus-of-legislation) below. The verdicts in the other columns are the project's (GPL) |
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

## An Caighdeán Oifigiúil (2017)

The test suites in `test/caighdean/` quote the example sentences of *Gramadach na
Gaeilge: An Caighdeán Oifigiúil, Caighdeán Athbhreithnithe 2017*, published by Seirbhís
Thithe an Oireachtais (the Houses of the Oireachtas Service),
<https://data.oireachtas.ie/ie/oireachtas/caighdeanOifigiul/2017/2017-08-03_an-caighdean-oifigiuil-2017_ga.pdf>.
Section and page numbers refer to that edition. `variants.tsv` also holds sentences
derived from those examples (one form changed), with the original beside each. The
grammar rules' comments cite the standard by section but don't quote it at length.

The publication carries no copyright or licence notice of its own. The Houses of the
Oireachtas state that most of the information they publish is their copyright and may
be re-used free of charge under the Oireachtas (Open Data) PSI Licence, which
incorporates CC BY 4.0, unless otherwise indicated
(<https://www.oireachtas.ie/en/copyright-and-reuse>,
<https://www.oireachtas.ie/en/open-data/license>). The examples are used on that basis,
for a tool that furthers the use of the standard, with this acknowledgement:

> Example sentences quoted from *Gramadach na Gaeilge: An Caighdeán Oifigiúil* (2017),
> Seirbhís Thithe an Oireachtais. © Houses of the Oireachtas; re-used under the
> Oireachtas (Open Data) PSI Licence.

Short quotations with acknowledgement are also allowed by section 52(4) of the
Copyright and Related Rights Act 2000. Whether the PSI licence covers this publication
hasn't been confirmed with the Houses of the Oireachtas.

## Gaois parallel corpus of legislation

The sentences in `test/gaois/confirmed.tsv` are segments extracted, unchanged, from the
Gaois parallel corpus of Irish legislation
(<https://www.gaois.ie/en/corpora/parallel/data/>):

> The derivative machine-readable aligned translation memories are copyright Fiontar &
> Scoil na Gaeilge (DCU) and are made available under the Creative Commons Attribution
> 4.0 International (CC BY 4.0) licence (<https://creativecommons.org/licenses/by/4.0/>).
> The original legislation is copyright Government of Ireland.

The underlying legislation is © Houses of the Oireachtas / Government of Ireland, re-used
under the Oireachtas (Open Data) PSI Licence (<https://www.oireachtas.ie/en/open-data/license>).
This is not the official text of any Act or statutory instrument, nor an official
restatement. Gaois provides the corpus as a language resource only, not as an
authoritative legal resource (<https://www.gaois.ie/en/corpora/parallel/disclaimer>).

## Sources consulted but not included

The review decisions in `data/overlay-decisions.tsv` and the word-list corrections in
`grammar/lexicon-corrections.tsv` were checked against *Foclóir Gaeilge-Béarla* (Ó Dónaill,
1977) on <https://www.teanglann.ie>, and the hyphenation decisions against *An Caighdeán
Oifigiúil* (2017, section 2.1.7). No text or data from the dictionary is included; only
the resulting decisions are.
