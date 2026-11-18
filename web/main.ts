import { analyse, type CheckedError, type ErrorView } from './annotate.ts';
import { APP_NAME, WARN_CHARS } from './config.ts';
import { applyCorrection, type Plan, planReplacement, proposeFix, QUOTES_REPLACEMENT, quotedParts, sliceRange, withLastWord } from './corrections.ts';
import { EXAMPLES } from './examples.ts';
import { unreadableCount } from './fold.ts';
import { applyStrings, currentLocale, localeIsComplete, t, tn } from './strings.ts';
import type { WorkerRequest, WorkerResponse } from './worker.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = $<HTMLTextAreaElement>('input');
const checkBtn = $<HTMLButtonElement>('check');
const statusEl = $('status');
const annotated = $('annotated');
const list = $('list');

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const setState = (s: string) => { document.body.dataset.state = s; };
const setStatus = (s: string, fail = false) => { statusEl.textContent = s; statusEl.classList.toggle('fail', fail); };
const show = (el: HTMLElement, on: boolean) => { el.hidden = !on; };

// ------------------------------------------------------------------ set-up

document.documentElement.lang = localeIsComplete() ? currentLocale() : 'en';
applyStrings();
document.title = t('page.title');
$('brand').textContent = APP_NAME;
$('brand').setAttribute('aria-label', t('nav.home'));

let exampleAt = Math.floor(Math.random() * EXAMPLES.length);
$('example').addEventListener('click', () => {
  input.value = EXAMPLES[exampleAt++ % EXAMPLES.length].text;
  updateCount();
  check();
});

// About / How it works dialogs
document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((b) => {
  b.addEventListener('click', () => $<HTMLDialogElement>(b.dataset.open!).showModal());
});
document.querySelectorAll('dialog').forEach((d) => {
  d.addEventListener('click', (e) => {
    if (e.target === d) { d.close(); return; } // click on the backdrop
    // A link such as [About](#about) switches from this dialog to that one.
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    const target = a && document.getElementById(a.getAttribute('href')!.slice(1));
    if (target instanceof HTMLDialogElement) {
      e.preventDefault();
      d.close();
      target.showModal();
    }
  });
});

// ---------------------------------------------------------- worker + loading

let worker: Worker | null = null;
let ready = false;
let pendingCheck = false;
let nextId = 1;
let activeId = 0;
let checkingTimer = 0;

function startWorker() {
  worker?.terminate();
  ready = false;
  setState('loading');
  show($('load-bar'), true);
  show($('load-detail'), true);
  show($('loading-failed'), false);
  const bar = $<HTMLProgressElement>('load-bar');
  bar.removeAttribute('value');
  $('load-detail').textContent = t('status.loading');

  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<WorkerResponse>) => onWorker(ev.data);
  worker.onerror = (ev) => { ev.preventDefault(); onWorker({ type: 'loadError', message: ev.message || t('loading.crashed') }); };
}

function onWorker(m: WorkerResponse) {
  switch (m.type) {
    case 'progress': {
      const bar = $<HTMLProgressElement>('load-bar');
      if (m.phase === 'prepare') {
        bar.removeAttribute('value');
        $('load-detail').textContent = t('loading.prepare');
        show($('load-first'), false);
      } else {
        const pct = Math.min(100, Math.round((m.loaded / m.total) * 100));
        bar.value = pct;
        $('load-detail').textContent = m.phase === 'cache' ? t('loading.fromCache') : t('loading.download', { pct });
        show($('load-first'), m.phase === 'download');
      }
      break;
    }
    case 'ready':
      ready = true;
      if (document.body.dataset.state === 'loading') { setState('ready'); setStatus(''); }
      if (pendingCheck) { pendingCheck = false; check(); }
      break;
    case 'loadError':
      setState('load-error');
      show($('load-bar'), false);
      show($('load-detail'), false);
      show($('load-first'), false);
      show($('loading-failed'), true);
      $('load-error-detail').textContent = t('loading.fail.body', { message: m.message });
      setStatus('');
      break;
    case 'checkProgress':
      if (m.id !== activeId) break;
      showCheckingProgress(Math.round((m.done / m.total) * 100));
      break;
    case 'result':
      if (m.id !== activeId) break;
      finishChecking();
      showResults(checkedText, m.errors);
      break;
    case 'cancelled':
      if (m.id !== activeId) break;
      finishChecking();
      backToEditor(false);
      setStatus('');
      break;
    case 'error':
      if (m.id !== activeId) break;
      finishChecking();
      backToEditor(false);
      setStatus(t('status.error', { message: m.message }), true);
      break;
  }
}

