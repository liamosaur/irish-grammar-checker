// TypeScript port of Lingua::GA::Gramadoir (Kevin P. Scannell's An Gramadóir).
// Derived from the Perl original; see COPYING and README.md.
//
// All text inside the engine is "Latin-1 safe": every UTF-16 unit is < 256,
// matching the Perl engine which transcodes input to iso-8859-1.

import type { GramadoirData, GrammarError, MorphRuleJson, RuleJson } from './types.ts';
import { keepMinority, markDatives } from './datives.ts';
import { applyRules, compileRule, type CompiledRule } from './rules.ts';

const BD = '\u0001';
const NOBD = '\u0002';
// Perl's \s on byte strings (no \xA0 / \x85): JS \s is wider, so spell it out.
const WS = '[ \\t\\n\\r\\f\\v]';

const BDCHARS = 'A-Z\u00c1\u00c9\u00cd\u00d3\u00daa-z\u00e1\u00e9\u00ed\u00f3\u00fa';
const CAPITALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ\u00c1\u00c9\u00cd\u00d3\u00da';
const LOWERS = 'abcdefghijklmnopqrstuvwxyz\u00e1\u00e9\u00ed\u00f3\u00fa';

const RE_CAPITAL = new RegExp(`[${CAPITALS}]`);
const RE_ASCII_UPPER = /[A-Z]/g;
/**
 * Case folding as String::Approx's "i" modifier does it on Latin-1 byte strings: ASCII letters only, so an
 * accented capital (É) does not match its lower-case form (é). Verified against the Perl original.
 */
const foldAscii = (s: string): string => s.replace(RE_ASCII_UPPER, (c) => String.fromCharCode(c.charCodeAt(0) + 32));

const mylc = (s: string): string => {
  let out = '';
  for (const ch of s) {
    const i = CAPITALS.indexOf(ch);
    out += i >= 0 ? LOWERS[i] : ch;
  }
  return out;
};
const mylcfirst = (s: string): string => (s.length ? mylc(s[0]) + s.slice(1) : s);

/** Mimics Perl's from_to(utf-8 -> iso-8859-1): unmappable chars become '?'. */
export function toLatin1(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    out += cp < 256 ? ch : '?';
  }
  return out;
}

interface Morph {
  re: RegExp; // non-global, for testing
  reG: RegExp; // global, for replacement
  src: MorphRuleJson;
  pos: RegExp | null;
}

interface PosAns {
  v: string;
}

export interface GramadoirOptions {
  unigramTagging?: boolean;
  /**
   * Suggest replacements for unknown words (Perl's `fix_spelling`, the `--aspell` flag). Off by default,
   * as in the Perl library. Suggestions come back as `MOLADH{a, b}` errors with `suggestions` set.
   */
  fixSpelling?: boolean;
  /**
   * Mark the dative singulars that follow the system (CO17 1.7) the text uses less: CORASSEIMHIU,
   * CORASLARNACH (src/datives.ts). Off by default, as it is not in the Perl library.
   */
  datives?: boolean;
  /**
   * For a word whose only fault is a hyphen after a prefix (fo-ráiteas), give the word without it
   * (foráiteas) as the correction, not the root (ráiteas); and for the prefix t written without its
   * hyphen before a lowercase vowel (tospidéal), give t-ospidéal (CO17 1.1.4), not near misses. On
   * by default; the Perl library gives the root and the near misses, so the parity tests turn it off.
   */
  hyphenFix?: boolean;
  /**
   * Leave alone a word with a digit in it that is not in the word list (9rn, 2km, CO2, RFA1): the
   * unknown-word messages only ever flagged times, units and form codes. On by default; the Perl
   * library flags them, so the parity tests turn it off.
   */
  skipDigitWords?: boolean;
  /**
   * With fixSpelling: for an unknown word that the one-edit suggestions miss (GRAM, ANAITHNID),
   * suggest words that differ from it in fadas and at most one more edit (mhuinteorí -> mhúinteoirí,
   * Eoals -> eolas). Only for words of four or more letters with a lower-case letter in them, as
   * abbreviations (km, RF) give only chance matches. On by default; not in the Perl library.
   */
  fadaSuggestions?: boolean;
  /**
   * With fixSpelling: no one-edit suggestions and no unlikely-letters message (GRAM) for an unknown
   * word written all in capitals, an abbreviation (COLÓ, SIMI, FCPS), for which both are chance
   * (COLÓ -> Colm; GRAM{^CO}), as fadaSuggestions found for km, RF; it gets the unknown-word
   * message. On by default; the Perl library gives them, so the parity tests turn it off.
   */
  capsNoNearMiss?: boolean;
  /**
   * With fixSpelling: for an unknown word that the other suggestions miss, a prefix the morphology
   * knows (comh-, ath-, neamh-) followed by a root one edit away from a word in the word list
   * (comhchónatheoir -> comhchónaitheoir). Such words are built by the morphology rather than
   * listed, so the one-edit search over the word list cannot find them. On by default; not in the
   * Perl library.
   */
  prefixSuggestions?: boolean;
  /**
   * A word read as a compound of two listed words (COMHFHOCAL) whose second part could be lenited
   * but is not: flagged COMHSEIMHIU with the lenited compound (ríomhprionta -> ríomhphrionta). The
   * second part of a compound is lenited except for d, t or s after d, n, t, l or s (CO17 2.1.7,
   * 10.2.12, 10.3.5: antráth, catsúil). On by default; not in the Perl library.
   */
  compoundLenition?: boolean;
  /**
   * Report a word that splits into two listed words, one of them a non-standard form, as
   * COMHCHAIGH ("may be a non-standard compound"). Off by default: the splits were nearly all
   * chance (dhreacht+adh, truailli+teach), and without them the word gets the unknown-word
   * messages and their spelling suggestions (truaillitheach). On in the Perl library.
   */
  nonStandardCompounds?: boolean;
  /**
   * Messages name the words a word is formed from as the dictionary lists them: a prefixed word
   * is reported as MOIRFREIMIR (comh and gnéis) instead of MOIRF, and the root of MOIRF and the
   * second part of COMHFHOCAL are shown without the lenition the first part gives them
   * (ghnéis -> gnéis). On by default; not in the Perl library.
   */
  namedParts?: boolean;
  /**
   * A rare word (NEAMHCHOIT) is reported only when it looks like a mistake for a commoner word:
   * one edit away from a word in a more frequent tier of the word list that is not rare itself,
   * offered as the suggestion (beith -> bheith, rata -> ráta). A rare word with no such neighbour
   * is left alone: the checker is for grammar, and a rare word is not an error. On by default;
   * not in the Perl library, which reports every rare word.
   */
  rareNeedsMatch?: boolean;
  /**
   * Report a word not in the word list that the morphology reads as a regular formation from a
   * listed word: a prefix (MOIRF, MOIRFREIMIR with namedParts: comhghnéis, comh + gnéis) or an
   * ending (cuimsiúcháin, from cuimsiú). Off by default: the prefix rules check the lenition and
   * hyphen, so such a word is almost always correct, and the flag is information, not a grammar
   * error. On in the Perl library.
   */
  derivedWords?: boolean;
  /**
   * Report NOGENITIVE as a hint, WEAKNOGENITIVE, when the genitive may be a plural the dictionary
   * doesn't list (le déanmhais; see grammaticalErrors). On by default; not in the Perl library.
   */
  pluralHint?: boolean;
}

function toMap(o: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(o));
}

