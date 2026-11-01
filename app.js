import { createSync } from './sync.js';

const L = ['a', 'b', 'c', 'd', 'e'];
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

let BANKS = store.get('qb:banks', []);   // subject list (titles + counts only), refreshed from Firebase
let bank = null;         // current bank data {id,title,chapters:[{title,count,questions?}]}
let prog = {};           // current bank progress { qid: {p,t} }
let ci = 0, qi = 0;
let sync = null, user = null, syncState = 'local';

/* ---------- progress (local first, synced when signed in) ---------- */
const progKey = id => 'qb:progress:' + id;
const pick = q => (prog[q.id] && prog[q.id].p) || null;
function setAnswer(qids, p) {
  const t = Date.now(), entries = {};
  qids.forEach(id => { prog[id] = { p, t }; entries[id] = { p, t }; });
  store.set(progKey(bank.id), prog);
  if (sync && user) { sync.write(bank.id, entries).catch(() => {}); setSyncState('pending'); }
}
// merge remote → local by newest timestamp; push local entries that are newer than remote
function mergeRemote(bankId, remote) {
  const local = bankId === (bank && bank.id) ? prog : store.get(progKey(bankId), {});
  const push = {};
  let changed = false;
  for (const [id, r] of Object.entries(remote)) {
    const l = local[id];
    if (!l || (r.t || 0) > (l.t || 0)) { local[id] = r; changed = true; }
  }
  for (const [id, l] of Object.entries(local)) {
    const r = remote[id];
    if (!r || (l.t || 0) > (r.t || 0)) push[id] = l;
  }
  store.set(progKey(bankId), local);
  if (Object.keys(push).length && sync && user) sync.write(bankId, push).catch(() => {});
  return changed;
}

/* ---------- sync status UI ---------- */
function setSyncState(s) {
  syncState = s;
  const dot = $('syncdot'), msg = $('syncmsg');
  const map = {
    local: ['off', sync ? 'Not signed in · answers saved on this device only' : 'Answers saved on this device'],
    ok: ['ok', 'Synced with your other devices'],
    pending: ['wait', navigator.onLine ? 'Syncing…' : 'Offline · will sync when back online'],
    offline: ['wait', 'Offline · will sync when back online'],
    error: ['wait', 'Sync paused · answers are safe on this device'],
  };
  const [c, m] = map[s] || map.local;
  dot.className = 'dot ' + c; msg.textContent = m;
}
window.addEventListener('online', () => syncState !== 'local' && setSyncState('pending'));
window.addEventListener('offline', () => syncState !== 'local' && setSyncState('offline'));

/* ---------- home ---------- */
function bankStats(b, p) {
  let a = 0, r = 0;
  for (const c of b.chapters) for (const q of (c.questions || [])) { const x = p[q.id] && p[q.id].p; if (x) { a++; if (x === q.answer) r++; } }
  return { a, r };
}
function renderHome() {
  if (sync && !user) { $('banklist').innerHTML = '<li class="loading">Sign in below to load your question banks.</li>'; return; }
  $('banklist').innerHTML = BANKS.map((b, i) => {
    const p = store.get(progKey(b.id), {});
    const done = Object.values(p).filter(x => x.p).length;
    return '<li><button class="ch subj" data-b="' + i + '"><span>' + esc(b.title) + '</span><span class="meta">' +
      (done ? '<b>' + done + '</b>/' : '') + b.count + ' Q</span></button></li>';
  }).join('') || '<li class="loading">No subjects yet.</li>';
}
$('banklist').addEventListener('click', e => { const b = e.target.closest('.ch'); if (b) openBank(+b.dataset.b); });

async function loadBank(meta) {
  const have = store.get('qb:bankver:' + meta.id, null);
  const b = await sync.loadBank(meta, have);
  if (!b.chapters.some(c => c.questions)) throw new Error('empty');
  store.set('qb:bankver:' + meta.id, meta.version);
  return b;
}
async function openBank(i) {
  const meta = BANKS[i];
  toast('Opening ' + meta.title + '…');
  try { bank = await loadBank(meta); } catch (e) { toast('This subject is not on this device yet. Open it once while online.'); return; }
  prog = store.get(progKey(bank.id), {});
  store.set('qb:last', bank.id);
  if (sync && user) watchBank();
  show('contents'); renderContents();
}
$('tohome').onclick = () => { show('home'); renderHome(); };

