// Overlays noun, adjective and verb data from the Irish National Morphology Database
// (BuNaMo, Foras na Gaeilge, ODbL 1.0) onto the lexicon built by build-data.mjs.
// The result is not a merged lexicon but a separate overlay file (ODbL, see NOTICE.md), which
// src/lexicon.ts applyOverlay() merges with the 0.70 lexicon when the checker loads.
//
// Usage: node tools/overlay-bunamo.mjs <BuNaMo checkout> <upstream gramadoir checkout> <dataDir> <outDir>
//          [--only noun,adj,verb] [--conflicts keep|bunamo] [--rare keep|tag] [--decisions <file>]
//          [--lexicon <file>] [--reports <dir>]
//   dataDir  directory holding lexicon.json, pos.json, eile.json, earraidi.json (the base data)
//   outDir   receives bunamo-overlay.json, overlay-report.txt and review lists (*.tsv)
//
// bunamo-overlay.json is {add: [7 tiers], remove: [7 tiers]}, each tier {word: code chars}. A word keeps
// the tier it has in the base lexicon (new words get one from freq-ga.txt). Merging (applyOverlay):
// per tier, drop the `remove` chars from the word's entry, add the `add` chars, and store the entry's
// unique chars sorted. `remove` only comes from `bunamo` decisions, which replace 0.70's tags.
//
// Each BuNaMo form is expanded with the initial mutations the 0.70 (ispell-flag) lexicon contains,
// then merged per part of speech:
//   - form absent from the lexicon         -> added, in the frequency tier given by freq-ga.txt
//                                             (unless it is a key of earraidi/eile: see below)
//   - form present, no tag of this class   -> tags added to its existing entry
//   - form present, BuNaMo adds tags       -> extra tags added
//   - form present, tags conflict          -> kept as-is (--conflicts keep, default) or replaced by
//                                             BuNaMo's (--conflicts bunamo); always listed for review
//   - 0.70 has tags BuNaMo lacks           -> kept
// Safeguards (each one fixed a regression seen in testing):
//   - words carrying a closed-class tag (article, preposition, conjunction, ...) never gain tags
//   - nouns: a homograph with a different gender is not merged in (it would silence gender rules)
//   - new forms that are keys of earraidi/eile are skipped: the engine consults the lexicon first, so
//     adding them would silence the known-error corrections (mor -> mór, atha -> átha, ...)
import fs from 'node:fs';
import path from 'node:path';

