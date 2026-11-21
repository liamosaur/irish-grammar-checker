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
   * (foráiteas) as the correction, not the root (ráiteas). On by default; the Perl library gives
   * the root, so the parity tests turn it off.
   */
  hyphenFix?: boolean;
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
  private opts: Required<GramadoirOptions>;
  private memo = new Map<string, string>();
  // spelling suggestions (built lazily)
  private alphabetCache: string[] | null = null;
  private foldedAlphabetCache: string[] | null = null;
  private foldIndex: Map<string, string[]>[] | null = null;

  constructor(data: GramadoirData, opts: GramadoirOptions = {}) {
    this.opts = { unigramTagging: true, fixSpelling: false, datives: false, hyphenFix: true, ...opts };
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

  private lookup(original: string, current: string, level: number, posans: PosAns): string {
    posans.v = this.cleanLookup(current);
    if (posans.v) {
      if (level === 0) return `<E msg="MOIRF{${current}}"><X>${original}</X></E>`;
      if (level === 1) return `<E msg="CAIGHDEAN{${this.withoutHyphen(original) ?? current}}"><X>${original}</X></E>`;
      if (level === 2) return `<E msg="DROCHMHOIRF{${current}}"><X>${original}</X></E>`;
      return '<X>';
    }
    posans.v = '<OK>';
    const e = this.eile.get(current);
    if (e !== undefined) {
      if (level === -1) return `<E msg="CAIGHDEAN{${e}}"><X>${original}</X></E>`;
      if (level === 0) return `<E msg="CAIGHMOIRF{${e}}"><X>${original}</X></E>`;
      if (level === 1) return `<E msg="CAIGHDEAN{${current} (${e})}"><X>${original}</X></E>`;
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

  private tagRecurse(original: string, current: string, level: number, posans: PosAns, maxdepth: number): string {
    let ans = this.lookup(original, current, level, posans);
    if (maxdepth === 0) return '';
    if (ans) return ans;
    for (const rule of this.morph) {
      if (!rule.re.test(current)) continue;
      const newcurrent = this.applyMorph(rule, current);
      ans = this.tagRecurse(original, newcurrent, level > rule.src.level ? level : rule.src.level, posans, maxdepth - 1);
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

  private tagAsCompound(word: string): string {
    const dummy: PosAns = { v: '' };
    const dm = /^([^-]+)-(.*)$/.exec(word);
    if (dm) {
      const l = dm[1];
      const r = dm[2];
      const t1 = this.tagRecurse(l, l, -1, dummy, 2);
      const t2 = this.tagRecurse(r, r, -1, dummy, 2);
      if (t1 && t2) {
        if (!t1.includes('<E') && !t2.includes('<E')) return `<E msg="COMHFHOCAL{${l}+${r}}"><X>${word}</X></E>`;
        return `<E msg="COMHCHAIGH{${l}+${r}}"><X>${word}</X></E>`;
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
            if (!tl.includes('<E') && !tr.includes('<E')) return `<E msg="COMHFHOCAL{${l}+${r}}"><X>${word}</X></E>`;
            return `<E msg="COMHCHAIGH{${l}+${r}}"><X>${word}</X></E>`;
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
    const caseless = RE_CAPITAL.test(word);
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

  private findBadThreeGrams(word: string): string {
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
    ans = this.tagInflected(word);
    if (ans) return ans;
    const dummy: PosAns = { v: '' };
    ans = this.tagRecurse(word, word, -1, dummy, 6);
    if (ans) return ans;
    ans = this.tagAsCompound(word);
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

        const msgm = /^<E msg="(.+?)"(?: r="([^"]+)")?>$/.exec(thiserror);
        if (!msgm) continue;
        const sugg = /^MOLADH\{(.*)\}$/.exec(msgm[1]);
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
          ...(sugg ? { suggestions: sugg[1].split(', ') } : {}),
          ...(msgm[2] ? { reason: msgm[2] } : {}),
        });
      }
    }
    return this.opts.datives ? keepMinority(errors, (id) => this.localizeMe(id)) : errors;
  }
}

// ---------------------------------------------------------------- helpers

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
