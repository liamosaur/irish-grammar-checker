// Which word forms belong together (doras / dorais / doirse), from data/forms.json
// (built from BuNaMo by tools/build-forms.mjs). The engine can say "the genitive case is
// required here"; this works out the genitive.
//
// After the article the noun also changes its first letter, and which change depends on the
// case, gender and number. The rules are those of An Caighdeán Oifigiúil (2017), chapter 1
// (tables 1A, 1F, 1G, 1I); see articleForm() below.
import { type CheckedError, decodeEntities, ruleOf } from './annotate.ts';
import { eclipse, hPrefix, lenite, matchCase, tPrefix, uneclipse, unHPrefix, unlenite, unTPrefix } from './corrections.ts';

export interface FormsData {
  /** "nsg|gsg|npl|gpl|gender" per noun; variants inside a field are separated by ",". */
  n: string[];
  /** "nsg|gsgMasc|gsgFem|npl" per adjective. */
  a: string[];
}

type Role = 'nsg' | 'gsg' | 'npl' | 'gpl' | 'adj';
interface Target { w: string; role: Role; gender: string }
type Index = Map<string, Map<string, Target>>;

const add = (index: Index, from: string[], to: string[], role: Role, gender = '') => {
  for (const f of from) {
    const key = f.toLowerCase();
    let m = index.get(key);
    if (!m) index.set(key, (m = new Map()));
    for (const w of to) if (!m.has(w)) m.set(w, { w, role, gender });
  }
};
const split = (s: string) => (s ? s.split(',') : []);

/** Undoing and redoing an initial mutation, so "mo dteach" can be looked up as "teach". */
const MUTATIONS: [undo: (w: string) => string | null, redo: (w: string) => string | null][] = [
  [unlenite, lenite],
  [uneclipse, eclipse],
  [unTPrefix, tPrefix],
  [unHPrefix, hPrefix],
];

const first = (w: string) => w[0]?.toLowerCase() ?? '';

/**
 * How a noun begins right after the article, by the case it is in (Caighdeán Oifigiúil 2017, ch. 1):
 *  - genitive masculine singular ("an"): lenition of b c f g m p, t- before s, nothing else (1F)
 *  - genitive feminine singular ("na"): h- before a vowel, nothing else (1F)
 *  - genitive plural ("na"): eclipsis, n- before a vowel (1I)
 *  - nominative masculine singular ("an"): t- before a vowel (1A)
 *  - nominative feminine singular ("an"): lenition of b c f g m p, t- before s (1A)
 *  - nominative plural ("na"): h- before a vowel (1G)
 */
export function articleForm(w: string, role: Role, gender: string): string {
  const lenites = 'bcfgmp'.includes(first(w));
  switch (role) {
    case 'gsg':
      if (gender === 'm') return (lenites ? lenite(w) : first(w) === 's' ? tPrefix(w) : null) ?? w;
      return hPrefix(w) ?? w;
    case 'gpl': return eclipse(w) ?? w;
    case 'nsg':
      if (gender === 'm') return hPrefix(w) !== null ? (tPrefix(w) ?? w) : w;
      return (lenites ? lenite(w) : first(w) === 's' ? tPrefix(w) : null) ?? w;
    case 'npl': return hPrefix(w) ?? w;
    default: return w;
  }
}

export class Forms {
  private nGen: Index = new Map(); // noun nominative singular -> genitive singular
  private nGenPl: Index = new Map(); // nominative plural -> genitive plural
  private nNomFromGen: Index = new Map(); // genitive singular -> nominative singular
  private nNomPlFromGenPl: Index = new Map(); // genitive plural -> nominative plural
  private nPl: Index = new Map(); // nominative singular -> nominative plural
  private nSg: Index = new Map(); // nominative plural -> nominative singular
  private gender = new Map<string, string>(); // genitive singular form -> "m" | "f"
  private aGenMasc: Index = new Map(); // adjective (singular or plural nominative) -> masculine genitive
  private aGenFem: Index = new Map();
  private aPl: Index = new Map(); // adjective singular -> plural