export class Gramadoir {
  private focail: Map<string, string>[];
  private eile: Map<string, string>;
  private earraidi: Map<string, string>;
  private nocombo: Set<string>;
  private grams: Set<string>;
  private pos: Map<string, string>;
  private sop: Map<string, string>;
  private token: { re: RegExp; tag: string; tail: string }[];
  private morph: Morph[];
  private puremorph: Morph[];
  /** Level -2 rules (not in Perl 0.70): regular inflections, such as the emphatic suffixes. */
  private inflect: Morph[];
  private messages: Record<string, string>;
  private aonchiall: CompiledRule[];
  private comhshuite: CompiledRule[];
  private giorr: CompiledRule[];
  private rialacha: CompiledRule[];
  private unigram: CompiledRule[];
  /** Genitive singulars (lower case) whose every noun in BuNaMo has a plural spelt differently. */
  private genitiveNotPlural = new Set<string>();
  private opts: Required<GramadoirOptions>;
  private memo = new Map<string, string>();
  // spelling suggestions (built lazily)
  private alphabetCache: string[] | null = null;
  private foldedAlphabetCache: string[] | null = null;
  private foldIndex: Map<string, string[]>[] | null = null;
  private fadaIndex: Map<string, string[]>[] | null = null;
  private firstPartCache: Map<string, boolean> | null = null;
  /** Set while tagAsCompound tags the parts of a word: a part is not read as prefix + unlenited root. */
  private inCompound = false;

  constructor(data: GramadoirData, opts: GramadoirOptions = {}) {
    this.opts = { unigramTagging: true, fixSpelling: false, datives: false, hyphenFix: true, skipDigitWords: true, fadaSuggestions: true, capsNoNearMiss: true, prefixSuggestions: true, compoundLenition: true, nonStandardCompounds: false, namedParts: true, rareNeedsMatch: true, derivedWords: false, pluralHint: true, ...opts };
    this.focail = data.lexicon.map(toMap);
    this.eile = toMap(data.eile);
    this.earraidi = toMap(data.earraidi);
    this.nocombo = new Set(data.nocombo);
    this.grams = new Set(data.grams);
    this.pos = toMap(data.pos);
    this.sop = new Map([...this.pos].map(([k, v]) => [v, k]));
    this.token = data.token.map((t) => ({ re: new RegExp(t.re, 'g'), tag: t.tag, tail: t.tail }));
    this.morph = data.morph.map((m) => ({
      re: new RegExp(m.re),
      reG: new RegExp(m.re, 'g'),
      src: m,
      pos: m.poscompiled ? new RegExp(m.poscompiled) : null,
    }));
    this.puremorph = this.morph.filter((m) => m.src.level === -1);
    this.inflect = this.morph.filter((m) => m.src.level === -2);
    this.messages = data.messages;
    const vn = withVerbalNouns(data.verbalNouns ?? []);
    this.aonchiall = data.rules.aonchiall.map(vn).map(compileRule);
    this.comhshuite = data.rules.comhshuite.map(compileRule);
    this.giorr = data.rules.giorr.map(compileRule);
    this.rialacha = data.rules.rialacha.map(vn).map(compileRule);
    this.unigram = data.rules.unigram.map(compileRule);
    // cineál: cineáil, cineálacha. Not when another noun's genitive is spelt the same and has no
    // plural, or the same plural (fear: fir, fir).
    const maybePlural = new Set<string>();
    for (const row of data.nouns ?? []) {
      const [, gsg = '', npl = ''] = row.split('|');
      const gs = gsg.split(',').filter(Boolean).map((w) => w.toLowerCase());
      const pl = npl.split(',').filter(Boolean).map((w) => w.toLowerCase());
      for (const g of gs) (pl.length && !pl.includes(g) ? this.genitiveNotPlural : maybePlural).add(g);
    }
    for (const g of maybePlural) this.genitiveNotPlural.delete(g);
  }

  // ---------------------------------------------------------------- sentences