$('retry').addEventListener('click', startWorker);

// ---------------------------------------------------------------- checking

let checkedText = '';
let last: { text: string; errors: CheckedError[] } | null = null;

/** The text the engine sees and the UI draws: same line endings, composed accents. */
const normalise = (s: string) => s.replace(/\r\n?/g, '\n').normalize('NFC');

function check() {
  const text = normalise(input.value);
  if (!text.trim()) { setStatus(t('status.empty')); input.focus(); return; }
  if (last && last.text === text) {
    checkedText = text;
    showResults(text, last.errors);
    return;
  }
  if (!ready) { pendingCheck = true; setStatus(t('status.waiting')); return; }
  checkedText = text;
  // Remember how tall the text box is, so the results text doesn't shrink below it.
  if (!$('editor').hidden && input.offsetHeight) annotated.style.minHeight = `${input.offsetHeight}px`;
  activeId = nextId++;
  setState('checking');
  setStatus(t('status.checkingShort'));
  checkBtn.disabled = true;
  // Quick checks never flash a progress panel; slow ones get one after a moment.
  window.clearTimeout(checkingTimer);
  checkingTimer = window.setTimeout(() => {
    if (!$('results').hidden) return; // re-checking after a correction: leave the text where it is
    show($('editor'), false);
    show($('checking'), true);
    showCheckingProgress(0);
    $('cancel').focus();
  }, 250);
  worker!.postMessage({ type: 'check', id: activeId, text } satisfies WorkerRequest);
}

function showCheckingProgress(pct: number) {
  $('checking-label').textContent = t('status.checking', { pct });
  $<HTMLProgressElement>('check-bar').value = pct;
}

function finishChecking() {
  window.clearTimeout(checkingTimer);
  show($('checking'), false);
  checkBtn.disabled = false;
}

$('cancel').addEventListener('click', () => { if (worker) worker.postMessage({ type: 'cancel', id: activeId } satisfies WorkerRequest); });
checkBtn.addEventListener('click', check);
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); check(); } });

function updateCount() {
  const n = Array.from(input.value).length;
  show($('clear'), n > 0);
  if (n > WARN_CHARS) setStatus(t('editor.long'));
  else if (statusEl.textContent === t('editor.long')) setStatus('');
}
input.addEventListener('input', updateCount);
$('clear').addEventListener('click', () => { input.value = ''; updateCount(); setStatus(''); input.focus(); });

// ----------------------------------------------------------------- results

const SHOW_SUGGESTIONS = 3;
let views: ErrorView[] = [];
let selected = -1;
let multiLine = false;
const marksFor = new Map<number, HTMLElement[]>();

