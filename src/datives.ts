// The two systems of the dative singular after the article (CO17 1.4, 1.7): An Córas
// Lárnach (ar an mbord, ar an suíochán, ar an eitleán dubh) and Córas an tSéimhithe
// (ar an bhord, ar an tsuíochán, ar an eitleán dhubh). Both are standard, but 1.7.1
// advises keeping to one ("Moltar cloí le córas amháin ... gan na córais a mheascadh").
// A sentence can't show a mix, so the engine marks each phrase that shows a system and
// keeps only the marks of the system the text uses less (with a tie, the one that comes
// second). Eclipsis after den/don/sa (1.4 N.B.) counts with An Córas Lárnach: the book
// allows it alongside that system.
import type { GrammarError } from './types.ts';

/** S: Córas an tSéimhithe; L: An Córas Lárnach (or the eclipsis of 1.4 N.B.). */
type System = 'S' | 'L';

/** The rule id of a phrase's mark before the count, and of a kept one after it. */
const MARK = 'CORAS';
const KEPT: Record<System, string> = { S: 'CORASSEIMHIU', L: 'CORASLARNACH' };

const ARTPREP = /^(ag|ar|as|chuig|fairis|ionsar|leis|roimh|thar|tríd|um)$/i;
const FUSED = /^(den|don|sa|san|faoin|ón)$/i;
/** Lenite in both systems (CO17 1.4.1, 1.7.3). */
const LENITING = /^(den|don|sa|san)$/i;

const PHRASE = /(?<=^| )<S>([^<]+)<\/S>( <T>[Aa]n<\/T>)? <N pl="n" gnt="n" gnd="([mf])">([^<]+)<\/N>(?: <A pl="n" gnt="n">([^<]+)<\/A>)?/g;

/** The system a noun after a preposition and the article shows, if any. */
function bySystemNoun(prep: string, masc: boolean, noun: string): System | null {
  const w = noun.toLowerCase();
  if (/^(mb|gc|nd|bhf|ng|bp|dt)/.test(w)) return 'L'; // ar an mbord; sa gCabhán (1.4 N.B.)
  if (masc && /^ts[aeiouáéíóúlnr]/.test(w)) return 'S'; // ar an tsuíochán (1.7.4)
  if (masc && /^s[aeiouáéíóúlnr]/.test(w)) return 'L'; // ar an suíochán (1.4.2)
  if (LENITING.test(prep)) return null; // den chrann, sa bhosca: both systems
  if (/^[bcfgmp]h/.test(w)) return 'S'; // ar an bhord (1.7.3)
  if (/^m[^bh]/.test(w)) return 'L'; // ar an máthair: m is not eclipsed (1.4.1)
  return null;
}

/** The system an adjective after a masculine noun shows, if any (1.4.3-4, 1.7.5-6). */
function bySystemAdjective(adj: string): System | null {
  const w = adj.toLowerCase();
  if (/^([bcdfgmpt]h|sh)/.test(w)) return 'S'; // ar an eitleán dhubh (lenited after n too)
  if (/^([bcdfgmpt]|s[aeiouáéíóúlnr])/.test(w)) return 'L'; // ar an eitleán dubh
  return null;
}

/** Wraps each phrase that shows a system in a mark (outside any error already marked). */
export function markDatives(s: string): string {
  return s.replace(PHRASE, (m, prep: string, art: string | undefined, gnd: string, noun: string, adj: string | undefined, at: number) => {
    if ((art ? !ARTPREP.test(prep) : !FUSED.test(prep))) return m;
    const before = s.slice(0, at);
    if ((before.match(/<E /g) ?? []).length > (before.match(/<\/E>/g) ?? []).length) return m;
    if (s.startsWith(' <E', at + m.length)) return m; // the next word has an error of its own
    const masc = gnd === 'm';
    const n = bySystemNoun(prep, masc, noun);
    const a = masc && adj ? bySystemAdjective(adj) : null;
    if (n && a && n !== a) return m; // a mix within one phrase: the rules report that
    const sys = n ?? a;
    if (!sys) return m;
    // Mark up to the word that shows the system.
    const end = n ? m.length - (adj ? ` <A pl="n" gnt="n">${adj}</A>`.length : 0) : m.length;
    return `<E msg="${MARK}{${sys}}">${m.slice(0, end)}</E>${m.slice(end)}`;
  });
}

/**
 * Keeps the marks of the system the text uses less (or, with a tie, of the one that comes
 * second), renamed to that system's message; drops the others.
 */
export function keepMinority(errors: GrammarError[], localize: (id: string) => string): GrammarError[] {
  const sysOf = (e: GrammarError) => new RegExp(`/${MARK}\\{([SL])\\}$`).exec(e.ruleId)?.[1] as System | undefined;
  const marks = errors.map(sysOf).filter((x): x is System => !!x);
  const s = marks.filter((x) => x === 'S').length;
  const l = marks.length - s;
  const minority: System | null = !s || !l ? null : s < l ? 'S' : l < s ? 'L' : marks[0] === 'S' ? 'L' : 'S';
  return errors.flatMap((e) => {
    const sys = sysOf(e);
    if (!sys) return [e];
    if (sys !== minority) return [];
    return [{ ...e, ruleId: e.ruleId.replace(/[^/]*$/, KEPT[sys]), msg: localize(KEPT[sys]) }];
  });
}