  /** Port of get_sentences_real. Input must already be Latin-1 safe. */
  getSentencesReal(text: string): string[] {
    let s = text;
    s = s.replace(new RegExp(`^${WS}+`), '');
    s = s.replace(/<[^>]*>/g, ' ');
    s = s.replace(/\\[tnvfr]/g, ' ');
    s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.split(NOBD).join('').split(BD).join('');
    s = applyRules(s, this.giorr);
    s = s.replace(new RegExp(`([^${NOBD}][.?!][\\]"')}]*)[ \\t\\n]+`, 'g'), `$1${BD}`);
    s = s.replace(/"/g, '&quot;');
    s = s.replace(new RegExp(`${WS}+`, 'g'), ' ');
    s = s.split(NOBD).join('');
    return perlSplit(s, BD);
  }

  // -------------------------------------------------------------------- tags

  private getGrammarTags(grambytes: string): string {
    let ans = '';
    for (const ch of grambytes) {
      const tag = this.pos.get(ch);
      if (tag !== undefined) ans += tag;
    }
    return ans;
  }

  private addGrammarTags(word: string, grambytes: string): string {
    let tagz = this.getGrammarTags(grambytes);
    if ([...grambytes].length === 1) {
      const m = /^<([A-Z])/.exec(tagz);
      return `${tagz}${word}</${m ? m[1] : ''}>`;
    }
    tagz = tagz.replace(/>/g, '/>');
    return `<B><Z>${tagz}</Z>${word}</B>`;
  }

  private cleanLookup(current: string): string {
    for (const h of this.focail) {
      const g = h.get(current);
      if (g !== undefined) return this.getGrammarTags(g);
    }
    return '';
  }

  /**
   * For a word whose only fault is a hyphen (fo-ráiteas): the word without its first hyphen, if
   * that is a standard word or one formed regularly from one. The morphology finds the root
   * (ráiteas) by taking the prefix off too, so the root alone is not the correction.
   */
  private withoutHyphen(original: string): string | null {
    if (!this.opts.hyphenFix || !original.includes('-')) return null;
    const joined = original.replace('-', '');
    const got = this.tagRecurse(joined, joined, -1, { v: '' }, 6);
    return got && (!got.includes('<E') || got.startsWith('<E msg="MOIRF{')) ? joined : null;
  }

  private lookup(original: string, current: string, level: number, posans: PosAns, nofix = false): string {
    posans.v = this.cleanLookup(current);
    if (posans.v) {
      if (level === 0) return `<E msg="MOIRF{${current}}"><X>${original}</X></E>`;
      if (level === 1) return `<E msg="${nofix ? 'NODICTPLURAL' : 'CAIGHDEAN'}{${this.withoutHyphen(original) ?? current}}"${nofix ? ' fix="n"' : ''}><X>${original}</X></E>`;
      if (level === 2) return `<E msg="DROCHMHOIRF{${current}}"><X>${original}</X></E>`;
      return '<X>';
    }
    posans.v = '<OK>';
    const e = this.eile.get(current);
    if (e !== undefined) {
      if (level === -1) return `<E msg="CAIGHDEAN{${e}}"><X>${original}</X></E>`;
      if (level === 0) return `<E msg="CAIGHMOIRF{${e}}"><X>${original}</X></E>`;
      if (level === 1) return `<E msg="${nofix ? 'NODICTPLURAL' : 'CAIGHDEAN'}{${current} (${e})}"${nofix ? ' fix="n"' : ''}><X>${original}</X></E>`;
      return `<E msg="DROCHMHOIRF{${current} (${e})}"><X>${original}</X></E>`;
    }
    const er = this.earraidi.get(current);
    if (er !== undefined) {
      if (level === -1) return `<E msg="MICHEART{${er}}"><X>${original}</X></E>`;
      return `<E msg="MIMHOIRF{${current} (${er})}"><X>${original}</X></E>`;
    }
    return '';
  }

  private morphRepl(rule: Morph, m: RegExpExecArray | string[]): string {
    let out = '';
    for (const p of rule.src.parts) {
      if ('s' in p) out += p.s;
      else {
        const g = m[p.g] ?? '';
        out += p.f === 'lc' ? mylc(g) : p.f === 'lcfirst' ? mylcfirst(g) : g;
      }
    }
    return out;
  }

  private applyMorph(rule: Morph, current: string): string {
    rule.reG.lastIndex = 0;
    return current.replace(rule.reG, (...args) => {
      const groups: string[] = [args[0] as string];
      for (let i = 1; i < args.length && typeof args[i] !== 'number'; i++) groups.push(args[i] as string);
      return this.morphRepl(rule, groups);
    });
  }

  private tagRecurse(original: string, current: string, level: number, posans: PosAns, maxdepth: number, nofix = false): string {
    let ans = this.lookup(original, current, level, posans, nofix);
    if (maxdepth === 0) return '';
    if (ans) return ans;
    for (const rule of this.morph) {
      if (!rule.re.test(current)) continue;
      const newcurrent = this.applyMorph(rule, current);
      if (rule.src.compound && !this.compoundRoot(newcurrent)) continue;
      const lenited = rule.src.lenite ? this.prefixLenited(rule, original, current) : '';
      if (rule.src.lenite && !lenited) continue;
      ans = this.tagRecurse(original, newcurrent, level > rule.src.level ? level : rule.src.level, posans, maxdepth - 1, nofix || !!rule.src.nofix);
      // an unlenited root after a prefix: reported only when the root itself is standard
      if (lenited) ans = ans === '<X>' || ans.startsWith('<E msg="MOIRF{') ? `<E msg="COMHSEIMHIU{${lenited}}"><X>${original}</X></E>` : '';
      if (ans) {
        if (posans.v !== '<OK>') {
          const temp = posans.v;
          posans.v = '';
          for (const m of temp.matchAll(/<[ACDF-Y][^>]*>/g)) {
            let cand = m[0];
            if (rule.pos === null || rule.pos.test(cand)) {
              if (rule.src.replpos !== '<&>' && rule.pos) cand = cand.replace(rule.pos, rule.src.replpos);
              posans.v += cand;
            }
          }
        }
        if (posans.v) return ans;
      }
    }
    return '';
  }

  private cleanTagRecurse(current: string, maxdepth: number): string {
    let ans = this.cleanLookup(current);
    if (maxdepth === 0) return ans;
    for (const rule of this.puremorph) {
      if (!rule.re.test(current)) continue;
      const newcurrent = this.applyMorph(rule, current);
      const toadd = this.cleanTagRecurse(newcurrent, maxdepth - 1);
      for (const m of toadd.matchAll(/<[^>]+>/g)) {
        let cand = m[0];
        if (rule.pos === null || rule.pos.test(cand)) {
          if (rule.src.replpos !== '<&>' && rule.pos) cand = cand.replace(rule.pos, rule.src.replpos);
          ans += cand;
        }
      }
    }
    return ans;
  }

  private tagOneWordClean(word: string): string {
    const ans = this.cleanTagRecurse(word, 4);
    return ans ? this.tagsFor(word, ans) : ans;
  }

  /** The word tagged with the tags in `ans` (a string of tags), as tag_one_word does. */
  private tagsFor(word: string, ans: string): string {
    const seen = new Set<string>();
    for (const m of ans.matchAll(/<[^>]+>/g)) {
      const cod = this.sop.get(m[0]);
      if (cod !== undefined) seen.add(cod);
    }
    let codez = [...seen].sort().join('');
    if ([...codez].length > 1) codez = codez.replace('\u007f', '');
    return this.addGrammarTags(word, codez);
  }

  /**
   * A word not in the word list that is a regular inflection (a level -2 rule) of one that is:
   * tagged as the stem, with the tags the rule allows, and no message. Tried before the full
   * morphology search, whose first match may otherwise be a pre-standard spelling.
   */
  private tagInflected(word: string): string {
    let ans = '';
    for (const rule of this.inflect) {
      if (!rule.re.test(word)) continue;
      for (const m of this.cleanTagRecurse(this.applyMorph(rule, word), 4).matchAll(/<[^>]+>/g)) {
        if (rule.pos === null || rule.pos.test(m[0])) ans += m[0];
      }
    }
    return ans ? this.tagsFor(word, ans) : '';
  }

  /**
   * The compound with its second part lenited, when that part could be lenited but is not and the
   * standard lenites it (see the compoundLenition option); '' otherwise.
   */
  private compoundUnlenited(l: string, r: string, sep: string, word: string): string {
    if (!this.opts.compoundLenition) return '';
    if (!/^([bcdfgmpt][^h']|s[aeiouáéíóúlnr])/i.test(r) || r === r.toUpperCase()) return '';
    const dental = /[dntls]$/i.test(l);
    if (dental && /^[dts]/i.test(r)) return '';
    // Only after a first part the word list shows in lenited compounds (príomh-, iar-, gnáth-), so
    // that a misspelling split at a chance point (athchur+sála, láim+seáil) is not read as one ...
    if (!this.lenitingFirstPart(l.toLowerCase(), dental)) return '';
    // ... and not when the whole word is one edit from a listed word (lagdaithe: laghdaithe).
    for (let t = 0; t < this.focail.length; t++) if (this.nearMisses(word, t, RE_CAPITAL.test(word)).length) return '';
    return `${l}${sep}${r[0]}h${r.slice(1)}`;
  }

  /**
   * For a rule with the lenite flag (a prefix before a root left unlenited: droch-príomhoide,
   * sean-Cárta), the word as written with the root lenited (droch-phríomhoide, sean-Chárta), or ''
   * when the rule does not apply: `current` must be the end of the word as written (earlier rules
   * only lowercased it or took off a mutation), and the word must not be one edit from a listed
   * word, as for compoundUnlenited.
   */
  private prefixLenited(rule: Morph, original: string, current: string): string {
    if (!this.opts.compoundLenition || this.inCompound) return '';
    const m = rule.re.exec(current);
    if (!m || m[1] === undefined) return '';
    // where current starts in the word: after a mutation before it (tsean-, n-), or with the h of a
    // lenited prefix taken out (dhroch-)
    let off = original.length - current.length;
    const lc = current.toLowerCase(), olc = original.toLowerCase();
    if (off === 1 && olc[1] === 'h' && olc[0] + olc.slice(2) === lc) off = 1;
    else if (off < 0 || olc.slice(off) !== lc) return '';
    const at = off + m.index + m[0].length - m[1].length + 1;
    for (let t = 0; t < this.focail.length; t++) if (this.nearMisses(original, t, RE_CAPITAL.test(original)).length) return '';
    return `${original.slice(0, at)}h${original.slice(at)}`;
  }

  /**
   * Whether `w` (a root after a prefix and hyphen, lenited) is itself a compound: a listed first
   * part the word list shows in lenited compounds, and a listed second part lenited after it
   * (cheol + fhoireann in comh-cheolfhoireann, CO17 2.1.7(c): a hyphen between two prefixes).
   */
  private compoundRoot(w: string): boolean {
    for (let i = 3; i < w.length - 2; i++) {
      const l = w.slice(0, i), r = w.slice(i);
      const dental = /[dntls]$/.test(l);
      if (!(/^([bcdfgmpt]h|sh[aeiouáéíóúlnr])/.test(r) || (dental && /^[dts][^h]/.test(r)))) continue;
      if (this.nocombo.has(l) || this.nocombo.has(r)) continue;
      if (!this.cleanLookup(l) || !this.cleanLookup(r)) continue;
      const base = /^([bcdfgmpt]|s)h/.test(l) ? l[0] + l.slice(2) : l;
      if (this.lenitingFirstPart(base, dental)) return true;
    }
    return false;
  }

  /**
   * Whether `l` is a first part the word list shows in lenited compounds: at least ten listed
   * words are `l` + a lenited consonant, more than twice as many as `l` + an unlenited one (d, t and
   * s left out after d, n, t, l or s).
   */
  private lenitingFirstPart(l: string, dental: boolean): boolean {
    this.firstPartCache ??= new Map();
    const hit = this.firstPartCache.get(l);
    if (hit !== undefined) return hit;
    let len = 0, un = 0;
    const seen = new Set<string>();
    for (const tier of this.focail) for (const w0 of tier.keys()) {
      const w = w0.toLowerCase();
      if (!w.startsWith(l) || w.length < l.length + 3 || seen.has(w)) continue;
      seen.add(w);
      const r = w.slice(l.length);
      if (dental && /^[dts]/.test(r)) continue;
      if (/^([bcdfgmpt]h|sh[aeiouáéíóúlnr])/.test(r)) len++;
      else if (/^([bcdfgmpt][^h]|s[aeiouáéíóúlnr])/.test(r)) un++;
    }
    const ok = len >= 10 && len > 2 * un;
    this.firstPartCache.set(l, ok);
    return ok;
  }

  private tagAsCompound(word: string): string {
    const dummy: PosAns = { v: '' };
    const dm = /^([^-]+)-(.*)$/.exec(word);
    if (dm) {
      const l = dm[1];
      const r = dm[2];
      const t1 = this.tagRecurse(l, l, -1, dummy, 2);
      const t2 = this.tagRecurse(r, r, -1, dummy, 2);
      if (t1 && t2) {
        const len = !t1.includes('<E') && !t2.includes('<E') ? this.compoundUnlenited(l, r, '-', word) : '';
        if (len) return `<E msg="COMHSEIMHIU{${len}}"><X>${word}</X></E>`;
        if (!t1.includes('<E') && !t2.includes('<E')) return `<E msg="COMHFHOCAL{${l}+${r}}"><X>${word}</X></E>`;
        return this.opts.nonStandardCompounds ? `<E msg="COMHCHAIGH{${l}+${r}}"><X>${word}</X></E>` : '';
      }
    } else {
      const len = word.length;
      for (let i = 3; i < len - 2; i++) {
        const l = word.slice(0, i);
        const r = word.slice(i);
        if (!this.nocombo.has(l) && !this.nocombo.has(r)) {
          const tl = this.tagRecurse(l, l, -1, dummy, 2);
          const tr = this.tagRecurse(r, r, -1, dummy, 2);
          if (tl && tr) {
            const len = !tl.includes('<E') && !tr.includes('<E') ? this.compoundUnlenited(l, r, '', word) : '';
            if (len) return `<E msg="COMHSEIMHIU{${len}}"><X>${word}</X></E>`;
            if (!tl.includes('<E') && !tr.includes('<E')) return `<E msg="COMHFHOCAL{${l}+${r}}"><X>${word}</X></E>`;
            return this.opts.nonStandardCompounds ? `<E msg="COMHCHAIGH{${l}+${r}}"><X>${word}</X></E>` : '';
          }
        }
      }
    }
    return '';
  }

  /**
   * Port of tag_as_near_miss (fix_spelling). The Perl scans every lexicon key with String::Approx; here the
   * words one edit away are generated and looked up instead, which gives the same set far faster.
   *
   * For each lexicon tier in frequency order, the suggestions are the tier's words that are the unknown word
   * with two adjacent letters swapped, one letter deleted, one letter inserted or one letter substituted.
   * The first tier with any suggestion wins. If the word contains a capital letter the insert/delete/substitute
   * matching ignores case (the "i" modifier in the Perl, ASCII letters only); transpositions are always exact.
   */
  private tagAsNearMiss(word: string): string {
    if (!this.opts.fixSpelling) return '';
    const len = word.length;
    if (len <= 2) return '';
    // CO17 1.1.4: a hyphen between the prefix t and a lowercase vowel (an tospidéal -> an t-ospidéal).
    // Only when the form with the hyphen is a noun of the word list; not a morphology rule, which
    // would go on to the non-standard forms of other words (Tamhlachta).
    const tv = /^t([aeiouáéíóú].*)$/.exec(word);
    if (tv && this.opts.hyphenFix && /^<N/.test(this.tagOneWordClean(`t-${tv[1]}`))) return `<E msg="CAIGHDEAN{t-${tv[1]}}"><X>${word}</X></E>`;
    const caseless = RE_CAPITAL.test(word);
    if (this.opts.capsNoNearMiss && word === word.toUpperCase() && word !== word.toLowerCase()) return '';
    for (let t = 0; t < this.focail.length; t++) {
      const found = this.nearMisses(word, t, caseless);
      if (found.length) return `<E msg="MOLADH{${found.join(', ')}}"><X>${word}</X></E>`;
    }
    return '';
  }

  /** Words of lexicon tier `t` within one edit of `word` (see tagAsNearMiss), best guesses first. */
  nearMisses(word: string, t: number, caseless: boolean): string[] {
    const tier = this.focail[t];
    const len = word.length;
    const rank = new Map<string, number>(); // suggestion -> edit-kind rank (lower is likelier)
    const note = (cand: string, r: number) => { if (!rank.has(cand) || rank.get(cand)! > r) rank.set(cand, r); };

    // transpositions: exact case, as in the Perl (it uses exists() on the swapped word)
    for (let i = 0; i < len - 1; i++) {
      const perm = word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2);
      if (perm !== word && tier.has(perm)) note(perm, 0);
    }

    const base = caseless ? foldAscii(word) : word;
    const alphabet = caseless ? this.foldedAlphabet() : this.alphabet();
    const lookup = (e: string, r: number) => {
      if (tier.has(e)) note(e, r);
      if (caseless) {
        const hits = this.foldIndexFor(t).get(e);
        if (hits) for (const h of hits) note(h, r);
      }
    };

    // substitutions (and, when ignoring case, the word itself differing only in case)
    if (caseless) lookup(base, 1);
    for (let i = 0; i < len; i++) {
      const pre = base.slice(0, i), post = base.slice(i + 1);
      for (const c of alphabet) if (c !== base[i]) lookup(pre + c + post, 1);
    }
    // deletions
    for (let i = 0; i < len; i++) lookup(base.slice(0, i) + base.slice(i + 1), 2);
    // insertions
    for (let i = 0; i <= len; i++) {
      const pre = base.slice(0, i), post = base.slice(i);
      for (const c of alphabet) lookup(pre + c + post, 3);
    }
    return [...rank.entries()]
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([w]) => w);
  }

  private alphabet(): string[] {
    if (!this.alphabetCache) {
      const set = new Set<string>();
      for (const tier of this.focail) for (const w of tier.keys()) for (const ch of w) set.add(ch);
      this.alphabetCache = [...set].sort();
    }
    return this.alphabetCache;
  }

  private foldedAlphabet(): string[] {
    if (!this.foldedAlphabetCache) this.foldedAlphabetCache = [...new Set(this.alphabet().map((c) => foldAscii(c)))].sort();
    return this.foldedAlphabetCache;
  }

  /** Per tier: case-folded form -> the lexicon words with ASCII capitals that fold to it (small: ~30k of 500k). */
  private foldIndexFor(t: number): Map<string, string[]> {
    if (!this.foldIndex) {
      this.foldIndex = this.focail.map((tier) => {
        const m = new Map<string, string[]>();
        for (const w of tier.keys()) {
          const f = foldAscii(w);
          if (f === w) continue; // nothing to fold: found directly in the tier
          const list = m.get(f);
          if (list) list.push(w); else m.set(f, [w]);
        }
        return m;
      });
    }
    return this.foldIndex[t];
  }

  /**
   * Words of the word list that differ from `word` in fadas and case and at most one more edit (a
   * letter swapped with the next, deleted, inserted or substituted), from the most frequent tier
   * that has any; those differing only in fadas and case first. See the fadaSuggestions option.
   */
  fadaNearMisses(word: string): string[] {
    if (Array.from(word).length < 4 || !/[a-záéíóú]/.test(word)) return [];
    const fold = (s: string) => s.toLowerCase().replace(/[áéíóú]/g, (c) => 'aeiou'['áéíóú'.indexOf(c)]);
    if (!this.fadaIndex) {
      this.fadaIndex = this.focail.map((tier) => {
        const m = new Map<string, string[]>();
        for (const w of tier.keys()) {
          const f = fold(w);
          const list = m.get(f);
          if (list) list.push(w); else m.set(f, [w]);
        }
        return m;
      });
    }
    const b = fold(word);
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    for (const index of this.fadaIndex) {
      const rank = new Map<string, number>();
      const look = (e: string, r: number) => {
        for (const w of index.get(e) ?? []) if (w !== word && (!rank.has(w) || rank.get(w)! > r)) rank.set(w, r);
      };
      look(b, 0);
      for (let i = 0; i < b.length - 1; i++) look(b.slice(0, i) + b[i + 1] + b[i] + b.slice(i + 2), 1);
      for (let i = 0; i < b.length; i++) for (const c of letters) if (c !== b[i]) look(b.slice(0, i) + c + b.slice(i + 1), 1);
      for (let i = 0; i < b.length; i++) look(b.slice(0, i) + b.slice(i + 1), 2);
      for (let i = 0; i <= b.length; i++) for (const c of letters) look(b.slice(0, i) + c + b.slice(i), 3);
      if (rank.size) {
        return [...rank.entries()]
          .sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))
          .map(([w]) => w);
      }
    }
    return [];
  }

