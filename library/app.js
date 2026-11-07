// مكتبة قيس — reading app. Local-first: everything is kept on the device (localStorage + Firestore's
// on-device cache) and synced to the owner's Firebase account whenever the internet is available.
import { createStore } from './store.js';

const IDLE_MS = 4 * 60 * 1000, IDLE_REFUND = 150;
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const dayKey = (d = new Date()) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const AR_DAYS = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
const ICON_PAUSE = '<svg viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="1" width="3.5" height="12" rx="1"/><rect x="8.5" y="1" width="3.5" height="12" rx="1"/></svg>';
const ICON_PLAY = '<svg viewBox="0 0 14 14" fill="currentColor"><path d="M3 1.5v11l9.5-5.5z"/></svg>';
const LS_STATE = 'kais_library_v1', LS_LIB = 'kais_library_list', LS_VER = 'kais_library_cached';

/* ---------- state ---------- */
const blank = () => ({ v: 1, goal: 30, goalAt: 0, days: {}, books: {}, prefs: { fs: 26, lh: 1.7, rt: 'auto' }, ui: { open: null } });
let S = blank();
try { const raw = localStorage.getItem(LS_STATE); if (raw) S = Object.assign(blank(), JSON.parse(raw)); } catch (e) {}
S.prefs = Object.assign(blank().prefs, S.prefs || {}); S.ui = S.ui || { open: null };
// Nov 2026: bigger text for phone reading — lift any older, smaller saved size once.
function bigText(src) { if (src && src.big) return; S.prefs.big = 1; if (S.prefs.fs < 26) { S.prefs.fs = 26; S.prefsAt = Date.now(); } }
bigText(S.prefs);
let localT = 0;
function saveLocal(now = false) {
  const w = () => { try { localStorage.setItem(LS_STATE, JSON.stringify(S)); } catch (e) {} };
  clearTimeout(localT); if (now) w(); else localT = setTimeout(w, 800);
}
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
function bookState(id) { return S.books[id] || (S.books[id] = { ch: 0, blk: 0, pct: 0, secs: 0, started: dayKey(), last: 0, finished: false }); }

/* ---------- account + sync ---------- */
let store = null, user = null, writing = false, again = false, pushT = 0, firstServer = false;
function setSync(mode) {
  const el = $('sync');
  el.classList.toggle('on', mode === 'on');
  el.querySelector('span').textContent = mode === 'on' ? 'محفوظ في حسابك' : mode === 'wait' ? 'سيُرفع حين يعود الإنترنت' : 'محفوظ على هذا الجهاز';
}
function merge(r) {
  if (!r || typeof r !== 'object') return;
  for (const [k, v] of Object.entries(r.days || {})) if (typeof v === 'number' && v > (S.days[k] || 0)) S.days[k] = v;
  for (const [id, b] of Object.entries(r.books || {})) {
    const mine = S.books[id];
    if (!mine) { S.books[id] = Object.assign({}, b); continue; }
    const secs = Math.max(mine.secs || 0, b.secs || 0), fin = !!(mine.finished || b.finished);
    if ((b.last || 0) > (mine.last || 0) && !(readerBook && readerBook.id === id)) Object.assign(mine, b);
    mine.secs = secs; mine.finished = fin;
  }
  if (r.goal && (r.goalAt || 0) > (S.goalAt || 0)) { S.goal = r.goal; S.goalAt = r.goalAt; }
  if (r.prefs && (r.prefsAt || 0) > (S.prefsAt || 0)) { S.prefs = Object.assign(S.prefs, r.prefs); S.prefsAt = r.prefsAt; bigText(r.prefs); }
}
async function push() {
  if (!store || !user) return;
  if (writing) { again = true; return; }
  writing = true;
  try {
    const { ui, ...rest } = S;
    const p = store.writeState(JSON.parse(JSON.stringify(rest)));
    if (!navigator.onLine) setSync('wait');
    await p; setSync('on');
  } catch (e) { setSync('local'); }
  finally { writing = false; if (again) { again = false; push(); } }
}
function schedulePush(ms = 2500) { clearTimeout(pushT); pushT = setTimeout(push, ms); }

