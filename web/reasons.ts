// Why a rule applies (grammar/reasons.tsv, built into data/rules/reasons.json): an explanation
// in English and, once written, Irish, with the section of An Caighdeán Oifigiúil (2017).
import messageReasons from '../data/rules/message-reasons.json';
import reasons from '../data/rules/reasons.json';
import { currentLocale } from './strings.ts';

export interface Reason {
  co17?: string;
  en: string;
  ga?: string;
}

const all: Record<string, Reason> = reasons;
// The reason shown with a message whose rule names none (grammar/messages.tsv, fourth column).
const byMessage: Record<string, string> = messageReasons;
// Messages whose argument is a word's parts (see tidyParts in src/engine.ts).
const PARTS = new Set(['COMHFHOCAL', 'MOIRFREIMIR', 'MIMHOIRF']);

/**
 * The quoted word for /\1/. GRAM's letter sequence marks the start of a word with ^ and the end
 * with $ (^rn): written out in words ("rn at the start of a word").
 */
function quoted(rule: string | undefined, arg = ''): string {
  if (rule !== 'GRAM') return `/${arg}/`;
  const m = /^(\^?)(.*?)(\$?)$/.exec(arg)!;
  const at = m[1] && m[3] ? ' as a whole word' : m[1] ? ' at the start of a word' : m[3] ? ' at the end of a word' : '';
  return `/${m[2]}/${at}`;
}

/**
 * The explanation for a reason id (or, without one, for the message `rule`) in the interface
 * language (English if it has no Irish yet). \1 in the text is the word the rule quotes (`arg`),
 * \0 the flagged words (`words`). For a word reported as its parts (PARTS: comh+gnéis,
 * mí+buntaiste (buntáiste)), \1 is the parts joined by " + " and \2 the correct form in brackets.
 */
export function reasonFor(id: string | undefined, rule?: string, arg?: string, words?: string): { text: string; lang: string; co17?: string } | null {
  const r = all[id ?? ''] ?? (rule ? all[byMessage[rule] ?? ''] : undefined);
  if (!r) return null;
  const parts = rule !== undefined && PARTS.has(rule) && arg !== undefined;
  const p = parts ? /^(.+?) \((.+)\)$/.exec(arg) : null;
  const main = p ? p[1] : arg;
  const one = parts && main!.includes('+') ? main!.split('+').map((x) => `/${x}/`).join(' + ') : quoted(rule, main);
  const fill = (s: string) => s
    .replace(/\/\\0\//g, `/${words ?? ''}/`)
    .replace(/\/\\1\//g, one)
    .replace(/\/\\2\//g, `/${p ? p[2] : ''}/`)
    .replace(/\\1/g, arg ?? '');
  if (currentLocale() === 'ga' && r.ga) return { text: fill(r.ga), lang: 'ga', co17: r.co17 };
  return { text: fill(r.en), lang: 'en', co17: r.co17 };
}