function showResults(text: string, errors: CheckedError[]) {
  last = { text, errors };
  const a = analyse(text, errors);
  views = a.views;
  selected = -1;
  marksFor.clear();

  // Highlighted text
  annotated.textContent = '';
  a.lines.forEach((pieces, y) => {
    for (const p of pieces) {
      if (!p.ids.length) { annotated.append(p.text); continue; }
      const mk = document.createElement('mark');
      mk.dataset.ids = p.ids.join(',');
      mk.append(p.text);
      for (const id of p.ends) {
        const sr = document.createElement('span');
        sr.className = 'sr';
        sr.textContent = ` (${t('err.sr', { n: id + 1 })})`;
        mk.append(sr);
      }
      for (const id of p.ids) { (marksFor.get(id) ?? marksFor.set(id, []).get(id)!).push(mk); }
      annotated.append(mk);
    }
    if (y < a.lines.length - 1) annotated.append('\n');
  });

  // List
  list.textContent = '';
  views.forEach((v) => list.append(listItem(v)));

  // Summary and notes
  const n = errors.length;
  $('summary').textContent = n === 0 ? t('result.none') : tn('result.count', n);
  multiLine = text.includes('\n');
  $('text-group').textContent = n === 0 ? t('text.group.none') : tn('text.group', n);
  show($('note-none'), n === 0);
  show(list, n > 0);
  const unread = unreadableCount(text);
  show($('note-unreadable'), unread > 0);
  if (unread > 0) $('note-unreadable').textContent = tn('result.unreadable', unread);

  show($('editor'), false);
  show($('results'), true);
  setState('done');
  setStatus('');
  checkBtn.disabled = false;
  $('summary').focus({ preventScroll: true });
}

/** A button that puts `replacement` into the user's text, where the flagged words are (or the part of them it stands for). */
function replaceButton(v: ErrorView, replacement: string, stop = false): HTMLButtonElement {
  const line = v.range ? (checkedText.split('\n')[v.range.y] ?? '') : '';
  const plan = v.range ? planReplacement(line, v.range, replacement) : null;
  const b = document.createElement('button');
  b.className = 'sugg-word';
  b.lang = 'ga';
  b.type = 'button';
  b.textContent = plan?.word ?? replacement;
  b.title = t('sugg.apply', { word: b.textContent });
  b.addEventListener('click', (e) => { if (stop) e.stopPropagation(); if (plan) applyPlan(plan); });
  return b;
}

/** Message text with the /word/ parts the engine uses to quote Irish words set apart (as buttons when `v` can take them). */
function formatMessage(msg: string, v?: ErrorView): DocumentFragment {
  const frag = document.createDocumentFragment();
  const re = /\/([^/]+)\//g;
  let at = 0;
  for (let m = re.exec(msg); m; m = re.exec(msg)) {
    if (m.index > at) frag.append(msg.slice(at, m.index));
    if (!v) {
      const q = document.createElement('span');
      q.className = 'tok';
      q.lang = 'ga';
      q.textContent = m[1];
      frag.append(q);
    } else {
      for (const part of quotedParts(m[1])) {
        if (!part.option) { frag.append(part.text); continue; }
        const q = replaceButton(v, part.text);
        frag.append(q);
      }
    }
    at = m.index + m[0].length;
  }
  if (at < msg.length) frag.append(msg.slice(at));
  return frag;
}

