// A record of what the checker does with every sentence we have, to compare before and after a
// change to the rules. It records behaviour, not correctness: a difference is something to look
// at, and whether the old or the new output is right is a language question.
//
// The inputs are local (git-ignored) or in test/: Gaois Acts (the last gaois-check run), the ELRC
// sets (the last text-check run), the book's examples (test/caighdean/chNN.json), the derived
// variants (test/caighdean/variants.tsv), the review probes (.sources/review/probes/*/probes.tsv,
// made up), the example lines in grammar/rialacha-ga.in (#. lines, upstream's) and upstream's
// ga/triail.xml. Missing inputs are skipped.
//
// Usage (from the repo root):
//   node tools/rule-baseline.ts snapshot <out.tsv>     set, sentence, messages (MSG@from-to ...)
//   node tools/rule-baseline.ts diff <old.tsv> <new.tsv>
//   node tools/rule-baseline.ts fire <out.json>        per rule: how often it fires, by set; per
//                                                      exception: how often, and which messages it removed
// Options: --gaois <dir> --elrc <dir> (default: the newest .sources/gaois/checkall* and
// .sources/elrc/check* directories).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';
import { foldForEngine } from '../web/fold.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [, , cmd, ...rest] = process.argv;
const opt = (name: string) => { const i = rest.indexOf(name); return i >= 0 ? rest.splice(i, 2)[1] : undefined; };
const exists = (p: string) => fs.existsSync(path.join(root, p));
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

/** The newest numbered run directory, e.g. .sources/elrc/check31. */
function newest(dir: string, prefix: string): string | undefined {
  if (!exists(dir)) return undefined;
  const runs = fs.readdirSync(path.join(root, dir)).filter((d) => new RegExp(`^${prefix}\\d+$`).test(d));
  runs.sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)));
  return runs.length ? `${dir}/${runs[runs.length - 1]}` : undefined;
}

export function inputs(gaoisDir?: string, elrcDir?: string): [string, string][] {
  const out: [string, string][] = [];
  const add = (set: string, s: string) => { if (s.trim()) out.push([set, s.trim()]); };
  const lastColumn = (dir: string | undefined, set: string) => {
    if (!dir) return;
    for (const f of ['accepted.tsv', 'flagged.tsv']) {
      if (exists(`${dir}/${f}`)) for (const l of read(`${dir}/${f}`).split('\n')) if (l) add(set, l.split('\t').at(-1)!);
    }
  };
  lastColumn(gaoisDir ?? newest('.sources/gaois', 'checkall'), 'gaois');
  lastColumn(elrcDir ?? newest('.sources/elrc', 'check'), 'elrc');
  for (const f of fs.readdirSync(path.join(root, 'test/caighdean')).filter((x) => /^ch\d+\.json$/.test(x)).sort()) {
    for (const e of JSON.parse(read(`test/caighdean/${f}`))) add('book', e.text);
  }
  {
    const ls = read('test/caighdean/variants.tsv').split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
    const vi = ls[0].split('\t').indexOf('variant');
    for (const l of ls.slice(1)) add('variants', l.split('\t')[vi]);
  }
  if (exists('.sources/review/probes')) {
    for (const d of fs.readdirSync(path.join(root, '.sources/review/probes')).sort()) {
      const p = `.sources/review/probes/${d}/probes.tsv`;
      if (exists(p)) for (const l of read(p).split('\n')) { const c = l.split('\t'); if (c.length >= 3) add('probes', c[2]); }
    }
  }
  for (const l of read('grammar/rialacha-ga.in').split(/\r?\n/)) if (l.startsWith('#.')) add('examples', l.slice(2).replace(/ \(OK\)([.?!]?)$/, '$1'));
  if (exists('.sources/gramadoir/ga/triail.xml')) {
    const un = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const seen = new Set<string>();
    for (const m of read('.sources/gramadoir/ga/triail.xml').matchAll(/context="([^"]*)"/g)) {
      const c = un(m[1]);
      if (!seen.has(c)) { seen.add(c); add('triail', c); }
    }
  }
  return out;
}

const describe = (errs: { ruleId: string; fromx: number; tox: number }[]) =>
  errs.map((e) => `${e.ruleId.replace(/^Lingua::GA::Gramadoir\//, '')}@${e.fromx}-${e.tox}`).join(' ');
const clean = (s: string) => s.replace(/[\t\n]/g, ' ');

