// Reviewed rows of test/caighdean/variants.tsv: sentences from the Caighdeán suites with one
// initial mutation undone (tools/derive-variants.ts), each given a verdict by a reviewer:
//   wrong: the checker must flag the changed word;
//   ok:    the variant is correct Irish, and the checker must not flag anything.
// Rows without a verdict, or marked skip, are not tested.
//
// The checker column records what the checker did when the file was last generated. Where that
// agrees with the verdict, the row is a test: a change that breaks it fails. Where it does not,
// the row is a todo (a gap or a false alarm to work on); when a rule change makes it pass, the
// last test fails until tools/derive-variants.ts is re-run to record the new behaviour.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';
import { analyse } from '../web/annotate.ts';
import { foldForEngine } from '../web/fold.ts';
import { checkVariant, readVariants, type VariantRow } from './caighdean/variants.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rows = readVariants(fs.readFileSync(path.join(root, 'test', 'caighdean', 'variants.tsv'), 'utf8'))
  .filter((r) => r.verdict === 'wrong' || r.verdict === 'ok');

const LEXICON_ONLY = new Set(['ANAITHNID', 'ANKOTHVOS', 'UNKNOWN', 'MOLADH', 'GRAM', 'MOIRF', 'COMHFHOCAL', 'COMHCHAIGH']);
let engine: Gramadoir | undefined;
const complaints = (text: string) => {
  engine ??= new Gramadoir(loadData(path.join(root, 'data')), { fixSpelling: true });
  return analyse(text, engine.grammaticalErrors(foldForEngine(text))).views.filter((v) => !LEXICON_ONLY.has(v.rule));
};
/** Does this checker result agree with the reviewer's verdict? */
const agrees = (r: VariantRow, checker: string) => (r.verdict === 'wrong' ? checker.startsWith('flagged:') : checker === '-');

describe('Caighdeán sentences with a mutation undone, as reviewed (test/caighdean/variants.tsv)', () => {
  for (const r of rows) {
    const gap = !agrees(r, r.checker);
    it(`${r.variant} [${r.change}; ${r.verdict}; ${r.section}]`, { todo: gap ? `checker: ${r.checker}` : undefined }, () => {
      const now = checkVariant(r, complaints);
      assert.ok(agrees(r, now), r.verdict === 'wrong'
        ? `should be flagged on "${r.change.split(' → ')[1]}" (${r.original}); checker: ${now}`
        : `correct per the reviewer, but flagged: ${now}`);
    });
  }

  it('the checker column is up to date for rows that now pass', () => {
    const fixed = rows.filter((r) => !agrees(r, r.checker) && agrees(r, checkVariant(r, complaints))).map((r) => r.variant);
    assert.deepEqual(fixed, [], 'now as the verdict says: re-run node tools/derive-variants.ts');
  });
});
