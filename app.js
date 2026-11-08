import { createSync } from './sync.js';

const L = ['a', 'b', 'c', 'd', 'e'];
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

let BANKS = store.get('qb:banks', []);   // subject list (titles + counts only)
let bank = null;                          // current subject {id,title,chapters:[{title,count,questions?}]}
let prog = {};                            // current subject progress { qid: {p,t} }
let sync = null, user = null, syncState = 'local';
let filter = 'all';
// a quiz session: one chapter, or the review of incorrect answers
let S = null;   // { kind:'chapter'|'review', ci, title, label, items:[q], rev:{qid:letter} }
let qi = 0;

/* ---------- device data ---------- */
function wipeLocal() {
  try { Object.keys(localStorage).filter(k => k.startsWith('qb:')).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  BANKS = []; bank = null; prog = {}; S = null;
}

/* ---------- progress (local first, synced when signed in) ---------- */
const progKey = id => 'qb:progress:' + id;
const saved = q => (prog[q.id] && prog[q.id].p) || null;
const pick = q => S && S.kind === 'review' ? (S.rev[q.id] || null) : saved(q);
function setAnswer(qids, p) {
  const t = Date.now(), entries = {};
  qids.forEach(id => { prog[id] = { p, t }; entries[id] = { p, t }; });
  store.set(progKey(bank.id), prog);
  if (sync && user) { sync.write(bank.id, entries).catch(() => {}); setSyncState('pending'); }
}
function mergeRemote(bankId, remote) {
  const local = bankId === (bank && bank.id) ? prog : store.get(progKey(bankId), {});
  const push = {}; let changed = false;
  for (const [id, r] of Object.entries(remote)) { const l = local[id]; if (!l || (r.t || 0) > (l.t || 0)) { local[id] = r; changed = true; } }
  for (const [id, l] of Object.entries(local)) { const r = remote[id]; if (!r || (l.t || 0) > (r.t || 0)) push[id] = l; }
  store.set(progKey(bankId), local);
  if (Object.keys(push).length && sync && user) sync.write(bankId, push).catch(() => {});
  return changed;
}

/* ---------- sync status ---------- */
function setSyncState(s) {
  syncState = s;
  const map = {
    local: ['off', sync ? 'Not signed in' : 'Answers saved on this device'],
    ok: ['ok', 'Synced with your other devices'],
    pending: ['wait', navigator.onLine ? 'Syncing…' : 'Offline · will sync when back online'],
    offline: ['wait', 'Offline · will sync when back online'],
    error: ['wait', 'Sync paused · answers are safe on this device'],
  };
  const [c, m] = map[s] || map.local;
  $('syncdot').className = 'dot ' + c; $('syncmsg').textContent = m;
}
window.addEventListener('online', () => syncState !== 'local' && setSyncState('pending'));
window.addEventListener('offline', () => syncState !== 'local' && setSyncState('offline'));

/* ---------- text size (kept per device, survives sign-out) ---------- */
const TS = [{ v: 1, n: 'Normal' }, { v: 1.15, n: 'Large' }, { v: 1.3, n: 'Larger' }, { v: 1.45, n: 'Extra large' }, { v: 1.6, n: 'Huge' }];
let tsi = (() => { try { const v = localStorage.getItem('ui:textsize'); if (v !== null && TS[+v]) return +v; } catch (e) {} return innerWidth <= 600 ? 1 : 0; })();
function applyTextSize(toastIt) {
  document.documentElement.style.setProperty('--ts', TS[tsi].v);
  try { localStorage.setItem('ui:textsize', String(tsi)); } catch (e) {}
  const g = document.getElementById('tsz');
  if (g) g.innerHTML = TS.map((t, i) => '<button data-i="' + i + '" class="' + (i === tsi ? 'on' : '') + '" aria-pressed="' + (i === tsi) + '" title="' + t.n + '">A</button>').join('');
  if (g) g.querySelectorAll('button').forEach((b, i) => { b.style.fontSize = (13 + i * 3) + 'px'; });
  if (toastIt) toast('Text size: ' + TS[tsi].n);
}
document.getElementById('tsz').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { tsi = +b.dataset.i; applyTextSize(false); } });
document.getElementById('qsize').addEventListener('click', () => { tsi = (tsi + 1) % TS.length; applyTextSize(true); });
applyTextSize(false);

