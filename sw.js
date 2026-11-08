// Offline copy of the app itself (questions are kept by Firebase on the device, not here). Answers from the stored copy straight away,
// and refreshes that copy in the background whenever the internet is available.
const CACHE = 'qbank-v11';
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'sync.js', 'config.js', 'vendor/firebase.js', 'manifest.webmanifest',
  'fonts/inter-tight-latin-400-normal.woff2', 'fonts/inter-tight-latin-500-normal.woff2', 'fonts/inter-tight-latin-600-normal.woff2',
  'fonts/inter-tight-latin-700-normal.woff2', 'fonts/inter-tight-latin-800-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('qbank-') && k !== CACHE) await caches.delete(k);   // leave the reading app's cache alone
    await self.clients.claim();
  })());
});

const SCOPE = new URL('./', self.location).pathname;           // e.g. /amc-bank/
const SHELL_PATHS = new Set(SHELL.map(u => new URL(u, self.location).pathname));

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const isApp = req.mode === 'navigate' && (url.pathname === SCOPE || url.pathname === SCOPE + 'index.html');
  // only the app page and the app's own files are kept offline; anything else goes straight to the network
  if (!isApp && (url.search || !SHELL_PATHS.has(url.pathname))) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const key = isApp ? 'index.html' : req;
    const hit = await c.match(key);
    const fresh = fetch(req, { cache: 'no-cache' }).then(res => {
      const html = (res.headers.get('content-type') || '').startsWith('text/html');
      if (res && res.ok && !res.redirected && (!isApp || html)) c.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(fresh); return hit; }
    const res = await fresh;
    return res || Response.error();
  })());
});