async function start() {
  renderHome();
  try { store = await createStore(); } catch (e) { store = null; }
  if (!store) { showSignedOut('تعذّر تشغيل الحفظ في الحساب. أعد فتح التطبيق وأنت متصل بالإنترنت مرة واحدة.'); return; }
  store.onUser(async u => {
    user = u;
    if (!u) { showSignedOut(); return; }
    $('signin').hidden = true; $('accIn').hidden = false; $('accWho').textContent = u.email || '';
    watchState();
    await refreshLibrary();
  });
}
let stateErr = false;
function watchState() {
  firstServer = false; stateErr = false;
  store.watchState((data, meta) => {
    if (meta.error) { stateErr = true; setSync('local'); return; }
    if (data) { merge(data); saveLocal(); renderHome(); }
    if (!meta.fromCache) { setSync(meta.pending ? 'wait' : 'on'); if (!firstServer) { firstServer = true; push(); } }
  });
}
function showSignedOut(msg) {
  user = null; LIB = null;
  $('signin').hidden = false; $('accIn').hidden = true; setSync('local');
  $('contWrap').hidden = true;
  $('shelf').innerHTML = '<div class="empty">' + esc(msg || 'سجّل الدخول لتظهر رواياتك.') + '</div>';
  $('libCount').textContent = '';
}
$('sForm').addEventListener('submit', async e => {
  e.preventDefault();
  const em = $('sEmail').value.trim(), pw = $('sPass').value;
  const err = $('sErr'); err.hidden = true;
  if (!em || pw.length < 6) { err.textContent = 'اكتب البريد وكلمة المرور (6 أحرف على الأقل).'; err.hidden = false; return; }
  $('sBtn').disabled = true; $('sBtn').textContent = 'جارٍ الدخول…';
  try { await store.signIn(em, pw); $('sPass').value = ''; }
  catch (x) {
    const c = (x && x.code) || '';
    err.textContent = /network/.test(c) ? 'لا يوجد اتصال بالإنترنت. الدخول أول مرة يحتاج إنترنت.'
      : /invalid|wrong-password|user-not-found/.test(c) ? 'البريد أو كلمة المرور غير صحيحة.'
      : /too-many/.test(c) ? 'محاولات كثيرة. انتظر قليلًا ثم جرّب.' : 'تعذّر الدخول (' + c + ').';
    err.hidden = false;
  } finally { $('sBtn').disabled = false; $('sBtn').textContent = 'دخول'; }
});
$('sReset').addEventListener('click', async () => {
  const em = $('sEmail').value.trim(), err = $('sErr');
  if (!em) { err.textContent = 'اكتب بريدك أولًا، ثم اضغط «نسيت كلمة المرور».'; err.hidden = false; return; }
  try { await store.resetPassword(em); err.textContent = 'أرسلنا رابط تغيير كلمة المرور إلى بريدك.'; }
  catch (x) { err.textContent = 'تعذّر الإرسال. تأكد من البريد والاتصال.'; }
  err.hidden = false;
});
$('sOut').addEventListener('click', async () => { await push(); try { await store.signOut(); } catch (e) {} });