/* ---------- motion ---------- */
const REDUCE = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
function replay(el, cls) { if (!el || REDUCE) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
function countTo(el, to, suffix) {
  suffix = suffix || ''; el.dataset.v = to + suffix;
  const from = parseInt(el.textContent, 10);
  if (REDUCE || isNaN(from) || from === to) { el.textContent = to + suffix; return; }
  const t0 = performance.now(), d = 650;
  const step = t => { const k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3);
    if (el.dataset.v !== to + suffix) return;
    el.textContent = Math.round(from + (to - from) * e) + suffix; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
function confetti() {
  if (REDUCE) return;
  const cv = document.createElement('canvas'); cv.className = 'confetti'; document.body.appendChild(cv);
  const W = cv.width = innerWidth * devicePixelRatio, H = cv.height = innerHeight * devicePixelRatio, ctx = cv.getContext('2d');
  const cols = ['#1E3A8A', '#16A34A', '#F59E0B', '#3B82F6', '#DC2626'];
  const ps = Array.from({ length: 90 }, () => ({ x: W / 2 + (Math.random() - .5) * W * .3, y: H * .35, vx: (Math.random() - .5) * 14 * devicePixelRatio,
    vy: (-Math.random() * 14 - 6) * devicePixelRatio, r: (4 + Math.random() * 5) * devicePixelRatio, a: Math.random() * 6, va: (Math.random() - .5) * .3, c: cols[Math.random() * 5 | 0] }));
  const t0 = performance.now();
  const frame = t => {
    ctx.clearRect(0, 0, W, H); const k = (t - t0) / 1600;
    ps.forEach(p => { p.vy += .45 * devicePixelRatio; p.x += p.vx; p.y += p.vy; p.a += p.va; ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); ctx.restore(); });
    if (k < 1) requestAnimationFrame(frame); else cv.remove();
  };
  requestAnimationFrame(frame);
}
let animHome = true;   // animate bars/rows the next time home is drawn

/* ---------- screens + tab bar ---------- */
function show(id) {
  const was = ['home', 'account', 'quiz'].find(s => !$(s).hidden);
  ['home', 'account', 'quiz'].forEach(s => $(s).hidden = s !== id);
  if (was !== id) { replay($(id), 'enter'); if (id === 'home') { animHome = true; renderHome(); } }
  $('tabbar').hidden = id === 'quiz';
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('on', b.dataset.t === (id === 'home' && filter === 'wrong' ? 'wrong' : id)));
  window.scrollTo(0, 0);
}
$('tabbar').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.t === 'account') return show('account');
  setFilter(b.dataset.t === 'wrong' ? 'wrong' : 'all'); show('home');
});
$('go-account').onclick = () => show('account');

/* ---------- home ---------- */
const allQs = () => bank ? bank.chapters.flatMap(c => c.questions || []) : [];
function chStats(c) {
  const qs = bank.chapters[c].questions || []; let a = 0, r = 0;
  qs.forEach(q => { const x = saved(q); if (x) { a++; if (x === q.answer) r++; } });
  return { a, r, n: qs.length };
}
const wrongQs = () => allQs().filter(q => { const x = saved(q); return x && x !== q.answer; });
function setFilter(f) {
  filter = f;
  document.querySelectorAll('#filters .pill').forEach(p => p.classList.toggle('on', p.dataset.f === f));
  renderHome();
}
$('filters').addEventListener('click', e => { const p = e.target.closest('.pill'); if (p) { setFilter(p.dataset.f); show('home'); } });
$('subjects').addEventListener('click', e => { const p = e.target.closest('.pill'); if (p) openBank(p.dataset.id); });