  /**
   * Prefix + root suggestions for an unknown word (see the prefixSuggestions option): for each way of
   * splitting off a first part of two or more letters, the one-edit near misses of the rest (from
   * the most frequent tier that has any), kept only where the morphology reads first part + near
   * miss as a prefixed word (MOIRF), so the first part must be a prefix it knows.
   */
  prefixNearMisses(word: string): string[] {
    const len = word.length;
    if (len < 6) return [];
    const caseless = RE_CAPITAL.test(word);
    const dummy: PosAns = { v: '' };
    const found: string[] = [];
    for (let i = 2; i <= len - 3; i++) {
      const left = word.slice(0, i);
      const right = word.slice(i);
      for (let t = 0; t < this.focail.length; t++) {
        const roots = this.nearMisses(right, t, caseless);
        if (!roots.length) continue;
        for (const r of roots) {
          const cand = left + r;
          if (cand !== word && !found.includes(cand) && this.tagRecurse(cand, cand, -1, dummy, 2).startsWith('<E msg="MOIRF{')) found.push(cand);
        }
        break;
      }
    }
    return found;
  }

  /**
   * For a rare word (see the rareNeedsMatch option): the words one edit away in a more frequent
   * tier of the word list than the word's own, leaving out those that are rare themselves; from
   * the most frequent tier that has any.
   */
  commonerNearMisses(word: string): string[] {
    if (word.length <= 2) return [];
    let own = this.focail.findIndex((t) => t.has(word));
    if (own < 0) own = this.focail.findIndex((t) => t.has(word.toLowerCase()));
    if (own < 0) own = this.focail.length;
    const caseless = RE_CAPITAL.test(word);
    // the likeliest slips first: a missing fada (rata -> ráta), a missing lenition h (beith ->
    // bheith), a single letter for a double (chineann -> chinneann); the rest in nearMisses order
    const fold = (s: string) => s.toLowerCase().replace(/[áéíóú]/g, (c) => 'aeiou'['áéíóú'.indexOf(c)]);
    const likely = (w: string) =>
      fold(w) === fold(word) || w.toLowerCase() === `${word[0]}h${word.slice(1)}`.toLowerCase() ||
      [...w].some((_, i) => w[i] === w[i + 1] && w.slice(0, i) + w.slice(i + 1) === word);
    for (let t = 0; t < own; t++) {
      const found = this.nearMisses(word, t, caseless).filter((w) => w.toLowerCase() !== word.toLowerCase() && !/^<F>/.test(this.tagOneWordClean(w)));
      if (found.length) return [...found.filter(likely), ...found.filter((w) => !likely(w))];
    }
    return [];
  }

