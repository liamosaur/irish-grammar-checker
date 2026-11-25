// Web Worker: loads the data once (with real progress, cached in the Cache API
// so repeat visits skip the network), then checks text one chunk at a time so
// it can report progress, be cancelled, and reuse results for unchanged text.
import { Gramadoir } from '../src/engine.ts';
import { applyLexiconCorrections, applyOverlay, type LexiconOverlay } from '../src/lexicon.ts';
import type { GramadoirData, GrammarError } from '../src/types.ts';
import type { CheckedError } from './annotate.ts';
import { chunkText } from './chunk.ts';
import { foldForEngine } from './fold.ts';
import { addFixes, Forms, type FormsData } from './forms.ts';

import lexiconUrl from '../data/lexicon.json?url';
import overlayUrl from '../data/bunamo-overlay.json?url';
import lexiconCorrectionsUrl from '../data/lexicon-corrections.json?url';
import verbalNounsUrl from '../data/verbal-nouns.json?url';
import verbalNounsExtraUrl from '../data/verbal-nouns-extra.json?url';
import eileUrl from '../data/eile.json?url';
import earraidiUrl from '../data/earraidi.json?url';
import posUrl from '../data/pos.json?url';
import tokenUrl from '../data/token.json?url';
import morphUrl from '../data/morph.json?url';
import gramsUrl from '../data/grams.json?url';
import nocomboUrl from '../data/nocombo.json?url';
import messagesUrl from '../data/messages.json?url';
import formsUrl from '../data/forms.json?url';
import aonchiallUrl from '../data/rules/aonchiall.json?url';
import comhshuiteUrl from '../data/rules/comhshuite.json?url';
import giorrUrl from '../data/rules/giorr.json?url';
import rialachaUrl from '../data/rules/rialacha.json?url';
import unigramUrl from '../data/rules/unigram.json?url';

export type WorkerRequest = { type: 'check'; id: number; text: string } | { type: 'cancel'; id: number };
export type WorkerResponse =
  | { type: 'progress'; phase: 'download' | 'cache' | 'prepare'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'loadError'; message: string }
  | { type: 'checkProgress'; id: number; done: number; total: number }
  | { type: 'result'; id: number; errors: CheckedError[] }
  | { type: 'cancelled'; id: number }
  | { type: 'error'; id: number; message: string };

const post = (m: WorkerResponse) => (self as unknown as Worker).postMessage(m);
const CACHE_NAME = 'gramadoir-data-v1';

// ------------------------------------------------------------------ loading

const URLS = [
  lexiconUrl, eileUrl, earraidiUrl, posUrl, tokenUrl, morphUrl, gramsUrl, nocomboUrl, messagesUrl,
  aonchiallUrl, comhshuiteUrl, giorrUrl, rialachaUrl, unigramUrl, formsUrl, overlayUrl, lexiconCorrectionsUrl,
  verbalNounsUrl, verbalNounsExtraUrl,
].map((u) => new URL(u, self.location.href).href);

/** Sizes of the data files (decoded bytes), written by the build; absent in dev. */
async function loadSizes(): Promise<Record<string, number>> {
  try {
    const res = await fetch(new URL('../assets.json', URLS[0]).href);
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return {};
    return (await res.json()) as Record<string, number>;
  } catch {
    return {};
  }
}

async function openCache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null; // private browsing, insecure context, ...
  }
}