function renderHome() {
  const out = sync && !user;
  $('signedout').hidden = !out;
  $('filters').hidden = out || !bank;
  $('subjects').hidden = out || BANKS.length < 2;
  $('subjects').innerHTML = BANKS.map(b => '<button class="pill' + (bank && b.id === bank.id ? ' on' : '') + '" data-id="' + esc(b.id) + '">' + esc(b.title) + '</button>').join('');
  $('banktitle').textContent = bank ? bank.title : 'Question Bank';
  const qs = allQs(); let a = 0, r = 0;
  qs.forEach(q => { const x = saved(q); if (x) { a++; if (x === q.answer) r++; } });
  countTo($('k-ans'), a); if (a) countTo($('k-pct'), Math.round(100 * r / a), '%'); else { $('k-pct').textContent = '—'; $('k-pct').dataset.v = '—'; } countTo($('k-left'), qs.length - a);
  const w = a - r; $('wrongcount').textContent = w ? '(' + w + ')' : '';
  if (out || !bank) { $('chlist').innerHTML = ''; $('wrongview').hidden = true; $('lede').textContent = ''; $('loading').hidden = out || !!bank || !BANKS.length;
    if (!out && user && !BANKS.length) { $('loading').hidden = false; $('loadmsg').textContent = 'No subjects yet. Add one from the Account tab.'; }
    return; }
  $('loading').hidden = true;
  $('chlist').hidden = filter !== 'all'; $('wrongview').hidden = filter !== 'wrong';
  if (filter === 'all') {
    $('chlist').innerHTML = bank.chapters.map((c, i) => {
      const live = !!c.questions; const s = live ? chStats(i) : { a: 0, r: 0, n: Number(c.count) || 0 };
      const pct = s.a ? Math.round(100 * s.r / s.a) : null;
      const cls = pct === null ? 'none' : pct >= 75 ? 'hi' : pct >= 60 ? 'mid' : 'lo';
      const sub = !live ? 'Coming in the full build' : s.a ? s.a + ' of ' + s.n + ' answered' : s.n + ' questions';
      return '<li><button class="row" data-c="' + i + '"' + (live ? '' : ' disabled') + '><span class="n">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span><span class="t">' + esc(c.title) + '</span><span class="sub">' + sub + '</span>' +
        '<span class="seg"><i class="g" data-w="' + (s.n ? 100 * s.r / s.n : 0) + '"></i><i class="r" data-w="' + (s.n ? 100 * (s.a - s.r) / s.n : 0) + '"></i></span></span>' +
        '<span class="s ' + cls + '">' + (pct === null ? '—' : pct + '%') + '</span></button></li>';
    }).join('');
    const bars = document.querySelectorAll('#chlist [data-w]');
    if (animHome && !REDUCE) {
      document.querySelectorAll('#chlist li').forEach((li, i) => { li.style.animationDelay = Math.min(i, 14) * 28 + 'ms'; li.classList.add('rise'); });
      requestAnimationFrame(() => requestAnimationFrame(() => bars.forEach(el => { el.style.width = el.dataset.w + '%'; })));
    } else bars.forEach(el => { el.classList.add('now'); el.style.width = el.dataset.w + '%'; });
    animHome = false;
    $('lede').textContent = bank.chapters.length + ' chapters · ' + bank.chapters.reduce((t, c) => t + (Number(c.count) || 0), 0) + ' questions' + (bank.pilot ? ' · pilot: chapter 1 only' : '');
  } else {
    const wq = wrongQs();
    if (!wq.length) { $('wrongview').innerHTML = '<div class="wrongcard"><div class="big ok">0</div><p>No incorrect answers right now. Questions you get wrong will gather here so you can redo them.</p></div>'; }
    else {
      const per = bank.chapters.map((c, i) => ({ i, t: c.title, n: (c.questions || []).filter(q => wq.includes(q)).length })).filter(x => x.n);
      $('wrongview').innerHTML = '<div class="wrongcard"><div class="big">' + wq.length + '</div><p>questions you answered incorrectly. Redo them here; your first answers stay as they are.</p>' +
        '<button class="btn primary wide" id="startreview">Redo incorrect questions</button><ul class="wlist">' +
        per.map(x => '<li><span>' + String(x.i + 1).padStart(2, '0') + ' · ' + esc(x.t) + '</span><b>' + x.n + '</b></li>').join('') + '</ul></div>';
      $('startreview').onclick = startReview;
    }
    $('lede').textContent = '';
  }
}
$('chlist').addEventListener('click', e => { const b = e.target.closest('.row'); if (!b || b.disabled) return; openChapter(+b.dataset.c); });