/* ---------- contents ---------- */
function chStats(c) {
  const qs = bank.chapters[c].questions || []; let a = 0, r = 0;
  qs.forEach(q => { const x = pick(q); if (x) { a++; if (x === q.answer) r++; } });
  return { a, r, n: qs.length };
}
function renderContents() {
  const total = bank.chapters.reduce((s, c) => s + c.count, 0);
  $('banktitle').textContent = bank.title;
  $('lede').textContent = bank.chapters.length + ' chapters · ' + total + ' questions' + (bank.pilot ? ' · pilot: chapter 1 only' : '');
  $('chlist').innerHTML = bank.chapters.map((c, i) => {
    const s = chStats(i), live = !!c.questions;
    const meta = !live ? 'full build' : (s.a ? '<b>' + s.r + '</b>/' + s.a + ' · ' + c.count + ' Q' : c.count + ' Q');
    return '<li><button class="ch" data-c="' + i + '"' + (live ? '' : ' disabled') + '><span class="num">' + String(i + 1).padStart(2, '0') +
      '</span><span>' + esc(c.title) + '</span><span class="meta">' + meta + '</span></button></li>';
  }).join('');
}
$('chlist').addEventListener('click', e => { const b = e.target.closest('.ch'); if (!b || b.disabled) return; openChapter(+b.dataset.c); });

function show(id) { ['home', 'contents', 'quiz'].forEach(s => $(s).hidden = s !== id); window.scrollTo(0, 0); }
function openChapter(c) {
  ci = c; const qs = bank.chapters[c].questions;
  const first = qs.findIndex(q => !pick(q)); qi = first < 0 ? 0 : first;
  $('chnum').textContent = 'Chapter ' + (c + 1); $('chname').textContent = bank.chapters[c].title;
  show('quiz'); renderQ();
}
$('back').onclick = () => { show('contents'); renderContents(); };

/* ---------- map ---------- */
function renderMap() {
  const qs = bank.chapters[ci].questions;
  $('mapgrid').innerHTML = qs.map((q, i) => {
    const x = pick(q); const cls = x ? (x === q.answer ? ' ok' : ' bad') : '';
    return '<button class="cell' + cls + (i === qi ? ' cur' : '') + '" data-i="' + i + '" aria-label="Question ' + q.n + '">' + q.n + '</button>';
  }).join('');
}
$('mapbtn').onclick = () => { const m = $('map'); m.hidden = !m.hidden; $('mapbtn').setAttribute('aria-expanded', String(!m.hidden)); };
$('mapgrid').addEventListener('click', e => { const b = e.target.closest('.cell'); if (!b) return; go(+b.dataset.i); $('map').hidden = true; $('mapbtn').setAttribute('aria-expanded', 'false'); });

/* ---------- question ---------- */
const copyText = q => q.stem + '\n\n' + L.map(k => k + ') ' + q.options[k]).join('\n');
window.__copyText = (c, i) => copyText(bank.chapters[c].questions[i]);

