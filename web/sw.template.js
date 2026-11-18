// Service worker (generated into dist/sw.js by vite.config.ts, which fills in the build
// hash and the list of page files). It only makes the page itself work offline
// and load instantly on repeat visits. The large data files are cached by the
// worker script, not here, so nothing is downloaded twice.
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
    // Show the cached page at once and refresh it in the background.
    const page = new URL('./index.html', self.location).href;
    event.respondWith(
      caches.open(CACHE).then(async (c) => {
        const cached = await c.match(page);
        const fresh = fetch(new URL('./', self.location).href).then((res) => {
          if (res.ok) c.put(page, res.clone());
          return res;
        });
        if (cached) { fresh.catch(() => {}); return cached; }
        return fresh;
      }),
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
