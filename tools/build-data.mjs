// Converts the language-pack source files (share/*.bs from the CPAN
// Lingua::GA::Gramadoir 0.70 distribution) into JSON for the TS engine.
//
// Usage: node tools/build-data.mjs <path/to/Lingua-GA-Gramadoir> <outDir> [--upstream <gramadoir checkout>]
//
// All strings are treated as Latin-1 (code point == byte), which is what the
// Perl engine does internally (it transcodes input to iso-8859-1).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , distDir, outDir, ...rest] = process.argv;
// Optional: --upstream <checkout of github.com/kscanne/gramadoir> to take the newer
// morphology, tagset, tokenizer, word-combination and 3-gram files from source.
const upIdx = rest.indexOf('--upstream');
const upstream = upIdx >= 0 ? rest[upIdx + 1] : null;
const UPSTREAM_FILES = {
  'morph.bs': 'ga/morph-ga.txt',
  'pos.bs': 'ga/pos-ga.txt',
  'token.bs': 'ga/token-ga.in',
  'nocombo.bs': 'ga/nocombo-ga.txt',
  '3grams.bs': 'ga/3grams-ga.txt',
};
const share = path.join(distDir, 'share');
fs.mkdirSync(outDir, { recursive: true });

const readBuf = (f) => fs.readFileSync(path.join(share, f));
// Files maintained in grammar/ (UTF-8) instead of taken from the source distribution.
const GRAMMAR_FILES = { 'morph.bs': 'morph-ga.txt' };
const latin1Lines = (f) => {
  if (GRAMMAR_FILES[f]) {
    const s = fs.readFileSync(fileURLToPath(new URL(`../grammar/${GRAMMAR_FILES[f]}`, import.meta.url)), 'utf8').replace(/\r/g, '');
    if (/[^\u0000-ÿ]/.test(s)) throw new Error(`grammar/${GRAMMAR_FILES[f]}: character outside Latin-1`);
    return s.split('\n');
  }
  if (upstream && UPSTREAM_FILES[f]) {
    return fs.readFileSync(path.join(upstream, UPSTREAM_FILES[f])).toString('latin1').replace(/\r/g, '').split('\n');
  }
  return readBuf(f).toString('latin1').split('\n');
};
const write = (name, obj) => fs.writeFileSync(path.join(outDir, name), JSON.stringify(obj));

// Perl regex (as written in .bs files, already Latin-1 chars) -> JS regex source
const fixClass = (p) => p.replace(/\[(\^?)\]/g, '[$1\\]');

// ---- lexicon: focail0..6.bs --------------------------------------------
// Alternating lines: word (prefix-compressed: optional leading digit = number
// of chars to keep from previous word, rest = new suffix), then a line of
// grammar-code characters (UTF-8 encoded code points).
function readLexicon(i) {
  const buf = readBuf(`focail${i}.bs`);
  // split on \n at byte level
  const lines = [];
  let s = 0;
  for (let k = 0; k < buf.length; k++) if (buf[k] === 10) { lines.push(buf.subarray(s, k)); s = k + 1; }
  if (s < buf.length) lines.push(buf.subarray(s));
  const out = {};
  let cur = '';
  for (let k = 0; k < lines.length; k += 2) {
    const w = lines[k].toString('latin1');
    if (k === 0) cur = w;
    else {
      const m = /^([0-9]?)([\s\S]*)$/.exec(w);
      cur = cur.slice(0, m[1] === '' ? 0 : Number(m[1])) + m[2];
    }
    const codes = k + 1 < lines.length ? lines[k + 1].toString('utf8') : '';
    out[cur] = codes;
  }
  return out;
}
const lex = [];
for (let i = 0; i <= 6; i++) { lex.push(readLexicon(i)); }
write('lexicon.json', lex);
console.log('lexicon sizes', lex.map((l) => Object.keys(l).length));

// ---- eile / earraidi (word -> correction(s)) -----------------------------
function readRepl(f) {
  const h = {};
  for (const line of latin1Lines(f)) {
    const m = /^([^ ]*) (.*)$/.exec(line);
    if (!m) continue;
    const repl = m[2].replace(/ /g, '_');
    h[m[1]] = m[1] in h ? `${h[m[1]]},_${repl}` : repl;
  }
  return h;
}
const eile = readRepl('eile.bs'); // written after the word-list corrections below, which can remove entries
write('earraidi.json', readRepl('earraidi.bs'));

