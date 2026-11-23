# Tools

Scripts for rebuilding `data/` and for comparing the port with the original Perl
engine. None of them is needed to run, test or build the site. Each script's
header comment documents its options.

## Rebuilding the data

The inputs are not committed. Put them under `.sources/` (git-ignored):

| Path | What |
|---|---|
| `.sources/gramadoir` | checkout of <https://github.com/kscanne/gramadoir> (0.73, commit `daa63e64130a9b34848f999bed4b47f19dbeebed`): rules, morphology, tagset, tokenizer |
| `.sources/lingua-0.70` | the CPAN [Lingua-GA-Gramadoir-0.70](https://cpan.metacpan.org/authors/id/S/SC/SCANNELL/Lingua-GA-Gramadoir-0.70.tar.gz) distribution, extracted: the only published source of the word list and the non-standard-form tables |
| `.sources/bunamo/repo` | checkout of <https://github.com/michmech/BuNaMo> |

```sh
node tools/generate-rules.mjs .sources/gramadoir data
node tools/build-data.mjs .sources/lingua-0.70/Lingua-GA-Gramadoir-0.70 data --upstream .sources/gramadoir
node tools/overlay-bunamo.mjs .sources/bunamo/repo .sources/gramadoir data data --rare keep --decisions data/overlay-decisions.tsv --reports <dir>
node tools/build-forms.mjs .sources/bunamo/repo data   # forms.json and verbal-nouns.json
```

This reproduces the committed files exactly.

The grammar rules are in `grammar/` and are edited there directly:
`rialacha-ga.in` (the rules), `aonchiall-ga.in` (the rules that choose between
a word's possible tags), `comhshuite-ga.in` (phrases tagged as one word) and
`macra-ga.meta.pl` (the macros, such as `ANYTHING` and `NONCOMPOUND`).
`generate-rules.mjs` compiles them with `rule-compiler.mjs`, a JavaScript version of
An Gramadóir's Perl compiler scripts that gives the same output, so Perl is not needed.
It stops on a mistake those scripts passed over silently (an unknown macro, a word
it can't read, a malformed message, a macro name containing an earlier one, a
character outside Latin-1 in a rule; comments may contain anything), and writes
`data/rules/lines.json`, the source line of each compiled rule, for tools.
`test/rule-compiler.test.ts` checks that `data/rules/` is up to date. The rules follow *An Caighdeán Oifigiúil* (2017);
`node tools/upstream-diff.mjs .sources/gramadoir` lists the changes since the
An Gramadóir commit they came from. Rules can also use `CLAUSESTART`,
`AFTERFEMNAME`, `AFTERMANNERNOUN` (first word), `CLAUSEEND` and `VNLATER` (last word), which the rule
compiler cannot express; see `generate-rules.mjs`. `VERBALNOUN` is a word that matches a verbal
noun: `src/engine.ts` fills it in when the rules load, from `data/verbal-nouns.json` (BuNaMo, ODbL)
and `data/verbal-nouns-extra.json` (built from `grammar/verbal-nouns.tsv`, verbal nouns BuNaMo lacks). Also in `grammar/`:
`morph-ga.txt`, the morphology rules (read by `build-data.mjs`; level -2, not in
An Gramadóir 0.70, marks a regular inflection such as an emphatic suffix, which
`src/engine.ts` accepts without a message for a word not in the word list);
`prefixes.tsv`, the prefixes the morphology strips (comh-, iar-, neamh-), one row each: the
build writes their rules into `morph-ga.txt` at `@PREFIXES` and `@PREFIXES-LATE`, applying the
same CO17 rules to every prefix (lenition, no lenition of d, t, s after d, n, t, l, s, and the
hyphens of 2.1.7), with the exceptions in the row's flags;
`messages.tsv`, the English text of every message (id, status, en, reason; read by
`build-data.mjs`, which writes `data/messages.json`, and upstream's own text to
`data/legacy-0.70/messages.json` for the parity tests; status as in *Text status* below; the
optional reason is a `reasons.tsv` id shown with the message when its rule names none, written by
`generate-rules.mjs` to `data/rules/message-reasons.json`), and `lexicon-corrections.tsv`, corrections to words' tags
in the word list (or standard words upstream lists only as non-standard forms,
which are then removed from `data/eile.json`, or words the standard spells otherwise, which are moved there), which `build-data.mjs` turns into `data/lexicon-corrections.json`,
applied when the checker loads, after the BuNaMo overlay and kept separate from it
(`src/lexicon.ts`). The parity tests use the 0.70 rules in `data/legacy-0.70/`,
so they are unaffected. `data/lexicon.json` is the 0.70
word list, unchanged. `data/bunamo-overlay.json` holds what BuNaMo adds to it,
merged in memory when the checker loads (`src/lexicon.ts`); the safeguards that
keep it from making the checker worse are listed at the top of
`overlay-bunamo.mjs`. `data/overlay-decisions.tsv` records the manual review of
the cases the tool cannot decide (genders checked against teanglann.ie,
hyphenation against *An Caighdeán Oifigiúil* 2017 §2.1.7). `data/forms.json` is
the table of noun and adjective forms behind the one-click fixes.

`data/legacy-0.70/` keeps the 0.70 versions of the files that changed since, for
exact comparison with the Perl 0.70 engine:

```sh
node tools/build-data.mjs .sources/lingua-0.70/Lingua-GA-Gramadoir-0.70 <tmp>
cp <tmp>/morph.json <tmp>/pos.json <tmp>/nocombo.json data/legacy-0.70/
node tools/extract-rules.mjs .sources/lingua-0.70/Lingua-GA-Gramadoir-0.70/lib/Lingua/GA/Gramadoir.pm <tmp>/rules
cp <tmp>/rules/aonchiall.json <tmp>/rules/rialacha.json data/legacy-0.70/rules/
```

## Comparing with the Perl engine

`npm test` compares the port with Perl output recorded in `test/golden/` and
`test/spelling/`, so Perl is not needed for it.

- `compare.ts`: runs the Perl engine and the port on a text file and diffs the
  results (`GRAMADOIR_PERL_DIST=<built Lingua-GA-Gramadoir-0.70> node tools/compare.ts some.txt`).
  The Perl module needs `String::Approx`. A stub in `<dist>/fakelib` is enough
  except for spelling suggestions; for those, see `perl-wsl.sh`.
- `make-golden.ts`, `make-golden-spelling.ts`: record new Perl output as test fixtures.
- `drift.mjs`: agreement with the expected output in upstream `ga/triail.xml`
  (currently 458 of 479 sentences identical). Some differences are intended (*an-scanradh*, a regular prefix formation, is not reported): the
  rules in `grammar/` follow *An Caighdeán Oifigiúil* where upstream does not
  (e.g. *Ní hamháin*, *in 1982*, *mórsheisear iníonacha*, *chuig an banaltra*, *leis an farraige*, *thar an cuid*
  (the dative rule, not the nominative feminine one), *ar fail* (*fáil*, not lenition), and *ag an tsiopa*, the
  dative of Córas an tSéimhithe), and a phrase taken as one word can widen a reported span (*ón cur i gcéill*).
- `browser-smoke.mjs`: checks a sentence in the built site in headless Edge or Chrome.

## Checking a change to the rules

- `rule-baseline.ts`: `snapshot` records what the checker reports for every sentence we have
  (the local Gaois and ELRC runs, the book's examples, the variants, the review probes, the `#.`
  lines of `grammar/rialacha-ga.in`, upstream's `triail.xml`); `diff` compares two snapshots;
  `fire` counts, per rule (by source line, `data/rules/lines.json`), how often it matches and how
  many reported errors it makes, and which marks each exception removes. Snapshots record
  behaviour, not correctness: keep them local (`.sources/review/baseline/`).
- `fix-check.ts`: applies the first one-click fix of every error in the same sentences, checks
  again, and sorts each fix: ok; next step (a note is left for another word: fine, one note is
  one change); rechanged (following the notes left changes a word this fix changed: the fix
  changed the wrong word or gave the wrong form); not cleared. Rechanged is the count to bring
  down. The later steps follow the checker's own fixes, so a rechanged fix is a lead to read,
  not a verdict; and a wrong word the checker accepts counts as ok. `--out fixes.tsv` writes
  every fix with its later steps.

## Reasons

`grammar/reasons.tsv` explains why a rule applies, with its section of *An Caighdeán Oifigiúil*
(id, status, section, English, Irish). A rule names one after its message (`:SEIMHIU @adj-fem`);
the build checks that every id exists and is used, and writes `data/rules/reasons.json`, which the
interface shows under the message ("Why: ..."). In the English text, Irish words are written
`/like this/`; the Irish examples are copied from the book. A reason can also explain a message
(`messages.tsv`, fourth column), for flags that come from the word list rather than a rule; in it,
`/\1/` is the word the message quotes, and for CAIGHDEAN alternatives are shown joined by "or".

## Text status

Each message in `grammar/messages.tsv` and each reason in `grammar/reasons.tsv` records the status
of its English text, so that what has been reviewed can be tracked while the wording improves:

- `inherited`: from An Gramadóir 0.70 (`share/messages.bs`), unchanged (messages only). The build
  checks that an inherited message still matches upstream word for word, and that every upstream
  message has a row.
- `unreviewed`: written or changed by Claude, not yet approved.
- `reviewed`: approved by the maintainer, whether inherited or written by Claude.

To improve an inherited message, change its text and mark it `unreviewed`. The builds print the
counts (`messages 78 names; 59 inherited, 11 unreviewed, 0 reviewed`). The status is not shown in
the interface.

The interface text in `web/strings/en.ts` carries the same status as a comment before each key
(`/* unreviewed */ 'btn.check': 'Check',`); none of it is inherited. `test/web.test.ts` checks
that every key has one.

## Searching published Irish

`gaois-corpus.mjs` builds a local search corpus from the Gaois parallel corpus of Irish
legislation (the TMX files from <https://www.gaois.ie/en/corpora/parallel/data/>, unzipped under
`.sources/gaois/raw`): `extract` writes every Irish segment once to a TSV, and `search` counts
the segments a regular expression matches, by period (before 1958, 1958-2011, 2012 on; most texts
predate the current standard), with examples. It is for evidence of usage, not test data: the
texts are copyright Government of Ireland and are not copied into the repository.

## Derived error sentences for review

`derive-variants.ts` takes the sentences in the Caighdeán suites (`test/caighdean/chNN.json`)
that the checker accepts, undoes one initial mutation at a time, and writes the results to
`test/caighdean/variants.tsv` with what the checker currently does with each. It does not
judge them: a variant may be an error, correct Irish with another meaning, or not a real
mutation. A reviewer marks each row `wrong`, `ok` or `skip` in the verdict column, and
`test/caighdean-variants.test.ts` tests the rows marked `wrong` or `ok`. Re-running the tool
keeps the verdicts and refreshes the checker column.
