// The rule compiler (tools/rule-compiler.mjs): mistakes in grammar/ that the original Perl filters
// passed over silently must be reported, and data/rules/ must be what grammar/ compiles to.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
// @ts-expect-error: plain JavaScript module without type declarations
import { checkRules, gin, parseMacros, rialachaMeta } from '../tools/rule-compiler.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const macros = parseMacros('s/ANYTHING/[^<]+/g;\ns/*CS[/*pl="n" gnt="n"[/g;\n');
const check = (name: string, text: string) => checkRules(name, text, macros, ['CLAUSESTART']) as string[];

describe('checkRules reports what the compiler would drop or misread', () => {
  it('accepts well-formed rules', () => {
    assert.deepEqual(check('rialacha', '# a comment with any character: …\n<T>[Aa]n</T> <NCS>ANYTHING</NCS>:SEIMHIU\n  CLAUSESTART <S>[Aa]r</S>:OK\n'), []);
  });
  it('a stray colon before the message (::)', () => {
    assert.match(check('rialacha', '<T>an</T> <N>x</N>::BACHOIR{y}\n').join(), /not an action/);
  });
  it('a tag left open', () => {
    assert.match(check('rialacha', '[Oo]cht <N pl="n" gnt="n" gnd="m">n-orlach:BACHOIR{n-orlaí}\n').join(), /not a word gin can read/);
  });
  it('a "<" inside a word', () => {
    assert.match(check('rialacha', '<T>an</T> ab[^<]*:SEIMHIU\n').join(), /not a word gin can read/);
  });
  it('an unknown macro or tag shorthand', () => {
    assert.match(check('rialacha', '<T>an</T> <N>ANYTHNG</N>:SEIMHIU\n').join(), /unknown macro ANYTHNG/);
    assert.match(check('rialacha', '<T>an</T> <NXS>ANYTHING</NXS>:SEIMHIU\n').join(), /unknown tag shorthand <NXS>/);
  });
  it('a character outside Latin-1 in a rule', () => {
    assert.match(check('rialacha', '<T>an</T> ’sin:SEIMHIU\n').join(), /outside Latin-1/);
  });
  it('an exception that is not indented, or indented without a rule above it', () => {
    const top = '[Nn]í <E><X>hin</X></E>:OK\n';
    assert.deepEqual(check('rialacha', `${top}<T>an</T> <N>x</N>:SEIMHIU\n# comment\n  <T>an</T> <E><N>x</N></E>:OK\n  <S>ag</S> <E><N>x</N></E>:OK\n`), []);
    assert.match(check('rialacha', `${top}<T>an</T> <N>x</N>:SEIMHIU\n<T>an</T> <E><N>x</N></E>:OK\n`).join(), /indent it/);
    assert.match(check('rialacha', `${top}<T>an</T> <N>x</N>:SEIMHIU\n\n  <T>an</T> <E><N>x</N></E>:OK\n`).join(), /must follow an error rule/);
    assert.match(check('rialacha', `${top}  <T>an</T> <N>x</N>:SEIMHIU\n`).join(), /only an :OK exception is indented/);
  });
  it('a macro name containing an earlier one', () => {
    const clash = parseMacros('s/CAPVOWEL/[AEIOU][^<]*/g;\ns/CAPVOWELWITHH/h[AEIOU][^<]*/g;\n');
    assert.match(checkRules('macros', '', clash, []).join(), /CAPVOWEL is substituted inside CAPVOWELWITHH/);
  });
});

describe('the compiled rules', () => {
  it('compiles an error rule with its exceptions', () => {
    const out = rialachaMeta(gin('<T>an</T> <N>x</N>:SEIMHIU\n<T>an</T> <E><N>x</N></E>:OK\n', 'ANOPV'));
    assert.match(out, /^if \(s\/\(\?<!\[<>\]\)\(.*\)\(\?!\[<>\]\)\/<E msg="SEIMHIU">\$1<\\\/E>\/g\) \{\ns\/.*strip_errors\(\$1\);\/eg;\n\}\n$/);
  });

  it('a rule\'s reason (:MSG @id) reaches the reported error', async () => {
    const { Gramadoir } = await import('../src/engine.ts');
    const { loadData } = await import('../src/node-data.ts');
    const reasons = JSON.parse(fs.readFileSync(path.join(root, 'data', 'rules', 'reasons.json'), 'utf8'));
    // The negative imperative written na (CO17 10.14.1; the case in test/added-rules.test.ts).
    const [e] = new Gramadoir(loadData(path.join(root, 'data'))).grammaticalErrors('Na abair é.');
    assert.equal(e.reason, 'na-imperative');
    assert.equal(reasons[e.reason!].co17, '10.14.1');
  });

  const upstream = path.join(root, '.sources', 'gramadoir');
  it('data/rules/ is what grammar/ compiles to', { skip: fs.existsSync(upstream) ? undefined : 'needs the An Gramadoir checkout in .sources/gramadoir' }, () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-'));
    execFileSync(process.execPath, [path.join(root, 'tools', 'generate-rules.mjs'), upstream, out], { stdio: 'pipe' });
    for (const f of fs.readdirSync(path.join(root, 'data', 'rules'))) {
      assert.ok(fs.readFileSync(path.join(out, 'rules', f)).equals(fs.readFileSync(path.join(root, 'data', 'rules', f))), `data/rules/${f} is out of date: run tools/generate-rules.mjs`);
    }
  });
});
