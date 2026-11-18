import type { RuleJson } from './types.ts';

// Perl's strip_errors: drop the first <E ...> and the first </E>.
export function stripErrors(s: string): string {
  return s.replace(/<E[^>]*>/, '').replace(/<\/E>/, '');
}

// Perl's strip_badpos (called from aonchiall ":!" rules).
export function stripBadpos(str: string, word: string, badpos: RegExp): string {
  const orig = str;
  str = str.replace(badpos, '');
  if (/></.test(str)) return `<B><Z>${str}</Z>${word}</B>`;
  const m = /^<([A-Z])/.exec(str);
  if (m) {
    const pos = m[1];
    str = str.replace(/.>$/, '>');
    return `${str}${word}</${pos}>`;
  }
  const m2 = /^(<([A-Z])[^>]*).><.*/.exec(orig);
  if (m2) return `${m2[1]}>${word}</${m2[2]}>`;
  return `${orig}${word}`;
}

type TplPart = string | number;

function parseTemplate(t: string): TplPart[] {
  const parts: TplPart[] = [];
  const re = /\$([1-9])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    if (m.index > last) parts.push(t.slice(last, m.index));
    parts.push(Number(m[1]));
    last = m.index + m[0].length;
  }
  if (last < t.length) parts.push(t.slice(last));
  return parts;
}

export interface CompiledRule {
  re: RegExp;
  apply: (...groups: (string | undefined)[]) => string;
  then?: CompiledRule[];
}

export function compileRule(r: RuleJson): CompiledRule {
  const re = new RegExp(r.re, r.flags.includes('g') ? r.flags : r.flags + 'g');
  let apply: CompiledRule['apply'];
  if (r.kind === 'tpl') {
    const parts = parseTemplate(r.repl ?? '');
    apply = (...g) => parts.map((p) => (typeof p === 'number' ? (g[p - 1] ?? '') : p)).join('');
  } else if (r.kind === 'strip_errors') {
    apply = (...g) => stripErrors(g[0] ?? '');
  } else {
    const bad = new RegExp(r.badpos ?? '', 'g');
    apply = (...g) => `${g[0] ?? ''}${stripBadpos(g[1] ?? '', g[2] ?? '', bad)}${g[3] ?? ''}`;
  }
  return { re, apply, then: r.then?.map(compileRule) };
}

// Applies s/// rule; returns the new string and the number of substitutions.
export function applyRule(s: string, rule: CompiledRule): { s: string; n: number } {
  let n = 0;
  rule.re.lastIndex = 0;
  const out = s.replace(rule.re, (...args) => {
    n++;
    // args: match, p1..pN, offset, string[, groups]
    const groups: (string | undefined)[] = [];
    for (let i = 1; i < args.length && typeof args[i] !== 'number'; i++) groups.push(args[i]);
    return rule.apply(...groups);
  });
  return { s: out, n };
}

export function applyRules(s: string, rules: CompiledRule[]): string {
  for (const rule of rules) {
    const r = applyRule(s, rule);
    s = r.s;
    if (r.n > 0 && rule.then) s = applyRules(s, rule.then);
  }
  return s;
}
