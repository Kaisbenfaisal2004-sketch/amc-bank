// One lesson, opened as a full page of its own (so its contents menu, top bar and links behave like a normal page,
// also on iPhone). The page comes from Firestore's on-device copy, so it opens without internet once it was kept.
// Progress (finished sections, reading place) is saved on the device and synced to the account, like the home page.
import { createStore } from './store.js';

const LS_STATE = 'kais_lessons_v1', LS_LIST = 'kais_lessons_list', LS_VER = 'kais_lessons_cached';
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const id = new URLSearchParams(location.search).get('id');
const say = t => { const el = document.getElementById('kLoad'); if (el) el.innerHTML = t; };
const home = () => { location.href = './'; };

let S = Object.assign({ v: 1, items: {}, ui: {} }, lsGet(LS_STATE, {}));
S.items = S.items || {};
const item = () => S.items[id] || (S.items[id] = { done: {}, total: 0, last: 0, pos: 0, at: 0 });
let store = null, user = null, writing = false, again = false, pushT = 0, touched = false, boxes = [];

function reloadLocal() { const r = lsGet(LS_STATE, null); if (r && r.items) for (const [k, v] of Object.entries(r.items)) if (k !== id && (!S.items[k] || (v.at || 0) > (S.items[k].at || 0))) S.items[k] = v; }
function saveLocal() { reloadLocal(); lsSet(LS_STATE, S); }
// other lessons: the newer copy wins; this lesson: the account's copy only until you change something here
function merge(r) {
  if (!r || !r.items) return;
  for (const [k, it] of Object.entries(r.items)) {
    if (!it || typeof it !== 'object') continue;
    const mine = S.items[k];
    if (k === id) {
      if (!touched && (!mine || (it.at || 0) > (mine.at || 0))) { S.items[k] = Object.assign({ done: {} }, it); applyTicks(); }
    } else if (!mine || (it.at || 0) > (mine.at || 0)) S.items[k] = it;
  }
  saveLocal();
}
async function push() {
  if (!store || !user) return;
  if (writing) { again = true; return; }
  writing = true;
  try { saveLocal(); await store.writeState(JSON.parse(JSON.stringify({ v: 1, items: S.items }))); } catch (e) {}
  finally { writing = false; if (again) { again = false; push(); } }
}
const schedulePush = ms => { clearTimeout(pushT); pushT = setTimeout(push, ms); };

function applyTicks() {
  const it = item();
  boxes.forEach(cb => {
    cb.checked = !!(it.done || {})[cb.dataset.sec];
    const a = document.querySelector('#toc a[data-id="' + cb.dataset.sec + '"]'); if (a) a.classList.toggle('ok', cb.checked);
  });
}

async function getPage(meta) {
  const ver = lsGet(LS_VER, {}), cached = ver[id] === meta.version;
  let html = await store.loadParts(meta, cached);
  const imgs = await store.loadImages(meta, cached);
  if (!cached && navigator.onLine) { ver[id] = meta.version; lsSet(LS_VER, ver); }
  return html.replace(/lesson-img:([A-Za-z0-9_-]+)/g, (m, n) => imgs[n] || '');
}

// put the lesson's own page in place of this one, and run its scripts
function mount(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const a of doc.documentElement.attributes) if (a.name !== 'data-theme') document.documentElement.setAttribute(a.name, a.value);
  document.title = doc.title || document.title;
  document.querySelectorAll('link[rel="stylesheet"]').forEach(l => l.remove());
  doc.head.querySelectorAll('style').forEach(s => document.head.appendChild(document.importNode(s, true)));
  const extra = document.createElement('style');
  const f = n => 'url(../library/fonts/ibm-plex-sans-arabic-' + n + '.woff2) format("woff2")';
  const ar = 'unicode-range:U+0600-06FF,U+0750-077F,U+08A0-08FF,U+200C-200E,U+FB50-FDFF,U+FE70-FEFC';
  extra.textContent =
    '@font-face{font-family:"Plex Arabic";src:' + f('arabic-400-normal') + ';font-weight:400;' + ar + '}' +
    '@font-face{font-family:"Plex Arabic";src:' + f('arabic-600-normal') + ';font-weight:500 600;' + ar + '}' +
    '@font-face{font-family:"Plex Arabic";src:' + f('arabic-700-normal') + ';font-weight:700;' + ar + '}' +
    'body{font-family:"Plex Arabic","Geeza Pro","Noto Naskh Arabic",serif}' +
    '#kBack{font:inherit;font-size:.75em;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:10px;padding:4px 12px;cursor:pointer;white-space:nowrap}' +
    'header.top{padding-top:calc(8px + env(safe-area-inset-top,0px))}' +
    '#toc{padding-top:calc(16px + env(safe-area-inset-top,0px));padding-bottom:calc(16px + env(safe-area-inset-bottom,0px));-webkit-overflow-scrolling:touch;overscroll-behavior:contain}' +
    '#toc a{padding:.45em .5em}' +
    '@media (max-width:560px){header.top .title{display:none}header.top{gap:6px;padding-left:10px;padding-right:10px}header.top button,#kBack{padding:4px 9px}}';
  document.head.appendChild(extra);
  const scripts = [];
  document.body.replaceChildren(...Array.from(doc.body.childNodes).map(n => {
    const m = document.importNode(n, true);
    if (m.nodeType === 1) (m.tagName === 'SCRIPT' ? [m] : m.querySelectorAll('script')).forEach(s => scripts.push(s));
    return m;
  }));
  for (const a of doc.body.attributes) document.body.setAttribute(a.name, a.value);
  for (const old of scripts) { const s = document.createElement('script'); for (const a of old.attributes) s.setAttribute(a.name, a.value); s.textContent = old.textContent; old.replaceWith(s); }
}

