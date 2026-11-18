// Builds test/spelling/perl-golden.json from real Perl output (with the real String::Approx, see tools/perl-wsl.sh).
// Usage: node tools/make-golden-spelling.ts <sentences.txt> <perl --api --aspell output.xml> [maxLines]
// Keeps only the first maxLines sentences if given. Suggestion order in the Perl output is random; the test
// compares suggestions as sets.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { perlApiErrors } from './compare.ts';

const [, , wordsFile, perlFile, max] = process.argv;
let lines = fs.readFileSync(wordsFile, 'utf8').split('\n').filter(Boolean);
const errors = perlApiErrors(fs.readFileSync(perlFile, 'utf8'));
if (max) lines = lines.slice(0, Number(max));
// Perl reports the whole input as the "context" of every error when the sentences are consecutive lines, which
// would copy the document into every entry; the test does not compare it.
const keep = errors.filter((e) => Number(e.fromy) < lines.length).map(({ context: _context, ...rest }) => rest);
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test', 'spelling', 'perl-golden.json');
fs.writeFileSync(out, JSON.stringify({ text: lines.join('\n'), api: keep }));
console.log(`wrote ${lines.length} sentences, ${keep.length} Perl errors (${keep.filter((e) => e.ruleId.includes('MOLADH')).length} suggestions) to ${out}`);
