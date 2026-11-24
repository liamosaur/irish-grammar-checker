// Pure helpers for the "click a suggestion to fix your text" feature, kept out
// of main.ts so they can be tested without a browser.

/** Rules whose message quotes the word that should replace the flagged one. */
// MIMHOIRF quotes only the root (buntaiste, buntáiste); the engine offers the corrected word as a
// suggestion instead (míbhuntáiste).
export const QUOTES_REPLACEMENT = new Set(['MICHEART', 'BACHOIR', 'WEAKBACHOIRAR', 'WEAKBACHOIRMA', 'CAIGHDEAN', 'IONADAI', 'INPHRASE', 'COMHSEIMHIU']);

/** Messages whose quoted alternatives are shown joined by "or" (/Bruiséil/ or /Bruiséile/). */
export const OR_JOINED = new Set(['CAIGHDEAN', 'IONADAI', 'CAIGHMOIRF', 'DROCHMHOIRF']);

export interface Part {
  text: string;
  /** True for a word the user can pick; false for punctuation between choices. */
  option: boolean;
}

/**
 * Splits a quoted part of a message into choosable words.
 * "tá" -> [tá]. "conaí (cónaí)" -> "conaí (" [cónaí] ")": the engine prints the form it
 * derived (itself still a mistake) followed by the correct one in brackets, so only
 * the bracketed word is offered.
 */
export function quotedParts(quoted: string, or = false): Part[] {
  const m = /^(.+?)\s*\(([^()]+)\)$/.exec(quoted.trim());
  if (m) {
    return [
      { text: `${m[1]} (`, option: false },
      { text: m[2], option: true },
      { text: ')', option: false },
    ];
  }
  // "méid, mhéid" is two alternatives, never one text to insert. A lone "X" stands for
  // words the rule cannot name ("á X"), so such an entry is shown but not offered.
  const parts: Part[] = [];
  const alts = quoted.split(/,\s*/);
  alts.forEach((alt, i) => {
    if (i) parts.push({ text: or && i === alts.length - 1 ? ' or ' : ', ', option: false });
    parts.push({ text: alt, option: !/(^|\s)X(\s|$)/.test(alt) });
  });
  return parts;
}

