// Turns the engine's (line, column) errors into something the UI can draw,
// and checks that each one really lines up with the user's text.
import type { GrammarError } from '../src/types.ts';
import { foldForEngine, latin1 } from './fold.ts';

/** An engine error plus what the web worker adds to it. */
export type CheckedError = GrammarError & {
  /** Words the rule asks for in place of the last flagged word (e.g. the genitive), from the word-form table. */
  fixes?: string[];
};

export interface ErrorView {
  idx: number;
  /** Rule id without the library prefix and without any {argument} part. */
  rule: string;
  msg: string;
  /** The offending words, taken from the user's original text when they line up. */
  words: string;
  /** Similar words from the word list, for an unknown word (most likely first); empty for other errors. */
  suggestions: string[];
  /** Words that should replace the last flagged word, from the word-form table (e.g. the genitive). */
  fixes: string[];
  /** 1-based line number of the start. */
  line: number;
  /** Where the words sit (line index, code-point range), when they are on one line and line up with the text. */
  range?: { y: number; from: number; to: number };
  /** False if the engine's position does not match the text (then it is listed, not highlighted). */
  aligned: boolean;
  /** Why the rule applies: an id in data/reasons.json, when the rule has one. */
  reason?: string;
  /** The last flagged token when it is several words (see GrammarError). */
  unit?: string;
}

export interface Piece {
  text: string;
  /** Errors covering this piece, in list order. Empty for plain text. */
  ids: number[];
  /** Errors that finish at the end of this piece (they get their number badge there). */
  ends: number[];
}

/** Undoes the XML entities the engine puts in its error text. */
export const decodeEntities = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Same comparison for both sides: what the engine would have seen. */
const seen = (s: string) => squash(latin1(foldForEngine(s)));

export function ruleOf(e: GrammarError): string {
  return e.ruleId.replace(/^Lingua::GA::Gramadoir\//, '').replace(/\{.*$/s, '');
}

export function analyse(text: string, errors: CheckedError[]): { views: ErrorView[]; lines: Piece[][] } {
  const lines = text.split('\n').map((l) => Array.from(l));
  const views: ErrorView[] = [];
  const spans: { idx: number; y: number; from: number; to: number; last: boolean }[] = [];

  errors.forEach((e, idx) => {
    let aligned = e.fromy >= 0 && e.toy < lines.length && e.fromy <= e.toy && e.fromx >= 0;
    let slice = '';
    if (aligned) {
      const parts: string[] = [];
      for (let y = e.fromy; y <= e.toy; y++) {
        const from = y === e.fromy ? e.fromx : 0;
        const to = y === e.toy ? e.tox + 1 : lines[y].length;
        if (from > lines[y].length || to > lines[y].length || to <= from) { aligned = false; break; }
        parts.push(lines[y].slice(from, to).join(''));
      }
      slice = parts.join('\n');
    }
    if (aligned && seen(slice) !== squash(decodeEntities(e.errortext))) aligned = false;
    views.push({
      idx,
      rule: ruleOf(e),
      msg: e.msg,
      suggestions: e.suggestions ?? [],
      fixes: e.fixes ?? [],
      words: aligned ? squash(slice) : squash(decodeEntities(e.errortext)),
      line: e.fromy + 1,
      aligned,
      range: aligned && e.fromy === e.toy ? { y: e.fromy, from: e.fromx, to: e.tox + 1 } : undefined,
      ...(e.reason ? { reason: e.reason } : {}),
      ...(e.unit ? { unit: e.unit } : {}),
    });
    if (!aligned) return;
    for (let y = e.fromy; y <= e.toy; y++) {
      spans.push({
        idx, y,
        from: y === e.fromy ? e.fromx : 0,
        to: y === e.toy ? e.tox + 1 : lines[y].length,
        last: y === e.toy,
      });
    }
  });

  const out: Piece[][] = lines.map((chars, y) => {
    const mine = spans.filter((s) => s.y === y);
    if (!mine.length) return chars.length ? [{ text: chars.join(''), ids: [], ends: [] }] : [];
    const cuts = new Set<number>([0, chars.length]);
    for (const s of mine) { cuts.add(s.from); cuts.add(s.to); }
    const pts = [...cuts].sort((a, b) => a - b);
    const pieces: Piece[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [a, b] = [pts[i], pts[i + 1]];
      if (a === b) continue;
      const covering = mine.filter((s) => s.from <= a && s.to >= b).map((s) => s.idx);
      const ends = mine.filter((s) => s.last && s.to === b).map((s) => s.idx);
      pieces.push({ text: chars.slice(a, b).join(''), ids: covering, ends });
    }
    return pieces;
  });
  return { views, lines: out };
}
