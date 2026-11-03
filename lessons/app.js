// شروح قيس — lessons app. Local-first: every lesson is kept on the device (Firestore's on-device cache),
// progress is kept in localStorage and synced to the owner's Firebase account whenever the internet is available.
import { createStore } from './store.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS_STATE = 'kais_lessons_v1', LS_LIST = 'kais_lessons_list', LS_VER = 'kais_lessons_cached';
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const byName = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/* ---------- state ---------- */
const blank = () => ({ v: 1, items: {}, ui: { open: null } });
let S = Object.assign(blank(), lsGet(LS_STATE, {}));
S.items = S.items || {}; S.ui = S.ui || { open: null };
let localT = 0;
function saveLocal(now) {
  const w = () => lsSet(LS_STATE, S);
  clearTimeout(localT); if (now) w(); else localT = setTimeout(w, 600);
}
const item = id => S.items[id] || (S.items[id] = { done: {}, total: 0, last: 0, pos: 0, at: 0 });

/* ---------- account + sync ---------- */
let store = null, user = null, writing = false, again = false, pushT = 0, firstServer = false;
function setSync(mode) {
  const el = $('sync');
  el.classList.toggle('on', mode === 'on');
  el.querySelector('span').textContent = mode === 'on' ? 'محفوظ في حسابك' : mode === 'wait' ? 'سيُرفع حين يعود الإنترنت' : 'محفوظ على هذا الجهاز';
}
// each lesson's progress travels as one unit: the newer copy wins
function merge(r) {
  if (!r || typeof r !== 'object') return false;
  let changed = false;
  for (const [id, it] of Object.entries(r.items || {})) {
    if (!it || typeof it !== 'object') continue;
    const mine = S.items[id];
    if (!mine || (it.at || 0) > (mine.at || 0)) { S.items[id] = Object.assign({ done: {} }, it); changed = true; }
  }
  return changed;
}
async function push() {
  if (!store || !user) return;
  if (writing) { again = true; return; }
  writing = true;
  try {
    const p = store.writeState(JSON.parse(JSON.stringify({ v: 1, items: S.items })));
    if (!navigator.onLine) setSync('wait');
    await p; setSync('on');
  } catch (e) { setSync('local'); }
  finally { writing = false; if (again) { again = false; push(); } }
}
function schedulePush(ms = 2000) { clearTimeout(pushT); pushT = setTimeout(push, ms); }