/* ---------- library ---------- */
let LIB = null; const BOOKS = {};
async function refreshLibrary() {
  const cachedList = lsGet(LS_LIB, null);
  if (cachedList && !LIB) { LIB = cachedList; renderHome(); }
  try {
    const list = await store.listBooks();
    LIB = list.map(({ cover, ...m }) => Object.assign(m, { cover }));
    lsSet(LS_LIB, LIB);
  } catch (e) {
    const deniedErr = e && /permission-denied/.test(e.code || '');
    if (!LIB) {
      $('shelf').innerHTML = '<div class="empty">' + (deniedErr
        ? 'رفض Firebase فتح المكتبة، لأن قواعد Firestore لم تُحدَّث بعد. الصق القواعد الجديدة في Firebase واضغط Publish، ثم ارجع إلى هنا.'
        : 'تعذّر تحميل المكتبة. افتح التطبيق وأنت متصل بالإنترنت مرة واحدة.') + '</div>';
      return;
    }
  }
  renderHome();
  if (S.ui.open && LIB.some(b => b.id === S.ui.open) && !readerBook) openBook(S.ui.open);
  prefetch();
}
// keep every book on the device, so it opens without internet later
let prefetching = false;
async function prefetch() {
  if (prefetching || !navigator.onLine || !LIB) return;
  prefetching = true;
  const ver = lsGet(LS_VER, {});
  for (const m of LIB) {
    if (ver[m.id] === m.version) continue;
    try { await store.loadParts(m, false); await store.loadImages(m, false); ver[m.id] = m.version; lsSet(LS_VER, ver); delete BOOKS[m.id]; }
    catch (e) {}
  }
  prefetching = false;
}
window.addEventListener('online', () => { prefetch(); push(); });
async function getBook(id) {
  if (BOOKS[id]) return BOOKS[id];
  const meta = LIB.find(b => b.id === id);
  const ver = lsGet(LS_VER, {}), cached = ver[id] === meta.version;
  const parts = await store.loadParts(meta, cached);
  const images = await store.loadImages(meta, cached).catch(() => ({}));
  if (!cached && navigator.onLine) { ver[id] = meta.version; lsSet(LS_VER, ver); }
  let acc = 0; parts.forEach(c => { c.start = acc; acc += c.words; });
  return BOOKS[id] = { id, title: meta.title, chapters: parts, gloss: meta.gloss || {}, images, total: acc };
}

