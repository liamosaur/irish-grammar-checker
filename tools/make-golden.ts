// Records the Perl engine's output for a text file as a golden test fixture, so
// the parity tests can run without Perl installed.
//
// Usage: node tools/make-golden.ts <name> <textfile> --perl-dist <dir>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { perlApiErrors, perlOutput, perlXmlSentences } from './compare.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const [name, file] = args;
const distIdx = args.indexOf('--perl-dist');
const dist = distIdx >= 0 ? args[distIdx + 1] : process.env.GRAMADOIR_PERL_DIST;
if (!name || !file || !dist) {
  console.error('usage: node tools/make-golden.ts <name> <textfile> --perl-dist <dir>');
  process.exit(2);
}
const abs = path.resolve(file);
const golden = {
  generatedFrom: 'Lingua::GA::Gramadoir 0.70 (Perl)',
  text: fs.readFileSync(abs, 'utf8'),
  xml: perlXmlSentences(perlOutput(abs, '--xml', dist)),
  api: perlApiErrors(perlOutput(abs, '--api', dist)),
};
const outDir = path.join(here, '..', 'test', 'golden');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(golden));
console.log(`${name}: ${golden.xml.length} sentences, ${golden.api.length} errors`);
