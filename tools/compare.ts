// Parity harness: runs the original Perl engine (via a local CPAN build) and the
// TypeScript port on the same text and diffs the tagged-XML and API outputs.
//
// Usage: node tools/compare.ts <textfile> [--perl-dist <dir>] [--verbose]
//   env GRAMADOIR_PERL_DIST = path to the Lingua-GA-Gramadoir-0.70 build
//   env PERL_BIN            = perl executable (default: perl)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gramadoir } from '../src/engine.ts';
import { loadData } from '../src/node-data.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

export function perlOutput(file: string, mode: '--xml' | '--api', dist: string): string {
  const perl = process.env.PERL_BIN ?? 'perl';
  return execFileSync(
    perl,
    ['-Ilib', '-Ifakelib', 'scripts/gram-ga.pl', '--incode=utf-8', '--outcode=utf-8', '--interface=en', mode, file],
    { cwd: dist, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}

export function perlXmlSentences(out: string): string[] {
  const lines = out.replace(/\r\n/g, '\n').split('\n');
  return lines.filter((l) => l.startsWith('<line>'));
}

export function perlApiErrors(out: string): Record<string, string>[] {
  const res: Record<string, string>[] = [];
  for (const m of out.matchAll(/<error ([^>]*?)\/>/g)) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/(\w+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    res.push(attrs);
  }
  return res;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'))!;
  const distIdx = args.indexOf('--perl-dist');
  const dist = distIdx >= 0 ? args[distIdx + 1] : process.env.GRAMADOIR_PERL_DIST;
  if (!file || !dist) {
    console.error('usage: node tools/compare.ts <textfile> --perl-dist <dir>   (or set GRAMADOIR_PERL_DIST)');
    process.exit(2);
  }
  const verbose = args.includes('--verbose');
  const abs = path.resolve(file);
  const text = fs.readFileSync(abs, 'utf8');
  const gr = new Gramadoir(loadData(path.join(here, '..', 'data', 'legacy-0.70'), path.join(here, '..', 'data'), { overlay: false }), { hyphenFix: false, skipDigitWords: false, compoundLenition: false, nonStandardCompounds: true, namedParts: false, rareNeedsMatch: false, derivedWords: true }); // Perl 0.70 oracle

  const perlXml = perlXmlSentences(perlOutput(abs, '--xml', dist));
  const tsXml = gr.xmlStream(text);
  let bad = 0;
  const n = Math.max(perlXml.length, tsXml.length);
  for (let i = 0; i < n; i++) {
    if (perlXml[i] !== tsXml[i]) {
      bad++;
      console.log(`XML MISMATCH sentence ${i}\n  perl: ${perlXml[i]}\n  ts:   ${tsXml[i]}`);
    } else if (verbose) console.log(`ok ${i}: ${tsXml[i]}`);
  }
  console.log(`xml: ${n - bad}/${n} sentences identical`);

  const perlErr = perlApiErrors(perlOutput(abs, '--api', dist));
  const tsErr = gr.grammaticalErrors(text);
  const strip = (e: Record<string, unknown>) =>
    ['fromy', 'fromx', 'toy', 'tox', 'ruleId', 'msg', 'contextoffset', 'errorlength'].map((k) => `${k}=${e[k]}`).join(' ');
  let ebad = 0;
  const en = Math.max(perlErr.length, tsErr.length);
  for (let i = 0; i < en; i++) {
    const a = perlErr[i] ? strip(perlErr[i]) : '(none)';
    const b = tsErr[i] ? strip(tsErr[i] as unknown as Record<string, unknown>) : '(none)';
    if (a !== b) {
      ebad++;
      console.log(`API MISMATCH ${i}\n  perl: ${a}\n  ts:   ${b}`);
    }
  }
  console.log(`api: ${en - ebad}/${en} errors identical`);
  process.exit(bad || ebad ? 1 : 0);
}
