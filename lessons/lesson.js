// One lesson, opened as a full page of its own (so its contents menu, top bar and links behave like a normal page,
// also on iPhone). The page comes from Firestore's on-device copy, so it opens without internet once it was kept.
// Progress (finished sections, reading place) is saved on the device and synced to the account, like the home page.
import { createStore } from './store.js';

const LS_STATE = 'kais_lessons_v1', LS_LIST = 'kais_lessons_list', LS_VER = 'kais_lessons_cached';
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const id = new URLSearchParams(location.search).get('id');
const say = t => { const el = document.getElementById('kLoad'); if (el) el.innerHTML = '<span>' + t + '</span>'; };
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

let applyTicks = function () {
  const it = item();
  boxes.forEach(cb => {
    cb.checked = !!(it.done || {})[cb.dataset.sec];
    const a = document.querySelector('#toc a[data-id="' + cb.dataset.sec + '"]'); if (a) a.classList.toggle('ok', cb.checked);
  });
};

async function getPage(meta) {
  const ver = lsGet(LS_VER, {}), cached = ver[id] === meta.version;
  let html = await store.loadParts(meta, cached);
  const imgs = await store.loadImages(meta, cached);
  // large videos or sounds come in pieces; put each back together
  for (const [n, pieces] of Object.entries(meta.joins || {})) imgs[n] = pieces.map(p => imgs[p] || '').join('');
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
  // the app's look laid over every lesson: same palette and type as the home page, section ticks as big toggles
  const light = '--bg:#edf2f5;--card:#fff;--fg:#15283a;--muted:#5b6b7a;--line:#d3dde4;--accent:#1f6f7a;--accent-soft:#d6ecef;--blue:#2b5f8a;--blue-soft:#e3edf5;--gray-soft:#e2e9ee;--k-trace:#e0435a;--k-scrub:#1f7a86;--k-scrub-soft:#d6ecef';
  const dark = '--bg:#0e1923;--card:#16232f;--fg:#e6eef3;--muted:#93a4b3;--line:#243442;--accent:#4fb8c4;--accent-soft:#173640;--blue:#8cc0ea;--blue-soft:#162a3b;--gray-soft:#1d2c39;--k-trace:#ff5c73;--k-scrub:#4fb8c4;--k-scrub-soft:#173640';
  extra.textContent =
    '@font-face{font-family:"Plex Arabic";src:' + f('arabic-400-normal') + ';font-weight:400;' + ar + '}' +
    '@font-face{font-family:"Plex Arabic";src:' + f('arabic-600-normal') + ';font-weight:500 600;' + ar + '}' +
    '@font-face{font-family:"Plex Arabic";src:' + f('arabic-700-normal') + ';font-weight:700;' + ar + '}' +
    '@view-transition{navigation:auto}' +
    ':root{' + light + '}' +
    '@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){' + dark + '}}' +
    ':root[data-theme="dark"]{' + dark + '}' +
    'body{font-family:"Plex Arabic","Geeza Pro","Noto Naskh Arabic",serif}' +
    'main h1,main h2{font-family:"Plex Arabic",sans-serif;font-weight:700;letter-spacing:0}' +
    'main h1{border-radius:20px;padding:.5em .8em}main>h1:first-child{margin-top:.5em}' +
    '#progress{height:3px;background:var(--k-trace);box-shadow:0 0 8px var(--k-trace)}' +
    '#kBack{font:inherit;font-size:.75em;background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:10px;padding:4px 12px;cursor:pointer;white-space:nowrap}' +
    'header.top{padding-top:calc(8px + env(safe-area-inset-top,0px))}' +
    '#toc{padding-top:calc(16px + env(safe-area-inset-top,0px));padding-bottom:calc(16px + env(safe-area-inset-bottom,0px));-webkit-overflow-scrolling:touch;overscroll-behavior:contain}' +
    '#toc a{padding:.45em .5em}' +
    /* a finished-section toggle: a big pill; ticking it runs one heartbeat across it */
    'label.done{position:relative;overflow:hidden;display:flex;align-items:center;gap:14px;margin:1.8em 0;padding:14px 18px;border:2px dashed var(--line);border-radius:18px;color:var(--fg);font-weight:600;font-size:.9em;cursor:pointer;transition:background .3s,border-color .3s}' +
    'label.done input{appearance:none;-webkit-appearance:none;flex:none;width:32px;height:32px;margin:0;border-radius:50%;border:2px solid var(--muted);display:grid;place-items:center;transition:background .25s,border-color .25s;cursor:pointer}' +
    'label.done input::after{content:"";width:13px;height:7px;margin-top:-4px;border:3px solid #fff;border-top:0;border-right:0;transform:rotate(-45deg) scale(0);transition:transform .3s cubic-bezier(.3,1.7,.5,1)}' +
    'label.done input:checked{background:var(--k-scrub);border-color:var(--k-scrub)}' +
    'label.done input:checked::after{transform:rotate(-45deg) scale(1)}' +
    'label.done.on{border-style:solid;border-color:var(--k-scrub);background:var(--k-scrub-soft)}' +
    'label.done .kt{position:relative;z-index:1}' +
    'label.done svg.kecg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}' +
    'label.done svg.kecg polyline{stroke:var(--k-trace);stroke-width:2.2;fill:none;stroke-linejoin:round;stroke-dasharray:1 1;stroke-dashoffset:1;opacity:0}' +
    'label.done.fire svg.kecg polyline{animation:kbeat 1.1s cubic-bezier(.3,.6,.2,1) forwards}' +
    '@keyframes kbeat{0%{stroke-dashoffset:1;opacity:1}75%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}' +
    '#kToast{position:fixed;left:50%;bottom:calc(22px + env(safe-area-inset-bottom,0px));transform:translate(-50%,30px);opacity:0;visibility:hidden;pointer-events:none;background:var(--fg);color:var(--bg);padding:11px 18px;border-radius:14px;font-size:.82em;font-weight:600;z-index:60;transition:transform .35s cubic-bezier(.2,.9,.3,1.2),opacity .25s,visibility 0s linear .35s;white-space:nowrap}' +
    '#kToast.show{transform:translate(-50%,0);opacity:1;visibility:visible;transition:transform .35s cubic-bezier(.2,.9,.3,1.2),opacity .25s,visibility 0s}' +
    'header.top button,#kBack{white-space:nowrap}' +
    '@media (max-width:560px){header.top .title{display:none}header.top{gap:6px;padding-left:10px;padding-right:10px}header.top button,#kBack{padding:4px 9px}}' +
    '@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}';
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

// videos and sounds play more reliably (especially on iPhone) from a file kept in memory than from a long data: text
function mediaToBlobs() {
  document.querySelectorAll('video[src^="data:"], audio[src^="data:"]').forEach(el => {
    try {
      const src = el.getAttribute('src'), comma = src.indexOf(','), mime = src.slice(5, src.indexOf(';'));
      const bin = atob(src.slice(comma + 1)), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      el.src = URL.createObjectURL(new Blob([u8], { type: mime }));
    } catch (e) {}
  });
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
  const ECG = 'M0,50 L28,50 L31,44 L34,50 L40,50 L42,56 L45,12 L48,74 L51,50 L58,50 L62,42 L66,50 L100,50';
  const pts = ECG.replace(/M|L/g, ' ').trim().split(/\s+/).join(' ');
  const toast = document.createElement('div'); toast.id = 'kToast'; toast.setAttribute('role', 'status'); document.body.appendChild(toast);
  let toastT = 0;
  const showToast = t => { toast.textContent = t; toast.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('show'), 2200); };
  boxes.forEach(cb => {
    const lab = cb.closest('label.done'); if (!lab) return;
    // the label's words: what the toggle does now, and what it says once done
    Array.from(lab.childNodes).forEach(n => { if (n.nodeType === 3) n.remove(); });
    const kt = document.createElement('span'); kt.className = 'kt'; lab.appendChild(kt);
    lab.insertAdjacentHTML('afterbegin', '<svg class="kecg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts + '" pathLength="1" vector-effect="non-scaling-stroke"/></svg>');
  });
  const paint = () => boxes.forEach(cb => {
    const lab = cb.closest('label.done'); if (!lab) return;
    lab.classList.toggle('on', cb.checked);
    lab.querySelector('.kt').textContent = cb.checked ? 'أنهيت هذا القسم' : 'اضغط هنا حين تنهي هذا القسم';
  });
  const applyTicks0 = applyTicks; applyTicks = () => { applyTicks0(); paint(); };
  applyTicks();
  boxes.forEach(cb => cb.addEventListener('change', () => {
    touched = true;
    const i = item(); i.done = i.done || {};
    if (cb.checked) i.done[cb.dataset.sec] = true; else delete i.done[cb.dataset.sec];
    i.at = Date.now(); applyTicks(); saveLocal(); schedulePush(800);
    if (cb.checked) {
      const lab = cb.closest('label.done');
      if (lab) { lab.classList.remove('fire'); void lab.offsetWidth; lab.classList.add('fire'); setTimeout(() => lab.classList.remove('fire'), 1200); }
      if (navigator.vibrate) navigator.vibrate(12);
      const n = Object.keys(i.done).length;
      showToast(n >= boxes.length ? 'أنهيت الشرح كله' : 'أنهيت ' + n + ' من ' + boxes.length + ' أقسام');
    }
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
    mediaToBlobs();
    wire();
  });
}
start();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
