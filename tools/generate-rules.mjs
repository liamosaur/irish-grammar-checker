// Rebuilds the rule set, as An Gramadóir's Makefile-xx.in does
// (github.com/kscanne/gramadoir), and writes it as JSON for the TS engine.
// The rule files themselves (rialacha, aonchiall, comhshuite) and the macros are
// in grammar/; the tagset, giorr, unigram and the Gramadoir.pm.in template come
// from the An Gramadóir checkout. The compiler is tools/rule-compiler.mjs (the
// Perl filter scripts of the original, in JavaScript), so no Perl is needed.
//
// Usage: node tools/generate-rules.mjs <upstream-checkout> <outDir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRules } from './extract-rules.mjs';
import { aonchiallMeta, checkRules, comhshuiteMeta, gin, macra, parseMacros, rialachaMeta } from './rule-compiler.mjs';

const [, , up, outDir] = process.argv;
if (!up || !outDir) { console.error('usage: node tools/generate-rules.mjs <upstream-checkout> <outDir>'); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));

// Files are Latin-1; a Windows checkout may have CRLF line endings, upstream is LF.
const read = (f) => fs.readFileSync(path.join(up, f)).toString('latin1').replace(/\r/g, '');

// Values from ga/configure
const BDCHARS = 'A-ZÁÉÍÓÚa-záéíóú';
const UPPERS = 'A-ZÁÉÍÓÚ';
const LOWERS = 'a-záéíóú';

// Tags that carry attributes: sed -n '/<[A-Z] /{s/^[0-9]* <\([A-Z]\).*/\1/; p;}' pos-ga.txt | sort -u | tr -d "\n"
const attrtags = [
  ...new Set(read('ga/pos-ga.txt').split('\n').filter((l) => /<[A-Z] /.test(l)).map((l) => l.replace(/^[0-9]* <([A-Z]).*/, '$1'))),
].sort().join('');

// The macros (grammar/macra-ga.meta.pl, kept in UTF-8): a list of s/NAME/EXPANSION/g; lines.
const macraSrc = fs.readFileSync(path.join(here, '..', 'grammar', 'macra-ga.meta.pl'), 'utf8').replace(/\r/g, '');
const macros = parseMacros(macraSrc);
if (macros.some(([f, t]) => /[^\u0000-ÿ]/.test(f + t))) throw new Error('grammar/macra-ga.meta.pl: a macro with a character outside Latin-1');

// Words that the rules may use besides the macros: filled in below (CLAUSESTART ... VNLATER)
// or by src/engine.ts when the rules load (VERBALNOUN, VNPLAIN).
const PLACEHOLDERS = ['CLAUSESTART', 'CLAUSEEND', 'AFTERFEMNAME', 'AFTERNOUNANDGEN', 'AFTERNOUNANDADJS', 'AFTERTEN', 'AFTERMANNERNOUN', 'VNLATER', 'VERBALNOUN', 'VNPLAIN'];

// The rule files: grammar/<name>-ga.in (UTF-8; rules in Latin-1, comments in anything).
// tools/upstream-diff.mjs lists the changes since the An Gramadóir commit they came from.
// A mistake that the compiler would pass over silently stops the build (checkRules).
const problems = checkRules('macros', '', macros, PLACEHOLDERS);
// The line numbers of each file's rules (every line that is not a comment is one rule).
const sourceLines = {};
function readGrammar(name) {
  const file = path.join(here, '..', 'grammar', `${name}-ga.in`);
  const s = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  problems.push(...checkRules(name, s, macros, PLACEHOLDERS));
  sourceLines[name] = s.split('\n').flatMap((l, i) => (l === '' || l.startsWith('#') ? [] : [i + 1]));
  return s;
}

