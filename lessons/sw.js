// Offline copy of the lessons app itself (the lessons are kept by Firebase on the device, not here).
// Answers from the stored copy straight away, and refreshes it in the background when online.
const CACHE = 'lessons-v8';
const SHELL = [
  './', 'index.html', 'lesson.html', 'app.css', 'app.js', 'lesson.js', 'store.js', '../config.js', '../vendor/firebase.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  '../library/fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2','../library/fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2','../library/fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2',
  '../library/fonts/ibm-plex-sans-arabic-latin-400-normal.woff2','../library/fonts/ibm-plex-sans-arabic-latin-600-normal.woff2','../library/fonts/ibm-plex-sans-arabic-latin-700-normal.woff2',
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
    for (const k of await caches.keys()) if (k.startsWith('lessons-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const SCOPE = new URL('./', self.location).pathname;           // e.g. /amc-bank/lessons/
const SHELL_PATHS = new Set(SHELL.map(u => new URL(u, self.location).pathname));

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const isApp = req.mode === 'navigate' && (url.pathname === SCOPE || url.pathname === SCOPE + 'index.html');
  const isLesson = req.mode === 'navigate' && url.pathname === SCOPE + 'lesson.html';   // lesson.html?id=… is one cached page
  if (!isApp && !isLesson && (url.search || !SHELL_PATHS.has(url.pathname))) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const key = isApp ? 'index.html' : isLesson ? 'lesson.html' : req;
    const hit = await c.match(key);
    const fresh = fetch(req, { cache: 'no-cache' }).then(res => {
      const html = (res.headers.get('content-type') || '').startsWith('text/html');
      if (res && res.ok && !res.redirected && (!(isApp || isLesson) || html)) c.put(key, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(fresh); return hit; }
    const res = await fresh;
    return res || Response.error();
  })());
});