/* ---------- home ---------- */
const fmtMin = s => Math.floor(s / 60);
function fmtTotal(s) { const m = Math.round(s / 60); return m < 60 ? m + ' د' : (Math.floor(m / 60) + ' س' + (m % 60 ? ' ' + (m % 60) + ' د' : '')); }
function streak() {
  const goal = S.goal * 60; let n = 0; const d = new Date();
  if ((S.days[dayKey(d)] || 0) < goal) d.setDate(d.getDate() - 1);
  while ((S.days[dayKey(d)] || 0) >= goal) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function renderGoal() {
  const secs = S.days[dayKey()] || 0, goal = S.goal * 60, frac = Math.min(1, secs / goal), done = secs >= goal;
  $('ringPr').style.strokeDashoffset = (326.7 * (1 - frac)).toFixed(1);
  $('ring').classList.toggle('done', done);
  $('ringMin').textContent = fmtMin(secs);
  $('ringOf').textContent = 'من ' + S.goal + ' دقيقة';
  const left = Math.max(0, Math.ceil((goal - secs) / 60));
  $('gH').textContent = done ? 'أتممت هدف اليوم' : secs > 0 ? 'باقي ' + left + ' دقيقة لهدف اليوم' : 'هدف اليوم: ' + S.goal + ' دقيقة قراءة';
  $('gS').textContent = done ? 'أحسنت. كل دقيقة إضافية تُحسب لك أيضًا.' : 'افتح رواية واضغط زر المؤقت لتبدأ.';
  const st = streak();
  $('streak').textContent = st ? 'سلسلة الأيام: ' + st + (st === 1 ? ' يوم' : st <= 10 ? ' أيام' : ' يومًا') : 'ابدأ سلسلة أيامك اليوم';
  const wk = $('week'); wk.innerHTML = '';
  const vals = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return [d, S.days[dayKey(d)] || 0]; });
  const max = Math.max(goal, ...vals.map(v => v[1]));
  vals.forEach(([d, s], i) => {
    const el = document.createElement('div'); el.className = 'wd' + (i === 6 ? ' today' : '');
    el.innerHTML = '<div class="bar" style="--gl:' + (goal / max * 100).toFixed(1) + '"><u class="' + (s >= goal ? 'ok' : '') + '" style="height:' + (s / max * 100).toFixed(1) + '%"></u></div><small>' + (i === 6 ? 'اليوم' : AR_DAYS[d.getDay()]) + '</small>';
    el.title = fmtMin(s) + ' دقيقة'; wk.appendChild(el);
  });
  $('gVal').textContent = S.goal + ' د';
}
const pctOf = id => Math.round((S.books[id] && S.books[id].pct || 0) * 100);
function renderHome() {
  renderGoal();
  $('stTime').textContent = fmtTotal(Object.values(S.days).reduce((a, b) => a + b, 0));
  $('stDays').textContent = Object.values(S.days).filter(v => v >= 60).length;
  $('stDone').textContent = Object.values(S.books).filter(b => b.finished).length;
  if (!LIB) return;
  $('libCount').textContent = LIB.length ? LIB.length + (LIB.length === 1 ? ' رواية' : LIB.length <= 10 ? ' روايات' : ' رواية') : '';
  const shelf = $('shelf'); shelf.innerHTML = '';
  if (!LIB.length) shelf.innerHTML = '<div class="empty">لا توجد روايات بعد. أضف رواية من «إضافة رواية» في الأسفل.</div>';
  for (const b of LIB) {
    const st = S.books[b.id], p = pctOf(b.id);
    const chip = st && st.finished ? '<span class="chip done">أنهيتها</span>' : st && st.last ? '<span class="chip num">' + p + '%</span>' : '<span class="chip">جديدة</span>';
    const el = document.createElement('button'); el.className = 'bk';
    el.innerHTML = '<div class="cv">' + (b.cover ? '<img src="' + b.cover + '" alt="">' : '') + chip + '</div>' +
      '<div class="bt ltr">' + esc(b.title) + '</div><div class="meta">' + esc(b.level || '') + ' · ' + b.chapters.length + ' فصول · ' + Math.round(b.words / 150) + ' د تقريبًا</div>' +
      (st && st.last && !st.finished ? '<div class="pbar"><u style="width:' + p + '%"></u></div>' : '');
    el.addEventListener('click', () => openBook(b.id)); shelf.appendChild(el);
  }
  const recent = LIB.filter(b => S.books[b.id] && S.books[b.id].last && !S.books[b.id].finished).sort((a, b) => S.books[b.id].last - S.books[a.id].last)[0];
  $('contWrap').hidden = !recent;
  if (recent) {
    const st = S.books[recent.id], p = pctOf(recent.id);
    $('cont').innerHTML = (recent.cover ? '<img src="' + recent.cover + '" alt="">' : '<span></span>') + '<div class="t"><div class="bt ltr">' + esc(recent.title) + '</div>' +
      '<div class="ch">الفصل ' + (st.ch + 1) + ' من ' + recent.chapters.length + ' · <span class="num">' + p + '%</span> · قرأت ' + fmtTotal(st.secs || 0) + '</div>' +
      '<div class="pbar"><u style="width:' + p + '%"></u></div><button class="btn" id="contBtn">تابع من حيث توقفت</button></div>';
    $('contBtn').addEventListener('click', () => openBook(recent.id));
  }
}
function setGoal(d) { S.goal = Math.min(180, Math.max(5, S.goal + d)); S.goalAt = Date.now(); saveLocal(); renderHome(); schedulePush(); }
$('gMinus').addEventListener('click', () => setGoal(-5));
$('gPlus').addEventListener('click', () => setGoal(5));

