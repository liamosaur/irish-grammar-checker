// Builds data/forms.json from a BuNaMo checkout: for each noun its nominative and genitive,
// singular and plural; for each adjective its nominative, masculine/feminine genitive and plural.
// Also data/verbal-nouns.json: the verbal noun of each verb (the tag set has no verbal-noun tag,
// so rules that need one use this list: the VERBALNOUN placeholder, src/engine.ts).
// The engine's lexicon says what case a word form is in but not which words belong together,
// and the web page needs that to offer "the genitive of doras is dorais".
//
// Usage: node tools/build-forms.mjs <BuNaMo-checkout> <outDir>     (e.g. .sources/bunamo/repo data)
//
// Format: { n: ["nsg|gsg|npl|gpl|gender", ...], a: ["nsg|gsgMasc|gsgFem|npl", ...] }
// A field with variants lists them separated by ","; a missing field is empty.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const [, , bunamo, outDir] = process.argv;
if (!bunamo || !outDir) {
  console.error('usage: node tools/build-forms.mjs <BuNaMo-checkout> <outDir>');
  process.exit(2);
}

const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
/** All values of <name default="..."/> elements, in file order, without duplicates. */
const values = (xml, name) => {
  const out = [];
  for (const m of xml.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))) {
    const v = attr(m[0], 'default');
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
};
const read = (dir) => fs.readdirSync(path.join(bunamo, dir)).filter((f) => f.endsWith('.xml'))
  .map((f) => fs.readFileSync(path.join(bunamo, dir, f), 'utf8').replace(/^﻿/, ''));

const nouns = new Set();
for (const xml of read('noun')) {
  const sgNom = values(xml, 'sgNom');
  if (!sgNom.length) continue;
  const gender = attr(/<sgNom\b[^>]*>/.exec(xml)[0], 'gender') ?? '';
  const row = [sgNom, values(xml, 'sgGen'), values(xml, 'plNom'), values(xml, 'plGen')].map((v) => v.join(','));
  nouns.add(`${row.join('|')}|${gender === 'masc' ? 'm' : gender === 'fem' ? 'f' : ''}`);
}

const adjectives = new Set();
for (const xml of read('adjective')) {
  const sgNom = values(xml, 'sgNom');
  if (!sgNom.length) continue;
  adjectives.add([sgNom, values(xml, 'sgGenMasc'), values(xml, 'sgGenFem'), values(xml, 'plNom')].map((v) => v.join(',')).join('|'));
}

const verbalNouns = new Set();
for (const xml of read('verb')) for (const v of values(xml, 'verbalNoun')) verbalNouns.add(v);

const out = { n: [...nouns].sort(), a: [...adjectives].sort() };
fs.mkdirSync(outDir, { recursive: true });
const json = JSON.stringify(out);
fs.writeFileSync(path.join(outDir, 'forms.json'), json);
console.log(`nouns ${out.n.length}, adjectives ${out.a.length}, ${(json.length / 1024).toFixed(0)} KB (${(zlib.gzipSync(json).length / 1024).toFixed(0)} KB gzipped)`);
fs.writeFileSync(path.join(outDir, 'verbal-nouns.json'), JSON.stringify([...verbalNouns].sort()));
console.log(`verbal nouns ${verbalNouns.size}`);
