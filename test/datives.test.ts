// The check for a mix of the two systems of the dative singular (src/datives.ts, CO17
// 1.4, 1.7). The phrases are the book's (test/caighdean/ch01.json, ch04.json); the texts
// below only put them together, to test which marks are kept.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { markDatives } from '../src/datives.ts';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';
import { analyse } from '../web/annotate.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
type Example = { section: string; text: string };
const book = (ch: string): Example[] => JSON.parse(fs.readFileSync(path.join(root, 'test', 'caighdean', `${ch}.json`), 'utf8'));
const ch1 = book('ch01');
const lárnach = ch1.filter((e) => e.section.startsWith('1.4.')).map((e) => e.text); // with the N.B. phrases (sa gcarr)
const séimhiú = ch1.filter((e) => /^1\.7\.[3-6]/.test(e.section)).map((e) => e.text);

describe('dative systems (CO17 1.7.1)', () => {
  let gr: Gramadoir;
  let plain: Gramadoir;
  before(() => {
    const data = loadData(path.join(root, 'data'));
    gr = new Gramadoir(data, { datives: true });
    plain = new Gramadoir(data);
  });
  const systemOf = (phrase: string) => /CORAS\{(.)\}/.exec(markDatives(plain.xmlStream(phrase).join('')))?.[1] ?? null;
  const marks = (text: string) =>
    analyse(text, gr.grammaticalErrors(text)).views.filter((v) => v.rule.startsWith('CORAS')).map((v) => `${v.rule} [${v.words}]${v.aligned ? '' : ' (not aligned)'}`);

  it('reads the tables of An Córas Lárnach (1.4) as that system, or as either', () => {
    const got = lárnach.map((p) => [p, systemOf(p)]);
    assert.deepEqual(got.filter(([, s]) => s === 'S'), []);
    assert.equal(got.filter(([, s]) => s === 'L').length, 62);
  });
  it('reads the tables of Córas an tSéimhithe (1.7) as that system, or as either', () => {
    const got = séimhiú.map((p) => [p, systemOf(p)]);
    assert.deepEqual(got.filter(([, s]) => s === 'L'), []);
    assert.equal(got.filter(([, s]) => s === 'S').length, 58);
  });
  it('reads the Córas an tSéimhithe example in 4.2.2(a)(ii)', () => {
    assert.equal(systemOf('ag an fhear bheag'), 'S');
    assert.equal(systemOf('ag an bhfear beag'), 'L');
  });
  it('marks nothing in a text that keeps to one system', () => {
    assert.deepEqual(marks(lárnach.join('\n')), []);
    assert.deepEqual(marks(séimhiú.join('\n')), []);
  });
  it('marks the system used less', () => {
    assert.deepEqual(marks([...lárnach, 'ar an eitleán dhubh'].join('\n')), ['CORASSEIMHIU [ar an eitleán dhubh]']);
    assert.deepEqual(marks(['sa gcarr', ...séimhiú].join('\n')), ['CORASLARNACH [sa gcarr]']);
  });
  it('with a tie, marks the system that comes second', () => {
    assert.deepEqual(marks('ar an mbosca dearg\nar an bhosca dhearg'), ['CORASSEIMHIU [ar an bhosca]']);
    assert.deepEqual(marks('ar an bhosca dhearg\nar an mbosca dearg'), ['CORASLARNACH [ar an mbosca]']);
  });
  it('is off unless asked for', () => {
    const text = 'ar an mbosca dearg\nar an bhosca dhearg';
    assert.deepEqual(plain.grammaticalErrors(text).filter((e) => /CORAS/.test(e.ruleId)), []);
  });
});