/* ---------- import a book file ---------- */
$('impFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (f) importText(await f.text());
});
// a book file's text pasted anywhere in the app (e.g. copied on a computer) imports it too
document.addEventListener('paste', e => {
  if (!user || readerBook) return;
  const t = e.clipboardData && e.clipboardData.getData('text');
  if (!t || t.charAt(0) !== '{' || t.indexOf('"kais-library-') < 0) return;
  e.preventDefault(); importText(t);
});
async function importText(text) {
  const msg = $('impMsg'); msg.hidden = false;
  const say = t => { msg.textContent = t; };
  if (!navigator.onLine) { say('الإضافة تحتاج إنترنت. جرّب حين يعود الاتصال.'); return; }
  let data;
  try { data = JSON.parse(text); } catch (x) { say('هذا الملف ليس ملف رواية صالحًا.'); return; }
  // one book, or a bundle of several books
  const books = data && data.type === 'kais-library-bundle' && Array.isArray(data.books) ? data.books : [data];
  const ok = b => b && b.type === 'kais-library-book' && b.id && b.meta && Array.isArray(b.parts);
  if (!books.length || !books.every(ok)) { say('هذا الملف ليس ملف رواية صالحًا.'); return; }
  const done = [];
  for (let i = 0; i < books.length; i++) {
    const b = books[i], pre = books.length > 1 ? '(' + (i + 1) + '/' + books.length + ') ' : '';
    try {
      say(pre + 'جارٍ رفع «' + b.meta.title + '»…');
      await store.importBook(b, step => say(pre + 'جارٍ رفع «' + b.meta.title + '»: ' + step));
      const ver = lsGet(LS_VER, {}); delete ver[b.id]; lsSet(LS_VER, ver); delete BOOKS[b.id];
      done.push(b.meta.title);
    } catch (x) {
      say(pre + 'تعذّر رفع «' + b.meta.title + '» (' + ((x && x.code) || 'خطأ') + '). أُضيف قبلها ' + done.length + '. أعد المحاولة والاتصال جيد.');
      await refreshLibrary(); return;
    }
  }
  const n = done.length; say(books.length > 1 ? (n === 2 ? 'أُضيفت روايتان إلى مكتبتك.' : 'أُضيفت ' + n + (n <= 10 ? ' روايات' : ' رواية') + ' إلى مكتبتك.') : 'أُضيفت «' + done[0] + '» إلى مكتبتك.');
  await refreshLibrary();
}