// ---- pos ---------------------------------------------------------------
const pos = {};
for (const line of latin1Lines('pos.bs')) {
  const l = line.replace(/^#.*$/, '');
  if (!/\S/.test(l)) continue;
  const m = /^([0-9]+)\s+(<[^>]+>)\s*$/.exec(l);
  pos[String.fromCharCode(Number(m[1]))] = m[2];
}
write('pos.json', pos);

// ---- our word-list corrections: grammar/lexicon-corrections.tsv -> lexicon-corrections.json
// {word: code chars}, applied after the BuNaMo overlay (src/lexicon.ts).
const localLexicon = fileURLToPath(new URL('../grammar/lexicon-corrections.tsv', import.meta.url));
const codeOf = new Map(Object.entries(pos).map(([ch, tag]) => [tag, ch]));
const corrections = {};
const nonstandard = {};
// A word the word list lacks needs a source: a dictionary, the standard, or Liam's own decision.
const SOURCE = /^(?:(?:focloir\.ie|FGB|CO17)\b|Liam \(\d{4}-\d\d-\d\d\))/;
for (const [i, line] of fs.readFileSync(localLexicon, 'utf8').replace(/\r/g, '').split('\n').entries()) {
  if (!/\S/.test(line) || line.startsWith('#')) continue;
  const where = `${localLexicon}:${i + 1}`;
  const [word, tags, reason = ''] = line.split('\t');
  if (!word || !tags) throw new Error(`${where}: expected word<TAB>tags<TAB>reason`);
  if (/[^\u0000-ÿ]/.test(word + tags)) throw new Error(`${where}: characters outside Latin-1`);
  // =form: a spelling the standard does not use, with form as the correction (several forms
  // separated by ", "). A word in the word list is taken out of it (no code chars). A word already
  // in the non-standard table gets this correction in place of the table's. Any other word is
  // new, and the reason must cite its source.
  if (tags.startsWith('=')) {
    const forms = tags.slice(1).trim();
    if (lex.some((tier) => Object.hasOwn(tier, word))) corrections[word] = '';
    else if (Object.hasOwn(eile, word)) delete eile[word];
    else if (!SOURCE.test(reason)) throw new Error(`${where}: ${word} is in neither the word list nor the non-standard table; its reason must start with its source (focloir.ie, FGB, CO17, or Liam (date))`);
    nonstandard[word] = forms.replace(/ /g, '_');
    continue;
  }
  // A word not in the word list is added to it. If it is in the non-standard forms table, the
  // correction says it is standard, so it is removed from there. Otherwise it is a new word, and the
  // reason must cite the dictionary or the standard that gives it.
  if (!lex.some((tier) => Object.hasOwn(tier, word))) {
    if (Object.hasOwn(eile, word)) delete eile[word];
    else if (!SOURCE.test(reason)) throw new Error(`${where}: ${word} is not in the word list; a new word's reason must start with its source (focloir.ie, FGB, CO17, or Liam (date))`);
  }
  const list = tags.match(/<[^>]+>/g) ?? [];
  if (list.join('') !== tags.trim()) throw new Error(`${where}: tags must be written <...><...>`);
  corrections[word] = list.map((t) => {
    if (!codeOf.has(t)) throw new Error(`${where}: unknown tag ${t}`);
    return codeOf.get(t);
  }).sort().join('');
}
write('lexicon-corrections.json', corrections);
// ---- verbal nouns BuNaMo lacks: grammar/verbal-nouns.tsv -> verbal-nouns-extra.json (word<TAB>reason)
const localVn = fileURLToPath(new URL('../grammar/verbal-nouns.tsv', import.meta.url));
const extraVn = [];
for (const [i, line] of fs.readFileSync(localVn, 'utf8').replace(/\r/g, '').split('\n').entries()) {
  if (!/\S/.test(line) || line.startsWith('#')) continue;
  const [word, reason] = line.split('\t');
  if (!word || !reason) throw new Error(`${localVn}:${i + 1}: expected word<TAB>reason`);
  extraVn.push(word);
}
write('verbal-nouns-extra.json', extraVn.sort());

write('eile.json', { ...eile, ...nonstandard });
console.log('word-list corrections', Object.keys(corrections).length);

// ---- token rules -------------------------------------------------------
const token = [];
for (const line of latin1Lines('token.bs')) {
  const l = line.replace(/^#.*$/, '');
  if (!/\S/.test(l)) continue;
  const m = /^(.*):(<[^>]+>)$/.exec(l);
  token.push({ re: `(${fixClass(m[1])})`, tag: m[2], tail: m[2][1] });
}
write('token.json', token);

// ---- morphology rules --------------------------------------------------
// repl is a Perl double-quoted string: $N group refs, \l$N = lcfirst, \L$N = lc.
const replDistinct = new Set();
const morph = [];

// grammar/prefixes.tsv: each prefix row expands to the rules that strip it, following the same CO17
// rules for every prefix (the file's header lists them). Returns { early, late } rule lines.
function expandPrefixes() {
  const file = fileURLToPath(new URL('../grammar/prefixes.tsv', import.meta.url));
  const text = fs.readFileSync(file, 'utf8').replace(/\r/g, '');
  if (/[^\u0000-ÿ]/.test(text)) throw new Error('grammar/prefixes.tsv: character outside Latin-1');
  const V = 'aeiouáéíóú';
  const early = [], late = [], rows = [], posOf = new Map();
  let header = true;
  text.split('\n').forEach((line, i) => {
    if (!line.trim() || line.startsWith('#')) return;
    if (header) { header = false; return; }
    const [p, pos, min = '', flagText = ''] = line.split('\t');
    if (!/^[a-záéíóú]+$/.test(p) || !/^(AN|ANV|N)$/.test(pos) || !/^[0-9]?$/.test(min)) {
      throw new Error(`grammar/prefixes.tsv:${i + 1}: bad row: ${line}`);
    }
    const flags = new Map();
    for (const f of flagText.split(/\s+/).filter((x) => x && x !== '-')) {
      const [k, ...v] = f.split(':');
      if (!['hyphen', 'wrong', 'same', 'exclude', 'other', 'vowel', 'late'].includes(k)) {
        throw new Error(`grammar/prefixes.tsv:${i + 1}: unknown flag ${f}`);
      }
      flags.set(k, v.join(':'));
    }
    rows.push(p);
    posOf.set(p, pos);
    const rootpos = pos === 'N' ? '<N.*>' : `<[${pos}].*>`;
    const head = `^${/^[aeiouáéíóú]/.test(p) ? 'h?' : ''}${p}${flags.has('hyphen') ? '-' : ''}`;
    // the root has at least min letters: dots after the pattern's own letters (a class is one
    // letter); not after a hyphen, which marks where the prefix ends (mí-úr)
    const pad = (cls, hy) => (hy || flags.has('hyphen') ? '' : '.'.repeat(Math.max(0, Number(min || 0) - cls.replace(/\[[^\]]*\]/g, 'x').length)));
    const rule = (out, cls, level = 0, hy = '') => out.push(`${head}${hy}(${cls}${pad(cls, hy)})\t$1\t\t${level}\t${rootpos}\t<&>`);
    const plain = flags.get('late') === 'plain' ? late : early;
    const endsVowel = /[aeiouáéíóú]$/.test(p);
    const dental = /[dntls]$/.test(p);
    // the consonant the prefix ends in, for the hyphen between the same consonants (2.1.7(b))
    const same = flags.has('hyphen') || endsVowel ? '' : (/(mh|ch|th)$/.exec(p) ?? /[a-z]$/.exec(p))[0];
    const exclude = new Set([...(flags.get('exclude') ?? '')]);
    if (same) exclude.add(same[0]);
    const lenitable = [...'bcdfgmpt'].filter((c) => !exclude.has(c));
    const lenited = dental ? lenitable.filter((c) => !'dt'.includes(c)) : lenitable;
    const unlenitedDentals = dental ? [...'dt'].filter((c) => !exclude.has(c)) : [];
    const sRules = !exclude.has('s');

    // a root starting with a vowel or a consonant that is never lenited
    if (flags.has('other')) {
      rule(early, flags.get('other'));
    } else if (endsVowel && !flags.has('hyphen')) {
      rule(early, `[${V}]`, 0, '-'); // 2.1.7(a): mí-ádh
      const nh = flags.get('vowel') ?? '';
      if (nh.startsWith('nohyphen2')) rule(early, `[${nh.split(':')[1] || V}]`, 2);
      rule(plain, '[lnr]');
    } else {
      if (flags.get('vowel') === 'both') rule(early, `[${V}]`, 0, '-');
      // nor h after a letter it would lenite (imh- is part of the word, not im- + h-: ainimheach),
      // nor after an h, which takes a hyphen instead (2.1.7(b): frith-hiostaimín)
      const not = new Set([...'bcdfgmpst', ...(/[bcdfgmpsth]$/.test(p) ? 'h' : ''), ...exclude]);
      if (/h$/.test(p)) rule(early, 'h', 0, '-');
      rule(plain, `[^${[...not].join('')}-]`);
    }
    // the same consonant, with a hyphen (droch-chaint, neamh-mhaith, leas-sagart)
    if (same && flags.get('same') !== 'none' && !flags.has('other')) rule(early, same, 0, '-');
    if (flags.has('other')) {
      if (lenited.length) rule(early, `[${lenited.join('')}]h`);
      return;
    }
    // lenited (and d, t, s left unlenited after d, n, t, l, s)
    if (lenited.length) rule(early, `[${lenited.join('')}]h`);
    if (unlenitedDentals.length) rule(plain, `[${unlenitedDentals.join('')}][^h]`);
    if (sRules) {
      if (dental) rule(plain, 's[^h]');
      else {
        rule(early, `sh[${V}lnr]`);
        rule(early, `s[^${V}lnrh]`);
      }
    }
    if (flags.get('wrong') === '2') {
      if (lenited.length) rule(early, `[${lenited.join('')}][^h]`, 2);
      if (!dental && sRules) rule(early, `s[${V}lnr]`, 2);
      if (dental) rule(early, `[${[...unlenitedDentals, ...(sRules ? ['s'] : [])].join('')}]h`, 2);
    } else {
      // the root left unlenited where it should be lenited (droch-príomhoide, sean-Cárta): the lenite
      // flag reports COMHSEIMHIU with the lenited word (src/engine.ts); with or without the hyphen
      const cls = [...(lenited.length ? [`[${lenited.join('')}][^h]`] : []), ...(!dental && sRules ? [`s[${V}lnr]`] : [])];
      if (cls.length) {
        const h = /^[aeiouáéíóú]/.test(p) ? 'h?' : '';
        late.push(`^${h}${p}-?((?:${cls.join('|')})${'.'.repeat(Math.max(0, Number(min || 0) - 2))})\t$1\t\t0\t${rootpos}\t<&>\tlenite`);
      }
    }
  });
  // a hyphen between two prefixes (2.1.7(c): comh-cheolfhoireann, sin-seanathair; leas-phríomhoide);
  // the second is lenited as any root is (10.2.12): not d, t or s after d, n, t, l or s
  const lenite = (p, afterDental) => {
    const c = p[0];
    if ('bcfgmp'.includes(c) || ('dt'.includes(c) && !afterDental) || (c === 's' && !afterDental && /^s[aeiouáéíóúlnr]/.test(p))) {
      return `${c}h${p.slice(1)}`;
    }
    return p;
  };
  for (const afterDental of [false, true]) {
    const first = rows.filter((p) => /[dntls]$/.test(p) === afterDental);
    const second = rows.filter((p) => !/^(an|dea)$/.test(p)).map((p) => lenite(p, afterDental));
    early.push(`^h?(${first.join('|')})-((?:${second.join('|')}).)\t$2\t\t0\t<[ANV].*>\t<&>`);
    // ... and before a first element that is not in the table (comh-cheolfhoireann: ceol +
    // fhoireann): the root must itself split into two listed words (the compound flag, src/engine.ts)
    const plainFirst = first.filter((p) => !/^(an|dea)$/.test(p));
    const root = afterDental ? '[bcfgmp]h|[dt][^h]|s[^h]' : '[bcdfgmpt]h|sh[aeiouáéíóúlnr]';
    early.push(`^h?(?:${plainFirst.join('|')})-((?:${root}).)\t$1\t\t0\t<[ANV].*>\t<&>\tcompound`);
  }
  return { early, late, capital: capitalRules(rows, posOf) };
}

// A prefix before a capital keeps its hyphen (2.1.7(e): an Ard-Chúirt, an Príomh-Bhreitheamh; do
// shean-Chárta): the prefix, in any mutated form, is stripped before the capital is lowercased, so
// that the hyphen is not read as an unwanted one. The capital follows the same lenition rules as
// any root (10.2.12); an unlenited one is left to the rules after.
function capitalRules(rows, posOf) {
  const ECLIPSIS = { b: 'm', c: 'g', d: 'n', f: 'bh', g: 'n', p: 'b', t: 'd' };
  const mutated = (p) => {
    const c = p[0], rest = p.slice(1), cc = `[${c}${c.toUpperCase()}]`;
    if (/[aeiouáéíóú]/.test(c)) return `(?:[hnt]-?)?${cc}${rest}`; // hIar-, t-iar-
    if (c === 's') return `t?${cc}h?${rest}`; // shean-, tSean-
    if (ECLIPSIS[c]) return `(?:${ECLIPSIS[c]})?${cc}h?${rest}`; // phríomh-, bPríomh-
    return `${cc}${rest}`;
  };
  const V = 'AEIOUÁÉÍÓÚLNR', v = 'aeiouáéíóúlnr';
  const root = (dental) => (dental
    ? `[${V}]|[BCFGMP]h|[DT][^h]|S[^h]`
    : `[${V}]|[BCDFGMPT]h|Sh[${v}]|S[^${v}h]`);
  const groups = new Map();
  for (const p of rows) {
    const key = `${posOf.get(p)}\t${/[dntls]$/.test(p)}`;
    groups.set(key, [...(groups.get(key) ?? []), mutated(p)]);
  }
  return [...groups].map(([key, alts]) => {
    const [pos, dental] = key.split('\t');
    const rootpos = pos === 'N' ? '<N.*>' : `<[${pos}].*>`;
    return `^(?:${alts.join('|')})-(${root(dental === 'true')})\t$1\t\t0\t${rootpos}\t<&>`;
  });
}
const prefixRules = expandPrefixes();
const morphLines = [];
for (const raw of latin1Lines('morph.bs')) {
  const marker = raw.trim();
  if (marker === '@PREFIXES') morphLines.push(...prefixRules.early);
  else if (marker === '@PREFIXES-LATE') morphLines.push(...prefixRules.late);
  else if (marker === '@PREFIXES-CAPITAL') morphLines.push(...prefixRules.capital);
  else morphLines.push(raw);
}
for (const [marker, rules] of [['@PREFIXES', prefixRules.early], ['@PREFIXES-LATE', prefixRules.late], ['@PREFIXES-CAPITAL', prefixRules.capital]]) {
  if (rules.length && !latin1Lines('morph.bs').some((l) => l.trim() === marker)) throw new Error(`grammar/morph-ga.txt: no ${marker} marker`);
}
for (const raw of morphLines) {
  const line = raw.replace(/#.*$/, '');
  if (!/\S/.test(line)) continue;
  // An optional last field: nofix, the rule finds the standard word but not the form the text
  // needs, so its note offers no fix; compound, the rule applies only when what it leaves is a
  // compound of two listed words; lenite, the root it leaves should have been lenited, reported as
  // COMHSEIMHIU (src/engine.ts).
  const m = /\s*(\S+)\s+(\S+)\s+(\S+)\s+(<[^>]+>)\s+(<[^>]+>)(?:\s+(nofix|compound|lenite)\b)?/.exec(line);
  if (!m) throw new Error('bad morph line: ' + raw);
  const [, patt, repl, level, rootpos, replpos, flag] = m;
  const nofix = flag === 'nofix';
  // tokenise repl
  const parts = [];
  const re = /\\([lL])\$([1-9])|\$([1-9])|([^$\\]+)|\\(.)/g;
  let t;
  while ((t = re.exec(repl))) {
    if (t[1]) parts.push({ f: t[1] === 'l' ? 'lcfirst' : 'lc', g: Number(t[2]) });
    else if (t[3]) parts.push({ g: Number(t[3]) });
    else if (t[4] !== undefined) parts.push({ s: t[4] });
    else parts.push({ s: t[5] });
  }
  replDistinct.add(replpos);
  let poscompiled = null;
  if (!/^<\.([+*])?>$/.test(rootpos)) {
    poscompiled = rootpos.replace(/\./g, '[^>]').replace(/>$/, '/?>');
  }
  morph.push({
    re: fixClass(patt), parts, level: Number(level), rootpos, replpos, poscompiled,
    ...(nofix ? { nofix: true } : {}),
    ...(flag === 'compound' ? { compound: true } : {}),
    ...(flag === 'lenite' ? { lenite: true } : {}),
  });
}
write('morph.json', morph);
console.log('morph rules', morph.length, 'distinct replpos:', [...replDistinct].slice(0, 20));
console.log('distinct rootpos:', [...new Set(morph.map((r) => r.rootpos))]);

// ---- 3grams / nocombo / messages --------------------------------------
const grams = [];
for (const line of latin1Lines('3grams.bs')) {
  const m = /^([^ ]*) (.*)$/.exec(line);
  if (m) grams.push(m[1]);
}
write('grams.json', grams);
write('nocombo.json', latin1Lines('nocombo.bs').filter(Boolean));

// messages.bs: MACRO[=ALIAS...]\t+'msgid'  (English msgids; translated catalogs
// are separate and are NOT touched here).
const messages = {};
for (const line of latin1Lines('messages.bs')) {
  if (!/\S/.test(line) || line.startsWith('#')) continue;
  const m = /^([^\t]+)\t+'(.*)'\s*$/.exec(line);
  if (!m) { console.warn('messages: unparsed', line); continue; }
  const msgid = m[2].replace(/\\'/g, "'"); // same unescaping as Makefile.PL
  for (const name of m[1].split('=')) messages[name] = msgid;
}
// The parity tests compare with Perl 0.70, so they read upstream's own text.
fs.mkdirSync(path.join(outDir, 'legacy-0.70'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'legacy-0.70', 'messages.json'), JSON.stringify(messages));
// grammar/messages.tsv (id, status, en, reason) gives the text of every message: upstream's, marked
// inherited (and checked to be unchanged), improved or new ones, marked unreviewed or reviewed.
// The optional reason (read by generate-rules.mjs) explains the message when its rule names none.
const localMessages = fileURLToPath(new URL('../grammar/messages.tsv', import.meta.url));
const STATUSES = ['inherited', 'unreviewed', 'reviewed'];
const fromTsv = {};
const statusCount = Object.fromEntries(STATUSES.map((s) => [s, 0]));
const msgProblems = [];
const msgRows = fs.readFileSync(localMessages, 'utf8').replace(/\r/g, '').split('\n')
  .filter((l) => l && !l.startsWith('#')).slice(1);
for (const row of msgRows) {
  const [ids, status, en, , ...extraCols] = row.split('\t');
  if (!ids || !en || extraCols.length) { msgProblems.push(`a row needs id, status, en (and optionally a reason): ${row}`); continue; }
  if (!STATUSES.includes(status)) { msgProblems.push(`${ids}: status ${status} is not one of ${STATUSES.join(', ')}`); continue; }
  if (/[^\u0000-ÿ]/.test(en)) msgProblems.push(`${ids}: characters outside Latin-1`);
  statusCount[status]++;
  for (const name of ids.split('=')) {
    if (name in fromTsv) msgProblems.push(`${name} twice`);
    fromTsv[name] = en;
    if (status === 'inherited') {
      if (!(name in messages)) msgProblems.push(`${name}: inherited, but not an upstream message (mark it unreviewed)`);
      else if (messages[name] !== en) msgProblems.push(`${name}: inherited, but the text differs from upstream's "${messages[name]}" (mark it unreviewed)`);
    }
  }
}
for (const name of Object.keys(messages)) if (!(name in fromTsv)) msgProblems.push(`${name}: upstream message missing (add it, marked inherited)`);
if (msgProblems.length) throw new Error(`${localMessages}:\n${msgProblems.join('\n')}`);
write('messages.json', fromTsv);
console.log('messages', Object.keys(fromTsv).length, 'names;', STATUSES.map((s) => `${statusCount[s]} ${s}`).join(', '));
