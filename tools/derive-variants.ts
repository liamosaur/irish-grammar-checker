// Candidate error sentences derived from the Caighdeán test suites (test/caighdean/chNN.json),
// for review. For each correct sentence the checker accepts, one initial mutation at a time is
// undone mechanically (lenition, eclipsis, t-, h-: the functions in web/corrections.ts), and the
// result is written to test/caighdean/variants.tsv with what the checker does with it now.
//
// Nothing here decides whether a variant is correct Irish: undoing a mutation can give an error,
// a correct sentence with another meaning, or something that was never a mutation (chun -> cun).
// That is the reviewer's call, in the verdict column (wrong / ok / skip; blank = not reviewed).
// test/caighdean-variants.test.ts tests the rows that have a verdict.
//
// Re-running keeps every verdict (and every reviewed row, even if its sentence is no longer
// generated) and refreshes the checker column, which is a record of the checker's behaviour.
//
// Usage: node tools/derive-variants.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';
import { analyse } from '../web/annotate.ts';
import { unHPrefix, uneclipse, unlenite, unTPrefix } from '../web/corrections.ts';
import { foldForEngine } from '../web/fold.ts';
import { checkVariant, COLUMNS, readVariants, type VariantRow, writeVariants } from '../test/caighdean/variants.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'test', 'caighdean');
const file = path.join(dir, 'variants.tsv');

const LEXICON_ONLY = new Set(['ANAITHNID', 'ANKOTHVOS', 'UNKNOWN', 'MOLADH', 'GRAM', 'MOIRF', 'MOIRFREIMIR', 'COMHFHOCAL', 'COMHCHAIGH']);
const engine = new Gramadoir(loadData(path.join(root, 'data')), { fixSpelling: true });
const complaints = (text: string) =>
  analyse(text, engine.grammaticalErrors(foldForEngine(text))).views.filter((v) => !LEXICON_ONLY.has(v.rule));

const UNDO: [string, (w: string) => string | null][] = [
  ['lenition', unlenite], ['eclipsis', uneclipse], ['t-', unTPrefix], ['h-', unHPrefix],
];

const existing = fs.existsSync(file) ? readVariants(fs.readFileSync(file, 'utf8')) : [];
const keyOf = (r: Pick<VariantRow, 'chapter' | 'original' | 'at' | 'kind'>) => `${r.chapter}|${r.original}|${r.at}|${r.kind}`;
const old = new Map(existing.map((r) => [keyOf(r), r]));

const rows = new Map<string, VariantRow>();
for (const f of fs.readdirSync(dir).filter((x) => /^ch\d+\.json$/.test(x)).sort()) {
  const chapter = String(Number(/\d+/.exec(f)![0]));
  const entries: { section: string; page: number; text: string; known?: string; hint?: string }[] =
    JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  for (const e of entries) {
    if (e.known || e.hint || complaints(e.text).length) continue; // only sentences the checker accepts
    for (const m of e.text.matchAll(/[\p{L}’'-]+/gu)) {
      const prev = /(\S+)\s*$/.exec(e.text.slice(0, m.index))?.[1] ?? '';
      for (const [kind, undo] of UNDO) {
        const to = undo(m[0]);
        if (!to || to === m[0]) continue;
        const row: VariantRow = {
          verdict: '', kind, change: `${m[0]} → ${to}`, before: prev,
          variant: e.text.slice(0, m.index) + to + e.text.slice(m.index! + m[0].length),
          original: e.text, chapter, section: e.section, page: String(e.page), at: String(m.index), checker: '',
        };
        rows.set(keyOf(row), { ...row, verdict: old.get(keyOf(row))?.verdict ?? '' });
      }
    }
  }
}
// Keep reviewed rows whose sentence is no longer generated (e.g. the checker now flags the original).
for (const r of existing) if (r.verdict && !rows.has(keyOf(r))) rows.set(keyOf(r), r);

for (const r of rows.values()) r.checker = checkVariant(r, complaints);

const sorted = [...rows.values()].sort((a, b) =>
  a.kind.localeCompare(b.kind) || a.before.toLowerCase().localeCompare(b.before.toLowerCase(), 'ga') ||
  a.change.localeCompare(b.change, 'ga') || Number(a.chapter) - Number(b.chapter) || a.variant.localeCompare(b.variant, 'ga'));
fs.writeFileSync(file, writeVariants(sorted));
const reviewed = sorted.filter((r) => r.verdict).length;
console.log(`${sorted.length} variants (${reviewed} reviewed) -> ${path.relative(root, file)}; columns: ${COLUMNS.join(', ')}`);
