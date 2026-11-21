// Extracts the generated s/// rule blocks (aonchiall, comhshuite, giorr,
// rialacha, unigram) from a Lingua::GA::Gramadoir Gramadoir.pm into JSON that
// the TypeScript engine consumes. The .pm is either the prebuilt one in the
// CPAN 0.70 distribution (lib/Lingua/GA/Gramadoir.pm, for data/legacy-0.70/) or
// the one generate-rules.mjs assembles from the upstream source.
//
// Usage: node tools/extract-rules.mjs <path/to/Gramadoir.pm> <outDir>
// (generate-rules.mjs imports extractRules instead.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULE_FILES = ['aonchiall', 'comhshuite', 'giorr', 'rialacha', 'unigram'];

// Split "s/PAT/REPL/FLAGS;" on unescaped slashes.
function parseSubst(line) {
  const s = line.trim();
  if (!s.startsWith('s/')) return null;
  const parts = [];
  let cur = '';
  let i = 2;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { cur += c + s[i + 1]; i++; continue; }
    if (c === '/' && parts.length < 2) {
      parts.push(cur);
      cur = '';
      if (parts.length === 2) { i++; break; }
      continue;
    }
    cur += c;
  }
  const flags = s.slice(i).replace(/;\s*$/, '');
  if (parts.length !== 2) return null;
  return { pat: parts[0], repl: parts[1], flags };
}

// Perl regex source -> JS regex source (only the constructs that occur).
function perlPatToJs(p) {
  return p
    .replace(/\\x\{([0-9a-fA-F]+)\}/g, (_, h) => '\\u' + h.padStart(4, '0'))
    .replace(/\\\//g, '/')
    .replace(/\$NOBD/g, '\\u0002')
    .replace(/\[(\^?)\]/g, '[$1\\]'); // Perl: ']' first in a class is literal
}

// Literal replacement text: handles $N, escaped slashes, \x{..}.
function perlReplToTemplate(r) {
  return r
    .replace(/\\x\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\$NOBD/g, '\u0002')
    .replace(/\\\//g, '/')
    .replace(/\\([\\<>"])/g, '$1');
}

function classify(sub) {
  const pat = perlPatToJs(sub.pat);
  if (!/e/.test(sub.flags)) {
    return { re: pat, flags: sub.flags.replace(/[^gi]/g, ''), kind: 'tpl', repl: perlReplToTemplate(sub.repl) };
  }
  let m;
  if ((m = /^strip_errors\(\$1\);?$/.exec(sub.repl))) return { re: pat, flags: 'g', kind: 'strip_errors' };
  // "$1".strip_badpos($2,$3,'<A[^>]+.>')."$4"
  if ((m = /^"\$1"\.strip_badpos\(\$2,\$3,'(.*)'\)\."\$4"$/.exec(sub.repl))) {
    return { re: pat, flags: 'g', kind: 'strip_badpos', badpos: perlPatToJs(m[1]) };
  }
  return { re: pat, flags: sub.flags, kind: 'UNSUPPORTED', repl: sub.repl };
}

function block(lines, name) {
  const start = lines.findIndex((l) => l === `sub ${name}`);
  if (start < 0) throw new Error('missing sub ' + name);
  const out = [];
  const odd = [];
  let cond = null; // rule whose "then" block we are inside: `if (s/.../.../g) { ... }`
  for (let i = start + 2; i < lines.length && lines[i] !== '}'; i++) {
    const l = lines[i];
    if (/^\s*(for \(\$_\[0\]\) \{|#.*|)$/.test(l)) continue;
    if (/^\s*\}\s*$/.test(l)) { cond = null; continue; }
    const ifm = /^\s*if \((s\/.*)\) \{\s*$/.exec(l);
    if (ifm) {
      const sub = parseSubst(ifm[1]);
      if (!sub) { odd.push({ line: i + 1, text: l.slice(0, 200) }); continue; }
      cond = { ...classify(sub), then: [] };
      out.push(cond);
      continue;
    }
    const sub = parseSubst(l);
    if (!sub) { odd.push({ line: i + 1, text: l.slice(0, 200) }); continue; }
    (cond ? cond.then : out).push(classify(sub));
  }
  return { rules: out, odd };
}

/**
 * The rule blocks of a Gramadoir.pm (its text, Latin-1): for each rule file, the rules, plus
 * those it could not convert (`bad`) and the lines it could not read (`odd`).
 */
export function extractRules(text) {
  const lines = text.split(/\r?\n/);
  const out = {};
  for (const name of RULE_FILES) {
    const { rules, odd } = block(lines, name);
    out[name] = { rules, odd, bad: rules.filter((r) => r.kind === 'UNSUPPORTED') };
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , src, outDir] = process.argv;
  const all = extractRules(fs.readFileSync(src, 'latin1'));
  fs.mkdirSync(outDir, { recursive: true });
  const summary = {};
  for (const [name, { rules, odd, bad }] of Object.entries(all)) {
    summary[name] = { total: rules.length, unsupported: bad.length, unparsedLines: odd.length };
    if (bad.length) console.error(name, 'unsupported sample:', bad.slice(0, 3));
    if (odd.length) console.error(name, 'unparsed sample:', odd.slice(0, 3));
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(rules));
  }
  console.table(summary);
}
