// Example sentences. The Irish is NOT written here: every sentence is copied
// verbatim from the test fixtures in test/golden/ (`source` gives the line of the
// fixture's text). test/web.test.ts checks that each example still produces its
// expected rule, so the list cannot silently go stale.

export interface Example {
  id: string;
  text: string;
  /** Set when the example should also come with spelling suggestions. */
  suggests?: string;
  /** Rule the engine is expected to report (see test/web.test.ts). */
  rule: string;
  /** Where the sentence was copied from. */
  source: string;
}

export const EXAMPLES: Example[] = [
  { id: 'seimhiu', rule: 'SEIMHIU', source: 'test/golden/edge.json, text line 8', text: 'Chonaic mé an bhean mór.' },
  { id: 'dubailte', rule: 'DUBAILTE', source: 'test/golden/triail.json, text line 3', text: 'Tabhair go leor leor de na na rudaí do do chara, a Chaoimhín.' },
  { id: 'genitive', rule: 'GENITIVE', source: 'test/golden/triail.json, text line 32', text: 'Scriúáil sé an glas seo ar chúl an doras.' },
  { id: 'nitee', rule: 'NITEE', source: 'test/golden/triail.json, text line 39', text: 'Tá ceacht stairiúil uathúil do chuairteoirí san t-ionad seo.' },
  { id: 'moladh', rule: 'MOLADH', suggests: 'gCabhán', source: 'test/golden/corpas.json, text line 80', text: 'Coicís sa bhaile i gCabhan agam ansin don craic!' },
  { id: 'micheart', rule: 'MICHEART', source: 'test/golden/triail.json, text line 20', text: 'Sílim nárbh ea, agus is docha nach bhfuil i gceist ach easpa smaoinimh.' },
];