function wire() {
  const it = item();
  const bar = document.querySelector('header.top');
  if (bar) {
    const b = document.createElement('button'); b.id = 'kBack'; b.textContent = '→ الشروح'; b.setAttribute('aria-label', 'رجوع إلى قائمة الشروح');
    b.addEventListener('click', () => { saveLocal(); push(); home(); });
    bar.insertBefore(b, bar.firstChild);
  }
  // the contents menu: jump to the section without leaving the page or adding to the back history
  document.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('#toc a[href^="#"]'); if (!a) return;
    const t = document.getElementById(a.getAttribute('href').slice(1)); if (!t) return;
    e.preventDefault();
    const top = t.getBoundingClientRect().top + scrollY - ((bar && bar.offsetHeight) || 0) - 8;
    scrollTo({ top, behavior: 'smooth' });
  });
  boxes = Array.from(document.querySelectorAll('.done input[data-sec]'));
  it.total = boxes.length;
  applyTicks();
  boxes.forEach(cb => cb.addEventListener('change', () => {
    touched = true;
    const i = item(); i.done = i.done || {};
    if (cb.checked) i.done[cb.dataset.sec] = true; else delete i.done[cb.dataset.sec];
    i.at = Date.now(); applyTicks(); saveLocal(); schedulePush(800);
  }));
  it.last = Date.now(); it.at = Date.now(); saveLocal(); schedulePush(1500);
  // reading place, put back a few times while the page settles (font, pictures) unless you start moving first
  const H = () => document.documentElement.scrollHeight - innerHeight;
  let moved = false; ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach(ev => addEventListener(ev, () => { moved = true; }, { passive: true, once: true }));
  const target = it.pos;
  if (target > 0) [60, 350, 900, 1800].forEach(ms => setTimeout(() => { if (!moved) scrollTo(0, target * H()); }, ms));
  let posT = 0;
  addEventListener('scroll', () => {
    clearTimeout(posT);
    posT = setTimeout(() => { const h = H(); if (h > 0) { const i = item(); i.pos = +(scrollY / h).toFixed(4); i.at = Date.now(); saveLocal(); schedulePush(4000); } }, 400);
  }, { passive: true });
  const flush = () => { saveLocal(); push(); };
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('online', push);
}

async function start() {
  if (!id) { home(); return; }
  try { store = await createStore(); } catch (e) { store = null; }
  if (!store) { say('تعذّر فتح الشرح. أعد فتح التطبيق وأنت متصل بالإنترنت مرة واحدة.<br><a href="./">رجوع</a>'); return; }
  let opened = false;
  store.onUser(async u => {
    user = u;
    if (!u) { if (!opened) say('سجّل الدخول أولًا من الصفحة الرئيسية.<br><a href="./">رجوع</a>'); return; }
    if (opened) return; opened = true;
    store.watchState((data, meta) => { if (data) merge(data); if (meta && !meta.fromCache && !meta.error) push(); });
    let list = lsGet(LS_LIST, null), meta = list && list.find(l => l.id === id);
    if (!meta) { try { list = await store.listLessons(); lsSet(LS_LIST, list); meta = list.find(l => l.id === id); } catch (e) {} }
    if (!meta) { say('لم أجد هذا الشرح.<br><a href="./">رجوع</a>'); return; }
    let html;
    try { html = await getPage(meta); }
    catch (e) { say((navigator.onLine ? 'تعذّر فتح الشرح. أعد المحاولة بعد قليل.' : 'هذا الشرح لم يُحفظ على هذا الجهاز بعد. افتحه مرة وأنت متصل بالإنترنت.') + '<br><a href="./">رجوع</a>'); return; }
    mount(html);
    wire();
  });
}
start();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
