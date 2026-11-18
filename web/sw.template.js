// Service worker (generated into dist/sw.js by vite.config.ts, which fills in the build
// hash and the list of page files). It makes the page itself work offline, and
// serves its hashed scripts and styles from the cache. The large data files are
// cached by the worker script, not here, so nothing is downloaded twice.
const CACHE = 'gramadoir-shell-__BUILD__';
const SHELL = __SHELL__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL.map((p) => new URL(p, self.location).href))).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gramadoir-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith('.json')) return;

  if (req.mode === 'navigate') {
    // Network first, with the browser's own request: the page is small, a new deployment
    // shows at once, and the host sees a real page load (Cloudflare adds its analytics
    // beacon only to those). The cached copy is for when there is no network. It is kept
    // under ./ only: some hosts redirect index.html to ./, and a redirected response
    // cannot answer a page load.
    const page = new URL('./', self.location).href;
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(page, copy)); }
        return res;
      }).catch(async () => (await caches.match(page)) ?? Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});
