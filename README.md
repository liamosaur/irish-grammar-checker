# Irish Grammar Checker

A grammar checker for Irish that runs entirely in your browser: your text never
leaves your device. It marks words and phrases that look wrong, such as a missing
or unnecessary mutation, a noun that should be in the genitive, a repeated word or
a non-standard spelling, says why, and where it can, offers a one-click fix.

It is a TypeScript port of [An Gramadóir](https://cadhan.com/gramadoir/), the
Irish grammar checker by Kevin P. Scannell. The grammar rules and most of the
word list are his work. The word list is extended with the
[Irish National Morphology Database](https://github.com/michmech/BuNaMo)
(BuNaMo, © Foras na Gaeilge).

Not affiliated with or endorsed by Kevin P. Scannell or Foras na Gaeilge.

## Feedback

If it flags something that is correct, or misses a mistake, please
[open an issue](https://github.com/liamosaur/irish-grammar-checker/issues).

## Running it locally

Needs Node.js 22.18 or later.

```sh
npm install
npm run dev       # local development server
npm test          # tests, including comparison with recorded output of the original Perl engine
npm run build     # static site in dist/
```

The built site is plain static files, so it can be hosted anywhere. It is
deployed on Cloudflare Workers as static assets (build command `npm run build`,
deploy command `npx wrangler deploy`, configured in `wrangler.jsonc`), with
Cloudflare Web Analytics for a cookieless visit count.

## Layout

| | |
|---|---|
| `src/` | the checker itself, ported from the Perl `Lingua::GA::Gramadoir` |
| `web/` | the website; interface text is in `web/strings/en.ts` |
| `data/` | the rules and word lists, generated from the original sources |
| `tools/` | scripts that build `data/` and compare with the Perl engine (see [tools/README.md](tools/README.md)) |
| `test/` | tests |

## Licence

An Gramadóir is © 2003-2007 Kevin P. Scannell, released under the GNU GPL
(version 2 or later) and, for the Irish data and the Perl module, under the same
terms as Perl. This port is a derivative work, licensed under the
**GNU General Public License, version 2 or (at your option) any later version**
([COPYING](COPYING)).

The data derived from BuNaMo is kept in separate files, `data/bunamo-overlay.json`
and `data/forms.json`, licensed under the **Open Database License 1.0**
([LICENSE-ODbL.txt](LICENSE-ODbL.txt)). See [NOTICE.md](NOTICE.md) for details.