/* ---------- reader ---------- */
let readerBook = null, curCh = 0, blocksEls = [], paused = true, started = false, idlePaused = false, lastAct = Date.now(), lastTick = Date.now(), sinceSync = 0, wake = null;
function applyPrefs() {
  const r = $('reader'), t = $('rtext');
  if (S.prefs.rt === 'auto') r.removeAttribute('data-rt'); else r.setAttribute('data-rt', S.prefs.rt);
  t.style.setProperty('--fs', S.prefs.fs + 'px'); t.style.setProperty('--lh', S.prefs.lh);
}
async function openBook(id) {
  if (!LIB || !LIB.find(b => b.id === id)) return;
  let b;
  try { b = await getBook(id); }
  catch (e) { toast(navigator.onLine ? 'تعذّر فتح الرواية. حاول مرة أخرى.' : 'هذه الرواية لم تُحمَّل على الجهاز بعد. افتحها مرة وأنت متصل بالإنترنت.', true); return; }
  readerBook = b;
  const st = bookState(id); if (!st.last) st.last = Date.now();
  S.ui.open = id; saveLocal(true);
  $('reader').hidden = false; document.body.style.overflow = 'hidden';
  applyPrefs(); paused = true; started = false; idlePaused = false; lastAct = Date.now(); lastTick = Date.now();
  renderChapter(st.finished ? 0 : Math.min(st.ch, b.chapters.length - 1), st.finished ? 0 : st.blk);
  updateTimer(); askWake();
}
function closeReader() {
  savePos(); $('reader').hidden = true; document.body.style.overflow = ''; S.ui.open = null;
  readerBook = null; saveLocal(true); push(); renderHome(); releaseWake(); closeSheet();
}
function renderChapter(ci, blk = 0) {
  const b = readerBook; curCh = ci; const c = b.chapters[ci];
  const parts = ['<div class="chn">Chapter ' + c.n + '</div><h2>' + esc(c.title) + '</h2>'];
  let first = true;
  c.blocks.forEach((x, i) => {
    if (x.k === 'p') { parts.push('<p data-i="' + i + '"' + (first ? ' class="f"' : '') + '>' + x.h + '</p>'); first = false; }
    else if (x.k === 'd') { parts.push('<h3 data-i="' + i + '">' + x.h + '</h3>'); first = true; }
    else {
      const src = b.images[x.src];
      parts.push('<figure data-i="' + i + '">' + (src ? '<img src="' + src + '" alt="' + esc(x.cap || '') + '">' : '') + (x.cap ? '<figcaption>' + esc(x.cap) + '</figcaption>' : '') + '</figure>');
    }
  });
  const last = ci === b.chapters.length - 1;
  parts.push('<div class="cend">' + (ci > 0 ? '<button id="cPrev">الفصل السابق</button>' : '<span></span>') + (last ? '<button class="pri" id="cDone">أنهيت الرواية</button>' : '<button class="pri" id="cNext">الفصل التالي</button>') + '</div>');
  if (last && bookState(b.id).finished) parts.push('<div class="fin"><b>أنهيت هذه الرواية</b>يمكنك العودة إلى المكتبة واختيار رواية أخرى.</div>');
  $('rtext').innerHTML = parts.join('');
  $('rTitle').innerHTML = '<span class="ltr">' + esc(b.title) + '</span> · الفصل ' + c.n;
  blocksEls = Array.from($('rtext').querySelectorAll('[data-i]'));
  const prev = $('cPrev'), next = $('cNext'), done = $('cDone');
  if (prev) prev.addEventListener('click', () => { renderChapter(ci - 1, 0); savePos(); });
  if (next) next.addEventListener('click', () => { renderChapter(ci + 1, 0); savePos(); schedulePush(); });
  if (done) done.addEventListener('click', () => {
    const st = bookState(b.id); st.finished = true; st.pct = 1; st.last = Date.now();
    saveLocal(true); push(); toast('مبروك! أنهيت ' + b.title); renderChapter(ci, c.blocks.length - 1);
  });
  const sc = $('rscroll');
  requestAnimationFrame(() => {
    if (blk > 0) { const el = blocksEls.find(e => +e.dataset.i >= blk); sc.scrollTop = el ? el.offsetTop - 12 : 0; }
    else sc.scrollTop = 0;
    updateProg();
  });
}
function currentBlock() {
  const top = $('rscroll').scrollTop; let cur = 0;
  for (const el of blocksEls) { cur = +el.dataset.i; if (el.offsetTop + el.offsetHeight > top + 8) break; }
  return cur;
}
function updateProg() {
  if (!readerBook) return null;
  const b = readerBook, c = b.chapters[curCh], blk = currentBlock();
  let w = c.start; for (let i = 0; i < blk && i < c.blocks.length; i++) w += c.blocks[i].w || 0;
  const sc = $('rscroll'); const atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4;
  const pct = atEnd ? (c.start + c.words) / b.total : w / b.total;
  $('rProg').style.width = (pct * 100).toFixed(1) + '%';
  return { blk, pct };
}
function savePos() {
  if (!readerBook) return;
  const p = updateProg(); if (!p) return;
  const st = bookState(readerBook.id);
  st.ch = curCh; st.blk = p.blk; st.pct = Math.max(p.pct, st.finished ? 1 : 0); st.last = Date.now();
  if (!st.finished && curCh === readerBook.chapters.length - 1 && p.pct >= 0.999) { st.finished = true; toast('مبروك! أنهيت ' + readerBook.title); push(); }
  saveLocal();
}
let scrollRaf = 0, posT = 0;
$('rscroll').addEventListener('scroll', () => {
  activity();
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updateProg(); clearTimeout(posT); posT = setTimeout(() => { savePos(); schedulePush(8000); }, 600); });
}, { passive: true });
['touchstart', 'pointerdown', 'keydown'].forEach(ev => $('reader').addEventListener(ev, activity, { passive: true }));
function activity() { lastAct = Date.now(); if (idlePaused && !paused) { idlePaused = false; lastTick = Date.now(); updateTimer(); } }
$('rBack').addEventListener('click', closeReader);
$('rtext').addEventListener('click', e => { const g = e.target.closest('.gl'); if (g) showWord(g.dataset.g); });