async function start() {
  LIST = lsGet(LS_LIST, null); renderHome();
  try { store = await createStore(); } catch (e) { store = null; }
  if (!store) { showSignedOut('تعذّر تشغيل الحفظ في الحساب. أعد فتح التطبيق وأنت متصل بالإنترنت مرة واحدة.'); return; }
  store.onUser(async u => {
    user = u;
    if (!u) { showSignedOut(); return; }
    $('signin').hidden = true; $('accIn').hidden = false; $('accWho').textContent = u.email || '';
    watchState();
    await refreshList();
  });
}
function watchState() {
  firstServer = false;
  store.watchState((data, meta) => {
    if (meta.error) { setSync('local'); return; }
    if (data && merge(data)) { saveLocal(); renderHome(); }
    if (!meta.fromCache) { setSync(meta.pending ? 'wait' : 'on'); if (!firstServer) { firstServer = true; push(); } }
  });
}
function showSignedOut(msg) {
  user = null; LIST = null;
  $('signin').hidden = false; $('accIn').hidden = true; setSync('local');
  $('monitor').hidden = true; monitorKey = '';
  $('list').innerHTML = '<div class="empty">' + esc(msg || 'سجّل الدخول لتظهر شروحك.') + '</div>';
}
$('sForm').addEventListener('submit', async e => {
  e.preventDefault();
  const em = $('sEmail').value.trim(), pw = $('sPass').value, err = $('sErr');
  err.hidden = true;
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

/* ---------- list of lessons ---------- */
let LIST = null; const PAGES = {};
async function refreshList() {
  try {
    LIST = await store.listLessons();
    lsSet(LS_LIST, LIST);
  } catch (e) {
    const deniedErr = e && /permission-denied/.test(e.code || '');
    if (!LIST) {
      $('list').innerHTML = '<div class="empty">' + (deniedErr
        ? 'رفض Firebase فتح الشروح، لأن قواعد Firestore لم تُحدَّث بعد. الصق القواعد الجديدة في Firebase واضغط Publish، ثم ارجع إلى هنا.'
        : 'تعذّر تحميل الشروح. افتح التطبيق وأنت متصل بالإنترنت مرة واحدة.') + '</div>';
      return;
    }
  }
  renderHome();
  prefetch();
}
// keep every lesson on the device, so it opens without internet later
let prefetching = false;
async function prefetch() {
  if (prefetching || !navigator.onLine || !LIST || !store || !user) return;
  prefetching = true;
  const ver = lsGet(LS_VER, {});
  for (const m of LIST) {
    if (ver[m.id] === m.version) continue;
    try { await store.loadParts(m, false); await store.loadImages(m, false); ver[m.id] = m.version; lsSet(LS_VER, ver); delete PAGES[m.id]; }
    catch (e) {}
  }
  prefetching = false;
}
window.addEventListener('online', () => { prefetch(); push(); });

function progressOf(m) {
  const it = S.items[m.id], total = (it && it.total) || m.sections || 0;
  const done = it ? Object.values(it.done || {}).filter(Boolean).length : 0;
  return { done, total, pct: total ? Math.round(100 * done / total) : 0, last: it ? it.last : 0 };
}
function ago(t) {
  if (!t) return '';
  const m = (Date.now() - t) / 60000; if (m < 60) return 'قبل قليل';
  const h = m / 60; if (h < 24) return 'اليوم';
  const d = Math.floor(h / 24); return d === 1 ? 'أمس' : d === 2 ? 'قبل يومين' : d <= 10 ? 'قبل ' + d + ' أيام' : 'قبل ' + d + ' يومًا';
}
// the heartbeat trace: drawn from the right (where reading starts) to how far you are in the lesson
function ecgPoints(xEnd) {
  const pts = [];
  for (let x = 400; x >= xEnd; x--) {
    const t = (400 - x) % 80; let y = 60;
    if (t >= 24 && t < 34) y = 60 - 5 * Math.sin(Math.PI * (t - 24) / 10);
    else if (t >= 40 && t < 42) y = 60 + 3 * (t - 40);
    else if (t >= 42 && t < 46) y = 66 - 13 * (t - 42);
    else if (t >= 46 && t < 50) y = 14 + 15.5 * (t - 46);
    else if (t >= 50 && t < 54) y = 76 - 4 * (t - 50);
    else if (t >= 54 && t < 68) y = 60 - 9 * Math.sin(Math.PI * (t - 54) / 14);
    pts.push(x + ',' + y.toFixed(1));
  }
  return pts;
}
function ecgSvg(frac) {
  const xEnd = Math.round(400 - (0.2 + 0.8 * Math.max(0, Math.min(1, frac))) * 400);   // always at least one beat
  const live = ecgPoints(xEnd), endY = live[live.length - 1].split(',')[1];
  return '<svg class="ecg" viewBox="0 0 400 96" preserveAspectRatio="none" aria-hidden="true">' +
    (xEnd > 0 ? '<line class="flat" x1="0" y1="60" x2="' + xEnd + '" y2="60" stroke-width="1.5" vector-effect="non-scaling-stroke"/>' : '') +
    '<polyline class="live" points="' + live.join(' ') + '" fill="none" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1">' +
    '<animate attributeName="stroke-dashoffset" from="1" to="0" dur="1.3s" begin="0.15s" fill="freeze" calcMode="spline" keySplines="0.3 0.7 0.2 1" keyTimes="0;1"/></polyline>' +
    '<circle class="halo" cx="' + xEnd + '" cy="' + endY + '" r="5"/><circle class="dot" cx="' + xEnd + '" cy="' + endY + '" r="3.6"/></svg>';
}
const partNo = t => { const m = /Part\s*(\d+)/i.exec(t || ''); return m ? m[1] : ''; };
const shortTitle = t => String(t || '').replace(/^\s*Part\s*\d+\s*[:\-–]?\s*/i, '');
const nLessons = n => n === 1 ? 'شرح واحد' : n === 2 ? 'شرحان' : n <= 10 ? n + ' شروح' : n + ' شرحًا';
let monitorKey = '';
function renderMonitor(all, q) {
  const mon = $('monitor');
  if (!all.length || q) { mon.hidden = true; return; }
  const recent = all.filter(m => S.items[m.id] && S.items[m.id].last).sort((a, b) => S.items[b.id].last - S.items[a.id].last)[0];
  const m = recent || all[0], p = progressOf(m);
  const key = m.id + ':' + p.done + '/' + p.total + ':' + !!recent;
  mon.hidden = false;
  if (key === monitorKey) return;          // draw the trace once, not on every refresh
  monitorKey = key;
  mon.classList.toggle('empty', !recent);
  mon.innerHTML =
    '<div class="lbl">' + (recent ? 'آخر ما فتحته في ' + esc(m.subject) : 'لم تبدأ بعد') + '</div>' +
    '<div class="ttl">' + esc(m.title) + '</div>' +
    '<div class="sub">' + (recent ? (p.done === p.total && p.total ? 'أنهيت كل الأقسام' : 'أنهيت <b>' + p.done + '</b> من ' + p.total + ' أقسام') + '، آخر فتح ' + ago(p.last) : (p.total ? p.total + ' أقسام تنتظرك' : '')) + '</div>' +
    '<a class="go" href="lesson.html?id=' + encodeURIComponent(m.id) + '">' + (recent ? 'تابع' : 'ابدأ') + '</a>' +
    ecgSvg(p.total ? p.done / p.total : 0);
  mon.querySelector('.go').addEventListener('click', e => { e.preventDefault(); openLesson(m.id); });
}
function lessonRow(m) {
  const p = progressOf(m), C = 138.2;
  const el = document.createElement('button'); el.className = 'row' + (p.total && p.done === p.total ? ' done' : '');
  const beads = p.total ? '<div class="beads" aria-hidden="true">' + Array.from({ length: p.total }, (_, i) => '<i' + (i < p.done ? ' class="on"' : '') + '></i>').join('') + '</div>' : '';
  el.innerHTML = '<span class="ring" aria-hidden="true"><svg viewBox="0 0 52 52"><circle class="tr" cx="26" cy="26" r="22" fill="none" stroke-width="5"/>' +
    '<circle class="pr" cx="26" cy="26" r="22" fill="none" stroke-width="5" stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '" data-to="' + (C * (1 - p.pct / 100)).toFixed(1) + '"/></svg>' +
    '<b>' + esc(partNo(m.title) || '•') + '</b></span>' +
    '<span><div class="t">' + esc(shortTitle(m.title) || m.title) + '</div>' + beads +
    '<div class="meta">' + (!p.last ? 'لم تفتحه بعد' : p.total && p.done === p.total ? 'أنهيت كل الأقسام' : 'أنهيت ' + p.done + ' من ' + p.total + '، آخر فتح ' + ago(p.last)) + '</div></span>';
  el.setAttribute('aria-label', m.title + '، ' + (p.total ? 'أنهيت ' + p.done + ' من ' + p.total + ' أقسام' : ''));
  el.addEventListener('click', () => openLesson(m.id));
  return el;
}
function renderHome() {
  if (!LIST) return;
  const q = ($('q').value || '').trim().toLowerCase();
  const all = LIST.slice().sort((a, b) => byName(a.subject, b.subject) || (a.order || 0) - (b.order || 0) || byName(a.title, b.title));
  renderMonitor(all, q);
  const L = $('list'); L.innerHTML = '';
  const shown = all.filter(m => !q || (m.title + ' ' + m.subject).toLowerCase().includes(q));
  if (!shown.length) { L.innerHTML = '<div class="empty">' + (all.length ? 'لا شيء يطابق البحث.' : 'لا توجد شروح بعد. أضف شرحًا من «إضافة شرح أو تحديثه» في الأسفل.') + '</div>'; return; }
  const groups = [];
  for (const m of shown) { let g = groups[groups.length - 1]; if (!g || g.subject !== m.subject) groups.push(g = { subject: m.subject, items: [] }); g.items.push(m); }
  for (const g of groups) {
    const sec = document.createElement('section'); sec.className = 'subj';
    sec.innerHTML = '<h2><small>' + nLessons(g.items.length) + '</small>' + esc(g.subject) + '</h2>';
    const rows = document.createElement('div'); rows.className = 'rows';
    g.items.forEach(m => rows.appendChild(lessonRow(m)));
    sec.appendChild(rows); L.appendChild(sec);
  }
  requestAnimationFrame(() => requestAnimationFrame(() => L.querySelectorAll('.ring .pr').forEach(c => { c.style.strokeDashoffset = c.dataset.to; })));
}
$('q').addEventListener('input', renderHome);

/* ---------- import a lesson file ---------- */
$('impFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (f) importText(await f.text());
});
async function importText(text) {
  const msg = $('impMsg'); msg.hidden = false;
  const say = t => { msg.textContent = t; };
  if (!navigator.onLine) { say('الإضافة تحتاج إنترنت. جرّب حين يعود الاتصال.'); return; }
  let data;
  try { data = JSON.parse(text); } catch (x) { say('هذا الملف ليس ملف شرح صالحًا.'); return; }
  const list = data && data.type === 'kais-lessons-bundle' && Array.isArray(data.lessons) ? data.lessons : [data];
  const ok = L => L && L.type === 'kais-lesson' && L.id && L.meta && Array.isArray(L.parts) && L.parts.length === L.meta.parts;
  if (!list.length || !list.every(ok)) { say('هذا الملف ليس ملف شرح صالحًا.'); return; }
  const done = [];
  for (let i = 0; i < list.length; i++) {
    const L = list[i], pre = list.length > 1 ? '(' + (i + 1) + '/' + list.length + ') ' : '';
    try {
      say(pre + 'جارٍ رفع «' + L.meta.title + '»…');
      await store.importLesson(L, step => say(pre + 'جارٍ رفع «' + L.meta.title + '»: ' + step));
      const ver = lsGet(LS_VER, {}); delete ver[L.id]; lsSet(LS_VER, ver); delete PAGES[L.id];
      done.push(L.meta.title);
    } catch (x) {
      say(pre + 'تعذّر رفع «' + L.meta.title + '» (' + ((x && x.code) || 'خطأ') + '). أُضيف قبله ' + done.length + '. أعد المحاولة والاتصال جيد.');
      await refreshList(); return;
    }
  }
  say(done.length === 1 ? 'أُضيف «' + done[0] + '». سيُحفظ على هذا الجهاز ويظهر في أجهزتك الأخرى.' : 'أُضيف ' + done.length + ' شروح.');
  await refreshList();
}

/* ---------- open a lesson ---------- */
// each lesson opens as a full page of its own (lesson.html), so its contents menu and links behave normally on phones
function openLesson(id) {
  if (!LIST || !LIST.some(l => l.id === id)) return;
  saveLocal(true); push();
  location.href = 'lesson.html?id=' + encodeURIComponent(id);
}
// coming back from a lesson: pick up the progress it saved on this device
window.addEventListener('pageshow', () => { const r = lsGet(LS_STATE, null); if (r && r.items && merge(r)) renderHome(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { saveLocal(true); push(); } });

start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {}); });
}
