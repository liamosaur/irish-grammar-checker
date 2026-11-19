// Pure helpers for the "click a suggestion to fix your text" feature, kept out
// of main.ts so they can be tested without a browser.

/** Rules whose message quotes the word that should replace the flagged one. */
export const QUOTES_REPLACEMENT = new Set(['MICHEART', 'BACHOIR', 'CAIGHDEAN', 'IONADAI', 'MIMHOIRF', 'INPHRASE']);

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
export function quotedParts(quoted: string): Part[] {
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
  quoted.split(/,\s*/).forEach((alt, i) => {
    if (i) parts.push({ text: ', ', option: false });
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
  const sa = planSa(chars, range, replacement);
  if (sa) return sa;
  const tokens: { from: number; to: number }[] = [];
  for (let i = range.from; i < range.to; i++) {
    if (/\s/.test(chars[i])) continue;
    if (tokens.length && tokens[tokens.length - 1].to === i) tokens[tokens.length - 1].to = i + 1;
    else tokens.push({ from: i, to: i + 1 });
  }
  const words = replacement.trim().split(/\s+/).length;
  let from = range.from;
  let to = range.to;
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
  const original = chars.slice(from, to).join('');
  const word = matchCase(original, replacement);
  return word === original ? null : { range: { y: range.y, from, to }, word }; // a button that changes nothing is not offered
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
  NISEIMHIU: unlenite,
  NIDARASEIMHIU: unlenite,
  URU: eclipse,
  NIURU: uneclipse,
  PREFIXH: hPrefix,
  NIAITCH: unHPrefix,
  PREFIXT: tPrefix,
  NITEE: unTPrefix,
  PREFIXD: dPrefix,
  NIDEE: unDPrefix,
  NIBEE: unBPrefix,
  // "Unnecessary initial mutation" does not say which one, but the word shows it.
  NICLAOCHLU: (w) => unlenite(w) ?? uneclipse(w) ?? unTPrefix(w) ?? unHPrefix(w),
};

/** The flagged text with the rule applied to its last word, or null if that cannot be worked out. */
export function proposeFix(rule: string, flagged: string): string | null {
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
  if (rule === 'PREFIXT') {
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

/** The first correction a note offers (what its first button does), or null if it offers none. */
export function firstFix(
  v: { rule: string; msg: string; suggestions: string[]; fixes?: string[]; range?: { y: number; from: number; to: number } },
  line: string,
): Plan | null {
  if (!v.range) return null;
  if (v.suggestions.length) return planReplacement(line, v.range, v.suggestions[0]);
  if (QUOTES_REPLACEMENT.has(v.rule)) {
    const quoted = /\/([^/]+)\//.exec(v.msg)?.[1];
    const word = quoted && quotedParts(quoted).find((p) => p.option)?.text;
    return word ? planReplacement(line, v.range, word) : null;
  }
  const flagged = sliceRange(line, v.range);
  if (flagged !== null && v.fixes?.length) {
    const phrase = withLastWord(flagged, v.fixes[0]);
    if (phrase !== null) return { range: v.range, word: phrase };
  }
  const fixed = flagged === null ? null : proposeFix(v.rule, flagged);
  return fixed === null ? null : { range: v.range, word: fixed };
}