const editDistance = (a: string, b: string): number => {
  const s = Array.from(a.toLowerCase());
  const t = Array.from(b.toLowerCase());
  let prev = Array.from({ length: t.length + 1 }, (_, j) => j);
  for (let i = 1; i <= s.length; i++) {
    const row = [i];
    for (let j = 1; j <= t.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[t.length];
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export interface Plan {
  /** The part of the line to replace. */
  range: { y: number; from: number; to: number };
  /** What to put there, written in the user's capitalisation. */
  word: string;
}

/**
 * Works out what a click on `replacement` should change. The engine flags a run of words
 * ("in Páras") but the replacement may stand for only some of them ("i" replaces "in"),
 * so when the flagged text has more words than the replacement, only the part most like
 * the replacement is replaced (ties go to the longer part). Otherwise the whole flagged
 * text is replaced.
 */
export function planReplacement(line: string, range: { y: number; from: number; to: number }, replacement: string): Plan | null {
  const chars = Array.from(line);
  if (range.from < 0 || range.to <= range.from || range.to > chars.length) return null;
  const sa = planSa(chars, range, replacement) ?? planMa(chars, range, replacement) ?? planSan(chars, range, replacement);
  if (sa) return sa;
  const tokens: { from: number; to: number }[] = [];
  for (let i = range.from; i < range.to; i++) {
    if (/\s/.test(chars[i])) continue;
    if (tokens.length && tokens[tokens.length - 1].to === i) tokens[tokens.length - 1].to = i + 1;
    else tokens.push({ from: i, to: i + 1 });
  }
  if (tokens.length === 1 && !/\s/.test(replacement.trim())) {
    replacement = keepMutation(chars.slice(tokens[0].from, tokens[0].to).join(''), replacement.trim());
  }
  const rep = replacement.trim().split(/\s+/);
  const words = rep.length;
  let from = range.from;
  let to = range.to;
  // "go mo" with "go dtí": the replacement begins with the first flagged word and the rest of it is
  // nothing like the other flagged words (not a respelling: cé mhéad -> cé mhéid), so it stands
  // for the first word (go mo theach -> go dtí mo theach).
  const flaggedWords = tokens.map((t) => chars.slice(t.from, t.to).join('').toLowerCase());
  const unlike = (a: string, b: string) => editDistance(a, b) >= 0.8 * Math.max(Array.from(a).length, Array.from(b).length);
  if (tokens.length > 1 && words > 1 && words === tokens.length && rep[0].toLowerCase() === flaggedWords[0]
    && flaggedWords.slice(1).every((w) => rep.slice(1).every((r) => unlike(w, r)))) {
    const original = chars.slice(tokens[0].from, tokens[0].to).join('');
    return { range: { y: range.y, from: tokens[0].from, to: tokens[0].to }, word: matchCase(original, replacement) };
  }
  if (tokens.length > 1 && words < tokens.length) {
    let best = Infinity;
    for (let i = 0; i < tokens.length; i++) {
      for (let j = i; j < tokens.length; j++) {
        const run = chars.slice(tokens[i].from, tokens[j].to).join('');
        // "Cé an" and "cén" are close once the words are joined, which is how a contraction reads.
        const d = Math.min(editDistance(run, replacement), editDistance(run.replace(/\s+/g, ''), replacement));
        if (d < best || (d === best && j - i > 0 && tokens[j].to - tokens[i].from > to - from)) {
          best = d;
          from = tokens[i].from;
          to = tokens[j].to;
        }
      }
    }
  }
  // A set phrase ("maidir le") is quoted whole although only part of it ("maidir") is flagged.
  // Where the rest is already in the text next to it, cover those words too instead of repeating them.
  if (from === range.from && to === range.to) {
    const rep = replacement.trim().split(/\s+/);
    const flaggedWords = chars.slice(from, to).join('').trim().split(/\s+/).map((w) => w.toLowerCase());
    // Which part of the phrase do the flagged words correspond to? The closest by spelling ("shon" ~ "son").
    let i = -1;
    let best = Infinity;
    if (rep.length > flaggedWords.length) {
      for (let k = 0; k + flaggedWords.length <= rep.length; k++) {
        const d = editDistance(rep.slice(k, k + flaggedWords.length).join(' '), flaggedWords.join(' '));
        if (d < best) { best = d; i = k; }
      }
    }
    if (i >= 0) {
      const before = rep.slice(0, i);
      const after = rep.slice(i + flaggedWords.length);
      const beforeText = chars.slice(0, from).join('');
      const afterText = chars.slice(to).join('');
      const b = before.length ? new RegExp(`(?:^|\\s)${before.map(escapeRe).join('\\s+')}\\s+$`, 'i').exec(beforeText) : null;
      const a = after.length ? new RegExp(`^\\s+${after.map(escapeRe).join('\\s+')}(?![\\p{L}\\p{M}'-])`, 'iu').exec(afterText) : null;
      if (b) from -= Array.from(b[0].replace(/^\s/, '')).length;
      if (a) to += Array.from(a[0]).length;
    }
  }
  // An elided form ("b'", "mb'") is written joined to the next word: "Ba eol" -> "B'eol".
  if (/^\S+['’]$/.test(replacement)) {
    let gap = to;
    while (gap < chars.length && /[ \t]/.test(chars[gap])) gap++;
    if (gap > to && gap < chars.length && /\p{L}/u.test(chars[gap])) to = gap;
  }
  // After the copula ní, é, í, iad and ea take h (Ní sé -> Ní hé).
  if (/^(é|í|iad|ea)$/i.test(replacement.trim()) && /(^|\s)ní\s+$/i.test(chars.slice(0, from).join(''))) replacement = `h${replacement.trim()}`;
  const original = chars.slice(from, to).join('');
  const word = matchCase(original, replacement);
  return word === original ? null : { range: { y: range.y, from, to }, word }; // a button that changes nothing is not offered
}

/** The initial mutation a word shows, and its form without it; null if it shows none. */
function mutationOf(w: string): { plain: string; apply: (w: string) => string | null } | null {
  const ecl = uneclipse(w);
  if (ecl !== null) return { plain: ecl, apply: eclipse };
  const t = unTPrefix(w);
  if (t !== null) return { plain: t, apply: tPrefix };
  if (/^d['’]./i.test(w)) return { plain: w.slice(2), apply: dPrefix };
  const h = unHPrefix(w);
  if (h !== null) return { plain: h, apply: hPrefix };
  const len = unlenite(w);
  if (len !== null) return { plain: len, apply: lenite };
  return null;
}

/**
 * A replacement for one word from the word list (the standard spelling: chulghairm ->
 * cúlghairm) is given as the plain form; the word keeps the mutation it had in the text (a
 * chulghairm -> a chúlghairm; i gconaí -> i gcónaí). Only when the replacement shows no mutation
 * of its own and begins with the same letter as the word without its mutation.
 */
export function keepMutation(original: string, replacement: string): string {
  const m = mutationOf(original);
  if (!m || mutationOf(replacement) || lc(m.plain[0]) !== lc(replacement[0])) return replacement;
  if (allCaps(m.plain)) return replacement; // an abbreviation (na gCE): not a word to mutate
  return m.apply(replacement) ?? replacement;
}

/**
 * "i an" -> "sa": the noun after it takes the dative of An Córas Lárnach (CO17 1.4.1), so it
 * is changed in the same click (i an gCabhán -> sa Chabhán; san fhéar; in an oifig -> san
 * oifig). Null unless the flagged words are "i an" or "in an" and the replacement sa or san.
 */
function planSa(chars: string[], range: { y: number; from: number; to: number }, replacement: string): Plan | null {
  const flagged = chars.slice(range.from, range.to).join('');
  if (!/^\s*in?\s+an\s*$/i.test(flagged) || !/^san?$/i.test(replacement.trim())) return null;
  const next = /^(\s+)([\p{L}\p{M}'’-]+)/u.exec(chars.slice(range.to).join(''));
  if (!next) return null;
  const noun = datAfterSa(next[2]);
  const word = matchCase(flagged.trim(), noun.san ? 'san' : 'sa') + next[1] + noun.word;
  const lead = Array.from(/^\s*/.exec(flagged)![0]).length;
  return { range: { y: range.y, from: range.from + lead, to: range.to + Array.from(next[0]).length }, word };
}

/**
 * "sa n-eachtra" -> "san eachtra": san before a vowel, and the eclipsis of the noun goes (it is
 * not eclipsed after sa). Null unless the flagged words are sa and an eclipsed vowel, and the
 * replacement san.
 */
function planSan(chars: string[], range: { y: number; from: number; to: number }, replacement: string): Plan | null {
  const flagged = chars.slice(range.from, range.to).join('');
  const m = /^(\s*)(sa)(\s+)(\S+?)(\s*)$/iu.exec(flagged);
  const noun = m && uneclipse(m[4]);
  if (!m || !noun || !isVowel(noun[0]) || !/^san$/i.test(replacement.trim())) return null;
  const lead = Array.from(m[1]).length;
  return { range: { y: range.y, from: range.from + lead, to: range.to - Array.from(m[5]).length }, word: matchCase(m[2], 'san') + m[3] + noun };
}

/**
 * "dá" + verb -> "má": má lenites the verb where dá eclipsed it (Dá ndéanann -> Má dhéanann; Dá
 * bhfuil -> Má tá is left to the user: tá and deir are not lenited after má, CO17 5.4.5(b)). Null
 * unless the flagged words are dá and a verb and the replacement má.
 */
function planMa(chars: string[], range: { y: number; from: number; to: number }, replacement: string): Plan | null {
  const flagged = chars.slice(range.from, range.to).join('');
  const m = /^(\s*)(dá)(\s+)([\p{L}\p{M}'’-]+)\s*$/iu.exec(flagged);
  if (!m || !/^má$/i.test(replacement.trim())) return null;
  const plain = uneclipse(m[4]) ?? m[4];
  if (/^(?:tá(?:im|imid|thar)?|(?:bh)?fuil(?:im|imid|tear)?|deir\p{L}*|dúirt|dúramar|déarf\p{L}*)$/iu.test(plain)) return null; // bí and abair: left alone
  const verb = lenite(plain) ?? plain;
  const lead = Array.from(m[1]).length;
  return { range: { y: range.y, from: range.from + lead, to: range.to }, word: matchCase(m[2], 'má') + m[3] + verb };
}

/**
 * A noun after "sa" in An Córas Lárnach (CO17 1.4.1-1.4.4): lenited (b, c, f, g, m, p), from its
 * plain form if eclipsed; d, t and vowels unchanged; s left as written (whether it takes t
 * depends on the gender). `san` before a vowel and before f + vowel.
 */
function datAfterSa(w: string): { word: string; san: boolean } {
  const plain = uneclipse(w) ?? w;
  const c = lc(plain[0]);
  const word = 'bcfgmp'.includes(c) ? lenite(plain) ?? plain : plain;
  return { word, san: isVowel(word[0]) || (lc(word[0]) === 'f' && lc(word[1]) === 'h' && isVowel(word[2])) };
}

/**
 * Gives a replacement the capitalisation of the word it replaces: "Ta" + "tá" -> "Tá",
 * "TA" + "tá" -> "TÁ". Anything else (lower case, mixed case such as "gCabhan") is left as
 * the replacement was written.
 */
export function matchCase(original: string, replacement: string): string {
  const chars = Array.from(original);
  const letters = chars.filter((c) => c !== c.toLowerCase() || c !== c.toUpperCase());
  if (!letters.length || chars[0] === chars[0].toLowerCase() && chars[0] !== chars[0].toUpperCase()) return replacement;
  const first = Array.from(replacement)[0];
  // Already capitalised after a mutation prefix (tSeapánaigh, nÉireannach, mBaile): the capital is in the right place.
  const second = Array.from(replacement)[1];
  if (second && first === first.toLowerCase() && second !== second.toLowerCase() && second === second.toUpperCase()) return replacement;
  if (letters.length > 1 && letters.every((c) => c === c.toUpperCase())) return replacement.toUpperCase();
  if (chars[0] === chars[0].toUpperCase() && chars[0] !== chars[0].toLowerCase() && !letters.slice(1).some((c) => c === c.toUpperCase())) {
    return first.toUpperCase() + replacement.slice(first.length);
  }
  return replacement;
}

/** Replaces code points [from, to) of line y with `word`; returns the new text, or null if the range does not fit. */
export function applyCorrection(text: string, range: { y: number; from: number; to: number }, word: string): string | null {
  const lines = text.split('\n').map((l) => Array.from(l));
  const line = lines[range.y];
  if (!line || range.from < 0 || range.to < range.from || range.to > line.length) return null;
  line.splice(range.from, range.to - range.from, ...Array.from(word));
  return lines.map((l) => l.join('')).join('\n');
}

// ---------------------------------------------------------------------------
// Initial mutations. For rules like "Lenition missing" the engine only says what
// is wrong; these functions work out the corrected word. Each returns null when
// the word cannot take that change, so the UI then simply offers nothing.

const VOWELS = 'aeiouáéíóúAEIOUÁÉÍÓÚ';
const isVowel = (c: string | undefined) => !!c && VOWELS.includes(c);
const isUpper = (c: string) => c !== c.toLowerCase();
const lc = (c: string | undefined) => (c ?? '').toLowerCase();
const allCaps = (w: string) => w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase();
const ECLIPSED = ['mb', 'gc', 'nd', 'ng', 'bp', 'dt', 'bh'];

/**
 * bean -> bhean, gCabhán -> Chabhán. A word that is eclipsed is lenited from its plain form
 * (after "sa" the eclipsis goes and lenition replaces it). Null if the word cannot be
 * lenited or already is.
 */
export function lenite(w: string): string | null {
  const plain = uneclipse(w) ?? w;
  const c = lc(plain[0]);
  const next = lc(plain[1]);
  if (!c || next === 'h') return null;
  if ('bcdfgmpt'.includes(c)) { /* always lenites */ }
  else if (c === 's') { if (!(isVowel(plain[1]) || 'lnr'.includes(next) && next)) return null; }
  else return null;
  return plain[0] + (allCaps(plain) ? 'H' : 'h') + plain.slice(1);
}

/** bhean -> bean. */
export function unlenite(w: string): string | null {
  if (w.length > 1 && 'bcdfgmpst'.includes(lc(w[0])) && lc(w[1]) === 'h') return w[0] + w.slice(2);
  return null;
}

/** bord -> mbord, cat -> gcat, ainm -> n-ainm. Null if already eclipsed or not eclipsable. */
export function eclipse(w: string): string | null {
  if (lc(w.slice(0, 3)) === 'bhf') return null;
  const base = unlenite(w) ?? w; // an already-lenited word (dhearna) is eclipsed from its plain form (ndearna)
  const c = lc(base[0]);
  const next = lc(base[1]);
  if (ECLIPSED.includes(c + next) || (c === 'n' && (next === '-' || (isVowel(base[1]) && isUpper(base[1]))))) return null;
  const prefix: Record<string, string> = { b: 'm', c: 'g', d: 'n', g: 'n', p: 'b', t: 'd', f: 'bh' };
  if (c in prefix) return prefix[c] + base;
  if (isVowel(base[0])) return isUpper(base[0]) ? `n${base}` : `n-${base}`;
  return null;
}

/** mbord -> bord, n-ainm -> ainm, bhfuil -> fuil. */
export function uneclipse(w: string): string | null {
  const pair = lc(w[0]) + lc(w[1]);
  if (lc(w.slice(0, 3)) === 'bhf') return w.slice(2);
  if (['mb', 'gc', 'bp', 'dt'].includes(pair)) return w.slice(1);
  if (['nd', 'ng'].includes(pair)) return w.slice(1);
  if (w[0] === 'n' && w[1] === '-' && isVowel(w[2])) return w.slice(2);
  if (w[0] === 'n' && isVowel(w[1]) && isUpper(w[1])) return w.slice(1);
  return null;
}

/** iontach -> hiontach. */
export function hPrefix(w: string): string | null { return isVowel(w[0]) ? `h${w}` : null; }
/** hiontach -> iontach. */
/** hata -> ata, hÉireann -> Éireann, Habair -> Abair (the capital moves to the vowel). */
export function unHPrefix(w: string): string | null {
  if (lc(w[0]) !== 'h' || !isVowel(w[1])) return null;
  const rest = w.slice(1);
  return isUpper(w[0]) && !isUpper(rest[0]) ? rest[0].toUpperCase() + rest.slice(1) : rest;
}

/** alt -> t-alt, Acht -> tAcht, sráid -> tsráid. */
export function tPrefix(w: string): string | null {
  if (isVowel(w[0])) return isUpper(w[0]) ? `t${w}` : `t-${w}`;
  if (lc(w[0]) === 's' && (isVowel(w[1]) || 'lnr'.includes(lc(w[1])) && w[1])) return `t${w}`;
  return null;
}
/** t-alt -> alt, tAcht -> Acht, tsráid -> sráid. */
export function unTPrefix(w: string): string | null {
  if (w[0] === 't' && w[1] === '-' && isVowel(w[2])) return w.slice(2);
  if (w[0] === 't' && isVowel(w[1]) && isUpper(w[1])) return w.slice(1);
  if (w[0] === 't' && lc(w[1]) === 's' && (isVowel(w[2]) || 'lnr'.includes(lc(w[2])) && w[2])) return w.slice(1);
  return null;
}

/** fhéach -> d'fhéach, ól -> d'ól. */
export function dPrefix(w: string): string | null {
  return isVowel(w[0]) || (lc(w[0]) === 'f' && lc(w[1]) === 'h') ? `d'${w}` : null;
}
export function unDPrefix(w: string): string | null { return /^d'./i.test(w) ? w.slice(2) : null; }
/** b'fhéadfadh -> fhéadfadh. */
export function unBPrefix(w: string): string | null { return /^b'./i.test(w) ? w.slice(2) : null; }

/** Which change fixes which rule. The change is made to the last word of the flagged words. */
const FIXES: Record<string, (w: string) => string | null> = {
  SEIMHIU: lenite,
  WEAKSEIMHIUGEN: lenite, // a hint: lenition is usual but may not apply (grammar/rialacha-ga.in)
  WEAKSEIMHIUVOC: lenite, // a hint: the vocative, unless a is the possessive her
  NISEIMHIU: unlenite,
  NIDARASEIMHIU: unlenite,
  URU: eclipse,
  NIURU: uneclipse,
  PREFIXH: hPrefix,
  NIAITCH: unHPrefix,
  PREFIXT: tPrefix,
  PREFIXTS: tPrefix,
  WEAKPREFIXT: tPrefix, // a hint: t- after a noun, unless the noun is in the genitive
  NITEE: unTPrefix,
  // d' goes before the capital: Fhág -> D'fhág, Ól -> D'ól
  PREFIXD: (w) => { const c = dPrefix(w.toLowerCase()); return c === null ? null : matchCase(w, c); },
  NIDEE: unDPrefix,
  NIBEE: unBPrefix,
  // "Unnecessary initial mutation" does not say which one, but the word shows it.
  NICLAOCHLU: (w) => unlenite(w) ?? uneclipse(w) ?? unTPrefix(w) ?? unHPrefix(w),
};

/**
 * The flagged text with the rule applied to its last word, or null if that cannot be worked out.
 * `before` is the text of the line before the flagged words (le before n-íoc); `unit` the last
 * flagged token when the tagger took several words as one (GrammarError.unit).
 */
export function proposeFix(rule: string, flagged: string, before = '', unit?: string): string | null {
  // "Definite article required": add the plain article. The rules that look at the result
  // then sort out the rest (sa, na, the mutation), one click at a time.
  if (rule === 'NEEDART') return flagged.trim() ? `an ${flagged}` : null;
  // "Unnecessary article": drop the leading "an" and the mutation it caused on the next word.
  if (rule === 'BADART' || rule === 'ONEART') {
    const m = /^(\s*)(an|san)(\s+)(\S+)([\s\S]*)$/i.exec(flagged);
    if (!m) return null;
    const [, lead, art, gap, next, rest] = m;
    if (art.toLowerCase() === 'san') return rule === 'BADART' ? `${lead}${matchCase(art, 'in')}${gap}${next}${rest}` : null;
    const plain = unlenite(next) ?? unTPrefix(next) ?? next;
    return `${lead}${matchCase(art, plain)}${rest}`;
  }
  // "Repeated word": keep one copy.
  if (rule === 'DUBAILTE') {
    const words = flagged.trim().split(/\s+/);
    return words.length > 1 && words.every((w) => w.toLowerCase() === words[0].toLowerCase()) ? words[0] : null;
  }
  // "Prefix h missing" and "Unnecessary lenition": the change goes on the last word
  // that can take it. That is the last word for most rules, but some flag a phrase
  // with that word inside it ("Ní aithne go haontíos", "Ní uair chairde",
  // "Maidin shách fuar", "chothrom le dáta": grammar/rialacha-ga.in).
  // "Prefix t missing" after the article: the t goes on the word after "an", which may
  // be the first of a phrase taken as one noun ("an éirí amach" -> "an t-éirí amach").
  if (rule === 'PREFIXT' || rule === 'PREFIXTS' || rule === 'WEAKPREFIXT') {
    const m = /^(\s*an\s+)(\S+)([\s\S]*)$/i.exec(flagged);
    if (m) { const changed = tPrefix(m[2]); return changed === null ? null : m[1] + changed + m[3]; }
  }
  // "na" for "ná" before the imperative: write ná, and h on a verb beginning with a
  // vowel ("Na abair é" -> "Ná habair é"; grammar/rialacha-ga.in, NAIMPER).
  if (rule === 'NAIMPER') {
    const m = /^(\s*)(\S+)(\s+)(\S+)([\s\S]*)$/.exec(flagged);
    if (!m || lc(m[2]) !== 'na') return null;
    return m[1] + matchCase(m[2], 'ná') + m[3] + (hPrefix(m[4]) ?? m[4]) + m[5];
  }
  // "Unnecessary eclipsis" on a vowel after a word that puts h before a vowel: the h goes in
  // where the n- comes out (le n-íoc -> le híoc).
  if (rule === 'NIURU') {
    const m = /^([\s\S]*?)(\S+)(\s*)$/.exec(flagged);
    const plain = m && uneclipse(m[2]);
    if (m && plain && isVowel(plain[0]) && /(?:^|\s)(?:le|go|na|chomh)\s+$/i.test(before + m[1])) return m[1] + (hPrefix(plain) ?? plain) + m[3];
  }
  // d' after a particle: the verb takes the particle's own mutation instead. The particles
  // ending in r and ní lenite (already shown by fh-; a vowel is unchanged); the others eclipse
  // (ina d'athródh -> ina n-athródh), except interrogative an before a vowel (An íosfá).
  if (rule === 'NIDEE') {
    const m = /^(\s*)(\S+)(\s+)(\S+)(\s*)$/.exec(flagged);
    const verb = m && unDPrefix(m[4]);
    if (!m || verb === null) return null;
    const p = m[2].toLowerCase();
    // a (his, her, their, or the relative) does not say which.
    const eclipses = !/r$/.test(p) && p !== 'ní' && p !== 'a' && !(p === 'an' && isVowel(verb[0]));
    return m[1] + m[2] + m[3] + (eclipses ? eclipse(verb) ?? verb : verb) + m[5];
  }
  // A past verb with its subject pronoun (Socraigh sí -> Shocraigh sí, Ól sé -> D'ól sé): the
  // change goes on the verb.
  // But tú as the object, after a subject pronoun or a synthetic ending, is the word that takes
  // the lenition (Chonaic mé tú -> Chonaic mé thú; Aithním tú -> Aithním thú).
  if (rule === 'SEIMHIU') {
    const m = /^([\s\S]*?(?:\b(?:mé|sé|sí|siad|sinn|muid|sibh)|(?:[ií]m|[ií]mid|amar|omar|[ií]mis|[ií]nn)(?:se|ne)?)\s+)(tú|tusa)(\s*)$/i.exec(flagged);
    if (m) return m[1] + matchCase(m[2], 'th' + m[2].slice(1).toLowerCase()) + m[3];
  }
  // The same for a verb after a particle (Ní dearna mé -> Ní dhearna mé; Mura cuire tú -> Mura gcuire tú).
  if (rule === 'SEIMHIU' || rule === 'PREFIXD' || rule === 'URU') {
    const m = /^([\s\S]*?)(\S+)(\s+(?:mé|tú|sé|sí|siad|sinn|muid|sibh|mise|seisean|sise|siadsan|sinne|sibhse)\s*)$/i.exec(flagged);
    if (m) { const changed = FIXES[rule](m[2]); return changed === null ? null : m[1] + changed + m[3]; }
  }
  // Bí before a noun phrase is the past missing its lenition (Bí na fir -> Bhí na fir).
  if (rule === 'SEIMHIU') {
    const m = /^(\s*)(bí)(\s[\s\S]*)$/i.exec(flagged);
    if (m) return m[1] + matchCase(m[2], 'bhí') + m[3];
  }
  // Lenition after a (the vocative, a fhios agam): the word after a, which may not be the last
  // ("A daoine uaisle" -> "A dhaoine uaisle").
  if (rule === 'SEIMHIU' || rule === 'WEAKSEIMHIUVOC') {
    const m = /^(\s*a\s+)(\S+)([\s\S]*)$/i.exec(flagged);
    if (m) { const changed = lenite(m[2]); return changed === null ? null : m[1] + changed + m[3]; }
  }
  const inside = rule === 'PREFIXH' ? hPrefix : rule === 'NISEIMHIU' ? unlenite : null;
  if (inside) {
    const words = [...flagged.matchAll(/\S+/g)];
    for (let i = words.length - 1; i >= 0; i--) {
      const changed = inside(words[i][0]);
      if (changed === null) continue;
      const at = words[i].index!;
      return flagged.slice(0, at) + changed + flagged.slice(at + words[i][0].length);
    }
    return null;
  }
  const fix = FIXES[rule];
  if (!fix) return null;
  // The last token is several words taken as one (i Baile Átha Cliath, ár dul chun cinn): the
  // mutation goes on its first word (i mBaile Átha Cliath, ár ndul chun cinn).
  const at = unit ? flagged.toLowerCase().lastIndexOf(unit.toLowerCase()) : -1;
  if (unit && at >= 0 && !flagged.slice(at + unit.length).trim()) {
    const first = /^\S+/.exec(unit)![0];
    const changed = fix(flagged.slice(at, at + first.length));
    return changed === null ? null : flagged.slice(0, at) + changed + flagged.slice(at + first.length);
  }
  const m = /^([\s\S]*?)(\S+)(\s*)$/.exec(flagged);
  if (!m) return null;
  const changed = fix(m[2]);
  return changed === null ? null : m[1] + changed + m[3];
}

/** The text covered by a range from the engine (one line). */
export function sliceRange(text: string, range: { y: number; from: number; to: number }): string | null {
  const line = text.split('\n')[range.y];
  return line === undefined ? null : Array.from(line).slice(range.from, range.to).join('');
}

/** The flagged text with its last word replaced: ("ar chúl an doras", "dorais") -> "ar chúl an dorais". */
export function withLastWord(flagged: string, word: string): string | null {
  const m = /^([\s\S]*?)(\S+)(\s*)$/.exec(flagged);
  return m ? m[1] + word + m[3] : null;
}

/** What a note needs for its buttons. */
export interface NoteLike { rule: string; msg: string; suggestions: string[]; fixes?: string[]; range?: { y: number; from: number; to: number }; unit?: string; noFix?: true }

/**
 * The words a note quotes as replacements that are offered as buttons, in order. With `line`
 * (the note's line), a word-list note whose standard forms are only the flagged word mutated
 * (tug: /dtug, thug/; faca: /bhfaca, fhaca/) offers only the form the particle before it calls
 * for (Ar tug -> Ar thug; An faca -> An bhfaca), or none if no offered form fits. None for a
 * note that names the standard word but not the form the text needs (noFix: péintéireachtaí,
 * /péintéireacht/).
 */
export function quotedOptions(v: NoteLike, line?: string): string[] {
  if (!QUOTES_REPLACEMENT.has(v.rule) || v.noFix) return [];
  const all = [...v.msg.matchAll(/\/([^/]+)\//g)].flatMap((m) => quotedParts(m[1]).filter((p) => p.option).map((p) => p.text));
  if (line === undefined || !v.range) return all;
  const chars = Array.from(line);
  const flagged = chars.slice(v.range.from, v.range.to).join('').trim().toLowerCase();
  const kind = (w: string) => uneclipse(w) !== null ? 'eclipse' : unlenite(w) !== null ? 'lenite' : null;
  const plainOf = (w: string) => (uneclipse(w) ?? unlenite(w) ?? '').toLowerCase();
  if (/\s/.test(flagged) || !all.length || !all.every((o) => kind(o) && plainOf(o) === flagged)) return all;
  const wanted = mutationAfter(chars.slice(0, v.range.from).join(''));
  return wanted ? all.filter((o) => kind(o) === wanted) : all;
}

/** Verbal particles that eclipse, and those that lenite (the dependent forms after them). */
const ECLIPSING_PARTICLES = new Set(['an', 'go', 'nach', 'cá', 'dá', 'mura', 'sula']);
const LENITING_PARTICLES = new Set(['ní', 'níor', 'nár', 'ar', 'gur', 'cár', 'murar', 'sular', 'má']);

/**
 * The mutation a verb takes after the text before it: the particle's, or lenition (the
 * independent form) when no particle comes before it. Null after a (direct or indirect relative).
 */
function mutationAfter(before: string): 'eclipse' | 'lenite' | null {
  const prev = /(\S+)\s*$/.exec(before)?.[1].toLowerCase();
  if (prev === 'a') return null;
  if (prev && ECLIPSING_PARTICLES.has(prev)) return 'eclipse';
  if (prev && LENITING_PARTICLES.has(prev)) return 'lenite';
  return 'lenite'; // no particle
}

/**
 * The flagged text as the rule asks for it, one per button after the message: the last word
 * replaced by each form from the word-form table (the genitive, ...), or else the change the
 * rule names (lenition, ...).
 */
export function proposals(v: NoteLike, flagged: string, before = ''): string[] {
  const out: string[] = [];
  if (v.noFix) return out;
  for (const w of v.fixes ?? []) { const p = withLastWord(flagged, w); if (p !== null) out.push(p); }
  if (!out.length) { const p = proposeFix(v.rule, flagged, before, v.unit); if (p !== null) out.push(p); }
  return out;
}

/** The corrections a note offers apart from spelling suggestions: its quoted words, then its proposals. */
export function notePlans(v: NoteLike, line: string): Plan[] {
  if (!v.range) return [];
  const plans: Plan[] = [];
  for (const w of quotedOptions(v, line)) { const p = planReplacement(line, v.range, w); if (p) plans.push(p); }
  const flagged = sliceRange(line, { ...v.range, y: 0 }); // `line` is the flagged line only
  if (flagged !== null) for (const p of proposals(v, flagged, Array.from(line).slice(0, v.range.from).join(''))) plans.push({ range: v.range, word: p });
  return plans;
}

/** The first correction a note offers (what its first button does), or null if it offers none. */
export function firstFix(v: NoteLike, line: string): Plan | null {
  if (!v.range) return null;
  if (v.suggestions.length) return planReplacement(line, v.range, v.suggestions[0]);
  return notePlans(v, line)[0] ?? null;
}
