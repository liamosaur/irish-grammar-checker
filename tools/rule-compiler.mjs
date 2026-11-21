// The rule compiler: JavaScript versions of An Gramadóir's Perl filters (gin.meta.pl,
// macra-ga.meta.pl run with perl -p, aonchiall.meta.pl, comhshuite.meta.pl, rialacha.meta.pl;
// github.com/kscanne/gramadoir, GPL), so that building the rules needs no Perl. Each function
// takes and returns the text of one stage, line by line, exactly as the Perl script would.
// The Perl regular expressions are kept as they were, in JavaScript syntax; tools/README.md
// describes the rule syntax they implement.
//
// Derived from the Perl originals by Kevin P. Scannell; see COPYING.

/** Calls `f` for each line (without its newline) and joins the results, one per line. */
const perLine = (text, f) => {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map(f).filter((l) => l !== null).map((l) => l + '\n').join('');
};

/**
 * gin.meta.pl: turns each rule word into a regular expression for the tagged text. `attrtags` is
 * the list of tags that carry attributes (from pos-ga.txt). Comment lines are dropped.
 */
export function gin(text, attrtags) {
  const at = `[${attrtags}]`;
  const noat = `[^BEZ${attrtags}]`;
  const TOKEN = /(?<= )(<E>)?(<B><Z>(?:(?:<[^>]+>)+|[^<>]+)<\/Z>[^<]+<\/B>|<[^/][^>]*>[^<]+<\/[^>]+>|[^<> ]+)(<\/E>)?(?= )/g;
  const reA = new RegExp(`<(${noat})>([^<]+)</[A-Z]>`);
  const reB = new RegExp(`<(${at})( [^>]+)>([^<]+)</[A-Z][^>]*>`);
  const reC = new RegExp(`<(${at})>([^<]+)</[A-Z][^>]*>`);
  const reD = new RegExp(`<(${at})([^ >][^>]*)>([^<]+)</[A-Z][^>]*>`);
  return perLine(text, (line) => {
    if (line.startsWith('#')) return null;
    const m = /^([^:]+):(.*)$/.exec(line);
    let rule = m ? m[1] : '';
    const action = m ? m[2] : '';
    rule = rule.replace(/\(/g, '(?:').replace(/\/>/g, '\\/>');
    rule = ` ${rule} `;
    let ans = '';
    for (const t of rule.matchAll(TOKEN)) {
      const aon = t[1] ?? '';
      let tok = t[2];
      let tri = t[3] ?? '';
      if (/^<\[\^/.test(tok)) {
        // e.g. <[^N]>ANYTHING</[^N]>
        tok = tok.replace(/<\[\^([A-DF-Z]+)\]>([^<]+)<\/[^>]*>/, (_, a, b) =>
          `(?:<[^\\/${a}][^>]*>${b}<\\/[^${a}]>|<B><Z>(?:<[^${a}][^>]*>)+<\\/Z>${b}<\\/B>)`);
      } else if (/^<\[[^^]/.test(tok)) {
        // e.g. <[AN]>ANYTHING</[AN]>
        tok = tok.replace(/<\[([A-DF-Z]+)\]>([^<]+)<\/[^>]*>/, (_, a, b) =>
          `(?:<[${a}][^>]*>${b}<\\/[${a}]>|<B><Z>(?:<[${a}][^>]*>)+<\\/Z>${b}<\\/B>)`);
      } else if (/^<[A-Z]/.test(tok)) {
        // e.g. <C>
        tok = tok.replace(reA, (_, a, b) => `<${a}>${b}<\\/${a}>`);
        // e.g. <N pl="n" gnt="n">
        tok = tok.replace(reB, (_, a, b, c) => `<${a}${b}>${c}<\\/${a}>`);
        // e.g. <N>
        tok = tok.replace(reC, (_, a, b) => `(?:<${a}[^>]*>${b}<\\/${a}>|<B><Z>(?:<${a}[^>]*>)+<\\/Z>${b}<\\/B>)`);
        // e.g. <NCS>, or <NCS h="y">
        tok = tok.replace(reD, (_, a, b, c) =>
          `(?:<${a}[^>]*${b}[^>]*>${c}<\\/${a}>|<B><Z>(?:<${a}[^>]*${b}[^>]*>)+<\\/Z>${c}<\\/B>)`);
      } else {
        // barewords or macros with no tags
        tok = tok.replace(/([^<> ]+)/, (_, a) => `(?:<[\\/A-DF-Z][^>]*>)+${a}<\\/[A-DF-Z]>`);
        tok = tok.replace(/\+([^(<]*\|[^(<]*)</g, (_, a) => `+(?:${a})<`);
      }
      tri = tri.replace(/\//, '\\/');
      ans += `${aon}${tok}${tri} `;
    }
    return ans.replace(/ $/, () => `:${action}`);
  });
}

/**
 * The macros: grammar/macra-ga.meta.pl is a list of `s/NAME/EXPANSION/g;` lines, applied in
 * order to every line (as perl -p does). Every pattern is a literal (a name, or \*XX\[ for a
 * tag shorthand) and no expansion contains a character special in a Perl replacement, which
 * `parseMacros` checks.
 */
export function parseMacros(src) {
  const out = [];
  for (const line of src.split('\n')) {
    if (!line.startsWith('s/')) continue;
    const m = /^s\/((?:\\.|[^/])*)\/((?:\\.|[^/])*)\/g;\s*$/.exec(line);
    if (!m) throw new Error(`macros: cannot read ${line}`);
    if (/[$@\\]/.test(m[2])) throw new Error(`macros: special character in an expansion: ${line}`);
    const from = m[1].replace(/\\(.)/g, '$1');
    if (/[^A-Za-z*[]/.test(from)) throw new Error(`macros: pattern is not a literal: ${line}`);
    out.push([from, m[2]]);
  }
  return out;
}

/**
 * Mistakes the Perl filters pass over silently, as a list of messages (empty if none):
 * - a macro name containing an earlier one (the earlier one is substituted inside it, so the
 *   later one never applies), or an expansion containing a later name;
 * - in a rule, an all-caps word of 4 letters or more (outside a character class) that is not a
 *   macro or one of `placeholders`, or a tag suffix (<NFCS>) that is not a tag shorthand;
 * - a rule that the word pattern of gin does not cover in full (a word containing "<" or an
 *   unbalanced tag would be dropped);
 * - an action that is not a message (rialacha: NAME, NAME{...} or OK; aonchiall: <TAG> or !<TAG>;
 *   comhshuite: <TAG>), such as ::NAME;
 * - a character outside Latin-1 in a rule (the checker folds its input to Latin-1, so the rule
 *   could never match). Comments may contain any character.
 */
export function checkRules(name, text, macros, placeholders) {
  const problems = [];
  const names = macros.map(([f]) => f);
  if (name === 'macros') {
    for (let i = 0; i < names.length; i++) {
      for (let j = 0; j < i; j++) if (names[i].includes(names[j])) problems.push(`macros: ${names[j]} is substituted inside ${names[i]}; put ${names[i]} first`);
      for (let j = i + 1; j < names.length; j++) if (macros[i][1].includes(names[j])) problems.push(`macros: the expansion of ${names[i]} contains ${names[j]}`);
    }
    return problems;
  }
  const known = new Set([...names, ...placeholders]);
  const shorthands = new Set(names.filter((n) => n.startsWith('*')).map((n) => n.slice(1, -1)));
  const ACTION = { rialacha: /^(OK|[A-Z]+(\{.*\})?) *$/, aonchiall: /^(<[A-Z][^>]*>|!<.+>) *$/, comhshuite: /^<[A-Z][^>]*> *$/ };
  const TOKEN = /(?<= )(<E>)?(<B><Z>(?:(?:<[^>]+>)+|[^<>]+)<\/Z>[^<]+<\/B>|<[^/][^>]*>[^<]+<\/[^>]+>|[^<> ]+)(<\/E>)?(?= )/g;
  text.split('\n').forEach((line, i) => {
    if (line.startsWith('#') || line === '') return;
    const where = `${name}-ga.in:${i + 1}`;
    const bad = /[^\u0000-ÿ]/.exec(line);
    if (bad) problems.push(`${where}: character outside Latin-1 (${bad[0]})`);
    const m = /^([^:]+):(.*)$/.exec(line);
    if (!m) { problems.push(`${where}: no ":" before the action`); return; }
    const [, rule, action] = m;
    if (!ACTION[name].test(action)) problems.push(`${where}: not an action: ${action}`);
    const asGin = rule.replace(/\(/g, '(?:').replace(/\/>/g, '\\/>');
    const covered = [...` ${asGin} `.matchAll(TOKEN)].map((t) => t[0]).join(' ');
    if (covered !== asGin.trim()) problems.push(`${where}: part of the rule is not a word gin can read: ${rule}`);
    for (const w of rule.replace(/<[^>]*>/g, ' ').replace(/\[[^\]]*\]/g, ' ').matchAll(/[A-Z]{4,}/g)) {
      if (!known.has(w[0])) problems.push(`${where}: unknown macro ${w[0]}`);
    }
    for (const t of rule.matchAll(/<([A-Z])([A-Z]+)[ >]/g)) {
      if (!shorthands.has(t[2]) && t[1] + t[2] !== 'B' && !/^[BEZ]$/.test(t[1])) problems.push(`${where}: unknown tag shorthand <${t[1]}${t[2]}>`);
    }
  });
  return problems;
}

export function macra(text, macros) {
  return perLine(text, (line) => {
    for (const [from, to] of macros) line = line.split(from).join(to);
    return line;
  });
}

/** aonchiall.meta.pl: tag-choice rules (`...:<TAG>` keeps one tag, `...:!<TAG>` removes one). */
export function aonchiallMeta(text) {
  return perLine(text, (line) => {
    if (/:!/.test(line)) {
      line = line.replace(/^(.*)<B><Z>(.*)<\/Z>(.*)<\/B>(.*):!(<.+)> *$/, (_, a, b, c, d, e) =>
        `s/(${a})<B><Z>(${b})<\\/Z>(${c})<\\/B>(${d})/"$1".strip_badpos($2,$3,'${e}.>')."$4"/eg;`);
      line = line.replace(/^(.*)<B>(.*)<\/B>(.*):!(<.+)> *$/, (_, a, b, c, d) =>
        `s/(${a})<B><Z>((?:<[^>]+>)+)<\\/Z>(${b})<\\/B>(${c})/"$1".strip_badpos($2,$3,'${d}.>')."$4"/eg;`);
    } else {
      line = line.replace(/^(.*)<B><Z>(.*)<\/Z>(.*)<\/B>(.*):<([A-DF-Z])([^>]*)> *$/, (_, a, b, c, d, e, f) =>
        `s/(${a})<B><Z>${b}<\\/Z>(${c})<\\/B>(${d})/$1<${e}${f}>$2<\\/${e}>$3/g;`);
      line = line.replace(/^(.*)<B>(.*)<\/B>(.*):<([A-DF-Z])([^>]*)> *$/, (_, a, b, c, d, e) =>
        `s/(${a})<B><Z>(?:<[^>]+>)+<\\/Z>(${b})<\\/B>(${c})/$1<${d}${e}>$2<\\/${d}>$3/g;`);
    }
    return line;
  });
}

/** comhshuite.meta.pl: two- and three-word phrases tagged as one word. */
export function comhshuiteMeta(text) {
  return perLine(text, (line) => {
    line = line.replace(/^([^+]*\+)([^<]*)(<[^+]*\+)([^<]*)([^:+]*):<([A-Z])([^>]*)>/, (_, a, b, c, d, e, f, g) =>
      `s/${a}(${b})${c}(${d})${e}/<${f}${g}>$1 $2<\\/${f}>/g;`);
    line = line.replace(/^([^+]*\+)([^<]*)(<[^+]*\+)([^<]*)(<[^+]*\+)([^<]*)([^:+]*):<([A-Z])([^>]*)>/, (_, a, b, c, d, e, f, g, h, i) =>
      `s/${a}(${b})${c}(${d})${e}(${f})${g}/<${h}${i}>$1 $2 $3<\\/${h}>/g;`);
    return line;
  });
}

/**
 * rialacha.meta.pl: error rules become `s/(?<![<>])(...)(?![<>])/<E msg="...">$1<\/E>/g;`, and
 * the :OK lines after a rule become an `if (rule) { ... }` block of strip_errors calls (OK lines
 * with no rule before them, at the top of the file, stand alone).
 */
export function rialachaMeta(text) {
  const out = [];
  let prev = '';
  let inokblock = false;
  let prevok = false;
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  for (let line of lines) {
    line = line.replace(/\|<B><Z>[^+]+\+<\\\/Z>[^/]+\/B>/g, '');
    line = line.split('(?:<[\\/A-DF-Z][^>]*>)+').join('<[A-DF-Z][^>]*>');
    if (/:OK *$/.test(line)) {
      if (!line.includes('<E>')) {
        line = `<E>${line}`;
        line = line.replace(':OK', () => '<\\/E>:OK');
      }
      line = line.replace('<E>', () => '<E[^>]*>');
      line = `s/(${line}`;
      line = line.replace(/:OK *$/, () => ')/strip_errors($1);/eg;');
      if (!(inokblock || prev === '' || prevok)) {
        prev = `if (${prev.replace(/;$/, '')}) {`;
        inokblock = true;
      }
      prevok = true;
    } else {
      line = line.replace(/^(.+[^?]):(.*)/, (_, a, b) => `s/(?<![<>])(${a})(?![<>])/<E msg="${b}">$1<\\/E>/g;`);
      if (inokblock) prev += '\n}';
      inokblock = false;
      prevok = false;
    }
    if (prev) out.push(prev);
    prev = line;
  }
  if (inokblock) prev += '\n}';
  out.push(prev);
  return out.join('\n') + '\n';
}
