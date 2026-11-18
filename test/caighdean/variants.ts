// The format of test/caighdean/variants.tsv, shared by tools/derive-variants.ts (which writes it)
// and test/caighdean-variants.test.ts (which tests the reviewed rows).

export const COLUMNS = ['verdict', 'kind', 'change', 'before', 'variant', 'original', 'chapter', 'section', 'page', 'at', 'checker'] as const;
export type VariantRow = Record<(typeof COLUMNS)[number], string>;
export const VERDICTS = ['wrong', 'ok', 'skip', ''] as const;

const HEADER = `# Candidate error sentences derived from test/caighdean/chNN.json by tools/derive-variants.ts:
# one initial mutation undone in a sentence the checker accepts. Not judged by the tool.
# verdict: wrong (should be flagged), ok (correct Irish), skip (not useful), blank (not reviewed).
# checker: what the checker does now (flagged:RULE on the changed word, other:RULE elsewhere, or -).
# Edit only the verdict column; re-run tools/derive-variants.ts to refresh the checker column.
`;

export function readVariants(text: string): VariantRow[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l !== '' && !l.startsWith('#'));
  const [head, ...body] = lines;
  if (head !== COLUMNS.join('\t')) throw new Error(`variants.tsv: header must be: ${COLUMNS.join('\t')}`);
  return body.map((l, i) => {
    const cells = l.split('\t');
    if (cells.length !== COLUMNS.length) throw new Error(`variants.tsv row ${i + 1}: ${cells.length} columns, expected ${COLUMNS.length}`);
    const row = Object.fromEntries(COLUMNS.map((c, k) => [c, cells[k].trim()])) as VariantRow;
    if (!(VERDICTS as readonly string[]).includes(row.verdict)) throw new Error(`variants.tsv row ${i + 1}: verdict must be wrong, ok, skip or blank: ${row.verdict}`);
    return row;
  });
}

export function writeVariants(rows: VariantRow[]): string {
  return HEADER + [COLUMNS.join('\t'), ...rows.map((r) => COLUMNS.map((c) => r[c]).join('\t'))].join('\n') + '\n';
}

type View = { rule: string; range?: { from: number; to: number } };

/** What the checker does with a variant: "flagged:RULE" on the changed word, "other:RULE" elsewhere only, or "-". */
export function checkVariant(r: VariantRow, complaints: (text: string) => View[]): string {
  const views = complaints(r.variant);
  const from = Number(r.at);
  const to = from + Array.from(r.change.split(' → ')[1]).length;
  const onWord = views.filter((v) => v.range && v.range.from <= to && v.range.to >= from);
  if (onWord.length) return `flagged:${[...new Set(onWord.map((v) => v.rule))].join(',')}`;
  if (views.length) return `other:${[...new Set(views.map((v) => v.rule))].join(',')}`;
  return '-';
}
