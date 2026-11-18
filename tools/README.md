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

Perl is needed for the first step only (it runs the original rule generators).

```sh
node tools/generate-rules.mjs .sources/gramadoir data
node tools/build-data.mjs .sources/lingua-0.70/Lingua-GA-Gramadoir-0.70 data --upstream .sources/gramadoir
node tools/overlay-bunamo.mjs .sources/bunamo/repo .sources/gramadoir data data --rare keep --decisions data/overlay-decisions.tsv --reports <dir>
node tools/build-forms.mjs .sources/bunamo/repo data
```

This reproduces the committed files exactly. `data/lexicon.json` is the 0.70
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
  (currently 471 of 479 sentences identical; 474 with the 0.70 word list alone, `OVERLAY=0`).
- `browser-smoke.mjs`: checks a sentence in the built site in headless Edge or Chrome.
