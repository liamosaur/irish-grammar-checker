// Sentences from Irish legislation (the Gaois parallel corpus, Acts 2009-2011) that the
// checker flagged, with a reviewer's verdict on each flag: test/gaois/confirmed.tsv (CC BY 4.0;
// see the notice at the top of that file and NOTICE.md).
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
type Row = { verdict: string; rule: string; act: string; text: string; known?: string };
const rows: Row[] = fs.readFileSync(path.join(root, 'test/gaois/confirmed.tsv'), 'utf8')
  .split(/\r?\n/)
  .filter((l) => l && !l.startsWith('#') && !l.startsWith('verdict\t'))
  .map((l) => {
    const [verdict, rule, act, text, known] = l.split('\t');
    return { verdict, rule, act, text, known: known || undefined };
  });

let engine: Gramadoir | undefined;
const rulesFor = (text: string) => {
  engine ??= new Gramadoir(loadData(path.join(root, 'data')), { fixSpelling: true });
  return analyse(text, engine.grammaticalErrors(foldForEngine(text))).views.map((v) => v.rule);
};
const asExpected = (r: Row) => rulesFor(r.text).includes(r.rule) === (r.verdict === 'wrong');

describe('Gaois legislation sentences with a verdict', () => {
  for (const r of rows) {
    const todo = r.verdict === 'unsure' ? 'unsure: see questions.md' : r.known;
    it(`${r.verdict} ${r.rule}: ${r.text} (${r.act})`, { todo }, () => {
      const got = rulesFor(r.text);
      if (r.verdict === 'wrong') assert.ok(got.includes(r.rule), `the source has an error: ${r.rule} expected, got ${got.join(', ') || 'nothing'}`);
      else assert.ok(!got.includes(r.rule), `${r.rule} judged a false positive, but given`);
    });
  }

  it('every row marked known still fails', () => {
    const fixed = rows.filter((r) => r.known && r.verdict !== 'unsure' && asExpected(r)).map((r) => r.text);
    assert.deepEqual(fixed, [], 'now passing: remove the known column from these in test/gaois/confirmed.tsv');
  });
});