// aonchiall / comhshuite / rialacha: .in -> gin -> macros -> the file's own step
const META = { aonchiall: aonchiallMeta, comhshuite: comhshuiteMeta, rialacha: rialachaMeta };
function generate(name) {
  let s = readGrammar(name);
  s = gin(s, attrtags);
  s = macra(s, macros);
  s = META[name](s);
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
if (problems.length) throw new Error(`${problems.length} problems in grammar/:\n${problems.join('\n')}`);

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

const extracted = extractRules(pm);
const failures = Object.entries(extracted).flatMap(([name, { odd, bad }]) => [
  ...odd.map((o) => `${name}: cannot read line ${o.line} of the assembled rules: ${o.text}`),
  ...bad.map((r) => `${name}: cannot convert: ${r.re.slice(0, 200)}`),
]);
if (failures.length) throw new Error(failures.join('\n'));

// An exception (an :OK indented under a rule) removes only a mark with its rule's message. The
// original strips whatever mark it finds, and runs over the whole sentence once its rule has
// matched anywhere in it, so it could remove another rule's mark (the CUPLA exceptions removed
// the PREFIXH of le aon). The exceptions at the top of the file, after no rule, still take any.
let bound = 0, behind = 0;
for (const r of extracted.rialacha.rules) {
  if (!r.then) continue;
  const msg = /^<E msg="([A-Z]+)/.exec(r.repl ?? '')?.[1];
  if (!msg) throw new Error(`rialacha: exceptions after a rule without a message: ${r.re.slice(0, 120)}`);
  for (const t of r.then) {
    if (t.kind !== 'strip_errors' || !t.re.includes('<E[^>]*>')) throw new Error(`rialacha: an exception that is not an :OK: ${t.re.slice(0, 120)}`);
    t.re = contextBehind(t.re.replace('<E[^>]*>', `<E msg="${msg}[{"][^>]*>`), msg);
    bound++;
  }
}
console.log(`rialacha: ${bound} exceptions bound to their rule's message, ${behind} with their words before the mark in a lookbehind`);

// An exception's words before the mark it removes (its context) are about those words' tags, and
// they stay the same words when another rule has marked them: in "an bean bheag" the noun has a
// mark of its own (the article should lenite it), and the adjective after this feminine noun is
// still rightly lenited. So the context goes in a lookbehind, outside the match (strip_errors
// removes the first <E> and </E> of the match, which must be this rule's), and may have another
// mark's <E ...> and </E> between its words and before the mark.
function contextBehind(re, msg) {
  const at = re.indexOf(`<E msg="${msg}[`);
  if (!re.startsWith('(') || !re.endsWith(')') || at <= 1) return re;
  const before = re.slice(1, at);
  // A context that starts with a placeholder (CLAUSESTART, AFTERFEMNAME, ...: lookbehinds already,
  // filled in below) is left as it is.
  if (!before.endsWith(' ') || !balancedWithoutTopLevelOr(before) || /CLAUSESTART|AFTER[A-Z]+/.test(before)) return re;
  const loose = before.slice(0, -1).replace(/([>)]) (?=[<(])/g, '$1(?:</E>)? (?:<E[^>]*>)?');
  behind++;
  return `((?<=${loose}(?:</E>)? )${re.slice(at)}`;
}
function balancedWithoutTopLevelOr(s) {
  let depth = 0, cls = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (cls) { if (c === ']') cls = false; continue; }
    if (c === '[') cls = true;
    else if (c === '(') depth++;
    else if (c === ')') { if (--depth < 0) return false; }
    else if (c === '|' && depth === 0) return false;
  }
  return depth === 0 && !cls;
}
fs.mkdirSync(path.join(outDir, 'rules'), { recursive: true });
console.log('attribute tags:', attrtags);
console.table(Object.fromEntries(Object.entries(extracted).map(([name, { rules }]) => [name, { rules: rules.length }])));

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
  const rules = extracted[name].rules;
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
  if (n) console.log(`${name}: ${n} placeholder replacements`);
}

