// Rebuilds the rule set, mirroring what An Gramadóir's Makefile-xx.in does
// (github.com/kscanne/gramadoir), then extracts it to JSON for the TS engine.
// The rule files themselves (rialacha, aonchiall, comhshuite) and the macros are
// in grammar/; everything else (compiler scripts, tagset, giorr, unigram) comes
// from the An Gramadóir checkout.
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

// The rule files: grammar/<name>-ga.in (UTF-8; the compiler works in Latin-1).
// tools/upstream-diff.mjs lists the changes since the An Gramadóir commit they came from.
function readGrammar(name) {
  const file = path.join(here, '..', 'grammar', `${name}-ga.in`);
  const s = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  const bad = /[^\u0000-ÿ]/.exec(s);
  if (bad) throw new Error(`${file}: character outside Latin-1: ${bad[0]}`);
  return s;
}

// The macros (grammar/macra-ga.meta.pl): a Perl
// script with Latin-1 characters in its patterns, kept in UTF-8, so a Latin-1 copy is
// what Perl runs.
const macraSrc = fs.readFileSync(path.join(here, '..', 'grammar', 'macra-ga.meta.pl'), 'utf8').replace(/\r/g, '');
if (/[^\u0000-ÿ]/.test(macraSrc)) throw new Error('grammar/macra-ga.meta.pl: characters outside Latin-1');
const macra = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gr-macra-')), 'macra-ga.meta.pl');
fs.writeFileSync(macra, macraSrc, 'latin1');

