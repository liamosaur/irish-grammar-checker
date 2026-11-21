// Data shapes produced by tools/extract-rules.mjs and tools/build-data.mjs.

export interface RuleJson {
  re: string;
  flags: string;
  kind: 'tpl' | 'strip_errors' | 'strip_badpos';
  repl?: string; // for kind === 'tpl': Perl-style replacement with $1..$9
  badpos?: string; // for kind === 'strip_badpos'
  then?: RuleJson[]; // `if (s/../../g) { ...then... }` blocks
}

export interface MorphRuleJson {
  re: string;
  parts: ({ s: string } | { g: number; f?: 'lc' | 'lcfirst' })[];
  level: number;
  rootpos: string;
  replpos: string;
  poscompiled: string | null;
}

export interface TokenRuleJson {
  re: string;
  tag: string;
  tail: string;
}

export interface GramadoirData {
  lexicon: Record<string, string>[]; // 7 frequency tiers: word -> grammar code chars
  eile: Record<string, string>;
  earraidi: Record<string, string>;
  pos: Record<string, string>; // code char -> tag like "<N pl=\"n\">"
  token: TokenRuleJson[];
  morph: MorphRuleJson[];
  grams: string[];
  nocombo: string[];
  messages: Record<string, string>;
  /**
   * Verbal nouns (data/verbal-nouns.json from BuNaMo, and data/verbal-nouns-extra.json), for the
   * VERBALNOUN placeholder in rules. Absent: the placeholder matches nothing.
   */
  verbalNouns?: string[];
  rules: {
    aonchiall: RuleJson[];
    comhshuite: RuleJson[];
    giorr: RuleJson[];
    rialacha: RuleJson[];
    unigram: RuleJson[];
  };
}

export interface GrammarError {
  fromy: number;
  fromx: number;
  toy: number;
  tox: number;
  ruleId: string;
  msg: string;
  context: string; // sentence text with XML entities (&amp; &quot; &lt; &gt;)
  contextoffset: number;
  errorlength: number;
  errortext: string;
  /** Replacement suggestions for an unknown word (only with the fixSpelling option), most likely first. */
  suggestions?: string[];
  /** Why the rule applies: an id in data/reasons.json (grammar/reasons.tsv), when the rule has one. */
  reason?: string;
}