  private findBadThreeGrams(word: string): string {
    // an abbreviation in capitals (COLÓ: GRAM{^CO}) matches the lowercase letter sequences only by chance
    if (this.opts.capsNoNearMiss && word === word.toUpperCase() && word !== word.toLowerCase()) return '';
    const w = `<${word}>`;
    const end = w.length - 2;
    for (let i = 0; i < end; i++) {
      let cand = w.slice(i, i + 3);
      if (!this.grams.has(cand)) {
        cand = cand.replace(/</g, '^').replace(/>/g, '$');
        return `<E msg="GRAM{${cand}}"><X>${word}</X></E>`;
      }
    }
    return '';
  }

  /** Port of tag_one_word. */
  tagOneWord(word: string): string {
    const hit = this.memo.get(word);
    if (hit !== undefined) return hit;
    const ans = this.tagOneWordUncached(word);
    if (this.memo.size > 5000) this.memo.clear();
    this.memo.set(word, ans);
    return ans;
  }

  private tagOneWordUncached(word: string): string {
    let ans = this.tagOneWordClean(word);
    if (ans) return ans;
    if (this.opts.skipDigitWords && /[0-9]/.test(word)) return `<Y>${word}</Y>`;
    ans = this.tagInflected(word);
    if (ans) return ans;
    const dummy: PosAns = { v: '' };
    ans = this.tagRecurse(word, word, -1, dummy, 6);
    if (ans) return ans;
    this.inCompound = true;
    try {
      ans = this.tagAsCompound(word);
    } finally {
      this.inCompound = false;
    }
    if (ans) return ans;
    ans = this.tagAsNearMiss(word);
    if (ans) return ans;
    ans = this.findBadThreeGrams(word);
    if (ans) return ans;
    return `<X>${word}</X>`;
  }

  // --------------------------------------------------------------- tokenizing

  private maybeTokenize(tag: string, word: string, t: string): string {
    if (t === 'd') return this.tagOneWordClean(word) ? `<c>${word}</c>` : word;
    return `${tag}${word}</${t}>`;
  }

  tokenizeReal(sentence: string): string {
    let answer = '';
    const allLetters = new RegExp(`^[${BDCHARS}]+$`);
    for (let chunk of perlSplit(sentence, ' ')) {
      if (allLetters.test(chunk)) {
        chunk = `<c>${chunk}</c>`;
      } else {
        let chunkdone = true;
        for (const rule of this.token) {
          let chtemp = '';
          let todo: string;
          const scan = /([^<]*)(<[A-Zc][^>]*>[^<]+<\/[A-Zc]>)/g;
          let m: RegExpExecArray | null;
          while ((m = scan.exec(chunk))) {
            todo = m[1];
            const done = m[2];
            if (todo) {
              chunkdone = false;
              todo = this.tokenizeSub(todo, rule);
            }
            chtemp += todo + done;
          }
          // Perl: $chunk =~ /([^>]*)$/  -- trailing text after the last '>'
          const tail = /([^>]*)$/.exec(chunk)![1];
          todo = tail;
          if (todo) {
            chunkdone = false;
            todo = this.tokenizeSub(todo, rule);
          }
          if (chunkdone) break;
          chtemp += todo;
          chunk = chtemp;
        }
        chunk = chunk.replace(/&(quot|[gl]t|amp)(<\/.>);/g, '&$1;$2');
        chunk = chunk.replace(/&<c>(quot|[gl]t|amp)<\/c>;/g, '&$1;');
        chunk = chunk.replace(/(<\/.>)</g, '$1 <');
      }
      if (answer) answer += ' ';
      answer += chunk;
    }
    return answer;
  }

