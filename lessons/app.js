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
  $('contWrap').hidden = true;
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
function lessonCard(m, cont) {
  const p = progressOf(m);
  const el = document.createElement('button'); el.className = 'ls' + (cont ? ' cont' : '');
  el.innerHTML = '<div class="t">' + esc(m.title) + '</div>' +
    '<div class="meta">' + (cont ? esc(m.subject) + ' · ' : '') + (p.last ? 'أنهيت ' + p.done + ' من ' + p.total + ' أقسام · آخر فتح ' + ago(p.last) : (p.total ? p.total + ' أقسام · ' : '') + 'لم تفتحه بعد') + '</div>' +
    '<div class="pbar"><u style="width:' + p.pct + '%"></u></div>';
  el.addEventListener('click', () => openLesson(m.id));
  return el;
}
function renderHome() {
  if (!LIST) return;
  const q = ($('q').value || '').trim().toLowerCase();
  const all = LIST.slice().sort((a, b) => byName(a.subject, b.subject) || (a.order || 0) - (b.order || 0) || byName(a.title, b.title));
  const recent = all.filter(m => S.items[m.id] && S.items[m.id].last).sort((a, b) => S.items[b.id].last - S.items[a.id].last)[0];
  $('contWrap').hidden = !recent || !!q;
  if (recent) { $('cont').innerHTML = ''; $('cont').appendChild(lessonCard(recent, true)); }
  const L = $('list'); L.innerHTML = '';
  const shown = all.filter(m => !q || (m.title + ' ' + m.subject).toLowerCase().includes(q));
  if (!shown.length) { L.innerHTML = '<div class="empty">' + (all.length ? 'لا شيء يطابق البحث.' : 'لا توجد شروح بعد. أضف شرحًا من «إضافة شرح» في الأسفل.') + '</div>'; return; }
  let cur = null;
  for (const m of shown) {
    if (m.subject !== cur) { cur = m.subject; const h = document.createElement('h3'); h.className = 'subj'; h.textContent = cur; L.appendChild(h); }
    L.appendChild(lessonCard(m));
  }
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
