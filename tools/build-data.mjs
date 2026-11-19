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
for (const [i, line] of fs.readFileSync(localLexicon, 'utf8').replace(/\r/g, '').split('\n').entries()) {
  if (!/\S/.test(line) || line.startsWith('#')) continue;
  const where = `${localLexicon}:${i + 1}`;
  const [word, tags] = line.split('\t');
  if (!word || !tags) throw new Error(`${where}: expected word<TAB>tags<TAB>reason`);
  if (/[^\u0000-ÿ]/.test(word)) throw new Error(`${where}: characters outside Latin-1`);
  // A word not in the word list is accepted only if it is in the non-standard forms table: the
  // correction says it is standard, so it is removed from there and added to the word list.
  if (!lex.some((tier) => Object.hasOwn(tier, word))) {
    if (!Object.hasOwn(eile, word)) throw new Error(`${where}: ${word} is neither in the word list nor a non-standard form`);
    delete eile[word];
  }
  const list = tags.match(/<[^>]+>/g) ?? [];
  if (list.join('') !== tags.trim()) throw new Error(`${where}: tags must be written <...><...>`);
  corrections[word] = list.map((t) => {
    if (!codeOf.has(t)) throw new Error(`${where}: unknown tag ${t}`);
    return codeOf.get(t);
  }).sort().join('');
}
write('lexicon-corrections.json', corrections);
write('eile.json', eile);
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
for (const raw of latin1Lines('morph.bs')) {
  const line = raw.replace(/#.*$/, '');
  if (!/\S/.test(line)) continue;
  const m = /\s*(\S+)\s+(\S+)\s+(\S+)\s+(<[^>]+>)\s+(<[^>]+>)/.exec(line);
  if (!m) throw new Error('bad morph line: ' + raw);
  const [, patt, repl, level, rootpos, replpos] = m;
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
// Messages for rules we added in grammar/rialacha-ga.in.
const localMessages = fileURLToPath(new URL('../grammar/extra-messages.json', import.meta.url));
for (const [name, msgid] of Object.entries(JSON.parse(fs.readFileSync(localMessages, 'utf8')))) {
  if (/[^\u0000-ÿ]/.test(msgid)) throw new Error(`${localMessages}: ${name}: characters outside Latin-1`);
  if (name in messages) throw new Error(`${localMessages}: ${name} is already an upstream message`);
  messages[name] = msgid;
}
write('messages.json', messages);
console.log('messages', Object.keys(messages).length);