// aonchiall / comhshuite / rialacha: .in -> gin -> macra -> <name>.meta.pl
function generate(name) {
  let s = readGrammar(name);
  s = run([path.join(up, 'gin.meta.pl'), attrtags], s);
  s = run(['-p', macra], s);
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

// CLAUSEEND, written as the last word of a local rule, matches the end of a
// clause: punctuation straight after the previous word, or the end of the
// sentence. CLAUSESTART, written as the first word, matches the start of one:
// the start of the sentence, or punctuation before the next word. The rule
// syntax cannot say this (gin turns every "(" into "(?:", so no lookahead
// or lookbehind), so the compiled word is replaced by one here.
// AFTERFEMNAME, also a first word, matches after a feminine singular noun and a
// capitalised unknown word (a trade name: sa scarbhileog Excel chéanna). The
// unknown word carries the word list's message, and an :OK removes only the first
// error mark it matches, so the context has to sit outside the match.
// AFTERNOUNANDGEN, a first word, matches after a noun that lenites an adjective (a feminine singular,
// a masculine genitive singular, a plural in a slender consonant) and a genitive noun: an adjective
// there may describe the first noun (feiste comharthaíochta cheadaithe; CO17 4.2). The genitive pair
// may carry a hint of its own (WEAKSEIMHIUGEN), so the context sits outside the match.
// AFTERNOUNANDADJS, a first word, matches after the same nouns and one or more adjectives, with or
// without commas between them: every adjective in the list agrees with the noun, and a vowel-initial
// one can't show lenition (seirbhís ghairmiúil, éifeachtach, chúirtéiseach; CO17 4.2).
// AFTERTEN, a first word, matches after one of the tens (fiche ... nócha), kept out of the mark
// (fiche a dhá: only a dhá is marked, CO17 9.3.10(c)(ii)).
// AFTERMANNERNOUN, a first word, matches after one of the nouns of CO17 11.3.1(h)
// (áit, bealach, caoi, cúis, dóigh, fáth, réasún, slí, treo), kept out of the mark.
// VNLATER, a last word, matches when a + a verbal noun follows in the same clause, at most 10
// words on (CO17 3.3.2(a): tar éis an Coinbhinsiún seo a shíniú; le linn an tseirbhís ar mhaithe
// leis an leas eacnamaíoch i gcoitinne a oibriú). No punctuation and no personal verb in between;
// VERBALNOUN is the list of verbal nouns the engine fills in at load (src/engine.ts).
const CLAUSEEND_WORD = ' <[A-DF-Z][^>]*>CLAUSEEND</[A-DF-Z]>';
const CLAUSEEND_RE = '(?=[.,;:!?)"\']| </line>)'; // the checker sees curly quotes folded to ASCII
const TOKEN = '(?:<E[^>]*>)?(?:<(?!V p=)[A-DF-Z][^>]*>[^<]+</[A-DF-Z]>|<B><Z>(?:<[^>]+>)+</Z>[^<]+</B>)(?:</E>)?';
const WORD = (w) => `(?:<E[^>]*>)?(?:<[A-DF-Z][^>]*>|<B><Z>(?:<[^>]+>)+</Z>)${w}</[A-DF-Z]>(?:</E>)?`;
// The verbal noun: a noun, or a word still ambiguous with a noun reading, not a finite verb (nuair a
// theip: teip is also a verbal noun).
const VNWORD = '(?:<E[^>]*>)?(?:<N[^>]*>|<B><Z>(?:<[^>]+>)*<N[^>]*>(?:<[^>]+>)*</Z>)VERBALNOUN</[A-DF-Z]>(?:</E>)?';
const VNLATER_RE = `(?=(?: ${TOKEN}){0,10} ${WORD('[Aa]')} ${VNWORD})`;
const VNLATER_WORDS = [' <[A-DF-Z][^>]*>VNLATER</[A-DF-Z]>', ' (?:<[/A-DF-Z][^>]*>)+VNLATER</[A-DF-Z]>'];
// The word as compiled in rialacha, and in aonchiall (where a word may still carry
// several tags).
const startWords = (w) => [`<[A-DF-Z][^>]*>${w}</[A-DF-Z]> `, `(?:<[/A-DF-Z][^>]*>)+${w}</[A-DF-Z]> `];
// A noun that lenites an adjective after it: a feminine singular, a masculine genitive singular, a
// plural in a slender consonant.
const LENITINGNOUN = '(?:<E[^>]*>)?<N (?:pl="n" gnt="n" gnd="f"|pl="n" gnt="y" gnd="m"|pl="y" gnt="n"[^>]*(?=>[^<]*[eéií][^aeiouáéíóú<]+<))[^>]*>[^<]+</N>';
const ADJ = '(?:<E[^>]*>)?<A[^>]*>[^<]+</A>(?:</E>)?';
const STARTS = {
  CLAUSESTART: '(?<=(?:<line>|[.,;:!?("\']) )',
  AFTERFEMNAME: '(?<=<N pl="n" gnt="n" gnd="f">[^<]+</N> <E[^>]*><X>[A-ZÁÉÍÓÚ][^<]*</X></E> )',
  AFTERNOUNANDGEN: `(?<=${LENITINGNOUN} (?:<E[^>]*>)?<N[^>]* gnt="y"[^>]*>[^<]+</N>(?:</E>)? )`,
  AFTERNOUNANDADJS: `(?<=${LENITINGNOUN}(?:</E>)? (?:${ADJ},? )+)`,
  AFTERTEN: '(?<=<[AN][^>]*>(?:[Ff]iche|[Tt]ríocha|[Dd]aichead|[Cc]aoga|[Ss]easca|[Ss]eachtó|[Oo]chtó|[Nn]ócha)</[AN]> )',
  AFTERMANNERNOUN: '(?<=<N[^>]*>(?:h?[Áá]it|[Bb]h?ealach|g?[Cc]h?aoi|[Cc]h?úis|[Dd]h?óigh|[Ff]h?áth|[Rr]éasún|t?[Ss]lí|[Tt]reo)</N> )',
};
for (const name of ['rialacha', 'aonchiall']) {
  const file = path.join(outDir, 'rules', `${name}.json`);
  const rules = JSON.parse(fs.readFileSync(file, 'utf8'));
  let n = 0;
  const fix = (rs) => rs.forEach((r) => {
    if (typeof r.re === 'string' && r.re.includes('CLAUSEEND')) {
      const parts = r.re.split(CLAUSEEND_WORD);
      // The compiler closes the match with ")" and, for error rules, "(?![<>])"; the lookahead goes before them.
      if (parts.length !== 2 || !/^\)(\(\?!\[<>\]\))?$/.test(parts[1])) throw new Error(`${name}: CLAUSEEND must be the last word of a rule: ${r.re}`);
      r.re = parts[0] + CLAUSEEND_RE + parts[1];
      n++;
    }
    if (typeof r.re === 'string' && r.re.includes('VNLATER')) {
      const word = VNLATER_WORDS.find((w) => r.re.includes(w));
      const parts = word ? r.re.split(word) : [];
      // rialacha: the match closes with ')' (and '(?![<>])'); aonchiall: the context group closes with ')'.
      if (parts.length !== 2 || !/^\)(\(\?!\[<>\]\))?$/.test(parts[1])) throw new Error(`${name}: VNLATER must be the last word of a rule: ${r.re}`);
      r.re = parts[0] + VNLATER_RE + parts[1];
      n++;
    }
    for (const [start, lookbehind] of Object.entries(STARTS)) {
      if (typeof r.re !== 'string' || !r.re.includes(start)) continue;
      const word = startWords(start).find((w) => r.re.includes(w)) ?? startWords(start)[0];
      const parts = r.re.split(word);
      // The compiler opens the match with "(" and, for error rules, "(?<![<>])" before it.
      if (parts.length !== 2 || !/^(\(\?<!\[<>\]\))?\($/.test(parts[0])) throw new Error(`${name}: ${start} must be the first word of a rule: ${r.re}`);
      r.re = parts[0] + lookbehind + parts[1];
      n++;
    }
    if (r.then) fix(r.then);
  });
  fix(rules);
  if (n) {
    fs.writeFileSync(file, JSON.stringify(rules));
    console.log(`${name}: ${n} placeholder replacements`);
  }
}
