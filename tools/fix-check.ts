// Checks the one-click fixes: for every error with a fix in the sentences of tools/rule-baseline.ts,
// applies the fix (as the first button would) and checks the sentence again. A fix "works" if the
// error goes and no new error appears on the changed words; otherwise it is listed. This is about
// the fix doing what the message says, not about whether the message is right.
//
// Usage: node tools/fix-check.ts [--sets gaois,elrc,...] [--show 20]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';
import { analyse, type CheckedError } from '../web/annotate.ts';
import { applyCorrection, firstFix } from '../web/corrections.ts';
import { foldForEngine } from '../web/fold.ts';
import { addFixes, Forms } from '../web/forms.ts';
import { inputs } from './rule-baseline.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const sets = opt('--sets')?.split(',');
const show = Number(opt('--show') ?? 20);
const gr = new Gramadoir(loadData(path.join(root, 'data')), { fixSpelling: false });
const forms = new Forms(JSON.parse(fs.readFileSync(path.join(root, 'data', 'forms.json'), 'utf8')));
const LEXICAL = new Set(['ANAITHNID', 'NEAMHCHOIT', 'MOLADH', 'GRAM', 'MOIRF', 'COMHFHOCAL', 'COMHCHAIGH']);

const check = (s: string) => {
  const errs = gr.grammaticalErrors(foldForEngine(s)) as CheckedError[];
  addFixes(errs, forms);
  return analyse(s, errs).views;
};
const byRule = new Map<string, { fixed: number; failed: number; examples: string[] }>();
let total = 0;
for (const [set, s] of inputs()) {
  if (sets && !sets.includes(set)) continue;
  for (const v of check(s)) {
    if (LEXICAL.has(v.rule)) continue;
    const plan = firstFix(v, s.split('\n')[v.range?.y ?? 0] ?? '');
    if (!plan) continue;
    const after = applyCorrection(s, plan.range, plan.word);
    if (after === null) continue;
    total++;
    // The error is gone if no error of the same rule covers the replaced words now.
    const from = plan.range.from, to = from + Array.from(plan.word).length;
    const left = check(after).filter((w) => !LEXICAL.has(w.rule) && w.range && w.range.y === plan.range.y && w.range.from < to && w.range.to > from);
    const st = byRule.get(v.rule) ?? { fixed: 0, failed: 0, examples: [] };
    if (left.length) {
      st.failed++;
      if (st.examples.length < 3) st.examples.push(`${s}\n      -> ${after}\n      still: ${left.map((w) => `${w.rule} [${w.words}]`).join(', ')}`);
    } else st.fixed++;
    byRule.set(v.rule, st);
  }
}
const rows = [...byRule].sort((a, b) => b[1].failed - a[1].failed);
const failed = rows.reduce((a, [, r]) => a + r.failed, 0);
console.log(`${total} fixes applied; ${failed} leave an error on the changed words`);
for (const [rule, r] of rows.slice(0, show)) {
  console.log(`${rule}: ${r.fixed} work, ${r.failed} don't`);
  for (const e of r.examples) console.log(`    ${e}`);
}