async function loadBank(meta) {
  const have = store.get('qb:bankver:' + meta.id, null);
  const b = await sync.loadBank(meta, have);
  if (!b.chapters.some(c => c.questions)) throw new Error('empty');
  store.set('qb:bankver:' + meta.id, meta.version);
  return b;
}
async function openBank(id) {
  const meta = BANKS.find(b => b.id === id) || BANKS[0]; if (!meta) return;
  if (!bank) { $('loading').hidden = false; $('loadmsg').textContent = 'Opening ' + meta.title + '…'; }
  try { bank = await loadBank(meta); } catch (e) { $('loading').hidden = false; $('loadmsg').textContent = meta.title + ' is not on this device yet. Open the app once while online.'; return; }
  prog = store.get(progKey(bank.id), {});
  store.set('qb:last', bank.id);
  if (sync && user) watchBank();
  renderHome();
}

/* ---------- quiz ---------- */
function openChapter(c) {
  const qs = bank.chapters[c].questions;
  S = { kind: 'chapter', ci: c, label: 'Chapter ' + (c + 1), items: qs, rev: {} };
  const first = qs.findIndex(q => !saved(q)); qi = first < 0 ? 0 : first;
  show('quiz'); renderQ();
}
function startReview() {
  S = { kind: 'review', label: 'Incorrect', items: wrongQs(), rev: {} };
  qi = 0; show('quiz'); renderQ();
}
$('back').onclick = () => { S = null; renderHome(); show('home'); };

const copyText = q => q.stem + '\n\n' + L.map(k => k + ') ' + q.options[k]).join('\n');
window.__copyText = (c, i) => copyText(bank.chapters[c].questions[i]);
const chOf = q => bank.chapters.findIndex(c => (c.questions || []).includes(q));

function sessStats() { let a = 0, r = 0; S.items.forEach(q => { const x = pick(q); if (x) { a++; if (x === q.answer) r++; } }); return { a, r, n: S.items.length }; }
function renderDots() {
  $('dots').innerHTML = '<div class="wrap">' + S.items.map((q, i) => {
    const x = pick(q); const cls = x ? (x === q.answer ? 'ok' : 'bad') : '';
    return '<button class="cell ' + cls + (i === qi ? ' cur' : '') + '" data-i="' + i + '" aria-label="Question ' + (i + 1) + '"></button>';
  }).join('') + '</div>';
}
$('dots').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(+b.dataset.i); });