async function loadAll(): Promise<unknown[]> {
  const sizes = await loadSizes();
  const cache = await openCache();
  const known = URLS.every((u) => sizes[u.split('/').pop()!] > 0);
  const total = known ? URLS.reduce((s, u) => s + sizes[u.split('/').pop()!], 0) : URLS.length;
  let loaded = 0;
  let network = false;
  let lastPost = 0;
  const report = (force = false) => {
    const now = performance.now();
    if (!force && now - lastPost < 60) return;
    lastPost = now;
    post({ type: 'progress', phase: network ? 'download' : 'cache', loaded, total });
  };

  if (cache) {
    // Drop data from older builds (the file names change whenever the content does).
    for (const req of await cache.keys()) if (!URLS.includes(req.url)) await cache.delete(req);
  }
  report(true);

  const fetchOne = async (url: string): Promise<unknown> => {
    const hit = cache ? await cache.match(url) : undefined;
    if (hit) {
      const buf = await hit.arrayBuffer();
      if (known) loaded += buf.byteLength; else loaded += 1;
      report();
      return JSON.parse(new TextDecoder().decode(buf));
    }
    network = true;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url.split('/').pop()}: HTTP ${res.status}`);
    const parts: Uint8Array[] = [];
    let size = 0;
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      size += value.byteLength;
      if (known) loaded += value.byteLength;
      report();
    }
    if (!known) loaded += 1;
    report();
    const bytes = new Uint8Array(size);
    let off = 0;
    for (const p of parts) { bytes.set(p, off); off += p.byteLength; }
    if (cache) {
      try {
        await cache.put(url, new Response(bytes, { headers: { 'content-type': 'application/json' } }));
      } catch { /* quota: fine, just not cached */ }
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  };

  const data = await Promise.all(URLS.map(fetchOne));
  report(true);
  return data;
}

// ----------------------------------------------------------------- checking

let engine: Gramadoir | null = null;
let forms: Forms | null = null;
let cancelId = -1;
const queue: Extract<WorkerRequest, { type: 'check' }>[] = [];

/** Result per chunk of text, so unchanged paragraphs/sentences are never re-checked. */
const chunkCache = new Map<string, GrammarError[]>();
const CACHE_LIMIT = 6000;

const yieldToEvents = () => new Promise<void>((r) => setTimeout(r, 0));

async function runCheck(id: number, text: string): Promise<void> {
  try {
    const chunks = chunkText(foldForEngine(text), 0);
    const errors: CheckedError[] = [];
    let lastPost = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (cancelId === id) { post({ type: 'cancelled', id }); return; }
      const ch = chunks[i];
      let found = chunkCache.get(ch.text);
      if (found) chunkCache.delete(ch.text); // refresh LRU position
      else found = engine!.grammaticalErrors(ch.text);
      chunkCache.set(ch.text, found);
      for (const e of found) errors.push({ ...e, fromy: e.fromy + ch.line, toy: e.toy + ch.line });
      const now = performance.now();
      if (now - lastPost > 80) {
        lastPost = now;
        post({ type: 'checkProgress', id, done: i + 1, total: chunks.length });
        await yieldToEvents();
      }
    }
    while (chunkCache.size > CACHE_LIMIT) chunkCache.delete(chunkCache.keys().next().value as string);
    if (forms) addFixes(errors, forms);
    post({ type: 'result', id, errors });
  } catch (e) {
    post({ type: 'error', id, message: e instanceof Error ? e.message : String(e) });
  }
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const m = ev.data;
  if (m.type === 'cancel') { cancelId = m.id; return; }
  if (engine) void runCheck(m.id, m.text);
  else queue.push(m);
};

(async () => {
  try {
    const data = await loadAll();
    post({ type: 'progress', phase: 'prepare', loaded: 1, total: 1 });
    await yieldToEvents();
    const [lexicon, eile, earraidi, pos, token, morph, grams, nocombo, messages, aonchiall, comhshuite, giorr, rialacha, unigram, formsData, overlay, lexiconCorrections, verbalNouns, verbalNounsExtra] =
      data as [
        GramadoirData['lexicon'], GramadoirData['eile'], GramadoirData['earraidi'], GramadoirData['pos'],
        GramadoirData['token'], GramadoirData['morph'], GramadoirData['grams'], GramadoirData['nocombo'],
        GramadoirData['messages'], GramadoirData['rules']['aonchiall'], GramadoirData['rules']['comhshuite'],
        GramadoirData['rules']['giorr'], GramadoirData['rules']['rialacha'], GramadoirData['rules']['unigram'],
        FormsData, LexiconOverlay, Record<string, string>, string[], string[],
      ];
    applyOverlay(lexicon, overlay); // the BuNaMo additions (ODbL) are a separate file, merged here
    applyLexiconCorrections(lexicon, lexiconCorrections); // our own corrections (grammar/lexicon-corrections.tsv)
    forms = new Forms(formsData);
    engine = new Gramadoir({
      lexicon, eile, earraidi, pos, token, morph, grams, nocombo, messages,
      verbalNouns: [...verbalNouns, ...verbalNounsExtra], // BuNaMo's (ODbL, a separate file) and ours
      nouns: formsData.n, // BuNaMo's noun forms, for the plural hint
      rules: { aonchiall, comhshuite, giorr, rialacha, unigram },
    }, { fixSpelling: true, datives: true }); // suggest similar words for unknown words; mark a mix of dative systems
    post({ type: 'ready' });
    for (const req of queue.splice(0)) void runCheck(req.id, req.text);
  } catch (e) {
    post({ type: 'loadError', message: e instanceof Error ? e.message : String(e) });
  }
})();
