// ميزان الحجج — local-first: the map and the examinations are kept on the device (Firestore's on-device cache, plus a
// copy in localStorage for an instant start); your reading marks, stance, notes and beliefs are kept in localStorage
// and synced to the owner's Firebase account whenever the internet is available.
import { createStore } from './store.js';

const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paras = t => String(t || '').split(/\n{2,}/).filter(p => p.trim()).map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
// rich text: blank line = new block; lines starting "• " = a list; a block starting "أي باختصار:" = the short restatement;
// a block starting "؟ " = a question to think about first, with its answer after " || " behind a tap
const rich = t => String(t || '').split(/\n{2,}/).filter(p => p.trim()).map(p => {
  p = p.trim();
  if (p.startsWith('؟ ')) { const [q, a] = p.slice(2).split(' || '); return '<details class="guess"><summary><span class="gk">توقّف وفكّر</span>' + esc(q) + '</summary><div class="ga">' + paras(a || '') + '</div></details>'; }
  const lines = p.split('\n');
  if (lines.every(l => l.startsWith('• '))) return '<ul>' + lines.map(l => '<li>' + esc(l.slice(2)) + '</li>').join('') + '</ul>';
  if (lines.length > 1 && lines.slice(1).every(l => l.startsWith('• ')) ) return '<p>' + esc(lines[0]) + '</p><ul>' + lines.slice(1).map(l => '<li>' + esc(l.slice(2)) + '</li>').join('') + '</ul>';
  if (p.startsWith('أي باختصار:')) return '<p class="brief">' + esc(p).replace(/\n/g, '<br>') + '</p>';
  return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
}).join('');
const LS_STATE = 'kais_mizan_v1', LS_CONTENT = 'kais_mizan_content', LS_OPEN = 'kais_mizan_open';
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const fmtDate = t => { try { return new Date(t).toLocaleDateString('ar-LY', { year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { return ''; } };

const LEVELS = { 1: 'المعرفة والعقل', 2: 'الكون', 3: 'الحياة', 4: 'الأخلاق والمعنى والدين', 5: 'النبوة والقرآن', 6: 'أحكام وقضايا اجتماعية', 7: 'الحضارة والعلمانية', 8: 'الأديان الأخرى والروحانيات', 9: 'توجيهي (ليس حجة)' };
const STEPS = [
  ['التأسيس', 'على ماذا تقف الحجة، ثم بناء كل قطعة منها من الصفر. في أول حجة من كل مجموعة يكون هذا درسًا كاملًا في العلم الذي تحتاجه.'],
  ['الحجة كما يقولها الكاتب', 'أقوى صياغة لها من كل المواضع التي وردت فيها، مفككة إلى مقدمات ونتيجة، مع نص الكاتب بجانب التبسيط.'],
  ['فحص كل مقدمة', 'كل مقدمة وحدها، بالأداة التي تناسب نوعها، مع حكم ومصدر ودرجة ثقة.'],
  ['أقوى اعتراض', 'أقوى ما يقوله المخالفون الجادون، بأسمائهم ومصادرهم.'],
  ['أقوى جواب على الاعتراض', 'من الكاتب أو من غيره من المدافعين، إن كان جوابهم أقوى.'],
  ['نقطة الحكم', 'ما ثبت، وما بقي مفتوحًا، وما يتوقف على معاييرك أنت، ثم أسئلة تختبر بها فهمك.'],
  ['المصادر', 'كل ما رجعنا إليه في هذا الفحص، لتراجعه بنفسك.'],
];
const VERDICTS = {
  true: ['صحيحة', '--v-true'], partial: ['صحيحة لكن ناقصة', '--v-partial'], disputed: ['مختلف فيها بين المختصين', '--v-disputed'],
  outdated: ['قديمة تجاوزها العلم', '--v-outdated'], false: ['خاطئة', '--v-false'], unverified: ['لم نستطع التحقق', '--v-unverified'],
};
const CONV = [[1, 'غير مقتنع'], [2, 'أميل إلى الرفض'], [3, 'متردد'], [4, 'أميل إلى القبول'], [5, 'مقتنع']];
const convLabel = v => (CONV.find(c => c[0] === v) || [0, ''])[1];

/* ---------- state ---------- */
const blank = () => ({ v: 1, items: {}, beliefs: null, history: [] });
let S = Object.assign(blank(), lsGet(LS_STATE, {}));
S.items = S.items || {}; S.history = S.history || [];
let C = lsGet(LS_CONTENT, null);          // { version, args, books, glossary, analyses }
function saveLocal() { lsSet(LS_STATE, S); }
const argsList = () => (C && C.args) || [];
const hasLesson = id => { const a = C && C.analyses && C.analyses[id]; return !!(a && a.foundation && a.foundation.lesson); };
const statusOf = id => { const a = C && C.analyses && C.analyses[id]; return !a ? 'none' : a.status === 'prog' ? 'prog' : 'done'; };

/* ---------- account + sync ---------- */
let store = null, user = null, writing = false, again = false, firstServer = false;
function setSync(mode) {
  const el = $('sync');
  el.classList.toggle('on', mode === 'on');
  el.querySelector('span').textContent = mode === 'on' ? 'محفوظ في حسابك' : mode === 'wait' ? 'سيُرفع حين يعود الإنترنت' : 'محفوظ على هذا الجهاز';
}
// the newer copy wins, one argument at a time; the beliefs as one unit; the history is the union of both
function merge(r) {
  if (!r || typeof r !== 'object') return false;
  let changed = false;
  for (const [id, it] of Object.entries(r.items || {})) {
    if (!it || typeof it !== 'object') continue;
    const mine = S.items[id];
    if (!mine || (it.at || 0) > (mine.at || 0)) { S.items[id] = it; changed = true; }
  }
  if (r.beliefs && (!S.beliefs || (r.beliefs.at || 0) > (S.beliefs.at || 0))) { S.beliefs = r.beliefs; changed = true; }
  const seen = new Set(S.history.map(h => h.at));
  for (const h of r.history || []) if (h && h.at && !seen.has(h.at)) { S.history.push(h); seen.add(h.at); changed = true; }
  if (changed) { S.history.sort((a, b) => a.at - b.at); S.history = S.history.slice(-50); }
  return changed;
}
async function push() {
  if (!store || !user) return;
  if (writing) { again = true; return; }
  writing = true;
  try {
    const p = store.writeState(JSON.parse(JSON.stringify({ v: 1, items: S.items, beliefs: S.beliefs || null, history: S.history })));
    if (!navigator.onLine) setSync('wait');
    await p; setSync('on');
  } catch (e) { setSync('local'); }
  finally { writing = false; if (again) { again = false; push(); } }
}

async function start() {
  render();
  try { store = await createStore(); } catch (e) { store = null; }
  if (!store) { showSignedOut('تعذّر تشغيل الحفظ في الحساب. أعد فتح التطبيق وأنت متصل بالإنترنت مرة واحدة.'); return; }
  store.onUser(async u => {
    user = u;
    if (!u) { showSignedOut(); return; }
    $('signin').hidden = true; $('accIn').hidden = false; $('accWho').textContent = u.email || '';
    watchState();
    await refreshContent();
  });
}
function watchState() {
  firstServer = false;
  store.watchState((data, meta) => {
    if (meta.error) { setSync('local'); return; }
    if (data && merge(data)) { saveLocal(); if (!editing()) render(); }
    // push once per account connection: never in answer to every snapshot
    if (!meta.fromCache) { setSync(meta.pending ? 'wait' : 'on'); if (!firstServer) { firstServer = true; push(); } }
  });
}
function showSignedOut(msg) {
  user = null;
  $('signin').hidden = false; $('accIn').hidden = true; setSync('local');
  if (!C) $('view').innerHTML = '<div class="empty">' + esc(msg || 'سجّل الدخول لتظهر الخريطة.') + '</div>';
}
let contentNote = '';
async function refreshContent() {
  try {
    const c = await store.loadContent(false);
    if (c) { C = c; lsSet(LS_CONTENT, C); contentNote = ''; }
    else if (!C) contentNote = 'لا توجد خريطة في حسابك بعد. اختر ملف «ميزان الحجج» من «تحديث الخريطة والفحوص» في الأسفل.';
  } catch (e) {
    const deniedErr = e && /permission-denied/.test(e.code || '');
    if (!C) contentNote = deniedErr
      ? 'رفض Firebase فتح الخريطة، لأن قواعد Firestore لم تُحدَّث بعد. الصق القواعد الجديدة في Firebase واضغط Publish، ثم ارجع إلى هنا.'
      : 'تعذّر تحميل الخريطة. افتح التطبيق وأنت متصل بالإنترنت مرة واحدة.';
  }
  if (!editing()) render();
}
window.addEventListener('online', () => { push(); if (store && user) refreshContent(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { saveLocal(); push(); } });
function editing() { const a = document.activeElement; return a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox' && a.id !== 'q' && a.id !== 'gq')); }

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

/* ---------- import the map and the examinations ---------- */
$('impFile').addEventListener('change', async e => {
  const f = e.target.files && e.target.files[0]; e.target.value = '';
  if (!f) return;
  const msg = $('impMsg'); msg.hidden = false;
  const say = t => { msg.textContent = t; };
  if (!navigator.onLine) { say('التحديث يحتاج إنترنت. جرّب حين يعود الاتصال.'); return; }
  let B;
  try { B = JSON.parse(await f.text()); } catch (x) { say('هذا الملف ليس ملف «ميزان الحجج».'); return; }
  const ok = B && B.type === 'kais-mizan' && B.version && Array.isArray(B.args) && B.args.length && Array.isArray(B.books) && Array.isArray(B.glossary) && B.analyses && typeof B.analyses === 'object';
  if (!ok) { say('هذا الملف ليس ملف «ميزان الحجج».'); return; }
  try {
    await store.importContent(B, step => say('جارٍ الرفع: ' + step));
    say('حُدّثت الخريطة: ' + B.args.length + ' حجة، و' + Object.keys(B.analyses).length + ' فحص. ستظهر في أجهزتك الأخرى أيضًا.');
  } catch (x) { say('تعذّر الرفع (' + ((x && x.code) || 'خطأ') + '). أعد المحاولة والاتصال جيد.'); }
  await refreshContent();
});

/* ---------- views ---------- */
function viewHome() {
  if (!C) return '<div class="empty">' + esc(contentNote || 'جارٍ تحميل الخريطة…') + '</div>';
  const A = argsList(), total = A.length;
  const done = A.filter(a => statusOf(a.id) === 'done').length;
  const read = A.filter(a => S.items[a.id] && S.items[a.id].read).length;
  const stance = A.filter(a => S.items[a.id] && S.items[a.id].conv).length;
  const mark = a => { const st = statusOf(a.id), it = S.items[a.id] || {};
    return '<a href="#arg-' + a.id + '" class="' + [st !== 'none' ? st : '', it.read ? 'read' : ''].join(' ').trim() + '" aria-label="الحجة ' + a.id + '" title="' + a.id + '"></a>'; };
  // one group per level, each as wide as its number of arguments
  const strip = Object.keys(LEVELS).map(lv => { const g = A.filter(a => String(a.level) === lv); return g.length ? '<span class="grp" style="flex:' + g.length + ';grid-template-columns:repeat(' + g.length + ',1fr)" title="' + LEVELS[lv] + '">' + g.map(mark).join('') + '</span>' : ''; }).join('');
  let h = '<section class="ledger"><div class="lbl">ما فحصناه من الحجج</div><div class="big">' + done + ' <small>من ' + total + '</small></div>' +
    '<div class="strip">' + strip + '</div>' +
    '<div class="legend"><span><i style="background:var(--acc)"></i>فُحصت</span><span><i style="background:var(--prog)"></i>قيد الفحص</span><span><i style="background:var(--brass)"></i>قرأتها (' + read + ')</span><span>سجّلت موقفك من ' + stance + '</span></div></section>';
  const nxt = A.find(a => statusOf(a.id) === 'done' && !(S.items[a.id] && S.items[a.id].read)) || A.find(a => statusOf(a.id) !== 'done');
  if (nxt) h += '<a class="next" href="#arg-' + nxt.id + '"><span><small>' + (statusOf(nxt.id) === 'done' ? 'فحص جاهز لم تقرأه' : 'الحجة التالية في الترتيب') + '</small>' + nxt.id + '. ' + esc(nxt.title) + '</span><span class="go">افتح</span></a>';
  h += '<input class="search" id="q" type="search" placeholder="ابحث في الحجج أو الكتب" aria-label="بحث" value="' + esc(Q.q) + '"><div id="ledger">' + ledger(Q.q) + '</div>';
  return h;
}
function ledger(q) {
  const qq = (q || '').trim();
  let h = '';
  for (const lv of Object.keys(LEVELS)) {
    const items = argsList().filter(a => String(a.level) === lv && (!qq || (a.title + ' ' + a.books + ' ' + a.type).includes(qq)));
    if (!items.length) continue;
    const d = items.filter(a => statusOf(a.id) === 'done').length;
    h += '<section class="level"><h2>' + lv + '. ' + LEVELS[lv] + '<small>' + d + ' من ' + items.length + '</small></h2><div class="rows">';
    for (const a of items) {
      const st = statusOf(a.id), it = S.items[a.id] || {};
      h += '<a class="row ' + st + '" href="#arg-' + a.id + '"><span class="num">' + a.id + '</span><span><div class="t">' + esc(a.title) + '</div><div class="meta"><span class="chip">' + esc(a.type) + '</span>' +
        (st === 'done' ? '<span class="chip">فُحصت</span>' : st === 'prog' ? '<span class="chip">قيد الفحص</span>' : '') +
        (hasLesson(a.id) ? '<span class="chip lesson">فيها درس</span>' : '') +
        (it.read ? '<span class="chip mine">قرأتها</span>' : '') + (it.conv ? '<span class="chip mine">موقفك: ' + convLabel(it.conv) + '</span>' : '') + '</div></span></a>';
    }
    h += '</div></section>';
  }
  return h || '<div class="empty">لا شيء يطابق البحث.</div>';
}
function stepBody(i, A) {
  if (!A) return null;
  const li = arr => '<ul>' + arr.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
  switch (i) {
    case 0: {
      const F = A.foundation; if (!F) return null;
      if (typeof F === 'string') return rich(F);
      let h = F.intro ? '<div class="stands">' + rich(F.intro) + '</div>' : '';
      if (F.ref) { const r = argsList().find(x => x.id === F.ref.id); h += '<a class="next brass lessonref" href="#arg-' + F.ref.id + '"><span><small>الدرس الكامل لهذه المجموعة</small>' + (r ? F.ref.id + '. ' + esc(r.title) : 'الحجة ' + F.ref.id) + (F.ref.note ? '<span class="rn">' + esc(F.ref.note) + '</span>' : '') + '</span><span class="go">افتح</span></a>'; }
      const open = lsGet(LS_OPEN, {})[CUR] || [];
      (F.sections || []).forEach((x, k) => { h += '<details class="sec" data-k="' + k + '"' + (open.includes(k) ? ' open' : '') + '><summary><span class="sk">' + (k + 1) + '</span>' + esc(x.h) + '</summary><div class="sb">' + rich(x.b) + '</div></details>'; });
      return h;
    }
    case 1: {
      const g = A.argument; if (!g) return null;
      let h = g.intro ? rich(g.intro) : '';
      (g.premises || []).forEach((p, k) => { h += '<div class="premise"><b>المقدمة ' + (k + 1) + ':</b> ' + esc(p) + '</div>'; });
      if (g.conclusion) h += '<div class="premise c"><b>النتيجة:</b> ' + esc(g.conclusion) + '</div>';
      if (g.quote) h += '<div class="quote">«' + esc(g.quote.text) + '»<cite>' + esc(g.quote.src) + '</cite></div>';
      return h;
    }
    case 2: {
      if (!A.checks || !A.checks.length) return null;
      return A.checks.map(c => {
        const v = VERDICTS[c.v] || VERDICTS.unverified;
        return '<div class="premise"><b>' + esc(c.p) + '</b><div style="margin-top:6px"><span class="verdict" style="background:var(' + v[1] + ')">' + v[0] + '</span>' + (c.c ? '<span class="src">درجة الثقة: ' + esc(c.c) + '</span>' : '') + '</div>' + rich(c.e) + (c.s ? '<div class="src">المصدر: ' + esc(c.s) + '</div>' : '') + '</div>';
      }).join('');
    }
    case 3: return A.objection ? rich(A.objection) : null;
    case 4: return A.reply ? rich(A.reply) : null;
    case 5: {
      const s = A.summary; if (!s) return null;
      let h = '';
      if (s.established && s.established.length) h += '<h3>ما ثبت</h3>' + li(s.established);
      if (s.open && s.open.length) h += '<h3>ما بقي مفتوحًا</h3>' + li(s.open);
      if (s.yours && s.yours.length) h += '<h3>ما يتوقف على معاييرك</h3>' + li(s.yours);
      if (A.questions && A.questions.length) h += '<div class="qs"><h3>أسئلة لنفسك</h3><ol>' + A.questions.map(q => '<li>' + esc(q) + '</li>').join('') + '</ol><p class="tip">فكّر فيها قبل أن تكمل. إن لم تقدر، ارجع إلى خطوة «فحص كل مقدمة».</p></div>';
      return h || null;
    }
    case 6: {
      if (!A.sources || !A.sources.length) return null;
      return '<ul>' + A.sources.map(x => '<li class="src">' + (x.u && /^https:\/\//.test(x.u) ? '<a href="' + esc(x.u) + '" target="_blank" rel="noopener">' + esc(x.t) + '</a>' : esc(x.t)) + '</li>').join('') + '</ul>';
    }
  }
  return null;
}
let CUR = null;
function viewArg(id) {
  CUR = id;
  if (!C) return viewHome();
  const a = argsList().find(x => x.id === id);
  if (!a) return '<div class="empty">لا توجد حجة بهذا الرقم. <a href="#home">ارجع إلى الخريطة</a></div>';
  const A = C.analyses && C.analyses[id], it = S.items[id] || {}, st = statusOf(id);
  const terms = (C.glossary || []).filter(g => (g.a || []).includes(id));
  let h = '<div class="crumb"><a href="#home">الخريطة</a> ← ' + a.level + '. ' + LEVELS[a.level] + '</div>' +
    '<section class="card claim"><div class="k">الحجة ' + a.id + ' · ' + esc(a.type) + ' · ' + (st === 'done' ? 'فُحصت' : st === 'prog' ? 'قيد الفحص' : 'لم تُفحص بعد') + '</div><h1>' + esc(a.title) + '</h1><div class="facts">' +
    (a.prereq ? '<div class="fact"><span class="k">ما نحتاجه قبلها</span>' + esc(a.prereq) + '</div>' : '') +
    '<div class="fact"><span class="k">أين وردت في الكتب</span>' + esc(a.books) + '</div>' +
    (terms.length ? '<div class="fact"><span class="k">مصطلحات تحتاجها</span><div class="links">' + terms.map(t => '<a href="#glossary" data-term="' + esc(t.t) + '">' + esc(t.t) + '</a>').join('') + '</div></div>' : '') +
    (A && A.date ? '<div class="fact"><span class="k">آخر تحديث للفحص</span>' + esc(A.date) + '</div>' : '') + '</div></section>';
  if (!A) h += '<div class="banner">لم نفحص هذه الحجة بعد. حين نفحصها معًا في المحادثة، تصلك نتيجة كل خطوة هنا.</div>';
  h += '<ol class="steps">' + STEPS.map((s, i) => { const b = stepBody(i, A); return '<li class="step' + (b ? '' : ' empty') + '"><div class="sh"><span class="sn">' + (i + 1) + '</span><h3>' + s[0] + '</h3></div><div class="body">' + (b || esc(s[1])) + '</div></li>'; }).join('') + '</ol>';
  h += '<section class="card mybox"><h2>موقفي</h2>' +
    '<label class="chk"><input type="checkbox" id="rd"' + (it.read ? ' checked' : '') + '> قرأت فحص هذه الحجة</label>' +
    '<p class="tip">إلى أي حد تقنعك هذه الحجة الآن؟</p><div class="scale" role="group" aria-label="درجة الاقتناع">' +
    CONV.map(c => '<button type="button" data-v="' + c[0] + '" aria-pressed="' + (it.conv === c[0]) + '">' + c[1] + '</button>').join('') + '</div>' +
    '<label for="nt" class="tip">ملاحظاتي: ما الذي أقنعني، وما الذي لم يقنعني، وما سؤالي التالي؟</label><textarea id="nt">' + esc(it.note || '') + '</textarea>' +
    '<div class="actions"><button class="btn" id="sv" type="button">احفظ</button><span class="saved" id="svs">' + (it.at ? 'آخر حفظ: ' + fmtDate(it.at) : '') + '</span></div></section>';
  const A2 = argsList(), ix = A2.indexOf(a), prev = A2[ix - 1], next = A2[ix + 1];
  h += '<div class="pager">' + (prev ? '<a href="#arg-' + prev.id + '"><small>السابقة</small>' + prev.id + '. ' + esc(prev.title) + '</a>' : '<span></span>') +
    (next ? '<a class="nx" href="#arg-' + next.id + '"><small>التالية</small>' + next.id + '. ' + esc(next.title) + '</a>' : '<span></span>') + '</div>';
  return h;
}
function bindArg(id) {
  document.querySelectorAll('details.sec').forEach(d => d.addEventListener('toggle', () => {
    const all = lsGet(LS_OPEN, {}); all[id] = [...document.querySelectorAll('details.sec[open]')].map(x => +x.dataset.k); lsSet(LS_OPEN, all);
  }));
  let conv = (S.items[id] || {}).conv || null;
  document.querySelectorAll('.scale button').forEach(b => b.addEventListener('click', () => {
    const v = +b.dataset.v; conv = conv === v ? null : v;
    document.querySelectorAll('.scale button').forEach(x => x.setAttribute('aria-pressed', String(+x.dataset.v === conv)));
  }));
  const save = () => {
    S.items[id] = { read: $('rd').checked, conv: conv, note: $('nt').value, at: Date.now() };
    saveLocal(); push();
    $('svs').textContent = 'حُفظ ' + fmtDate(Date.now()) + (user ? '' : '، على هذا الجهاز');
  };
  $('sv').addEventListener('click', save);
  $('rd').addEventListener('change', save);
}
function viewMethod() {
  const card = (t, body) => '<section class="card"><h2>' + t + '</h2>' + body + '</section>';
  return '<section><h1>طريقة الفحص</h1><p>نتعلم هنا كما تتعلم في الجامعة: نبني الأساس من الصفر، ونفهم الآلية، ثم نصل إلى الحكم بأنفسنا. والفرق الوحيد أن الكتاب هنا ليس مرجعًا موثوقًا نشرحه، بل هو موضوع الفحص نفسه.</p></section>' +
    card('كيف يُكتب الشرح', '<ul><li>جملة قصيرة، فيها فكرة واحدة. وكلمات من الحياة اليومية.</li><li>لكل فكرة صعبة صورة محسوسة، وبعدها سطر يبدأ بـ«أي باختصار».</li><li>لا «كما تعلم» ولا «من المعروف». كل ما نحتاجه نبنيه من الصفر.</li><li>أسألك قبل أن أجيب. تجد في الشرح صناديق «توقّف وفكّر»: فكّر أولًا، ثم افتح الجواب.</li><li>كل حكم يخرج من الشرح نفسه، فتستطيع أن تصل إليه بنفسك، لا أن تحفظه.</li></ul>') +
    card('المجموعات والدروس', '<p>الحجج مقسمة إلى مجموعات حسب العلم الذي تحتاجه: المعرفة، ثم الكون، ثم الحياة، وهكذا. وأول حجة في كل مجموعة يبدأ «التأسيس» فيها بدرس كامل في هذا العلم، مقسم إلى أقسام تفتحها واحدًا واحدًا. وفي باقي حجج المجموعة تجد تذكيرًا قصيرًا ورابطًا إلى الدرس.</p><p class="tip">في الدرس: ما يتفق عليه المختصون، وما يختلفون فيه، وما زال مجهولًا، وأشهر أخطاء الفهم، وأقوى ما يقوله الطرفان.</p>') +
    '<ol class="steps">' + STEPS.map((s, i) => '<li class="step"><div class="sh"><span class="sn">' + (i + 1) + '</span><h3>' + s[0] + '</h3></div><div class="body"><p>' + esc(s[1]) + '</p></div></li>').join('') + '</ol>' +
    card('ما يختلف عن دراسة الطب', '<ul><li>ملخص الطب مدقق، فنشرحه كما هو. أما كتب الكاتب فنتحقق من كل معلومة فيها بمصدر متخصص.</li><li>في الطب يكفيك الجواب الصحيح. هنا لا تحكم حكمًا عادلًا حتى ترى أقوى ما يقوله الطرف الآخر.</li><li>في الطب للسؤال قرار واحد. هنا نصل إلى ثلاثة أشياء: ما ثبت، وما بقي مفتوحًا، وما يتوقف على معاييرك. والحكم في الأسئلة الكبرى لك وحدك.</li></ul>') +
    card('كيف تُفحص المقدمة حسب نوعها', '<h3 style="margin-top:14px">المقدمة العلمية</h3><p>نقارنها بما يقوله العلم اليوم في مصادر متخصصة، وننتبه إلى تاريخ المعلومة.</p><h3>النقل عن شخص</h3><p>نرجع إلى المصدر الأصلي: هل نُقل الكلام بدقة، وفي سياقه، وبالمعنى الذي قصده صاحبه؟</p><h3>المقدمة الفلسفية</h3><p>هل هي مسلّمة أصلًا، أم يختلف فيها الفلاسفة؟ وهل تلزم النتيجة منها فعلًا، أم في الطريق قفزة؟</p><h3>الادعاء التاريخي أو النصي</h3><p>نسأل عن المصدر وتاريخ تدوينه، وعن اللغة الأصلية للنص، وعن تفسير أصحاب النص أنفسهم له.</p>') +
    '<section class="card"><h2>أحكام المقدمات</h2><div class="vlist">' + Object.values(VERDICTS).map(v => '<span class="verdict" style="background:var(' + v[1] + ')">' + v[0] + '</span>').join('') + '</div>' +
    '<p class="tip" style="margin-top:12px">مع كل حكم نذكر المصدر ودرجة الثقة.</p></section>';
}
function viewGlossary() {
  if (!C) return viewHome();
  return '<section><h1>المسرد</h1><p class="tip">شرح مبسط لكل مصطلح يمر في الفحوص. يزداد مع كل حجة نفحصها.</p></section>' +
    '<input class="search" id="gq" type="search" placeholder="ابحث عن مصطلح" aria-label="ابحث عن مصطلح" value="' + esc(Q.gq) + '"><div class="list" id="glist">' + glist(Q.gq) + '</div>';
}
function glist(q) {
  const qq = (q || '').trim().toLowerCase();
  const items = (C.glossary || []).filter(g => !qq || g.t.includes(qq) || String(g.en).toLowerCase().includes(qq) || g.d.includes(qq));
  return items.map(g => '<div class="card term"><h3>' + esc(g.t) + '</h3><div class="en">' + esc(g.en) + '</div><p>' + esc(g.d) + '</p>' +
    ((g.a || []).length ? '<div class="links">' + g.a.map(i => '<a href="#arg-' + i + '">الحجة ' + i + '</a>').join('') + '</div>' : '') + '</div>').join('') || '<div class="empty">لا يوجد مصطلح يطابق البحث.</div>';
}
function viewBooks() {
  if (!C) return viewHome();
  const groups = { 'بصائر': 'عائلة «بصائر»', 'العودة': 'عائلة «العودة إلى الإيمان»', 'مستقلة': 'كتب مستقلة ومجموعات', 'كتيبات': 'كتيبات الأسئلة والأجوبة', 'أديان': 'الأديان الأخرى والروحانيات' };
  let h = '<section><h1>الكتب</h1><p class="tip">28 كتابًا، كثير منها فصول من كتاب أكبر. هذه علاقة كل كتاب بالآخر.</p></section>';
  for (const g of Object.keys(groups)) {
    const items = (C.books || []).filter(b => b.g === g);
    if (!items.length) continue;
    h += '<section class="level"><h2>' + groups[g] + '<small>' + items.reduce((s, b) => s + b.p, 0) + ' صفحة</small></h2><div class="card">' +
      items.map(b => '<div class="book"><b>' + esc(b.n) + '</b><span class="pg">' + b.p + ' ص</span><span class="r">' + esc(b.r) + '</span><span class="s">' + esc(b.s) + '</span></div>').join('') + '</div></section>';
  }
  return h;
}

/* ---------- router ---------- */
const Q = { q: '', gq: '' };
const route = () => (location.hash || '#home').slice(1) || 'home';
function render() {
  const r = route(), v = $('view');
  document.querySelectorAll('.tabs a').forEach(a => a.classList.toggle('on', a.dataset.r === r || (r.startsWith('arg-') && a.dataset.r === 'home')));
  $('set').hidden = r !== 'home';
  if (r.startsWith('arg-')) { const id = parseInt(r.slice(4), 10); v.innerHTML = viewArg(id); if (C && argsList().some(x => x.id === id)) bindArg(id); return; }
  if (r === 'method') { v.innerHTML = viewMethod(); return; }
  if (r === 'glossary') { v.innerHTML = viewGlossary(); const g = $('gq'); if (g) g.addEventListener('input', e => { Q.gq = e.target.value; $('glist').innerHTML = glist(Q.gq); }); return; }
  if (r === 'books') { v.innerHTML = viewBooks(); return; }
  v.innerHTML = viewHome();
  const q = $('q'); if (q) q.addEventListener('input', e => { Q.q = e.target.value; $('ledger').innerHTML = ledger(Q.q); });
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
document.addEventListener('click', e => { const t = e.target.closest('a[data-term]'); if (t) Q.gq = t.dataset.term; });

start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {}); });
}
