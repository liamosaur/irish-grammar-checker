// Measures how far our output is from the author's newer expected output:
// upstream ga/triail.xml holds expected API errors for a set of sentences.
// Usage: [DATA_DIR=<dir>] [OVERLAY=0] [SHOW=<n>] node tools/drift.mjs <triail.xml>
//   DATA_DIR  data to measure (default data/); its BuNaMo overlay is used if it has one
//   OVERLAY=0 measure the 0.70 word list alone, without the overlay
import fs from 'node:fs';
import path from 'node:path';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';

const xml = fs.readFileSync(process.argv[2], 'utf8');
const unent = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const expected = new Map(); // context -> Set("ruleId|errortext")
for (const m of xml.matchAll(/<error ([^>]*?)\/>/g)) {
  const a = Object.fromEntries([...m[1].matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
  const ctx = unent(a.context);
  const text = unent(a.context).slice(Number(a.contextoffset), Number(a.contextoffset) + Number(a.errorlength));
  if (!expected.has(ctx)) expected.set(ctx, new Set());
  expected.get(ctx).add(`${a.ruleId.replace('Lingua::GA::Gramadoir/', '')}|${text}`);
}

const dataDir = process.env.DATA_DIR ?? 'data';
const overlay = process.env.OVERLAY !== '0' && fs.existsSync(path.join(dataDir, 'bunamo-overlay.json'));
const gr = new Gramadoir(loadData(dataDir, undefined, { overlay }));
let exp = 0, found = 0, extra = 0, ctxExact = 0;
const missed = [], added = [];
for (const [ctx, want] of expected) {
  const got = new Set();
  for (const e of gr.grammaticalErrors(ctx)) {
    if (e.context !== ctx.replace(/&/g, '&amp;').replace(/"/g, '&quot;') && !ctx.includes(e.errortext)) continue;
    // PREFIXTS (t before s) is upstream's PREFIXT, split off for its own message (t, not t-)
    got.add(`${e.ruleId.replace('Lingua::GA::Gramadoir/', '').replace(/^PREFIXTS\b/, 'PREFIXT')}|${e.errortext}`);
  }
  exp += want.size;
  let all = true;
  for (const w of want) if (got.has(w)) found++; else { all = false; missed.push(`${ctx}  ->  ${w}`); }
  for (const g of got) if (!want.has(g)) { extra++; all = false; added.push(`${ctx}  ->  ${g}`); }
  if (all) ctxExact++;
}
console.log(`contexts: ${expected.size}, identical to expected: ${ctxExact}`);
console.log(`expected errors: ${exp}, we also report: ${found}, missing: ${exp - found}, extra (not expected): ${extra}`);
console.log('\nSample missing:'); missed.slice(0, Number(process.env.SHOW ?? 8)).forEach((l) => console.log(' ', l.slice(0, 170)));
console.log('\nSample extra:'); added.slice(0, Number(process.env.SHOW ?? 5)).forEach((l) => console.log(' ', l.slice(0, 170)));
