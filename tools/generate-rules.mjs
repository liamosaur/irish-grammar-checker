// Rebuilds the rule set from the *upstream source* (github.com/kscanne/gramadoir),
// mirroring what Makefile-xx.in does, then extracts it to JSON for the TS engine.
//
// Perl is only needed here, at data-build time (the original rule "compiler" is a
// chain of small Perl filter scripts). The runtime engine never uses Perl.
//
// Usage: node tools/generate-rules.mjs <upstream-checkout> <outDir>
//   env PERL_BIN = perl executable (default: perl)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , up, outDir] = process.argv;
if (!up || !outDir) { console.error('usage: node tools/generate-rules.mjs <upstream-checkout> <outDir>'); process.exit(2); }
const perl = process.env.PERL_BIN ?? 'perl';
const here = path.dirname(fileURLToPath(import.meta.url));

// Files are Latin-1; a Windows checkout may have CRLF line endings, upstream is LF.
const read = (f) => fs.readFileSync(path.join(up, f)).toString('latin1').replace(/\r/g, '');
const run = (args, input) =>
  execFileSync(perl, args, { input: Buffer.from(input, 'latin1'), env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 256 * 1024 * 1024 }).toString('latin1');

// Values from ga/configure
const BDCHARS = 'A-ZÁÉÍÓÚa-záéíóú';
const UPPERS = 'A-ZÁÉÍÓÚ';
const LOWERS = 'a-záéíóú';

// Tags that carry attributes: sed -n '/<[A-Z] /{s/^[0-9]* <\([A-Z]\).*/\1/; p;}' pos-ga.txt | sort -u | tr -d "\n"
const attrtags = [
  ...new Set(read('ga/pos-ga.txt').split('\n').filter((l) => /<[A-Z] /.test(l)).map((l) => l.replace(/^[0-9]* <([A-Z]).*/, '$1'))),
].sort().join('');

// aonchiall / comhshuite / rialacha: .in -> gin -> macra -> <name>.meta.pl
function generate(name) {
  let s = read(`ga/${name}-ga.in`);
  s = run([path.join(up, 'gin.meta.pl'), attrtags], s);
  s = run(['-p', path.join(up, 'ga/macra-ga.meta.pl')], s);
  s = run([path.join(up, `${name}.meta.pl`)], s);
  return s.split('\n').map((l) => (l === '' ? l : '\t' + l)).join('\n');
}

// giorr: .pre lines starting s/ , plus one abbreviation rule per giorr-ga.txt line
function giorr() {
  const pre = read('ga/giorr-ga.pre').split('\n').filter((l) => /^s\//.test(l)).map((l) => '\t' + l);
  const abbr = read('ga/giorr-ga.txt').split('\n').filter((l) => l !== '')
    .map((l) => `\ts/([^@BDCHARS@]${l.replace(/ .*/, '')})\\./$1$NOBD./g;`);
  return [...pre, ...abbr].join('\n') + '\n';
}

// unigram: .pre lines starting s/ , plus one rule per unigram-ga.txt line
function unigram() {
  const pre = read('ga/unigram-ga.pre').split('\n').filter((l) => /^s\//.test(l)).map((l) => '\t' + l);
  const rules = read('ga/unigram-ga.txt').split('\n').filter((l) => l !== '')
    .map((l) => l.replace(/^(<([A-Z])[^>]*)>/, (_m, g1, g2) =>
      `\ts/<B><Z>(?:<[^>]*>)*${g1}.>(?:<[^>]*>)*<\\/Z>([^<]+)<\\/B>/${g1}>$1<\\/${g2}>/g;`));
  return [...pre, ...rules].join('\n') + '\n';
}

const gen = { aonchiall: generate('aonchiall'), comhshuite: generate('comhshuite'), giorr: giorr(), rialacha: generate('rialacha'), unigram: unigram() };

// Assemble Gramadoir.pm like the Makefile: insert each file after its marker line.
let pm = read('Gramadoir.pm.in');
for (const [name, body] of Object.entries(gen)) {
  const re = new RegExp(`^(# ${name} code [^\\n]*)$`, 'm');
  if (!re.test(pm)) throw new Error('marker not found for ' + name);
  pm = pm.replace(re, (m) => m + '\n' + body.replace(/\n$/, ''));
}
pm = pm.replace(/@BDCHARS@/g, BDCHARS).replace(/@CAPITALS@/g, UPPERS).replace(/@LOWERS@/g, LOWERS);
pm = pm.replace(/^# [a-z]* code goes here\n/gm, '');
// Legacy-encoding step from the Makefile: non-ASCII bytes -> \x{..}
pm = pm.replace(/[\u0080-ÿ]/g, (c) => `\\x{${c.charCodeAt(0).toString(16)}}`);

fs.mkdirSync(outDir, { recursive: true });
const asm = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-asm-')), 'Gramadoir.assembled.pm');
fs.writeFileSync(asm, pm, 'latin1');
console.log('attribute tags:', attrtags);
console.log('assembled', asm, pm.length, 'bytes');
execFileSync(process.execPath, [path.join(here, 'extract-rules.mjs'), asm, path.join(outDir, 'rules')], { stdio: 'inherit' });