/* ---------- timer ---------- */
function addTime(sec) {
  const k = dayKey(); S.days[k] = Math.max(0, (S.days[k] || 0) + sec);
  const st = bookState(readerBook.id); st.secs = Math.max(0, (st.secs || 0) + sec);
}
function tick() {
  const now = Date.now(); const dt = Math.min(5, (now - lastTick) / 1000); lastTick = now;
  if (!readerBook || document.hidden || paused || idlePaused) return;
  if (now - lastAct > IDLE_MS) { idlePaused = true; addTime(-IDLE_REFUND); saveLocal(); push(); updateTimer(); return; }
  const before = S.days[dayKey()] || 0;
  addTime(dt);
  const after = S.days[dayKey()] || 0, goal = S.goal * 60;
  if (before < goal && after >= goal) { toast('أتممت هدف اليوم: ' + S.goal + ' دقيقة. أحسنت!'); chime(); saveLocal(true); push(); }
  sinceSync += dt; if (sinceSync >= 60) { sinceSync = 0; saveLocal(); push(); }
  updateTimer();
}
setInterval(tick, 1000);
function updateTimer() {
  const secs = Math.floor(S.days[dayKey()] || 0), goal = S.goal * 60, done = secs >= goal;
  $('tTime').textContent = Math.floor(secs / 60) + ':' + pad(secs % 60);
  $('tSub').textContent = done ? 'تم الهدف' : '/ ' + S.goal + ':00';
  $('tPr').style.strokeDashoffset = (94.25 * (1 - Math.min(1, secs / goal))).toFixed(2);
  const t = $('timer'); t.classList.toggle('done', done);
  const isP = paused || idlePaused; t.classList.toggle('paused', isP);
  $('tPP').innerHTML = isP ? ICON_PLAY : ICON_PAUSE;
  $('tPP').setAttribute('aria-label', isP ? 'استئناف المؤقت' : 'إيقاف المؤقت مؤقتًا');
  if (idlePaused) $('tSub').textContent = 'متوقف · المس للمتابعة';
  else if (paused && !started) $('tSub').textContent = 'اضغط للبدء';
  else if (paused) $('tSub').textContent = 'متوقف';
}
$('tPP').addEventListener('click', e => {
  e.stopPropagation();
  if (paused || idlePaused) { paused = false; started = true; idlePaused = false; lastAct = Date.now(); lastTick = Date.now(); }
  else { paused = true; saveLocal(true); push(); }
  updateTimer();
});
document.addEventListener('visibilitychange', () => {
  lastTick = Date.now();
  if (document.hidden) { savePos(); saveLocal(true); push(); }
  else { lastAct = Date.now(); renderGoal(); if (readerBook) askWake(); if (user && !LIB) refreshLibrary(); if (user && stateErr) watchState(); }
});
window.addEventListener('pagehide', () => { savePos(); saveLocal(true); });
async function askWake() { try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; } }
function releaseWake() { try { if (wake) wake.release(); } catch (e) {} wake = null; }
let actx = null;
function chime() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    [659.25, 987.77].forEach((f, i) => {
      const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + i * 0.18;
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.9);
      o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + 1);
    });
  } catch (e) {}
}
let toastT = 0;
function toast(msg, warn) {
  const t = $('toast'); t.textContent = msg; t.classList.toggle('warn', !!warn); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4200);
}