  private tokenizeSub(todo: string, rule: { re: RegExp; tag: string; tail: string }): string {
    rule.re.lastIndex = 0;
    return todo.replace(rule.re, (_m, g1: string) => this.maybeTokenize(rule.tag, g1, rule.tail));
  }

  // -------------------------------------------------------------- tag + rules

  uncheckedXml(sentence: string): string {
    let s = this.tokenizeReal(sentence);
    s = s.replace(/(<[A-Zc][^>]*>[^<]+<\/[A-Zc]>) \1/g, '<E msg="DUBAILTE">$1 $1</E>');
    s = s.replace(/<c>([^<]*)<\/c>/g, (_m, w: string) => this.tagOneWord(w));
    s = s.replace(/<E msg="DUBAILTE">(<E[^>]+><X>[^<]+<\/X><\/E>) \1<\/E>/g, '$1 $1');
    return `<line> ${s} </line>`;
  }

  addTagsReal(sentence: string): string {
    let s = this.uncheckedXml(sentence);
    s = applyRules(s, this.comhshuite);
    s = applyRules(s, this.aonchiall);
    s = applyRules(s, this.aonchiall); // aonchiall_deux
    if (this.opts.unigramTagging) s = applyRules(s, this.unigram);
    return s;
  }

  /** Port of xml_stream: tagged XML with rule errors, for debugging/parity. */
  xmlStream(text: string): string[] {
    return this.getSentencesReal(toLatin1(text)).map((plain) => applyRules(this.addTagsReal(plain), this.rialacha));
  }

  // ----------------------------------------------------------- error reporting