// Reasons (grammar/reasons.tsv: id, CO17 section, English, Irish): why a rule applies, shown with
// its message. A rule names one after its message (:SEIMHIU @gen-after-fem); the mark then carries
// it as r="gen-after-fem". data/rules/reasons.json is what the interface reads.
const reasonRows = fs.readFileSync(path.join(here, '..', 'grammar', 'reasons.tsv'), 'utf8').replace(/\r/g, '').split('\n')
  .filter((l) => l && !l.startsWith('#')).slice(1).map((l) => l.split('\t'));
const reasons = {};
const reasonStatus = { unreviewed: 0, reviewed: 0 };
for (const [id, status, co17, en, ga] of reasonRows) {
  if (!/^[a-z0-9-]+$/.test(id ?? '') || !en) throw new Error(`grammar/reasons.tsv: a row needs an id (a-z, 0-9, -) and English text: ${id}`);
  if (!(status in reasonStatus)) throw new Error(`grammar/reasons.tsv: ${id}: status ${status} is not unreviewed or reviewed`);
  if (reasons[id]) throw new Error(`grammar/reasons.tsv: ${id} twice`);
  reasonStatus[status]++;
  reasons[id] = { co17: co17 || undefined, en, ga: ga || undefined };
}
console.log(`reasons: ${reasonStatus.unreviewed} unreviewed, ${reasonStatus.reviewed} reviewed`);
const used = new Set();
const withReason = (rs) => rs.forEach((r) => {
  if (r.repl) {
    r.repl = r.repl.replace(/<E msg="([^"]*) @([a-z0-9-]+)">/, (_, msg, id) => {
      if (!reasons[id]) problems.push(`rialacha: no reason ${id} in grammar/reasons.tsv (message ${msg})`);
      used.add(id);
      return `<E msg="${msg}" r="${id}">`;
    });
  }
  if (r.then) withReason(r.then);
});
withReason(extracted.rialacha.rules);
// grammar/messages.tsv's fourth column: the reason shown with a message whose rule names none
// (CAIGHDEAN from the word list). data/rules/message-reasons.json maps each message name to it.
const messageReasons = {};
for (const row of fs.readFileSync(path.join(here, '..', 'grammar', 'messages.tsv'), 'utf8').replace(/\r/g, '').split('\n')
  .filter((l) => l && !l.startsWith('#')).slice(1)) {
  const [ids, , , id] = row.split('\t');
  if (!id) continue;
  if (!reasons[id]) problems.push(`grammar/messages.tsv: ${ids}: no reason ${id} in grammar/reasons.tsv`);
  used.add(id);
  for (const name of ids.split('=')) messageReasons[name] = id;
}
for (const id of Object.keys(reasons)) if (!used.has(id)) problems.push(`grammar/reasons.tsv: ${id} is not used by any rule`);
if (problems.length) throw new Error(`${problems.length} problems in grammar/:\n${problems.join('\n')}`);
fs.mkdirSync(path.join(outDir, 'rules'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'rules', 'reasons.json'), JSON.stringify(reasons));
fs.writeFileSync(path.join(outDir, 'rules', 'message-reasons.json'), JSON.stringify(messageReasons));
for (const [name, { rules }] of Object.entries(extracted)) {
  fs.writeFileSync(path.join(outDir, 'rules', `${name}.json`), JSON.stringify(rules));
}

// data/rules/lines.json (for tools, not loaded by the checker): for each rule file in grammar/,
// the source line of each compiled rule, in the order a walk of the JSON meets them (a rule,
// then the exceptions in its `then`).
const lines = {};
for (const [name, src] of Object.entries(sourceLines)) {
  const flat = extracted[name].rules.flatMap((r) => [r, ...(r.then ?? [])]);
  if (flat.length !== src.length) throw new Error(`${name}: ${flat.length} compiled rules for ${src.length} source lines`);
  lines[name] = src;
}
fs.writeFileSync(path.join(outDir, 'rules', 'lines.json'), JSON.stringify(lines));
