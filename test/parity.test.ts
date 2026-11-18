import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const goldenDir = path.join(root, 'test', 'golden');

interface Golden {
  text: string;
  xml: string[];
  api: Record<string, string>[];
}

describe('parity with the Perl engine (golden files)', () => {
  let gr: Gramadoir;
  before(() => {
    // Perl 0.70 is the oracle, so use the 0.70 rules/morphology overlaid on the shared data.
    gr = new Gramadoir(loadData(path.join(root, 'data', 'legacy-0.70'), path.join(root, 'data'), { overlay: false }));
  });

  for (const f of fs.readdirSync(goldenDir).filter((x) => x.endsWith('.json'))) {
    const g: Golden = JSON.parse(fs.readFileSync(path.join(goldenDir, f), 'utf8'));

    it(`${f}: tagged XML identical`, () => {
      assert.deepEqual(gr.xmlStream(g.text), g.xml);
    });

    it(`${f}: reported errors identical`, () => {
      const keys = ['fromy', 'fromx', 'toy', 'tox', 'ruleId', 'msg', 'context', 'contextoffset', 'errorlength'] as const;
      const got = gr.grammaticalErrors(g.text).map((e) => Object.fromEntries(keys.map((k) => [k, String(e[k])])));
      const want = g.api.map((e) => Object.fromEntries(keys.map((k) => [k, e[k]])));
      assert.deepEqual(got, want);
    });
  }
});
