// A local search corpus from the Gaois parallel corpus of Irish legislation (TMX files from
// https://www.gaois.ie/en/corpora/parallel/data/, unzipped under .sources/gaois/raw). Used to look
// for evidence of usage (which prepositions govern a verbal-noun clause, ...), not as test data:
// the texts are copyright Government of Ireland and are not copied into the repository. Older
// texts predate An Caighdeán Oifigiúil (2017), so counts are reported by period.
//
// Usage:
//   node tools/gaois-corpus.mjs extract <rawDir> <corpus.tsv>
//       every Irish segment, once: collection, source, year (or ?), text
//   node tools/gaois-corpus.mjs search <corpus.tsv> <regex> [examples=3]
//       segments matching the regex (case-insensitive, Unicode), counted by period, with
//       examples from the most recent period first; the match is shown in [brackets]
import fs from 'node:fs';
import path from 'node:path';

const [cmd, a, b, c] = process.argv.slice(2);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

if (cmd === 'extract') {
  const files = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.tmx') && files.push(path.join(d, e.name))));
  walk(a);
  const seen = new Set();
  const out = fs.createWriteStream(b);
  let n = 0;
  for (const f of files.sort()) {
    const xml = new TextDecoder('utf-16le').decode(fs.readFileSync(f)).replace(/^﻿/, '');
    for (const m of xml.matchAll(/<tu [^>]*>([\s\S]*?)<\/tu>/g)) {
      const tu = m[1];
      const ga = /<tuv xml:lang="ga">\s*<seg>([\s\S]*?)<\/seg>/.exec(tu)?.[1];
      if (!ga) continue;
      const text = decode(ga).replace(/\s+/g, ' ').trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      const collection = (/<prop type="collection">([^<|]*)/.exec(tu)?.[1] ?? '').trim();
      const source = (/<prop type="source">([^<]*)<\/prop>/.exec(tu)?.[1] ?? '').trim();
      const year = /(?:^|\D)((?:19|20)\d\d)(?:\D|$)/.exec(source)?.[1] ?? '?';
      out.write(`${collection}\t${source}\t${year}\t${text.replace(/\t/g, ' ')}\n`);
      n++;
    }
  }
  out.end();
  console.log(`${files.length} files, ${n} distinct Irish segments -> ${b}`);
} else if (cmd === 'search') {
  const re = new RegExp(b, 'iu');
  const max = Number(c ?? 3);
  const period = (y) => (y === '?' ? 'unknown' : y < '1958' ? '1922-1957' : y < '2012' ? '1958-2011' : '2012-');
  const hits = {};
  for (const line of fs.readFileSync(a, 'utf8').split('\n')) {
    if (!line) continue;
    const [, source, year, text] = line.split('\t');
    const m = re.exec(text);
    if (!m) continue;
    (hits[period(year)] ??= []).push(`${text.slice(Math.max(0, m.index - 40), m.index)}[${m[0]}]${text.slice(m.index + m[0].length, m.index + m[0].length + 30)}  (${source})`);
  }
  const order = ['2012-', '1958-2011', '1922-1957', 'unknown'];
  console.log(order.map((p) => `${p}: ${hits[p]?.length ?? 0}`).join('   '));
  for (const p of order) for (const h of (hits[p] ?? []).slice(0, max)) console.log(`  ${p}  …${h}`);
} else {
  console.error('usage: node tools/gaois-corpus.mjs extract <rawDir> <corpus.tsv> | search <corpus.tsv> <regex> [examples]');
  process.exit(2);
}
