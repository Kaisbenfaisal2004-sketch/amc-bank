// Offline copy of the app itself (questions are kept by Firebase on the device, not here). Answers from the stored copy straight away,
// and refreshes that copy in the background whenever the internet is available.
const CACHE = 'qbank-v2';
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'sync.js', 'config.js', 'vendor/firebase.js', 'manifest.webmanifest',
  'fonts/atkinson-hyperlegible-latin-400-normal.woff2', 'fonts/atkinson-hyperlegible-latin-700-normal.woff2',
  'fonts/atkinson-hyperlegible-latin-400-italic.woff2', 'fonts/ibm-plex-mono-latin-500-normal.woff2',
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
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.search && req.mode !== 'navigate') return;   // only the app's own files are kept offline
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req.mode === 'navigate' ? 'index.html' : req);
    const fresh = fetch(req, { cache: 'no-cache' }).then(res => {
      if (res && res.ok) c.put(req.mode === 'navigate' ? 'index.html' : req, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(fresh); return hit; }
    const res = await fresh;
    if (res) return res;
    if (req.mode === 'navigate') return (await c.match('index.html')) || Response.error();
    return Response.error();
  })());
});