  private localizeMe(msg: string): string {
    const macro = /^([^{]+)/.exec(msg)?.[1] ?? '';
    const msgid = this.messages[macro];
    if (msgid === undefined) return '-';
    const am = /\{(.*)\}$/.exec(msg);
    const arg = am ? am[1].replace(/_/g, ' ') : undefined;
    // English interface only: msgid is the message. Placeholders look like \/\1\/
    return msgid.replace(/\\\/\\1\\\//g, `/${arg ?? ''}/`).replace(/\\\/([^_\\]+)\\\//g, '/$1/');
  }

  /**
   * With namedParts: the parts a derived or compound word is reported as, as the dictionary lists
   * them, so that the message and its explanation can name them. The root loses the lenition
   * the first part gives it, and a prefix the word's own initial mutation and hyphen:
   *   MOIRF{ghnéis} for comhghnéis -> MOIRFREIMIR{comh+gnéis}; MOIRF{shlánú} -> MOIRF{slánú}
   *   COMHFHOCAL{ríomh+phrionta} -> COMHFHOCAL{ríomh+prionta}
   *   MIMHOIRF{buntaiste (buntáiste)} for míbhuntaiste -> MIMHOIRF{mí+buntaiste (buntáiste)}
   *   CAIGHMOIRF, DROCHMHOIRF: each alternative unlenited
   * An ending (cuimsiúcháin, root cuimsiú) or an elision (b'fhéadfadh) is not a prefix.
   */
  private tidyParts(msg: string, word: string): string {
    const m = /^([A-Z]+)\{(.+)\}$/.exec(msg);
    if (!m) return msg;
    const [, id, arg] = m;
    if (id === 'MOIRF') {
      const front = this.prefixOf(word, arg);
      return front ? `MOIRFREIMIR{${front}+${this.unlenitedListed(arg)}}` : `MOIRF{${this.unlenitedListed(arg)}}`;
    }
    if (id === 'COMHFHOCAL') {
      const plus = arg.indexOf('+');
      return plus > 0 ? `COMHFHOCAL{${arg.slice(0, plus)}+${this.unlenitedListed(arg.slice(plus + 1))}}` : msg;
    }
    if (id === 'MIMHOIRF') {
      const p = /^(.+?) \((.+)\)$/.exec(arg);
      if (!p) return msg;
      const lenited = /^[bcdfgmpt]/i.test(p[1]) || /^s[aeiouáéíóúlnr]/i.test(p[1]) ? `${p[1][0]}h${p[1].slice(1)}` : p[1];
      const front = this.prefixOf(word, p[1]) ?? this.prefixOf(word, lenited);
      return `MIMHOIRF{${front ? front + '+' : ''}${p[1]} (${p[2]})}`;
    }
    if (id === 'CAIGHMOIRF' || id === 'DROCHMHOIRF') return `${id}{${arg.split(', ').map((a) => this.unlenitedListed(a)).join(', ')}}`;
    return msg;
  }

  /**
   * The prefix of `word` before `root`: the part in front, without the word's own initial
   * mutation (chomh-, gcomh-, hath-, t-ath-) or a hyphen; null when there is none, or it is an
   * elision (b'fhéadfadh) or a single letter. Compared without case or fadas (conai, root conaí).
   */
  private prefixOf(word: string, root: string): string | null {
    const fold = (s: string) => s.toLowerCase().replace(/[áéíóú]/g, (c) => 'aeiou'['áéíóú'.indexOf(c)]);
    if (word.length <= root.length || !fold(word).endsWith(fold(root))) return null;
    let front = word.slice(0, word.length - root.length).toLowerCase().replace(/-$/, '');
    if (/'/.test(front)) return null;
    front = front
      .replace(/^[tn]-(?=[aeiouáéíóú])/, '')
      .replace(/^h(?=[aeiouáéíóú])/, '')
      .replace(/^t(?=s)/, '')
      .replace(/^(?:m(?=b)|g(?=c)|n(?=[dg])|d(?=t)|b(?=p)|bh(?=f))/, '')
      .replace(/^([bcdfgmpst])h/, '$1');
    return front.length >= 2 ? front : null;
  }

  /**
   * MIMHOIRF{buntaiste (buntáiste)} for míbhuntaiste: the word with the incorrect root replaced by
   * the correct one (míbhuntáiste), the root lenited as it is in the word. None if the root is not
   * found in the word.
   */
  private correctedDerived(msg: string, word: string): string[] {
    const m = /^MIMHOIRF\{(.+?) \((.+)\)\}$/.exec(msg);
    if (!m) return [];
    const lenite = (s: string) => (/^[bcdfgmpt]/i.test(s) || /^s[aeiouáéíóúlnr]/i.test(s) ? `${s[0]}h${s.slice(1)}` : s);
    // compared without case or fadas: the word may reach the root through a fada rule (conai, root conaí)
    const fold = (s: string) => s.toLowerCase().replace(/[áéíóú]/g, (c) => 'aeiou'['áéíóú'.indexOf(c)]);
    for (const [w, r] of [[m[1], m[2]], [lenite(m[1]), lenite(m[2])]]) {
      if (word.length >= w.length && fold(word).endsWith(fold(w))) return [word.slice(0, word.length - w.length) + r];
    }
    return [];
  }

  /** The word without its lenition (phrionta -> prionta) when the word list has that form. */
  private unlenitedListed(w: string): string {
    const m = /^([bcdfgmpstBCDFGMPST])h(.+)$/.exec(w);
    if (!m) return w;
    const cand = m[1] + m[2];
    return this.focail.some((t) => t.has(cand) || t.has(cand.toLowerCase())) ? cand : w;
  }

  /** Every reading of the word (all paths of the clean pass) is a singular nominative noun. */
  private nominativeNounOnly(w: string): boolean {
    const tagged = this.tagOneWordClean(w);
    const tags = /^<B><Z>(.*)<\/Z>/.exec(tagged)?.[1] ?? /^<[^>]+>/.exec(tagged)?.[0] ?? '';
    const all = [...tags.matchAll(/<[^>]+>/g)].map((m) => m[0]);
    return all.length > 0 && all.every((t) => t.startsWith('<N pl="n" gnt="n"'));
  }

  grammaticalErrors(textIn: string): GrammarError[] {
    const text = toLatin1(textIn);
    const pristine = tidyInput(text);
    const errors: GrammarError[] = [];
    let endoflast = 0;
    let toy = 0;
    let tox = -1;
    let pristinePos = 0;

    for (const plain of this.getSentencesReal(text)) {
      let s = this.addTagsReal(plain);
      s = applyRules(s, this.rialacha);
      if (this.opts.datives) s = markDatives(s);
      if (!s.includes('<E')) continue;
      const buffered = stripEntities(` ${plain} `);
      let bufferedPos = 0;
      let lastCapture = '';
      const errRe = /(.*?)(<E[^>]+>)(.*?)<\/E>/g;
      let em: RegExpExecArray | null;
      while ((em = errRe.exec(s))) {
        let prefix = em[1];
        let thiserror = em[2];
        let errorregex = em[3];
        const nested = /^(.*)(<E[^>]+>)(.*)$/.exec(errorregex);
        if (nested) {
          prefix += nested[1];
          thiserror = nested[2];
          errorregex = nested[3];
        }
        // The marked words' last token, when the tagger took several words as one (i Baile Átha
        // Cliath: the eclipsis goes on Baile, the unit's first word).
        const unit = /([^<>]+)<\/[A-Z]>\s*$/.exec(errorregex)?.[1];
        prefix = regexify(prefix);
        errorregex = regexify(errorregex);
        errorregex = errorregex.replace(/\[\^[^\]]+\]\*$/, '');
        let matchregex = `${prefix}(${errorregex})`;
        if (!prefix) matchregex = `(?<=[^${BDCHARS}])${matchregex}`;

        const pre = new RegExp(matchregex, 'gsd');
        pre.lastIndex = pristinePos;
        const pm = pre.exec(pristine);
        if (!pm) {
          pristinePos = 0;
          // Perl prints "regex error in computing global coordinates" and skips.
          continue;
        }
        pristinePos = pre.lastIndex;
        const [globs, globe] = pm.indices![1]!;
        lastCapture = pm[1];

        let str = pristine.slice(endoflast, globs);
        const fromy = toy + countNl(str);
        let fromx: number;
        if (fromy === toy) fromx = tox + 1 + (globs - endoflast);
        else fromx = (/([^\n]+)$/.exec(str)?.[1] ?? '').length;

        str = pristine.slice(globs, globe);
        toy = fromy + countNl(str);
        if (fromy === toy) tox = fromx + (globe - globs) - 1;
        else tox = (/([^\n]+)$/.exec(str)?.[1] ?? '').length - 1;
        endoflast = globe;
        fromx--;
        const toans = tox - 1;

        const bre = new RegExp(matchregex, 'gd');
        bre.lastIndex = bufferedPos;
        const bm = bre.exec(buffered);
        let offset: number;
        let errortext: string;
        if (bm) {
          bufferedPos = bre.lastIndex;
          offset = bm.indices![1]![0] - 1;
          errortext = bm[1];
          lastCapture = errortext;
        } else {
          bufferedPos = 0;
          offset = -1;
          errortext = lastCapture;
        }

        const msgm = /^<E msg="(.+?)"(?: r="([^"]+)")?( fix="n")?>$/.exec(thiserror);
        if (!msgm) continue;
        const sugg = /^MOLADH\{(.*)\}$/.exec(msgm[1]);
        const unknown = !sugg && this.opts.fixSpelling && /^(GRAM|ANAITHNID)\b/.test(msgm[1]);
        let fada = unknown && this.opts.fadaSuggestions ? this.fadaNearMisses(errortext) : [];
        if (unknown && !fada.length && this.opts.prefixSuggestions) fada = this.prefixNearMisses(errortext);
        if (this.opts.namedParts && /^MIMHOIRF\{/.test(msgm[1])) fada = this.correctedDerived(msgm[1], errortext);
        // DROCHMHOIRF names the corrected word itself when no prefix was stripped (chomlíonann:
        // chomhlíonann); offer it then, in the word's case. A root after a prefix is no fix.
        const droch = this.opts.namedParts ? /^DROCHMHOIRF\{([^,{}]+)\}$/.exec(msgm[1]) : null;
        if (droch && Math.abs(droch[1].length - errortext.length) <= 2 && droch[1].slice(0, 2).toLowerCase() === errortext.slice(0, 2).toLowerCase()) {
          fada = [/^[A-ZÁÉÍÓÚ]/.test(errortext) ? droch[1][0].toUpperCase() + droch[1].slice(1) : droch[1]];
        }
        if (this.opts.rareNeedsMatch && /^NEAMHCHOIT\b/.test(msgm[1])) {
          // a capital after the first word is a name (Applus Car Testing Service), not a slip
          const midSentence = /\S/.test(plain.slice(0, Math.max(0, offset)));
          fada = midSentence && /^[A-ZÁÉÍÓÚ]/.test(errortext) ? [] : this.commonerNearMisses(errortext);
          if (!fada.length) continue;
        }
        if (this.opts.namedParts) msgm[1] = this.tidyParts(msgm[1], errortext);
        if (!this.opts.derivedWords && /^(MOIRF|MOIRFREIMIR)\{/.test(msgm[1])) continue;
        // WEAKGENITIVE (grammar/rialacha-ga.in): only where every reading of the second word in the
        // word list is a singular nominative noun; a form that is also a genitive (ceo, dlí,
        // gluaisteán) may be correct, and one with another part of speech (linn) may not be a noun.
        // After the article (eochair an chairr) only a genitive singular reading counts (the singular
        // article rules out the plural and other parts of speech), and only as written: a masculine
        // genitive after an is lenited or takes t (genitiveAfterAn), so úinéir an siopa is still
        // reported (an tsiopa), and a feminine one has na (teanga an Ghaeilge: na Gaeilge).
        // Without the article, not when the first word is also an imperative, which the second is
        // then the object of (comhlánaigh foirm; abair bliain): the second person singular, the
        // root; the third person in -adh/-odh is spelt like many nouns (ag riaradh scéim).
        if (/^WEAKGENITIVE\b/.test(msgm[1])) {
          const words = errortext.split(' ');
          const last = words.pop() ?? '';
          const first = words.pop() ?? '';
          const afterArticle = /^an$/i.test(first);
          if (afterArticle ? /pl="n" gnt="y" gnd="m"/.test(this.tagOneWordClean(last)) && genitiveAfterAn(last) : !this.nominativeNounOnly(last)) continue;
          // After the article, the word before it is the first noun (kept out of the mark). After a
          // particle of the past tense, ar included, a word that is also a past verb is the verb, and
          // the noun its subject (Sin í an bhean ar ghoid an gadaí a carr).
          if (afterArticle) {
            const before = plain.slice(0, Math.max(0, offset)).trim().split(/\s+/);
            const head = before.pop() ?? '';
            const particle = (before.pop() ?? '').toLowerCase();
            if (/^(ar|níor|nár|gur|cár|dár|murar|sular)$/.test(particle) && /<V p="y" t="caite"/.test(this.tagOneWordClean(head))) continue;
          }
          if (!afterArticle && /<V p="y" t="ord"/.test(this.tagOneWordClean(first)) && !/[ao]dh$/i.test(first)) continue;
          // the message names the noun (/athrú/ possibly should be in the genitive)
          if (!msgm[1].includes('{')) msgm[1] += `{${last}}`;
        }
        // WEAKPREFIXT (grammar/rialacha-ga.in): a noun that is also a genitive singular of the same
        // form (an Eolaire) is correct as the genitive, which takes no t-. (A genitive plural of the
        // same form, as in ospidéal, does not count: after the singular article it is singular.)
        if (/^WEAKPREFIXT\b/.test(msgm[1]) && /pl="n" gnt="y"/.test(this.tagOneWordClean(errortext.split(' ').pop() ?? ''))) continue;
        // NOGENITIVE (grammar/rialacha-ga.in) is a hint, WEAKNOGENITIVE, when the noun is a masculine
        // genitive singular ending in a slender consonant: a first-declension noun's nominative plural
        // is spelt the same (CO17 2.1.3(b)(i), Tábla 2B: na fir, hata an fhir), and the dictionaries
        // (FGB, focloir.ie, 2026-11-25) give no plural for many nouns
        // that real text uses in the plural (le déanmhais, do pháistí le míchumais, na speansais).
        // Not after the singular article (an, or a preposition joined with it: don, sa, ón...), where
        // a plural cannot follow (chuig an úinéara, don chomhshaoil), nor when BuNaMo gives the noun
        // a plural spelt differently (faoi chineáil: cineálacha).
        if (this.opts.pluralHint && /^NOGENITIVE\b/.test(msgm[1])) {
          const words = errortext.split(' ');
          const last = words.pop() ?? '';
          const before = (words.pop() ?? '').toLowerCase();
          if (/[eéií][^aeiouáéíóú]+$/i.test(last) && /<N pl="n" gnt="y" gnd="m"/.test(this.tagOneWordClean(last))
            && !/^(an|den|don|sa|san|insan|faoin|ón)$/.test(before)
            && !unmutatedForms(last).some((w) => this.genitiveNotPlural.has(w))) msgm[1] = msgm[1].replace(/^NOGENITIVE/, 'WEAKNOGENITIVE');
        }
        errors.push({
          fromy,
          fromx,
          toy,
          tox: toans,
          ruleId: `Lingua::GA::Gramadoir/${msgm[1]}`,
          msg: this.localizeMe(msgm[1]),
          context: plain,
          contextoffset: offset,
          errorlength: errortext.length,
          errortext,
          ...(sugg ? { suggestions: sugg[1].split(', ') } : fada.length ? { suggestions: fada } : {}),
          ...(msgm[2] ? { reason: msgm[2] } : {}),
          ...(unit && / /.test(unit.trim()) ? { unit: stripEntities(unit.trim()) } : {}),
          ...(msgm[3] ? { noFix: true as const } : {}),
        });
      }
    }
    return this.opts.datives ? keepMinority(errors, (id) => this.localizeMe(id)) : errors;
  }
}

// ---------------------------------------------------------------- helpers

/**
 * A word in lower case and the forms it may have without an initial mutation: lenition (chineáil),
 * eclipsis (bhfeidhmiúcháin, n-aighnis), h or t before a vowel (hamhrais, t-ioncaim). For looking a
 * word up in a list of unmutated forms, so a wrong guess finds nothing.
 */
function unmutatedForms(word: string): string[] {
  const w = word.toLowerCase();
  const out = [w];
  if (/^[bcdfgmpst]h/.test(w)) out.push(w[0] + w.slice(2));
  const ecl = /^(?:bhf|mb|gc|nd|ng|bp|dt|n-)(.*)$/.exec(w);
  if (ecl) out.push(w.startsWith('bhf') ? 'f' + ecl[1] : w.startsWith('n-') ? ecl[1] : w.slice(1));
  if (/^(?:h|t-)[aeiouáéíóú]/.test(w)) out.push(w.replace(/^(?:h|t-)/, ''));
  return out;
}

/**
 * Whether `word`, after the article an, has the first letter of a masculine genitive singular (CO17
 * 10.9.1, Tábla 1F): b c f g m p lenited (an fhile), t before s + a vowel, sl, sn, sr (an tsiopa),
 * any other letter unchanged (an Eolaire, an rí).
 */
export function genitiveAfterAn(word: string): boolean {
  const w = word.toLowerCase();
  const base = w.replace(/^t(?=s)/, '').replace(/^([bcdfgmpst])h/, '$1');
  const expected = /^[bcfgmp]/.test(base) ? `${base[0]}h${base.slice(1)}` : /^s([aeiouáéíóú]|[lnr])/.test(base) ? `t${base}` : base;
  return w === expected;
}

/**
 * The rule with the VERBALNOUN placeholder (a word in grammar/*.in) replaced by the verbal nouns,
 * unmutated and lenited (a dhéanamh, a shíniú). The word list cannot say which nouns are verbal
 * nouns, so the list comes from BuNaMo (data/verbal-nouns.json) and is joined in here, at load.
 */
function withVerbalNouns(words: string[]): (rule: RuleJson) => RuleJson {
  const forms = new Set<string>();
  const unlenited = new Set<string>();
  for (const w of words) {
    forms.add(w);
    if (/^([bcdfgmpt][^h]|s[aeiouáéíóúlnr])/.test(w)) {
      forms.add(`${w[0]}h${w.slice(1)}`);
      unlenited.add(w);
    }
  }
  const alternation = (set: Set<string>): string => {
    const esc = [...set].map((w) => toLatin1(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
    return esc.length ? `(?:${esc.join('|')})` : '(?!)';
  };
  const alt = alternation(forms);
  // VNPLAIN: the verbal nouns that take lenition, unlenited (cur, díol, ceannach), for a + VN.
  const altUnlenited = alternation(unlenited);
  const fix = (r: RuleJson): RuleJson => ({
    ...r,
    re: r.re.split('VNPLAIN').join(altUnlenited).split('VERBALNOUN').join(alt),
    ...(r.then ? { then: r.then.map(fix) } : {}),
  });
  return fix;
}

/** Perl's split /sep/, str: trailing empty fields removed, leading kept. */
function perlSplit(s: string, sep: string): string[] {
  if (s === '') return [];
  const parts = s.split(sep);
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

const countNl = (s: string): number => (s.match(/\n/g) ?? []).length;

function whiteout(t: string): string {
  return t.replace(/[^\n]/g, ' ');
}

function stripEntities(t: string): string {
  return t
    .replace(/&quot;/g, '""""""')
    .replace(/&lt;/g, '<<<<')
    .replace(/&gt;/g, '>>>>')
    .replace(/&amp;/g, '&&&&&');
}

function deentify(t: string): string {
  return t.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function escapeMeta(t: string): string {
  return t.replace(/\[/g, '\\[').replace(/\]/g, '\\]').replace(/([.?+$*^()])/g, '\\$1');
}

function regexify(textIn: string): string {
  let t = textIn;
  t = t.replace(/ *<\/?line> */, '');
  t = t.replace(/<\/E>/, '');
  if (/^[^<]+/.test(t)) t = t.replace(/^[^<]+/, `[^${BDCHARS}]*?`);
  t = deentify(t);
  t = t.replace(/<[A-Z][^>]*>([^<]+)<\/[A-Z]>[^<]*/g, (_m, g1: string) => `${escapeMeta(g1)}[^${BDCHARS}]*?`);
  t = t.replace(/ /g, '\\s+');
  t = t.replace(/(["&<>])/g, '$1+');
  return t;
}

function tidyInput(textIn: string): string {
  let t = textIn;
  t = t.replace(/(<[^>]*>)/g, (_m, g1: string) => whiteout(g1));
  t = t.replace(/\\[tnvfr]/g, '  ');
  t = t.split(NOBD).join(' ').split(BD).join(' ');
  t = ` ${t}`;
  t = t.replace(/\n/g, ' \n ');
  t = `${t} `;
  return t;
}
