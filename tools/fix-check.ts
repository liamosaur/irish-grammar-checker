// Checks the one-click fixes. For every note with a fix in the sentences of tools/rule-baseline.ts,
// applies the fix (what the first button does) and checks the sentence again. Each fix is one of:
//
//   ok           nothing is flagged on the changed words any more
//   next-step    a note is left on the changed words, but its fix changes other words only (an
//                chuid -> an coda leaves "an" for the next step: na coda). Fine: one note, one step.
//   rechanged    following the notes left (up to 3 steps) changes a word this fix changed: the fix
//                changed the wrong word or gave the wrong form (an bean bheag -> an bean beag, then
//                an bhean bheag again; le n-íoc -> le íoc, then le híoc). These are the ones to fix.
//   not-cleared  the same rule still flags the changed words and offers no further fix.
//
// The later steps follow the checker's own fixes, which may be wrong too: a rechanged fix is a
// lead, to be read, not a verdict.
//
// Usage: node tools/fix-check.ts [--sets gaois,elrc,...] [--show 3] [--out fixes.tsv]
//   --show  examples per rule for rechanged and not-cleared
//   --out   every fix: rule, group, sentence, after the fix, the later steps
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';
import { analyse, type CheckedError, type ErrorView } from '../web/annotate.ts';
import { applyCorrection, firstFix } from '../web/corrections.ts';
import { foldForEngine } from '../web/fold.ts';
import { addFixes, Forms } from '../web/forms.ts';
import { inputs } from './rule-baseline.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const sets = opt('--sets')?.split(',');
const show = Number(opt('--show') ?? 3);
const out = opt('--out');
const gr = new Gramadoir(loadData(path.join(root, 'data')), { fixSpelling: false });
const forms = new Forms(JSON.parse(fs.readFileSync(path.join(root, 'data', 'forms.json'), 'utf8')));
/** Notes about the word itself (unknown, rare, a spelling): left out. */
const LEXICAL = new Set(['ANAITHNID', 'NEAMHCHOIT', 'MOLADH', 'GRAM', 'MOIRF', 'COMHFHOCAL', 'COMHCHAIGH']);

const check = (line: string): ErrorView[] => {
  const errs = gr.grammaticalErrors(foldForEngine(line)) as CheckedError[];
  addFixes(errs, forms);
  return analyse(line, errs).views.filter((v) => !LEXICAL.has(v.rule) && v.range);
};
type Span = { from: number; to: number };
const overlaps = (a: Span, b: Span) => a.from < b.to && a.to > b.from;
const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{M}'’-]/u.test(c);
/** The part of `a` that `b` changes: [from, oldTo) in a, [from, newTo) in b. */
function changed(a: string[], b: string[]) {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  return { from: p, oldTo: a.length - q, newTo: b.length - q };
}
/** A span after a change at [from, oldTo) -> [from, newTo). */
function shift(s: Span, c: { from: number; oldTo: number; newTo: number }): Span {
  const grow = c.newTo - c.oldTo;
  if (c.oldTo <= s.from) return { from: s.from + grow, to: s.to + grow };
  if (c.from >= s.to) return s;
  return { from: Math.min(s.from, c.from), to: Math.max(s.to + grow, c.newTo) };
}

type Group = 'ok' | 'next-step' | 'rechanged' | 'not-cleared';
const byRule = new Map<string, Record<Group, number> & { examples: string[] }>();
const totals: Record<Group, number> = { ok: 0, 'next-step': 0, rechanged: 0, 'not-cleared': 0 };
const rows: string[] = [];
for (const [set, s] of inputs()) {
  if (sets && !sets.includes(set) || s.includes('\n')) continue;
  for (const v of check(s)) {
    const one = firstFix(v, s);
    if (!one) continue;
    const after = applyCorrection(s, one.range, one.word);
    if (after === null) continue;
    let cur = Array.from(after);
    const c1 = changed(Array.from(s), cur);
    // The words this fix changed (whole words), and the span its note covers now.
    let mine: Span = { from: c1.from, to: c1.newTo };
    while (mine.from > 0 && isWordChar(cur[mine.from - 1])) mine.from--;
    while (mine.to < cur.length && isWordChar(cur[mine.to])) mine.to++;
    let region: Span = { from: one.range.from, to: one.range.from + Array.from(one.word).length };
    const first = check(after).filter((n) => overlaps(n.range!, region));
    let group: Group = 'ok';
    const steps: string[] = [];
    if (first.length) {
      group = 'next-step';
      let left = first;
      for (let round = 0; round < 3 && left.length; round++) {
        const n = left.find((x) => firstFix(x, cur.join('')));
        const p = n && firstFix(n, cur.join(''));
        if (!n || !p) {
          // A note of the same rule is left on the changed words and offers nothing more.
          if (round === 0 && left.some((x) => x.rule === v.rule && overlaps(x.range!, mine))) group = 'not-cleared';
          break;
        }
        const next = applyCorrection(cur.join(''), p.range, p.word);
        if (next === null) break;
        const nextChars = Array.from(next);
        const c = changed(cur, nextChars);
        // shown as whole words: "SEIMHIU: phoiblí" rather than the letters that changed
        let wa = c.from, wb = c.oldTo, wn = c.newTo;
        while (wa > 0 && isWordChar(cur[wa - 1])) wa--;
        while (wb < cur.length && isWordChar(cur[wb])) { wb++; wn++; }
        steps.push(`${n.rule}: ${cur.slice(wa, wb).join('')} -> ${nextChars.slice(wa, wn).join('')}`);
        // A change inside a word this fix changed (an insertion right before it, "an" before
        // hIndia, does not count).
        const inserted = nextChars.slice(c.from, c.newTo).join('');
        const touched = c.oldTo > c.from ? overlaps({ from: c.from, to: c.oldTo }, mine)
          : c.from > mine.from && c.from < mine.to || c.from === mine.from && !/\s$/.test(inserted);
        if (touched) { group = 'rechanged'; break; }
        mine = shift(mine, c);
        region = shift(region, c);
        cur = nextChars;
        left = check(next).filter((x) => overlaps(x.range!, region));
      }
    }
    totals[group]++;
    const st = byRule.get(v.rule) ?? { ok: 0, 'next-step': 0, rechanged: 0, 'not-cleared': 0, examples: [] };
    st[group]++;
    if ((group === 'rechanged' || group === 'not-cleared') && st.examples.filter((e) => e.startsWith(group)).length < show) {
      st.examples.push(`${group}: ${s}\n      -> ${after}${steps.length ? `\n      then ${steps.join('; ')}` : ''}`);
    }
    byRule.set(v.rule, st);
    rows.push([v.rule, group, s, after, steps.join('; ')].join('\t'));
  }
}
if (out) fs.writeFileSync(out, rows.join('\n') + '\n');
const n = rows.length;
console.log(`${n} fixes: ${totals.ok} ok, ${totals['next-step']} leave a next step, ${totals.rechanged} rechanged, ${totals['not-cleared']} not cleared`);
for (const [rule, r] of [...byRule].sort((a, b) => (b[1].rechanged + b[1]['not-cleared']) - (a[1].rechanged + a[1]['not-cleared']))) {
  if (!r.rechanged && !r['not-cleared']) continue;
  console.log(`${rule}: ${r.ok} ok, ${r['next-step']} next step, ${r.rechanged} rechanged, ${r['not-cleared']} not cleared`);
  for (const e of r.examples) console.log(`    ${e}`);
}
