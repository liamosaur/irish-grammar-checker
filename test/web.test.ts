import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';
import { analyse } from '../web/annotate.ts';
import { chunkText } from '../web/chunk.ts';
import { EXAMPLES } from '../web/examples.ts';
import { foldForEngine } from '../web/fold.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const golden = (n: string): string => JSON.parse(fs.readFileSync(path.join(root, 'test', 'golden', `${n}.json`), 'utf8')).text;

describe('web UI helpers (current data)', () => {
  let gr: Gramadoir;
  before(() => { gr = new Gramadoir(loadData(path.join(root, 'data')), { fixSpelling: true }); });

  const key = (e: { ruleId: string; fromy: number; fromx: number; toy: number; tox: number }, off = 0) =>
    `${e.ruleId}|${e.fromy + off}:${e.fromx}-${e.toy + off}:${e.tox}`;

  it('chunked checking gives the same errors as checking the whole text', () => {
    const indented = '   Tá sé go maith.\n    Chonaic mé an bhean mór.\n\n  Dr. Ó Briain a bhí ann.\n  Tá an cat dubh.\nBhí an madra ag ithe\n agus an cat mór mór.';
    for (const text of [golden('edge'), golden('triail'), indented]) {
      const whole = gr.grammaticalErrors(text).map((e) => key(e));
      const chunked = chunkText(text, 0).flatMap((c) => gr.grammaticalErrors(c.text).map((e) => key(e, c.line)));
      assert.deepEqual(chunked, whole);
    }
  });

  it('folding is one code point to one code point', () => {
    const s = 'd’imigh “sé” – agus… 😀 é';
    assert.equal(Array.from(foldForEngine(s)).length, Array.from(s).length);
    assert.equal(foldForEngine('d’imigh “sé”'), 'd\'imigh "sé"');
  });

  it('curly apostrophes no longer cause false errors once folded', () => {
    const plain = gr.grammaticalErrors("D'oirfeadh sé an t-am a chaitheamh.").map((e) => e.ruleId);
    const curly = gr.grammaticalErrors(foldForEngine('D’oirfeadh sé an t-am a chaitheamh.')).map((e) => e.ruleId);
    assert.deepEqual(curly, plain);
  });

  it('every reported error lines up with the original text (golden corpora)', () => {
    for (const name of ['triail', 'corpas']) {
      const text = golden(name);
      const errors = chunkText(foldForEngine(text), 0).flatMap((c) =>
        gr.grammaticalErrors(c.text).map((e) => ({ ...e, fromy: e.fromy + c.line, toy: e.toy + c.line })));
      const { views } = analyse(text, errors);
      const bad = views.filter((v) => !v.aligned);
      assert.equal(bad.length, 0, `${name}: ${bad.length} of ${views.length} not aligned, e.g. ${JSON.stringify(bad[0])}`);
    }
  });

  it('positions stay aligned with curly quotes, emoji, tags and combining accents', () => {
    const text = 'Dúirt sé “go bhfuil sé ag teacht” agus d’imigh sé 😀. Chonaic mé an bhean mór.\n<b>Tá</b> an cat mór mór. Dia dhuit é an an.';
    const norm = text.normalize('NFC');
    const errors = chunkText(foldForEngine(norm), 0).flatMap((c) =>
      gr.grammaticalErrors(c.text).map((e) => ({ ...e, fromy: e.fromy + c.line, toy: e.toy + c.line })));
    const { views } = analyse(norm, errors);
    assert.ok(views.length >= 3);
    assert.ok(views.every((v) => v.aligned), JSON.stringify(views));
    assert.ok(views.some((v) => v.words === 'bhean mór'));
  });

  it('spelling suggestions come through and stay aligned with the text', () => {
    const text = 'Coicís sa bhaile i gCabhan agam ansin don craic!';
    const { views } = analyse(text, gr.grammaticalErrors(text));
    const v = views.find((x) => x.suggestions.length);
    assert.ok(v && v.aligned && v.words === 'gCabhan' && v.rule === 'MOLADH', JSON.stringify(views));
  });

  it('a wrong position is reported as unaligned rather than highlighted', () => {
    const [e] = gr.grammaticalErrors('Chonaic mé an bhean mór.');
    const { views, lines } = analyse('Chonaic mé an bhean mór.', [{ ...e, fromx: e.fromx + 2, tox: e.tox + 2 }]);
    assert.equal(views[0].aligned, false);
    assert.ok(lines[0].every((p) => p.ids.length === 0));
  });

  it('overlapping errors are both drawn', () => {
    const t = 'Chonaic mé an bhean mór.';
    const base = gr.grammaticalErrors(t)[0];
    // Two made-up errors over overlapping slices of t (each with its real text, or it would count as unaligned).
    const mk = (fromx: number, tox: number) => ({ ...base, fromx, tox, errortext: Array.from(t).slice(fromx, tox + 1).join('') });
    const { views, lines } = analyse(t, [mk(0, 9), mk(7, 16)]);
    assert.ok(views.every((v) => v.aligned));
    assert.ok(lines[0].some((p) => p.ids.length === 2));
  });

  for (const ex of EXAMPLES) {
    it(`example "${ex.id}" still produces ${ex.rule}`, () => {
      const rules = gr.grammaticalErrors(ex.text).map((e) => e.ruleId.replace(/^Lingua::GA::Gramadoir\//, '').replace(/\{.*$/, ''));
      assert.ok(rules.includes(ex.rule), `${ex.text} -> ${rules.join(',')}`);
      if (ex.suggests) {
        const sugg = gr.grammaticalErrors(ex.text).flatMap((e) => e.suggestions ?? []);
        assert.ok(sugg.includes(ex.suggests), `${ex.text} -> ${sugg.join(',')}`);
      }
      const fixture = ex.source.includes('edge') ? 'edge' : ex.source.includes('corpas') ? 'corpas' : 'triail';
      assert.ok(golden(fixture).includes(ex.text), 'example text must be copied from the fixture');
    });
  }
});

describe('interface text status', () => {
  it('every entry in web/strings/en.ts starts with its status', async () => {
    const { en } = await import('../web/strings/en.ts');
    const src = fs.readFileSync(path.join(root, 'web', 'strings', 'en.ts'), 'utf8');
    const entries = [...src.matchAll(/^\s*(?:\/\* *(\w+) *\*\/ *)?'([^']+)':/gm)];
    assert.deepEqual(entries.map((m) => m[2]).sort(), Object.keys(en).sort(), 'one line per key');
    const bad = entries.filter((m) => !['unreviewed', 'reviewed'].includes(m[1] ?? '')).map((m) => m[2]);
    assert.deepEqual(bad, [], 'each needs /* unreviewed */ or /* reviewed */ before its key');
  });
});