  constructor(data: FormsData) {
    for (const row of data.n) {
      const [nsg, gsg, npl, gpl, g] = row.split('|');
      const [a, b, c, d] = [nsg, gsg, npl, gpl].map(split);
      add(this.nGen, a, b, 'gsg', g);
      add(this.nGenPl, c, d, 'gpl', g);
      add(this.nNomFromGen, b, a, 'nsg', g);
      add(this.nNomPlFromGenPl, d, c, 'npl', g);
      add(this.nPl, a, c, 'npl', g);
      add(this.nSg, c, a, 'nsg', g);
      if (g) for (const w of b) this.gender.set(w.toLowerCase(), g);
    }
    for (const row of data.a) {
      const [nsg, gm, gf, npl] = row.split('|').map(split);
      add(this.aGenMasc, [...nsg, ...npl], gm, 'adj');
      add(this.aGenFem, [...nsg, ...npl], gf, 'adj');
      add(this.aPl, nsg, npl, 'adj');
    }
  }

  /**
   * Replacements for the last word of `flagged` that the rule asks for, or [] if there are none to
   * offer. A feminine genitive after the singular article replaces the article too (an Cháin ->
   * na Cánach: CO17 1.5.2, bun na sráide).
   */
  fixesFor(rule: string, flagged: string): string[] {
    const tokens = flagged.trim().split(/\s+/);
    const last = tokens[tokens.length - 1];
    const prev = tokens.length > 1 ? tokens[tokens.length - 2] : undefined;
    if (!last) return [];
    let lookups: Index[];
    switch (rule) {
      case 'GENITIVE': {
        // An adjective after a feminine or masculine genitive noun takes that noun's form.
        const g = prev ? this.gender.get(prev.toLowerCase()) : undefined;
        lookups = g ? [g === 'f' ? this.aGenFem : this.aGenMasc, this.nGen, this.nGenPl] : [this.nGen, this.nGenPl];
        break;
      }
      // the hint for a noun after another noun (cóta mná; eochair an chairr): the genitive singular,
      // with the mutation the noun already has (redo below) or, after the article, the article's
      case 'WEAKGENITIVE': lookups = [this.nGen]; break;
      case 'NOGENITIVE': case 'WEAKNOGENITIVE': lookups = [this.nNomFromGen, this.nNomPlFromGenPl]; break;
      case 'UATHA': lookups = [this.nSg]; break;
      case 'IOLRA': lookups = [this.nPl]; break;
      case 'AIDIOLRA': lookups = [this.aPl]; break;
      default: return [];
    }
    // Straight after the article the noun's first letter is fixed by the case (see articleForm).
    // Otherwise whatever mutation the word already had (from a possessive, say) is kept.
    const afterArticle = prev !== undefined && ['an', 'na'].includes(prev.toLowerCase());
    for (const [undo, redo] of [[(w: string) => w, (w: string) => w] as const, ...MUTATIONS]) {
      const base = undo(last);
      if (base === null) continue;
      for (const index of lookups) {
        const hits = index.get(base.toLowerCase());
        if (!hits) continue;
        const out: string[] = [];
        for (const h of hits.values()) {
          const moved = afterArticle && h.role !== 'adj' ? articleForm(h.w, h.role, h.gender) : redo(h.w);
          if (moved === null || moved.toLowerCase() === last.toLowerCase()) continue;
          const femGen = afterArticle && prev!.toLowerCase() === 'an' && h.role === 'gsg' && h.gender === 'f';
          const fix = femGen ? `${matchCase(prev!, 'na')} ${matchCase(last, moved)}` : matchCase(last, moved);
          if (!out.includes(fix)) out.push(fix);
        }
        if (out.length) return out.slice(0, 3);
      }
    }
    return [];
  }
}

/** For rules that ask for another form of a word (genitive, plural, ...), records which form in `error.fixes`. */
export function addFixes(errors: CheckedError[], forms: Forms): void {
  for (const e of errors) {
    const fixes = forms.fixesFor(ruleOf(e), decodeEntities(e.errortext));
    if (fixes.length) e.fixes = fixes;
  }
}
