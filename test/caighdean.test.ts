// Example sentences from Gramadach na Gaeilge: An Caighdeán Oifigiúil (2017), one
// file per chapter in test/caighdean/ (chNN.json). Every example is correct Irish by
// definition, so the checker should raise no grammar error on any of them.
//
// Sentences the checker currently gets wrong carry a `known` note (the rule it raises
// and the section of the Caighdeán that allows the sentence); they run as todo tests.
// When a fix makes one pass, the last test of its chapter fails until its `known`
// note is removed.
//
// A `hint` names the one message a sentence is expected to get: a hint that the rule
// cannot decide from the words alone (e.g. WEAKSEIMHIUGEN, where the Caighdeán's
// exception depends on what the nouns mean), not a claim that the sentence is wrong.
//
// Entries with `phrase` are short examples: those the book gives in its running text
// ("e.g., gan pingin rua; ..."), and the rows of its tables (chapter 4's tables of
// adjectives in each case), copied verbatim with the row labels dropped. In chapter 10,
// phrases with alternatives in brackets ("trí (ceithre, cúig, sé) bhád mhóra") are left
// out. In chapter 4, a sentence with alternatives in brackets ("Dá chríonna (dá chróga,
// dá fheabhas) é, ...") is given as printed without the brackets, then once with each
// alternative in place of the word before them; those entries have `variant`. In
// chapter 7, a word in brackets is optional ("Nach (é) Seán atá ina mhúinteoir?"): the
// sentence is given without it, then with it as a `variant`. Chapter 7's tables wrap
// and sit side by side, so their examples were copied out by hand.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';
import { analyse } from '../web/annotate.ts';
import { foldForEngine } from '../web/fold.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'test', 'caighdean');

type Example = { section: string; page: number; text: string; known?: string; hint?: string; phrase?: boolean; variant?: boolean };
const TITLES: Record<string, string> = { '4': 'adjectives', '7': 'the copula', '10': 'initial mutations' };
const chapters = fs.readdirSync(dir).filter((f) => /^ch\d+\.json$/.test(f)).sort();

// Messages about the word list rather than grammar: a word the database lacks says
// nothing about whether the sentence breaks a rule of the chapter.
const LEXICON_ONLY = new Set(['ANAITHNID', 'ANKOTHVOS', 'UNKNOWN', 'MOLADH', 'GRAM', 'MOIRF', 'COMHFHOCAL', 'COMHCHAIGH']);

let engine: Gramadoir | undefined;
function complaints(text: string): { rule: string; text: string }[] {
  engine ??= new Gramadoir(loadData(path.join(root, 'data')), { fixSpelling: true });
  return analyse(text, engine.grammaticalErrors(foldForEngine(text))).views
    .filter((v) => !LEXICON_ONLY.has(v.rule))
    .map((v) => ({ rule: v.rule, text: `${v.rule} [${v.words}]: ${v.msg}` }));
}
const asExpected = (e: Example) => {
  const got = complaints(e.text);
  return e.hint ? got.length === 1 && got[0].rule === e.hint : got.length === 0;
};

for (const file of chapters) {
  const chapter = String(Number(/\d+/.exec(file)![0]));
  const examples: Example[] = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  describe(`An Caighdeán Oifigiúil, chapter ${chapter}${TITLES[chapter] ? `: ${TITLES[chapter]}` : ''}`, () => {
    const sections = [...new Set(examples.map((e) => e.section))];
    for (const section of sections) {
      describe(section, () => {
        for (const e of examples.filter((x) => x.section === section)) {
          it(e.hint ? `${e.text} (hint: ${e.hint})` : e.text, { todo: e.known }, () => {
            const got = complaints(e.text);
            if (e.hint) assert.deepEqual(got.map((c) => c.rule), [e.hint], `expected only the ${e.hint} hint: ${got.map((c) => c.text).join('; ')}`);
            else assert.deepEqual(got.map((c) => c.text), [], `correct per ${e.section}, page ${e.page}`);
          });
        }
      });
    }

    it('every sentence marked as a known failure still fails', () => {
      const fixed = examples.filter((e) => e.known && asExpected(e)).map((e) => e.text);
      assert.deepEqual(fixed, [], `now passing: remove \`known\` from these in test/caighdean/${file}`);
    });
  });
}