function renderQ() {
  if ($('quiz').hidden || !S) return;
  const q = S.items[qi], p = pick(q), s = sessStats();
  $('chnum').textContent = S.label;
  $('qcount').textContent = (S.kind === 'review' ? '' : 'Q') + (S.kind === 'review' ? (qi + 1) : (q.n | 0)) + ' / ' + S.items.length;
  let h = '<div class="qhead">';
  if (S.kind === 'review') h += '<span class="tag">Ch ' + (chOf(q) + 1) + ' · Q' + (q.n | 0) + '</span>';
  if (q.recall > 0) h += '<span class="tag rc">Recall ×' + q.recall + '</span>';
  h += '</div><p class="stem" data-role="stem">' + esc(q.stem) + '</p>';
  if (q.image && /^data:image\/(jpeg|png|webp);base64,/.test(q.image)) h += '<img class="qimg" src="' + esc(q.image) + '" alt="Image for question ' + (q.n | 0) + '">';
  h += '<ul class="opts">' + L.map(k => {
    let cls = 'op', mk = '';
    if (p) { if (k === q.answer) { cls += ' right'; mk = k === p ? 'Your answer' : 'Correct'; } else if (k === p) { cls += ' wrong'; mk = 'Your answer'; } else cls += ' dim'; }
    return '<li><button class="' + cls + '" data-k="' + k + '"' + (p ? ' disabled' : '') + '><span class="lt">' + k + '</span><span class="t" data-role="opt-' + k + '">' + esc(q.options[k]) + '</span><span class="mk">' + mk + '</span></button></li>';
  }).join('') + '</ul>';
  if (p) {
    const ok = p === q.answer;
    h += '<div class="exp"><div class="h">Explanation</div><div class="v ' + (ok ? 'ok' : 'bad') + '">' + (ok ? 'Correct' : 'Incorrect') + '</div>' +
      '<div class="ans">Answer: <span data-role="answer">' + esc(q.answer) + ') ' + esc(q.options[q.answer]) + '</span></div>' +
      '<p class="rule">' + esc(q.rule) + '</p>' + (q.caution ? '<div class="tip"><b>Exam tip</b> ' + esc(q.caution) + '</div>' : '') + '</div>' +
      '<details class="ev"><summary>Source and evidence</summary><div class="evb"><div class="src">' + esc(q.source) + '</div>' +
      (q.quote ? '<blockquote>' + esc(q.quote) + '</blockquote>' : '') +
      (q.url ? (/^https?:\/\//i.test(q.url) ? '<a href="' + esc(q.url) + '" target="_blank" rel="noopener noreferrer">' + esc(q.url) + '</a>' : '<span>' + esc(q.url) + '</span>') : '') + '</div></details>';
  }
  if (s.a === s.n) {
    h += '<div class="done"><div class="h">' + (S.kind === 'review' ? 'Review complete' : 'Chapter complete') + '</div><div class="big">' + s.r + ' / ' + s.n + '</div><div>' + Math.round(100 * s.r / s.n) + '% correct</div><div class="acts">' +
      (S.kind === 'chapter' ? '<button class="btn" id="reset">Start this chapter again</button>' : '') + '<button class="btn primary" id="tohome">Back to home</button></div></div>';
  }
  h += '<p class="keys">Keys: <kbd>A</kbd>–<kbd>E</kbd> or <kbd>1</kbd>–<kbd>5</kbd> to answer · <kbd>←</kbd> <kbd>→</kbd> to move</p>';
  $('qbox').innerHTML = h;
  $('prev').disabled = qi === 0;
  $('next').textContent = qi === S.items.length - 1 ? 'Last question' : 'Next ›';
  $('next').disabled = qi === S.items.length - 1;
  const r = $('reset'); if (r) r.onclick = resetChapter;
  const th = $('tohome'); if (th) th.onclick = () => $('back').click();
  document.querySelectorAll('.op').forEach(b => b.onclick = () => answer(b.dataset.k));
  renderDots();
}
function resetChapter() {
  const b = $('reset');
  if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to clear this chapter'; return; }
  setAnswer(S.items.map(q => q.id), null); qi = 0; renderQ(); window.scrollTo(0, 0);
}
function answer(k) {
  const q = S.items[qi]; if (pick(q)) return;
  if (S.kind === 'review') S.rev[q.id] = k; else setAnswer([q.id], k);
  renderQ();
  const ok = k === q.answer;
  replay(document.querySelector('.op[data-k="' + k + '"]'), ok ? 'yes' : 'no');
  if (!ok) replay(document.querySelector('.op.right'), 'yes');
  replay(document.querySelector('.exp'), 'reveal'); replay(document.querySelector('details.ev'), 'reveal');
  replay(document.querySelector('#dots .cur'), 'blip');
  buzz(ok ? 12 : [30, 50, 30]);
  const s = sessStats();
  if (s.a === s.n) {
    const big = document.querySelector('.done .big'); if (big) { big.textContent = '0 / ' + s.n; countUpScore(big, s.r, s.n); }
    replay(document.querySelector('.done'), 'reveal');
    if (s.r / s.n >= .8) setTimeout(confetti, 250);
  }
}
function countUpScore(el, r, n) {
  if (REDUCE) { el.textContent = r + ' / ' + n; return; }
  const t0 = performance.now(), d = 900;
  const step = t => { const k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3); el.textContent = Math.round(r * e) + ' / ' + n; if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function go(i) { if (!S || i < 0 || i >= S.items.length || i === qi) return; const dir = i > qi ? 'in-r' : 'in-l'; qi = i; renderQ(); replay($('qbox'), dir); window.scrollTo(0, 0); }
$('prev').onclick = () => go(qi - 1); $('next').onclick = () => go(qi + 1);
$('copy').onclick = () => S && doCopy(S.items[qi]);

let tt;
function toast(m) { const t = $('toast'); t.textContent = m; t.hidden = false; replay(t, 'pop'); clearTimeout(tt); tt = setTimeout(() => t.hidden = true, 2200); }
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

/* ---------- sync wiring ---------- */
function rerender() { if (!$('quiz').hidden) renderQ(); else renderHome(); }
function watchBank() {
  sync.watch(bank.id, (remote, meta) => {
    if (!remote) { setSyncState('error'); return; }
    if (mergeRemote(bank.id, remote)) { prog = store.get(progKey(bank.id), {}); rerender(); }
    setSyncState(meta.pending ? 'pending' : (meta.fromCache || !navigator.onLine) ? 'offline' : 'ok');
  });
}
async function syncAllBanks() {
  for (const b of BANKS) {
    if (bank && b.id === bank.id) continue;
    await new Promise(res => {
      let done = false;
      sync.watch(b.id, (remote, meta) => {
        if (done) return;
        if (remote) mergeRemote(b.id, remote);
        if (!remote || !meta.fromCache || !navigator.onLine) { done = true; res(); }
      });
      setTimeout(() => { if (!done) { done = true; res(); } }, 6000);
    });
  }
  if (bank) watchBank(); else { sync.stop(); setSyncState(navigator.onLine ? 'ok' : 'offline'); }
}

/* ---------- account ---------- */
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
let accMode = 'in';
function setAccMode(m) {
  accMode = m; const up = m === 'up';
  $('acc-pass2-row').hidden = !up; $('acc-pass2').value = ''; $('acc-match').hidden = true; $('acc-err').hidden = true;
  $('acc-submit').textContent = up ? 'Create account' : 'Sign in';
  $('acc-mode').textContent = up ? 'Have an account? Sign in' : 'New here? Create account';
  $('acc-reset').hidden = up;
  $('acc-pass').setAttribute('autocomplete', up ? 'new-password' : 'current-password');
}
function showMatch() {
  const a = $('acc-pass').value, b = $('acc-pass2').value, m = $('acc-match');
  $('acc-err').hidden = true;
  if (accMode !== 'up' || !b) { m.hidden = true; return; }
  m.hidden = false; const same = a === b;
  m.className = 'acc-match ' + (same ? 'ok' : 'bad'); m.textContent = same ? 'Passwords match ✓' : 'Passwords do not match';
}
$('acc-mode').onclick = () => setAccMode(accMode === 'up' ? 'in' : 'up');
$('acc-pass').addEventListener('input', showMatch); $('acc-pass2').addEventListener('input', showMatch);
$('acc-eye').onclick = () => {
  const showIt = $('acc-pass').type === 'password';
  ['acc-pass', 'acc-pass2'].forEach(id => $(id).type = showIt ? 'text' : 'password');
  $('acc-eye').textContent = showIt ? 'Hide' : 'Show';
  $('acc-eye').setAttribute('aria-pressed', String(showIt)); $('acc-eye').setAttribute('aria-label', showIt ? 'Hide password' : 'Show password');
};
function accountUI() {
  if (user) { $('acc-pass').value = ''; $('acc-pass2').value = ''; setAccMode('in'); }
  $('acc-out').hidden = !sync || !!user;
  $('acc-in').hidden = !user;
  if (user) $('acc-who').textContent = user.email;
  if (!user) setSyncState('local');
}
async function accAction(fn) {
  const email = $('acc-email').value.trim(), pass = $('acc-pass').value, err = $('acc-err');
  err.hidden = true;
  if (!email || pass.length < 6) { err.textContent = 'Enter your email and a password of 6+ characters.'; err.hidden = false; return; }
  if (accMode === 'up' && pass !== $('acc-pass2').value) { err.textContent = 'The two passwords are not the same. Type them again.'; err.hidden = false; return; }
  document.querySelectorAll('#acc-form button').forEach(b => b.disabled = true);
  try { await fn(email, pass); } catch (e) { err.textContent = errText(e); err.hidden = false; }
  document.querySelectorAll('#acc-form button').forEach(b => b.disabled = false);
}
$('acc-form').addEventListener('submit', e => { e.preventDefault(); accAction((a, b) => sync.signIn(a, b)); });
$('acc-reset').onclick = async () => {
  const email = $('acc-email').value.trim(), err = $('acc-err');
  if (!email) { err.textContent = 'Type your email first, then tap Forgot password.'; err.hidden = false; return; }
  try { await sync.resetPassword(email); err.hidden = true; toast('Reset link sent to ' + email); } catch (e) { err.textContent = errText(e); err.hidden = false; }
};
$('acc-signout').onclick = async () => {
  $('acc-signout').disabled = true; $('acc-signout').textContent = 'Signing out and clearing this device…';
  await sync.signOutAndWipe(); wipeLocal();
  location.reload();
};

async function refreshBanks() {
  try { BANKS = await sync.listBanks(); store.set('qb:banks', BANKS); } catch (e) { /* keep the last list */ }
  const want = (bank && bank.id) || store.get('qb:last', null);
  if (BANKS.length) await openBank(BANKS.some(b => b.id === want) ? want : BANKS[0].id); else renderHome();
  if (navigator.onLine) for (const m of BANKS) { if (bank && m.id === bank.id) continue; try { await loadBank(m); } catch (e) {} }
}
function validateBank(b) {
  const str = x => typeof x === 'string';
  if (!b || !str(b.id) || !/^[a-z0-9-]{1,40}$/.test(b.id)) return 'id';
  if (!str(b.title) || !Array.isArray(b.chapters) || !b.chapters.length || b.chapters.length > 200) return 'chapters';
  for (const c of b.chapters) {
    if (!str(c.title) || !Number.isInteger(c.count) || c.count < 0) return 'chapter header';
    if (c.questions === undefined) continue;
    if (!Array.isArray(c.questions)) return 'questions';
    for (const q of c.questions) {
      if (!str(q.id) || !/^[A-Za-z0-9_-]{1,40}$/.test(q.id) || !Number.isInteger(q.n) || !str(q.stem) || !L.includes(q.answer)) return 'question ' + (q && q.id);
      if (!q.options || L.some(k => !str(q.options[k]))) return 'options ' + q.id;
      for (const f of ['rule', 'source', 'quote', 'url', 'caution']) if (q[f] !== undefined && !str(q[f])) return f + ' ' + q.id;
      if (q.image !== undefined && !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(q.image)) return 'image ' + q.id;
      if (q.recall !== undefined && !Number.isInteger(q.recall)) return 'recall ' + q.id;
    }
  }
  return '';
}
async function importText(text, label) {
  const msg = $('imp-msg'); msg.hidden = false; msg.textContent = 'Reading ' + label + '…';
  show('account');
  try {
    let b; try { b = JSON.parse(text); } catch (x) { throw new Error('This is not a question bank file.'); }
    const bad = validateBank(b); if (bad) throw new Error('This file is not a valid question bank (' + bad + ').');
    msg.textContent = 'Uploading ' + b.title + ' to your account…';
    await sync.importBank(b);
    const n = b.chapters.reduce((s, c) => s + (c.questions ? c.questions.length : 0), 0);
    msg.textContent = b.title + ' saved: ' + n + ' questions.';
    bank = null; store.set('qb:last', b.id);
    await refreshBanks();
  } catch (e) {
    msg.textContent = (e && e.code && e.code.includes('permission')) ? 'Your account is not allowed to add subjects.' : 'Could not add the subject: ' + (e.message || e.code || e);
  }
}
async function importFile(file) { return importText(await file.text(), file.name); }
// A subject file's text pasted anywhere in the app (copied on a computer) is added too.
document.addEventListener('paste', e => {
  if (!user || !$('quiz').hidden) return;
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  const t = e.clipboardData && e.clipboardData.getData('text');
  if (!t || t.charAt(0) !== '{' || t.indexOf('"chapters"') < 0) return;
  e.preventDefault(); importText(t, 'pasted subject');
});
$('imp-file').addEventListener('change', e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = ''; });

/* ---------- start ---------- */
if (window.top !== window.self) { try { window.top.location = window.self.location.href; } catch (e) { document.documentElement.hidden = true; } }
async function start() {
  renderHome();
  try { sync = await createSync(); } catch (e) { sync = null; }
  accountUI(); renderHome();
  if (sync) sync.onUser(async u => {
    if (u) { const last = store.get('qb:uid', null); if (last && last !== u.uid) { wipeLocal(); } store.set('qb:uid', u.uid); }
    user = u; accountUI();
    if (u) { setSyncState(navigator.onLine ? 'pending' : 'offline'); show('home'); await refreshBanks(); syncAllBanks(); }
    else { BANKS = []; bank = null; prog = {}; S = null; renderHome(); }
  });
}
start();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
