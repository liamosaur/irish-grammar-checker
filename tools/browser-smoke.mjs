// Smoke test: loads the built site in headless Edge/Chrome via the DevTools
// protocol, types the given text into the text box and presses Check, waits for
// the worker to finish checking, prints the results and (optionally) saves a
// screenshot.
//
// Usage: node tools/browser-smoke.mjs <url> <text> [screenshot.png]
//   env BROWSER = path to msedge/chrome executable
//   env WIDTH, HEIGHT = emulate a viewport (WIDTH under 600 also emulates a phone)
//   env SCHEME = light | dark (prefers-color-scheme)
//   env FULL = 1 to screenshot the whole page, not just the viewport
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [, , url, text, shot] = process.argv;
const exe =
  process.env.BROWSER ??
  ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(fs.existsSync);
if (!url || !text || !exe) { console.error('usage: node tools/browser-smoke.mjs <url> <text> [shot.png]  (set BROWSER if needed)'); process.exit(2); }

const port = 9222 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-smoke-'));
const proc = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu', '--window-size=1000,900', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); }
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;

  await send('Runtime.enable');
  await send('Page.enable');
  if (process.env.WIDTH) {
    const width = Number(process.env.WIDTH);
    await send('Emulation.setDeviceMetricsOverride', { width, height: Number(process.env.HEIGHT ?? 900), deviceScaleFactor: 1, mobile: width < 600 });
  }
  if (process.env.SCHEME) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: process.env.SCHEME }] });
  await send('Page.navigate', { url });
  // Once the page script is running, check the text as a user would (it waits for the checker to load).
  for (let i = 0; i < 60 && !(await evalJs("document.readyState === 'complete' && !!document.getElementById('check')")); i++) await sleep(250);
  await evalJs(`(() => {
    const input = document.getElementById('input');
    input.value = ${JSON.stringify(text)};
    input.dispatchEvent(new Event('input'));
    document.getElementById('check').click();
  })()`);
  let state = '';
  for (let i = 0; i < 120; i++) {
    // A failed check goes back to the editor with a failure message in the status line.
    state = await evalJs("document.getElementById('status').classList.contains('fail') ? 'error' : document.body.dataset.state");
    if (state === 'done' || state === 'error' || state === 'load-error') break;
    await sleep(500);
  }
  const report = await evalJs(`JSON.stringify({
    state: document.body.dataset.state,
    status: document.getElementById('status').textContent,
    annotated: document.getElementById('annotated').innerText,
    marks: [...document.querySelectorAll('#annotated mark')].map(m => m.textContent),
    errors: [...document.querySelectorAll('#list li')].map(li => li.innerText.replace(/\\n/g,' | ')),
  }, null, 2)`);
  console.log(report);
  if (logs.length) console.log('console:', logs);
  if (shot) {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!process.env.FULL });
    fs.writeFileSync(shot, Buffer.from(r.result.data, 'base64'));
    console.log('screenshot ->', shot);
  }
  ws.close();
  return state;
}

main().then((s) => { proc.kill(); process.exit(s === 'done' ? 0 : 1); }).catch((e) => { console.error(e); proc.kill(); process.exit(1); });
