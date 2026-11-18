// Shows how our files in grammar/ differ from the upstream An Gramadóir files they
// were copied from (in the checkout given, Latin-1).
//
// Usage: node tools/upstream-diff.mjs <upstream-checkout> [rialacha|aonchiall|comhshuite|macra ...]
//   default: all four. Output is a unified diff (git diff --no-index).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , up, ...names] = process.argv;
if (!up) { console.error('usage: node tools/upstream-diff.mjs <upstream-checkout> [rialacha|aonchiall|comhshuite|macra ...]'); process.exit(2); }
const FILES = { rialacha: 'rialacha-ga.in', aonchiall: 'aonchiall-ga.in', comhshuite: 'comhshuite-ga.in', macra: 'macra-ga.meta.pl' };
const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-diff-'));

for (const name of names.length ? names : Object.keys(FILES)) {
  const file = FILES[name];
  if (!file) throw new Error(`unknown file: ${name}`);
  // The upstream file as UTF-8 with LF line endings, so that only real changes show.
  const upstream = path.join(tmp, 'upstream', file);
  fs.mkdirSync(path.dirname(upstream), { recursive: true });
  fs.writeFileSync(upstream, fs.readFileSync(path.join(up, 'ga', file)).toString('latin1').replace(/\r/g, ''), 'utf8');
  const ours = path.join(here, '..', 'grammar', file);
  const r = spawnSync('git', ['diff', '--no-index', '--no-color', upstream, ours], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write(r.stdout);
}
fs.rmSync(tmp, { recursive: true, force: true });