function listItem(v: ErrorView): HTMLLIElement {
  const replaceable = !!v.range && QUOTES_REPLACEMENT.has(v.rule);
  const flagged = v.range ? sliceRange(checkedText, v.range) : null;
  // What the rule asks for, as the full flagged text: the genitive for "genitive required", the mutated form for "Lenition missing", ...
  const proposals: string[] = [];
  if (flagged !== null) {
    for (const w of v.fixes) { const p = withLastWord(flagged, w); if (p !== null) proposals.push(p); }
    if (!proposals.length) { const p = proposeFix(v.rule, flagged); if (p !== null) proposals.push(p); }
  }
  const standalone = v.suggestions.length > 0 || replaceable || proposals.length > 0; // message sits beside the row button, not inside it
  const li = document.createElement('li');
  li.className = 'err';
  li.dataset.idx = String(v.idx);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'err-btn';
  const sr = document.createElement('span');
  sr.className = 'sr';
  sr.textContent = `${t('err.sr', { n: v.idx + 1 })}: `;
  const words = document.createElement('span');
  words.className = 'words';
  words.lang = 'ga';
  words.textContent = v.words;
  const msg = document.createElement('span');
  msg.className = 'msg';
  if (v.suggestions.length) {
    // One line: “ta” – Did you mean tá?
    msg.append(' – ', t('sugg.label'), ' ');
    v.suggestions.slice(0, SHOW_SUGGESTIONS).forEach((w, i) => {
      if (i) msg.append(', ');
      if (v.range) msg.append(replaceButton(v, w, true));
      else {
        const s = document.createElement('span');
        s.className = 'sugg-word';
        s.lang = 'ga';
        s.textContent = w;
        msg.append(s);
      }
    });
    msg.append('?');
  } else msg.append(' – ', formatMessage(v.msg, replaceable ? v : undefined));
  proposals.forEach((proposal, i) => {
    const fix = document.createElement('button');
    fix.className = 'sugg-word';
    fix.lang = 'ga';
    fix.type = 'button';
    fix.textContent = proposal;
    fix.title = t('sugg.apply', { word: proposal });
    fix.addEventListener('click', () => applyPlan({ range: v.range!, word: proposal }));
    msg.append(i ? ', ' : ': ', fix);
  });
  const where = document.createElement('span');
  where.className = 'where';
  where.textContent = t('list.line', { n: v.line });
  // Suggestion buttons cannot live inside another button, so for those notes the message sits beside it.
  const row = document.createElement('div');
  row.className = 'err-row';
  const inside = standalone ? row : btn;
  btn.append(sr, words);
  if (standalone) row.append(btn, msg); else { btn.append(msg); row.append(btn); }
  if (multiLine) inside.append(' ', where);
  if (!v.aligned) {
    const warn = document.createElement('span');
    warn.className = 'unaligned';
    warn.textContent = t('list.unaligned');
    inside.append(warn);
  }
  btn.addEventListener('click', () => select(v.idx, 'list'));

  li.append(row);
  return li;
}

/** Puts the planned replacement into the user's text, then checks again. */
function applyPlan(plan: Plan) {
  const next = applyCorrection(checkedText, plan.range, plan.word);
  if (next === null) return;
  input.value = next;
  updateCount();
  check();
}

function select(idx: number, from: 'list' | 'text' | 'key') {
  selected = idx;
  annotated.querySelectorAll('mark.active').forEach((n) => n.classList.remove('active'));
  list.querySelectorAll('li.active').forEach((n) => { n.classList.remove('active'); n.querySelector('button')!.removeAttribute('aria-current'); });
  const marks = marksFor.get(idx) ?? [];
  marks.forEach((m) => m.classList.add('active'));
  const li = list.querySelector<HTMLElement>(`li[data-idx="${idx}"]`);
  li?.classList.add('active');
  li?.querySelector('button')?.setAttribute('aria-current', 'true');
  const behavior = reducedMotion() ? 'auto' : 'smooth';
  if (from === 'list') marks[0]?.scrollIntoView({ block: 'center', behavior });
  else li?.scrollIntoView({ block: from === 'key' ? 'nearest' : 'center', behavior });
  if (from === 'key') marks[0]?.scrollIntoView({ block: 'nearest', behavior });
}

annotated.addEventListener('click', (e) => {
  const mk = (e.target as HTMLElement).closest('mark');
  if (!mk || !getSelection()?.isCollapsed) return;
  const ids = mk.dataset.ids!.split(',').map(Number);
  const at = ids.indexOf(selected);
  select(at >= 0 ? ids[(at + 1) % ids.length] : ids[0], 'text');
});

annotated.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k !== 'n' && k !== 'p') return;
  const shown = views.filter((v) => v.aligned).map((v) => v.idx);
  if (!shown.length) return;
  e.preventDefault();
  const at = shown.indexOf(selected);
  const next = k === 'n' ? (at + 1) % shown.length : (at <= 0 ? shown.length - 1 : at - 1);
  select(shown[next], 'key');
});

function backToEditor(focus: boolean) {
  show($('results'), false);
  show($('editor'), true);
  setState(ready ? 'ready' : 'loading');
  if (focus) input.focus();
}
$('edit').addEventListener('click', () => { setStatus(''); backToEditor(true); });

// -------------------------------------------------------------------- go

updateCount();
startWorker();

// Offline support and instant repeat visits (production build only: the file
// is generated by vite.config.ts).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* optional */ }); });
}