function renderQ() {
  if ($('quiz').hidden) return;
  const ch = bank.chapters[ci], q = ch.questions[qi], p = pick(q), s = chStats(ci);
  $('score').textContent = s.r + '/' + s.a;
  $('trackbar').style.width = (100 * s.a / s.n) + '%';
  let h = '<div class="qhead"><span class="qnum">Q' + q.n + ' <span style="color:var(--muted)">/ ' + ch.questions.length + '</span></span>';
  if (q.recall > 0) h += '<span class="tag">Recall ×' + q.recall + '</span>';
  h += '<span class="spacer"></span><button class="ghost copy" id="copy" title="Copy the question and its options"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>Copy</button></div>';
  h += '<p class="stem" data-role="stem">' + esc(q.stem) + '</p>';
  if (q.image) h += '<img class="qimg" src="' + esc(q.image) + '" alt="Image for question ' + q.n + '">';
  h += '<ul class="opts">' + L.map(k => {
    let cls = 'opt', mk = '';
    if (p) { if (k === q.answer) { cls += ' right'; mk = k === p ? 'Your answer ✓' : 'Correct'; } else if (k === p) { cls += ' wrong'; mk = 'Your answer ✗'; } else cls += ' dim'; }
    return '<li><button class="' + cls + '" data-k="' + k + '"' + (p ? ' disabled' : '') + '><span class="l">' + k + ')</span><span class="t" data-role="opt-' + k + '">' + esc(q.options[k]) + '</span><span class="mk">' + mk + '</span></button></li>';
  }).join('') + '</ul>';
  if (p) {
    const ok = p === q.answer;
    h += '<div class="why"><div class="verdict ' + (ok ? 'ok' : 'bad') + '">' + (ok ? 'Correct' : 'Incorrect') + '</div>';
    h += '<div class="ans"><span>ANSWER</span>' + q.answer + ') ' + esc(q.options[q.answer]) + '</div>';
    h += '<p class="rule">' + esc(q.rule) + '</p>';
    if (q.caution) h += '<div class="tip"><b>Exam tip</b> ' + esc(q.caution) + '</div>';
    h += '<details class="ev"><summary>Source and evidence</summary><div class="evb"><div class="src">' + esc(q.source) + '</div>' +
      (q.quote ? '<blockquote>' + esc(q.quote) + '</blockquote>' : '') +
      (q.url ? '<a href="' + esc(q.url) + '" target="_blank" rel="noopener">' + esc(q.url) + '</a>' : '') + '</div></details></div>';
  }
  if (s.a === s.n) {
    h += '<div class="done"><div class="eyebrow">Chapter complete</div><div class="big">' + s.r + ' / ' + s.n + '</div><div>' + Math.round(100 * s.r / s.n) + '% correct</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="ghost" id="reset">Start this chapter again</button><button class="ghost" id="tocont">Back to contents</button></div></div>';
  }
  h += '<p class="keys">Keys: <kbd>A</kbd>–<kbd>E</kbd> or <kbd>1</kbd>–<kbd>5</kbd> to answer · <kbd>←</kbd> <kbd>→</kbd> to move</p>';
  $('qbox').innerHTML = h;
  $('prev').disabled = qi === 0;
  $('next').textContent = qi === ch.questions.length - 1 ? 'Last question' : 'Next →';
  $('next').disabled = qi === ch.questions.length - 1;
  $('copy').onclick = () => doCopy(q);
  const r = $('reset'); if (r) r.onclick = resetChapter;
  const tc = $('tocont'); if (tc) tc.onclick = () => $('back').click();
  document.querySelectorAll('.opt').forEach(b => b.onclick = () => answer(b.dataset.k));
  renderMap();
}
function resetChapter() {
  const resetBtn = $('reset');
  if (resetBtn.dataset.armed !== '1') { resetBtn.dataset.armed = '1'; resetBtn.textContent = 'Tap again to clear this chapter'; return; }
  setAnswer(bank.chapters[ci].questions.map(q => q.id), null);
  qi = 0; renderQ(); window.scrollTo(0, 0);
}
function answer(k) { const q = bank.chapters[ci].questions[qi]; if (pick(q)) return; setAnswer([q.id], k); renderQ(); }
function go(i) { const n = bank.chapters[ci].questions.length; if (i < 0 || i >= n) return; qi = i; renderQ(); window.scrollTo(0, 0); }
$('prev').onclick = () => go(qi - 1); $('next').onclick = () => go(qi + 1);