const [, , bunamo, upstream, dataDir, outDir, ...rest] = process.argv;
if (!bunamo || !upstream || !dataDir || !outDir) {
  console.error('usage: node tools/overlay-bunamo.mjs <BuNaMo> <upstream gramadoir> <dataDir> <outDir> [--only noun,adj,verb] [--conflicts keep|bunamo] [--rare keep|tag] [--decisions <file>] [--lexicon <file>] [--reports <dir>]');
  process.exit(2);
}
const opt = (name, dflt) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : dflt; };
const policy = opt('--conflicts', 'keep');
if (!['keep', 'bunamo'].includes(policy)) throw new Error('--conflicts must be keep or bunamo');
const only = opt('--only', 'noun,adj,verb').split(',');
// --decisions <file>: lines "<form>\t<bunamo|keep|union|allow>" (# comments allowed; see README.md). Overrides --conflicts for that word
// and for all its mutated variants, so one line per headword is enough.
const decisions = new Map();
if (opt('--decisions')) {
  for (const line of fs.readFileSync(opt('--decisions'), 'utf8').split('\n')) {
    const m = /^([^\t#]+)\t(bunamo|keep|union|allow)\b/.exec(line);
    if (m) decisions.set(m[1], m[2]);
  }
}
const unmutated = (w) => {
  const r = [w]; let m;
  if ((m = /^([bcdfgmpst])h(.+)$/i.exec(w))) r.push(m[1] + m[2]);
  if ((m = /^(mb|gc|nd|bhf|ng|bp|dt)(.+)$/.exec(w))) r.push(/^[A-ZÁÉÍÓÚ]/.test(m[2]) ? m[2] : { mb: 'b', gc: 'c', nd: 'd', bhf: 'f', ng: 'g', bp: 'p', dt: 't' }[m[1]] + m[2]);
  if ((m = /^(?:n-|t-|h|b'|m'|d')(.+)$/.exec(w))) r.push(m[1]);
  if ((m = /^t([sS].+)$/.exec(w))) r.push(m[1]);
  if ((m = /^(?:b'fh|m'fh|d'fh)(.+)$/.exec(w))) r.push('f' + m[1]);
  return r;
};
const decisionFor = (w) => { for (const c of unmutated(w)) if (decisions.has(c)) return decisions.get(c); return policy; };
// --lexicon <file>: base lexicon (default <dataDir>/lexicon.json, the untouched 0.70 lexicon).
// --reports <dir>: where the review lists (*.tsv) and overlay-report.txt go (default: outDir).
const lexiconFile = opt('--lexicon', path.join(dataDir, 'lexicon.json'));
const reportsDir = opt('--reports', outDir);
fs.mkdirSync(reportsDir, { recursive: true });
const rare = opt('--rare', 'keep'); // keep: leave words tagged only <F> (valid but rare) alone; tag: tag them
if (!['keep', 'tag'].includes(rare)) throw new Error('--rare must be keep or tag');
fs.mkdirSync(outDir, { recursive: true });

const lex = JSON.parse(fs.readFileSync(lexiconFile, 'utf8'));
const pos = JSON.parse(fs.readFileSync(path.join(dataDir, 'pos.json'), 'utf8'));
const earraidi = JSON.parse(fs.readFileSync(path.join(dataDir, 'earraidi.json'), 'utf8'));
const eile = JSON.parse(fs.readFileSync(path.join(dataDir, 'eile.json'), 'utf8'));

// ---- pos codes <-> descriptors, per tag letter ----
// descriptor = "pl/gnt/gnd" (N, A) or "p/t" (V), plus a separate h flag
const attrsOf = (s) => Object.fromEntries([...(s ?? '').matchAll(/(\w+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
function parseTag(tag) {
  const m = /^<([A-Z])( [^>]*)?>$/.exec(tag);
  if (!m) return null;
  const a = attrsOf(m[2]);
  if (m[1] === 'N' || m[1] === 'A') return { letter: m[1], k3: `${a.pl ?? '-'}/${a.gnt ?? '-'}/${a.gnd ?? '-'}`, h: a.h === 'y' ? 'y' : 'n' };
  if (m[1] === 'V' && a.p && a.t) return { letter: 'V', k3: `${a.p}/${a.t}`, h: 'n' };
  return null;
}
const codeOf = new Map(); // "L:k3/h" -> code char
const descOf = new Map(); // code char -> {letter,k3,h}
const closedChars = new Set(); // articles, prepositions, conjunctions, ... never become noun/adj/verb
for (const [ch, tag] of Object.entries(pos)) {
  const d = parseTag(tag);
  if (d) { codeOf.set(`${d.letter}:${d.k3}/${d.h}`, ch); descOf.set(ch, d); }
  if (/^<[UGHTSPORCQID][ >]/.test(tag)) closedChars.add(ch);
}

// ---- frequency tiers (reproduces count.pl + lexbuild: freq 0 -> tier 6, freq 1 -> tier 5, rest in 5 bands) ----
const freq = new Map();
for (const line of fs.readFileSync(path.join(upstream, 'ga', 'freq-ga.txt')).toString('latin1').split('\n')) {
  const i = line.lastIndexOf(' ');
  if (i > 0) freq.set(line.slice(0, i), Number(line.slice(i + 1)));
}
const tierMin = [];
for (let t = 0; t < 5; t++) {
  let min = Infinity;
  for (const w of Object.keys(lex[t])) { const f = freq.get(w) ?? 0; if (f < min) min = f; }
  tierMin.push(min);
}
const tierFor = (w) => {
  const f = freq.get(w) ?? 0;
  if (f === 0) return 6;
  if (f === 1) return 5;
  for (let t = 0; t < 5; t++) if (f >= tierMin[t]) return t;
  return 5;
};
let tierOk = 0, tierN = 0;
for (let t = 0; t < 7; t++) for (const w of Object.keys(lex[t])) { tierN++; if (tierFor(w) === t) tierOk++; }
console.log(`tier model reproduces ${tierOk}/${tierN} existing placements (${(100 * tierOk / tierN).toFixed(2)}%)`);

const out = lex.map((t) => ({ ...t }));
const tierOfWord = new Map();
for (let t = 0; t < 7; t++) for (const w of Object.keys(out[t])) tierOfWord.set(w, t);

// ---- mutation expansion ----
const V = 'aeiouáéíóúAEIOUÁÉÍÓÚ';
const lenitable = (w) => { const c = w[0], r = w.slice(1), lc = c.toLowerCase(); return r[0] !== 'h' && r[0] !== "'" && ('bcdfgmpt'.includes(lc) || (lc === 's' && /^[aeiouáéíóúlnr]/i.test(r))); };
const lenite = (w) => w[0] + 'h' + w.slice(1);
const eclipse = (w) => { const lc = w[0].toLowerCase(); const e = { b: 'm', c: 'g', d: 'n', f: 'bh', g: 'n', p: 'b', t: 'd' }[lc]; return e && w[1] !== 'h' ? e + w : null; };

// ---- BuNaMo readers: yield [form, k3] pairs for one entry ----
const attr = (s, n) => { const m = new RegExp(`${n}="([^"]*)"`).exec(s); return m ? m[1] : undefined; };
const oneWord = (f) => f && !/\s/.test(f);

const CATS = {
  noun: {
    letter: 'N', dir: 'noun',
    entries(xml) {
      const els = [...xml.matchAll(/<(\w+) ([^>]*)\/>/g)];
      const gender = els.map((e) => attr(e[2], 'gender')).find(Boolean);
      const g = gender === 'masc' ? 'm' : gender === 'fem' ? 'f' : '-';
      const res = [];
      for (const e of els) {
        const spec = { sgNom: 'n/n', sgGen: 'n/y', plNom: 'y/n', plGen: 'y/y' }[e[1]];
        const form = attr(e[2], 'default');
        if (spec && oneWord(form)) res.push([form, `${spec}/${g}`]);
      }
      return res;
    },
    // t- prefix is valid for feminine nominative singular / masculine genitive singular (s-initial) and
    // masculine nominative singular (vowel-initial); applying it to every form would make "tsiopa" a nominative.
    variants(w, k3) {
      const [pl, gnt, g] = k3.split('/'), spec = `${pl}/${gnt}`;
      const c = w[0], lc = c.toLowerCase(), out = [];
      if (lenitable(w)) out.push([lenite(w), 'n']);
      if (lc === 's' && /^[aeiouáéíóúlnr]/i.test(w.slice(1)) && ((g === 'f' && spec === 'n/n') || (g === 'm' && spec === 'n/y'))) out.push(['t' + w, 'n']);
      const e = eclipse(w); if (e) out.push([e, 'n']);
      if (V.includes(c)) {
        out.push(['n-' + w, 'n'], ["b'" + w, 'n'], ["m'" + w, 'n'], ["d'" + w, 'n'], ['h' + w, 'y']);
        if (g === 'm' && spec === 'n/n') out.push(['t-' + w, 'n']);
      }
      if (lc === 'f') out.push(["b'fh" + w.slice(1), 'n'], ["m'fh" + w.slice(1), 'n'], ["d'fh" + w.slice(1), 'n']);
      return out;
    },
    genderGuard: true,
  },
  adj: {
    letter: 'A', dir: 'adjective',
    entries(xml, dir, file) {
      const res = [];
      const els = [...xml.matchAll(/<(\w+) ([^>]*)\/>/g)];
      for (const e of els) {
        const k3 = { sgNom: 'n/n/-', sgGenMasc: 'n/y/m', sgGenFem: 'n/y/f', plNom: 'y/n/-', graded: 'n/y/f' }[e[1]];
        const form = attr(e[2], 'default');
        if (k3 && oneWord(form)) res.push([form, k3]);
      }
      return res;
    },
    // 0.70 (measured): adjectives are lenited but never eclipsed. h- only on the nominative singular.
    // b' (b'aerach) and b'fh (b'fhearr) on the nominative, the feminine genitive/comparative and the
    // plural, in roughly equal numbers, but never on the masculine genitive.
    variants(w, k3) {
      const c = w[0], lc = c.toLowerCase(), out = [];
      if (lenitable(w)) out.push([lenite(w), 'n']);
      if (V.includes(c) && k3 === 'n/n/-') out.push(['h' + w, 'y']);
      if (['n/n/-', 'n/y/f', 'y/n/-'].includes(k3)) {
        if (V.includes(c)) out.push(["b'" + w, 'n']);
        if (lc === 'f') out.push(["b'fh" + w.slice(1), 'n']);
      }
      return out;
    },
  },
  verb: {
    letter: 'V', dir: 'verb',
    entries(xml) {
      const res = [];
      const tenseMap = { Past: 'caite', PastCont: 'gnáth', PresCont: 'láith', Pres: 'láith', Fut: 'fáist', Cond: 'coinn' };
      for (const e of xml.matchAll(/<(tenseForm|moodForm) ([^>]*)\/>/g)) {
        const form = attr(e[2], 'default');
        if (!oneWord(form)) continue;
        const auto = attr(e[2], 'person') === 'Auto' ? 'n' : 'y';
        let t;
        if (e[1] === 'tenseForm') t = tenseMap[attr(e[2], 'tense')];
        else t = { Imper: 'ord', Subj: 'foshuit' }[attr(e[2], 'mood')];
        // 0.70 tags regular past / conditional / imperfect forms only in their lenited (dhúisigh,
        // chaithfinn) and eclipsed (ndúisigh) shapes, never the bare unlenited one: the bare form is a
        // "lenition missing" error. (Measured on 0.70: conditional, lenited-only 5082 vs base-only 6.)
        // So the bare base form is not tagged, but its variants are.
        if (t) res.push([form, `${auto}/${t}`, ['caite', 'gnáth', 'coinn'].includes(t) && lenitable(form) ? { noBase: true } : undefined]);
      }
      // the verbal adjective behaves like an adjective (all four forms)
      const va = /<verbalAdjective [^>]*default="([^"]*)"/.exec(xml)?.[1];
      if (oneWord(va)) for (const k3 of ['n/n/-', 'n/y/m', 'n/y/f', 'y/n/-']) res.push([va, 'A:' + k3]);
      return res;
    },
    // 0.70: lenited and eclipsed variants exist for every verb form; d' only for the past-type tenses;
    // h- only for the imperative ("ná hól").
    variants(w, k3) {
      if (k3.startsWith('A:')) return CATS.adj.variants(w, k3.slice(2));
      const t = k3.split('/')[1], c = w[0], lc = c.toLowerCase(), out = [];
      if (lenitable(w)) out.push([lenite(w), 'n']);
      const e = eclipse(w); if (e) out.push([e, 'n']);
      if (V.includes(c)) {
        out.push(['n-' + w, 'n']);
        if (t === 'ord') out.push(['h' + w, 'n']);   // verb tags carry no h attribute: "hól" is plain <V p="y" t="ord">, as in 0.70
        if (['caite', 'gnáth', 'coinn'].includes(t)) out.push(["d'" + w, 'n']);
      }
      if (lc === 'f' && ['caite', 'gnáth', 'coinn'].includes(t)) out.push(["d'fh" + w.slice(1), 'n']);
      return out;
    },
  },
};

// ---- helpers over the evolving lexicon ----
const descsOf = (letter, codes) => {
  const s = new Set();
  for (const ch of codes ?? '') { const d = descOf.get(ch); if (d && d.letter === letter) s.add(`${d.k3}/${d.h}`); }
  return s;
};
const strip = (s) => new Set([...s].map((x) => x.replace(/\/[yn]$/, '')));
const setCodes = (w, t, codes) => { out[t][w] = [...new Set(codes)].sort().join(''); tierOfWord.set(w, t); };

const report = [`policy: conflicts=${policy} rare=${rare}`];
const tsv = (name, header, rows) => fs.writeFileSync(path.join(reportsDir, name), header.join('\t') + '\n' + rows.map((r) => r.join('\t')).join('\n') + '\n');

for (const catName of ['noun', 'adj', 'verb']) {
  if (!only.includes(catName)) continue;
  const cat = CATS[catName];
  const letter = cat.letter;
  // forms -> Set("L:k3/h"), where verbal adjectives carry their own letter
  const bn = new Map();
  const add = (w, k) => { if (!bn.has(w)) bn.set(w, new Set()); bn.get(w).add(k); };
  const files = fs.readdirSync(path.join(bunamo, cat.dir));
  for (const f of files) {
    const xml = fs.readFileSync(path.join(bunamo, cat.dir, f), 'utf8');
    for (const [form, k3, flags] of cat.entries(xml)) {
      const L = k3.startsWith('A:') ? 'A' : letter;
      const kk = k3.startsWith('A:') ? k3.slice(2) : k3;
      if (!flags?.noBase) add(form, `${L}:${kk}/n`);
      for (const [v, h] of cat.variants(form, k3)) add(v, `${L}:${kk}/${h}`);
    }
  }
  console.log(`${catName}: ${files.length} BuNaMo files -> ${bn.size} forms after mutation expansion`);

  const stat = { added: 0, tagged: 0, extended: 0, same: 0, oldSuperset: 0, conflict: 0, noCode: 0, closedClassSkipped: 0, genderAddSkipped: 0, shadowSkipped: 0, rareKept: 0 };
  const conflicts = [], genderAdds = [], shadowed = [];
  const toCodes = (set) => {
    const cs = [];
    for (const k of set) { const ch = codeOf.get(k); if (ch === undefined) { stat.noCode++; continue; } cs.push(ch); }
    return cs;
  };
  // BuNaMo keys of different letters (verbal adjectives) are merged per letter
  for (const [w, bsetAll] of bn) {
    for (const L of new Set([...bsetAll].map((k) => k[0]))) {
      const bset = new Set([...bsetAll].filter((k) => k[0] === L).map((k) => k.slice(2)));
      const keyed = (set) => new Set([...set].map((x) => `${L}:${x}`));
      const t = tierOfWord.get(w);
      const codes = t === undefined ? '' : out[t][w];
      const oset = descsOf(L, codes);
      if (t === undefined) {
        // "allow" decision: the form is a real standard word that Kevin's table also lists, add it anyway
        if ((Object.hasOwn(earraidi, w) || Object.hasOwn(eile, w)) && decisionFor(w) !== 'allow') {
          stat.shadowSkipped++; shadowed.push([catName, w, earraidi[w] ?? eile[w], Object.hasOwn(earraidi, w) ? 'earraidi' : 'eile']);
          continue;
        }
        const cs = toCodes(keyed(bset));
        if (cs.length) { setCodes(w, tierFor(w), cs); stat.added++; }
        continue;
      }
      // Subjunctive tags are never added to words that already exist: the NOSUBJ rule fires on any
      // subjunctive reading outside a trigger context, so BuNaMo's subjunctives would hit homographs
      // such as ata (a misspelling of atá) and pleanála (genitive of pleanáil).
      const noSubj = (set) => new Set([...set].filter((x) => !(L === 'V' && x.endsWith('/foshuit/n'))));
      if (oset.size === 0) {
        if ([...codes].some((ch) => closedChars.has(ch))) { stat.closedClassSkipped++; continue; }
        // <F> (code 127) marks words that are valid but extremely rare (Dinneen-only). Tagging them
        // would turn them into ordinary words and silence the rare-word warnings (NEAMHCHOIT/IONADAI)
        // that catch misspellings coinciding with rare real words (airithe -> áirithe).
        if (rare === 'keep' && codes === '\u007f') { stat.rareKept++; continue; }
        const addable = noSubj(bset);
        if (!addable.size) continue;
        setCodes(w, t, [...codes, ...toCodes(keyed(addable))]);
        stat.tagged++;
        continue;
      }
      const b3 = strip(bset), o3 = strip(oset);
      const extra = [...b3].filter((x) => !o3.has(x));
      const missing = [...o3].filter((x) => !b3.has(x));
      if (!extra.length) { missing.length ? stat.oldSuperset++ : stat.same++; continue; }
      if (missing.length) {
        stat.conflict++;
        conflicts.push([catName, w, [...o3].sort().join(' '), [...b3].sort().join(' ')]);
        const choice = decisionFor(w);
        if (choice === 'bunamo') {
          const keep = [...codes].filter((ch) => descOf.get(ch)?.letter !== L);
          setCodes(w, t, [...keep, ...toCodes(keyed(bset))]);
        } else if (choice === 'union') {
          // both are right (different senses of a homograph): keep 0.70's tags and add BuNaMo's
          setCodes(w, t, [...codes, ...toCodes(keyed(bset))]);
        }
        continue;
      }
      const addSet = new Set([...noSubj(bset)].filter((x) => !oset.has(x) && !o3.has(x.replace(/\/[yn]$/, ''))));
      let keepAdd = addSet;
      if (cat.genderGuard) {
        // a homograph with a different gender (mí_fem + mí_masc4) would make the word gender-ambiguous
        const oldGenders = new Set([...o3].map((x) => x.split('/')[2]).filter((x) => x !== '-'));
        keepAdd = new Set([...addSet].filter((x) => { const gd = x.split('/')[2]; return gd === '-' || oldGenders.size === 0 || oldGenders.has(gd); }));
        // an explicit "union" decision (e.g. teanglann lists both genders for separate senses) overrides the guard
        if (decisionFor(w) === 'union') keepAdd = addSet;
        if (keepAdd.size < addSet.size) { stat.genderAddSkipped++; genderAdds.push([catName, w, [...o3].sort().join(' '), [...b3].sort().join(' ')]); }
      }
      if (!keepAdd.size) continue;
      setCodes(w, t, [...codes, ...toCodes(keyed(keepAdd))]);
      stat.extended++;
    }
  }
  report.push(`${catName}: ${JSON.stringify(stat)}`);
  tsv(`overlay-conflicts-${catName}.tsv`, ['class', 'form', '0.70', 'BuNaMo'], conflicts);
  tsv(`overlay-shadowed-${catName}.tsv`, ['class', 'form', 'correction', 'table'], shadowed);
  if (cat.genderGuard) tsv('overlay-gender-adds.tsv', ['class', 'form', '0.70', 'BuNaMo'], genderAdds);
}

// ---- overlay = difference between the base lexicon and the overlaid one ----
// Tiers are walked in the overlaid order, so new words keep their insertion order when merged.
const overlay = { add: [], remove: [] };
let nNew = 0, nGain = 0, nLose = 0;
for (let t = 0; t < 7; t++) {
  const add = {}, remove = {};
  for (const [w, codes] of Object.entries(out[t])) {
    if (!Object.hasOwn(lex[t], w)) { add[w] = codes; nNew++; continue; }
    const old = lex[t][w];
    if (codes === old) continue;
    const plus = [...new Set(codes)].filter((ch) => !old.includes(ch)).join('');
    const minus = [...new Set(old)].filter((ch) => !codes.includes(ch)).join('');
    // a changed entry always goes in `add` (possibly with no chars), so the merge sorts it as setCodes did
    if (plus || !minus) { add[w] = plus; if (plus) nGain++; }
    if (minus) { remove[w] = minus; nLose++; }
  }
  overlay.add.push(add);
  overlay.remove.push(remove);
}
fs.writeFileSync(path.join(outDir, 'bunamo-overlay.json'), JSON.stringify(overlay));
report.push(`overlay: ${nNew} new forms, ${nGain} existing forms gain codes, ${nLose} lose codes`);
const sizes = (l) => l.map((t) => Object.keys(t).length);
report.push(`forms per tier before: ${sizes(lex).join(' ')} (total ${sizes(lex).reduce((a, b) => a + b, 0)})`);
report.push(`forms per tier after : ${sizes(out).join(' ')} (total ${sizes(out).reduce((a, b) => a + b, 0)})`);
fs.writeFileSync(path.join(reportsDir, 'overlay-report.txt'), report.join('\n') + '\n');
console.log(report.join('\n'));