const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (!isMain) {
  // imported (tools/fix-check.ts): only inputs() is used
} else if (cmd === 'snapshot') {
  const [outFile] = rest;
  const gr = new Gramadoir(loadData(path.join(root, 'data')), { fixSpelling: true });
  const rows = inputs(opt('--gaois'), opt('--elrc')).map(([set, s]) => `${set}\t${clean(s)}\t${describe(gr.grammaticalErrors(foldForEngine(s)))}`);
  fs.writeFileSync(outFile, rows.join('\n') + '\n');
  console.log(`${rows.length} sentences -> ${outFile}`);
} else if (cmd === 'diff') {
  const [a, b] = rest;
  const load = (f: string) => new Map(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => { const c = l.split('\t'); return [`${c[0]}\t${c[1]}`, c[2] ?? '']; }));
  const A = load(a), B = load(b);
  let n = 0;
  for (const [k, v] of A) {
    if (!B.has(k)) continue;
    if (B.get(k) !== v) { n++; console.log(`${k}\n  - ${v || '(clean)'}\n  + ${B.get(k) || '(clean)'}`); }
  }
  const onlyA = [...A.keys()].filter((k) => !B.has(k)).length, onlyB = [...B.keys()].filter((k) => !A.has(k)).length;
  console.log(`${n} sentences changed${onlyA || onlyB ? `; ${onlyA} only in the old, ${onlyB} only in the new` : ''}`);
} else if (cmd === 'fire') {
  const [outFile] = rest;
  const data = loadData(path.join(root, 'data'));
  const lines: Record<string, number[]> = JSON.parse(read('data/rules/lines.json'));
  // Each error rule's mark carries its source line as its reason (r="L123"), so that the errors
  // reported can be counted by the rule that made them ("shown").
  {
    let k = 0;
    data.rules.rialacha = data.rules.rialacha.map((r) => {
      const line = lines.rialacha[k];
      k += 1 + (r.then?.length ?? 0);
      return r.repl ? { ...r, repl: r.repl.replace(/<E msg="([^"]*)"(?: r="[^"]*")?>/, `<E msg="$1" r="L${line}">`) } : r;
    });
  }
  const gr = new Gramadoir(data, { fixSpelling: true });
  type Compiled = { apply: (...g: (string | undefined)[]) => string; then?: Compiled[] };
  const compiled = (gr as unknown as { rialacha: Compiled[] }).rialacha;
  const msgOf = (repl: string | undefined) => /<E msg="([^"{]+)/.exec(repl ?? '')?.[1] ?? 'OK';
  // line -> {msg, fires by set, stripped messages (exceptions)}
  type Stat = { line: number; msg: string; parent?: number; fires: Record<string, number>; shown?: Record<string, number>; stripped?: Record<string, number> };
  const stats: Stat[] = [];
  let set = '';
  let k = 0;
  data.rules.rialacha.forEach((r, i) => {
    const st: Stat = { line: lines.rialacha[k++], msg: msgOf(r.repl), fires: {}, ...(r.repl ? { shown: {} } : {}) };
    stats.push(st);
    const c = compiled[i];
    const o = c.apply;
    c.apply = (...g) => { st.fires[set] = (st.fires[set] ?? 0) + 1; return o(...g); };
    (r.then ?? []).forEach((_, j) => {
      const ex: Stat = { line: lines.rialacha[k++], msg: 'OK', parent: st.line, fires: {}, stripped: {} };
      stats.push(ex);
      const t = c.then![j];
      const o2 = t.apply;
      t.apply = (...g) => {
        ex.fires[set] = (ex.fires[set] ?? 0) + 1;
        const m = /<E msg="([^"{]+)/.exec(g[0] ?? '')?.[1] ?? '(none)';
        ex.stripped![m] = (ex.stripped![m] ?? 0) + 1;
        return o2(...g);
      };
    });
  });
  const all = inputs(opt('--gaois'), opt('--elrc'));
  const byLine = new Map(stats.map((s) => [s.line, s]));
  for (const [s, sentence] of all) {
    set = s;
    for (const e of gr.grammaticalErrors(foldForEngine(sentence))) {
      const st = e.reason ? byLine.get(Number(e.reason.slice(1))) : undefined;
      if (st?.shown) st.shown[s] = (st.shown[s] ?? 0) + 1;
    }
  }
  fs.writeFileSync(outFile, JSON.stringify(stats));
  const real = new Set(['gaois', 'elrc', 'book']);
  const errorRules = stats.filter((s) => s.msg !== 'OK');
  const firesOn = (s: Stat, sets: (x: string) => boolean) => Object.keys(s.fires).some(sets);
  const exceptions = stats.filter((s) => s.parent !== undefined);
  const foreign = exceptions.filter((e) => Object.keys(e.stripped!).some((m) => m !== stats.find((s) => s.line === e.parent)!.msg));
  console.log(`${all.length} sentences. Error rules: ${errorRules.length}; fire on real text (gaois, elrc, book): ${errorRules.filter((s) => firesOn(s, (x) => real.has(x))).length}; on anything: ${errorRules.filter((s) => firesOn(s, () => true)).length}.`);
  console.log(`Exceptions after a rule: ${exceptions.length}; ever fire: ${exceptions.filter((s) => firesOn(s, () => true)).length}; ever remove another rule's message: ${foreign.length}${foreign.length ? ` (lines ${foreign.map((f) => f.line).join(', ')})` : ''}.`);
} else {
  console.error('usage: node tools/rule-baseline.ts snapshot <out.tsv> | diff <old.tsv> <new.tsv> | fire <out.json>');
  process.exit(2);
}