/* ---------- sheets ---------- */
function openSheet(html) { $('sheet').innerHTML = html; $('sheet').hidden = false; $('scrim').hidden = false; }
function closeSheet() { $('sheet').hidden = true; $('scrim').hidden = true; }
$('scrim').addEventListener('click', closeSheet);
function showWord(g) {
  const w = readerBook.gloss[g]; if (!w) return;
  openSheet('<p class="gword">' + esc(w.l) + '</p><p class="gdef">' + esc(w.d) + '</p><div class="gar">' + esc(w.ar) + '</div>');
}
$('rAa').addEventListener('click', () => {
  const P = S.prefs;
  const themes = [['auto', 'تلقائي', 'var(--surface)'], ['light', 'أبيض', '#ffffff'], ['sepia', 'بيج', '#f2e8d5'], ['dark', 'داكن', '#0e1012']];
  openSheet('<h3>شكل القراءة</h3>' +
    '<div class="lblrow">حجم الخط</div><div class="row"><div class="step"><button id="fsM" aria-label="أصغر">−</button><b class="num" id="fsV">' + P.fs + '</b><button id="fsP" aria-label="أكبر">+</button></div><span style="font-family:var(--book);font-size:' + P.fs + 'px" class="ltr" id="fsS">Aa</span></div>' +
    '<div class="lblrow">المسافة بين الأسطر</div><div class="seg three" id="lhS">' + [[1.5, 'ضيقة'], [1.7, 'متوسطة'], [1.95, 'واسعة']].map(([v, l]) => '<button data-v="' + v + '" aria-pressed="' + (P.lh == v) + '">' + l + '</button>').join('') + '</div>' +
    '<div class="lblrow">لون الصفحة</div><div class="seg" id="rtS">' + themes.map(([v, l, c]) => '<button data-v="' + v + '" aria-pressed="' + (P.rt === v) + '"><span class="sw" style="background:' + c + '"></span>' + l + '</button>').join('') + '</div>');
  const changed = () => { S.prefsAt = Date.now(); saveLocal(); schedulePush(5000); };
  const setFs = d => { const b = currentBlock(); P.fs = Math.min(48, Math.max(18, P.fs + d)); $('fsV').textContent = P.fs; $('fsS').style.fontSize = P.fs + 'px'; applyPrefs(); keepBlock(b); changed(); };
  $('fsM').onclick = () => setFs(-2); $('fsP').onclick = () => setFs(2);
  $('lhS').onclick = e => { const btn = e.target.closest('button'); if (!btn) return; const b = currentBlock(); P.lh = +btn.dataset.v; $('lhS').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === btn)); applyPrefs(); keepBlock(b); changed(); };
  $('rtS').onclick = e => { const btn = e.target.closest('button'); if (!btn) return; P.rt = btn.dataset.v; $('rtS').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === btn)); applyPrefs(); changed(); };
});
function keepBlock(b) { requestAnimationFrame(() => { const el = blocksEls.find(e => +e.dataset.i >= b); if (el) $('rscroll').scrollTop = el.offsetTop - 12; }); }
$('rToc').addEventListener('click', () => tocSheet('ch'));
function tocSheet(tab) {
  const b = readerBook, st = bookState(b.id);
  let body = '<div class="tabs"><button data-t="ch" aria-pressed="' + (tab === 'ch') + '">الفصول</button><button data-t="w" aria-pressed="' + (tab === 'w') + '">كلمات الرواية</button></div>';
  if (tab === 'ch') {
    body += '<ul class="toc">' + b.chapters.map((c, i) => {
      const doneCh = st.finished || i < st.ch;
      return '<li class="' + (i === curCh ? 'cur' : '') + '"><button data-c="' + i + '"><span class="n num">' + c.n + '</span><span class="tt">' + esc(c.title) + '</span>' + (doneCh ? '<span class="ck">✓</span>' : '') + '</button></li>';
    }).join('') + '</ul>';
  } else {
    const ws = Object.values(b.gloss).sort((x, y) => x.l.toLowerCase().localeCompare(y.l.toLowerCase()));
    body += '<p class="tip" style="margin:0 0 6px">' + ws.length + ' كلمة جديدة في هذه الرواية.</p><ul class="wl">' + ws.map(w => '<li><span><span class="w">' + esc(w.l) + '</span><br><span class="a ltr" style="font-family:var(--book)">' + esc(w.d) + '</span></span><span class="gar" style="font-size:1rem;white-space:nowrap">' + esc(w.ar) + '</span></li>').join('') + '</ul>';
  }
  openSheet(body);
  $('sheet').querySelectorAll('.tabs button').forEach(x => { x.onclick = () => tocSheet(x.dataset.t); });
  $('sheet').querySelectorAll('.toc button').forEach(x => { x.onclick = () => { closeSheet(); renderChapter(+x.dataset.c, 0); savePos(); }; });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('sheet').hidden) closeSheet(); else if (readerBook) closeReader(); } });

/* ---------- offline copy of the app ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {}); });
}

start();
