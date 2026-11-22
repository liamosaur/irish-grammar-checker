// Real sentences the checker flagged, with a reviewer's verdict on each flag:
// - test/gaois/confirmed.tsv: Irish legislation (the Gaois parallel corpus, Acts 2009-2011), CC BY 4.0.
// - test/coimisineir/confirmed.tsv: publications of An Coimisinéir Teanga (ELRC corpora), PSI.
// - test/citizens/confirmed.tsv: the Citizens Information website (ELRC-2438), CC BY 4.0.
// See the notice at the top of each file and NOTICE.md.
// - ok: the flag was wrong; the sentence must not get that message.
// - wrong: the source has the error; the message must still be given.
// - unsure: not decided (questions.md); run as a todo.
// A row with a fifth column (known) is a flag we have not fixed yet, run as a todo; the
// last test fails when such a row starts passing, so the column can be removed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';
import { analyse } from '../web/annotate.ts';
import { foldForEngine } from '../web/fold.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = { 'Gaois legislation': 'test/gaois/confirmed.tsv', 'Coimisinéir Teanga': 'test/coimisineir/confirmed.tsv', 'Citizens Information': 'test/citizens/confirmed.tsv' };
type Row = { file: string; verdict: string; rule: string; source: string; text: string; known?: string };
const read = (file: string): Row[] => fs.readFileSync(path.join(root, file), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l && !l.startsWith('#') && !l.startsWith('verdict\t'))
  .map((l) => {
    const [verdict, rule, source, text, known] = l.split('\t');
    return { file, verdict, rule, source, text, known: known || undefined };
  });

let engine: Gramadoir | undefined;
const rulesFor = (text: string) => {
  engine ??= new Gramadoir(loadData(path.join(root, 'data')), { fixSpelling: true });
  return analyse(text, engine.grammaticalErrors(foldForEngine(text))).views.map((v) => v.rule);
};
const asExpected = (r: Row) => rulesFor(r.text).includes(r.rule) === (r.verdict === 'wrong');

for (const [name, file] of Object.entries(FILES)) {
  const rows = read(file);
  describe(`${name} sentences with a verdict`, () => {
    for (const r of rows) {
      const todo = r.verdict === 'unsure' ? 'unsure: see questions.md' : r.known;
      it(`${r.verdict} ${r.rule}: ${r.text} (${r.source})`, { todo }, () => {
        const got = rulesFor(r.text);
        if (r.verdict === 'wrong') assert.ok(got.includes(r.rule), `the source has an error: ${r.rule} expected, got ${got.join(', ') || 'nothing'}`);
        else assert.ok(!got.includes(r.rule), `${r.rule} judged a false positive, but given`);
      });
    }

    it('every row marked known still fails', () => {
      const fixed = rows.filter((r) => r.known && r.verdict !== 'unsure' && asExpected(r)).map((r) => r.text);
      assert.deepEqual(fixed, [], `now passing: remove the known column from these in ${file}`);
    });
  });
}