let tt;
function toast(m) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 2200); }
function doCopy(q) {
  const txt = copyText(q);
  const fallback = () => {
    const ta = document.createElement('textarea'); ta.value = txt; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) {} ta.remove();
    toast(ok ? 'Copied' : 'Copy blocked · select the text by hand');
  };
  try { navigator.clipboard.writeText(txt).then(() => toast('Copied'), fallback); } catch (e) { fallback(); }
}
document.addEventListener('keydown', e => {
  if ($('quiz').hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (L.includes(k)) answer(k);
  else if (k.length === 1 && '12345'.includes(k)) answer(L[+k - 1]);
  else if (e.key === 'ArrowRight') go(qi + 1);
  else if (e.key === 'ArrowLeft') go(qi - 1);
});

/* ---------- account ---------- */
function watchBank() {
  sync.watch(bank.id, (remote, meta) => {
    if (!remote) { setSyncState('error'); return; }
    const changed = mergeRemote(bank.id, remote);
    if (changed) { prog = store.get(progKey(bank.id), {}); if (!$('quiz').hidden) renderQ(); else if (!$('contents').hidden) renderContents(); else renderHome(); }
    setSyncState(meta.pending ? 'pending' : (meta.fromCache || !navigator.onLine) ? 'offline' : 'ok');
  });
}
async function syncAllBanks() {
  // pull every subject once so the home screen counts match across devices
  for (const b of BANKS) {
    if (bank && b.id === bank.id) continue;
    await new Promise(res => {
      let done = false;
      sync.watch(b.id, (remote, meta) => {
        if (done) return;
        if (remote) mergeRemote(b.id, remote);
        if (!remote || !meta.fromCache || !navigator.onLine) { done = true; res(); }   // wait for the server copy when online
      });
      setTimeout(() => { if (!done) { done = true; res(); } }, 6000);
    });
  }
  if (bank) watchBank(); else sync.stop();
  if (!$('home').hidden) renderHome();
}
function errText(e) {
  const c = (e && e.code) || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Email or password is wrong.';
  if (c.includes('email-already-in-use')) return 'This email already has an account. Use Sign in.';
  if (c.includes('weak-password')) return 'Password needs at least 6 characters.';
  if (c.includes('invalid-email')) return 'This email address is not valid.';
  if (c.includes('network')) return 'No internet connection. Try again when you are online.';
  if (c.includes('too-many-requests')) return 'Too many tries. Wait a few minutes and try again.';
  return 'Could not finish that (' + (c || 'unknown error') + ').';
}
function accountUI() {
  $('acc-out').hidden = !sync || !!user;
  $('acc-in').hidden = !user;
  if (user) $('acc-who').textContent = user.email;
  if (!user) setSyncState('local');
}
async function accAction(fn) {
  const email = $('acc-email').value.trim(), pass = $('acc-pass').value, err = $('acc-err');
  err.hidden = true;
  if (!email || pass.length < 6) { err.textContent = 'Enter your email and a password of 6+ characters.'; err.hidden = false; return; }
  document.querySelectorAll('#acc-form button').forEach(b => b.disabled = true);
  try { await fn(email, pass); } catch (e) { err.textContent = errText(e); err.hidden = false; }
  document.querySelectorAll('#acc-form button').forEach(b => b.disabled = false);
}
$('acc-form').addEventListener('submit', e => { e.preventDefault(); accAction((a, b) => sync.signIn(a, b)); });
$('acc-signup').onclick = () => accAction((a, b) => sync.signUp(a, b));
$('acc-reset').onclick = async () => {
  const email = $('acc-email').value.trim(), err = $('acc-err');
  if (!email) { err.textContent = 'Type your email first, then tap Forgot password.'; err.hidden = false; return; }
  try { await sync.resetPassword(email); err.hidden = true; toast('Reset link sent to ' + email); } catch (e) { err.textContent = errText(e); err.hidden = false; }
};
$('acc-signout').onclick = async () => { sync.stop(); await sync.signOut(); };

/* ---------- start ---------- */
async function refreshBanks() {
  try { BANKS = await sync.listBanks(); store.set('qb:banks', BANKS); } catch (e) { /* keep the last list */ }
  renderHome();
  // keep a device copy of every subject so it opens without internet
  if (navigator.onLine) for (const m of BANKS) { try { await loadBank(m); } catch (e) {} }
}
async function importFile(file) {
  const msg = $('imp-msg'); msg.hidden = false; msg.textContent = 'Reading ' + file.name + '…';
  try {
    const b = JSON.parse(await file.text());
    if (!b.id || !b.title || !Array.isArray(b.chapters)) throw new Error('This file is not a question bank file.');
    msg.textContent = 'Uploading ' + b.title + ' to your account…';
    await sync.importBank(b);
    const n = b.chapters.reduce((s, c) => s + (c.questions ? c.questions.length : 0), 0);
    msg.textContent = b.title + ' saved: ' + n + ' questions.';
    await refreshBanks();
  } catch (e) {
    msg.textContent = (e && e.code && e.code.includes('permission')) ? 'Your account is not allowed to add subjects.' : 'Could not add the subject: ' + (e.message || e.code || e);
  }
}
$('imp-file').addEventListener('change', e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; });
window.__importBank = async b => { await sync.importBank(b); await refreshBanks(); return 'ok'; };

async function start() {
  renderHome();
  try { sync = await createSync(); } catch (e) { sync = null; }
  accountUI(); renderHome();
  if (sync) sync.onUser(async u => {
    user = u; accountUI(); renderHome();
    if (u) { setSyncState(navigator.onLine ? 'pending' : 'offline'); await refreshBanks(); syncAllBanks(); }
    else { BANKS = []; }
  });
}
start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
