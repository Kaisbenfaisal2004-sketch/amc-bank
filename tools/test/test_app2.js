// End-to-end tests of the app with a stand-in for Firebase (see mock-firebase.js).
const { chromium } = require('playwright');
const fs = require('fs');
const [bankPath, importPath, shots] = process.argv.slice(2);
const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
const L = ['a', 'b', 'c', 'd', 'e'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const check = (name, ok, extra) => results.push({ name, ok: !!ok, extra });
const URL = process.env.APPURL || 'http://127.0.0.1:8802/';
const ch1 = bank.filter(q => q.chapter_index === 0);

async function newDevice(browser, errs) {
  const c = await browser.newContext({ viewport: { width: 420, height: 880 } }); const p = await c.newPage();
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL); await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForSelector('#signedout:not([hidden]), #chlist .row');
  return [c, p];
}
async function signIn(p, email, how = 'in') {
  if (await p.isHidden('#account')) await p.click('.tabbar button[data-t="account"]');
  await p.waitForSelector('#acc-out:not([hidden])');
  if (how === 'up') await p.click('#acc-mode');
  await p.fill('#acc-email', email); await p.fill('#acc-pass', 'secret1');
  if (how === 'up') await p.fill('#acc-pass2', 'secret1');
  await p.click('#acc-submit'); await p.waitForFunction(() => !document.getElementById('acc-in').hidden);
}
async function openCh1(p) {
  if (!(await p.isHidden('#quiz'))) await p.click('#back');
  if (await p.isHidden('#home')) await p.click('.tabbar button[data-t="home"]');
  if (await p.isHidden('#chlist')) await p.click('#filters .pill[data-f="all"]');
  await p.waitForSelector('#chlist .row[data-c="0"]', { timeout: 10000 }); await p.click('#chlist .row[data-c="0"]'); await p.waitForSelector('[data-role=stem]');
}
const mapState = p => p.$$eval('#dots button', cs => cs.map(c => c.classList.contains('ok') ? 'o' : c.classList.contains('bad') ? 'x' : '-').join(''));
const goto = (p, i) => p.click(`#dots button[data-i="${i}"]`);
const home = async p => { if (!(await p.isHidden('#quiz'))) await p.click('#back'); };

(async () => {
  const browser = await chromium.launch(); const errs = [];
  const [cA, A] = await newDevice(browser, errs);
  check('service worker controls page', await A.evaluate(() => !!navigator.serviceWorker.controller));
  check('signed out: no questions shown', !(await A.isHidden('#signedout')) && (await A.$$('#chlist .row')).length === 0);
  // a stranger cannot add subjects
  // password UI: show toggle + confirm field
  await A.click('.tabbar button[data-t="account"]'); await A.click('#acc-mode'); await A.fill('#acc-email', 'x@test.com'); await A.fill('#acc-pass', 'secret1'); await A.fill('#acc-pass2', 'secret2');
  check('mismatch shown', (await A.textContent('#acc-match')).includes('do not match'));
  await A.click('#acc-submit'); check('mismatch blocks sign-up', (await A.textContent('#acc-err')).includes('not the same'));
  await A.click('#acc-eye'); check('show password works', (await A.getAttribute('#acc-pass', 'type')) === 'text' && (await A.getAttribute('#acc-pass2', 'type')) === 'text');
  await A.fill('#acc-pass2', 'secret1'); check('match shown', (await A.textContent('#acc-match')).includes('match ✓'));
  if (shots) await A.screenshot({ path: shots + '/v3_signup.png' });
  await A.click('#acc-mode');
  await signIn(A, 'stranger@test.com', 'up');
  await A.setInputFiles('#imp-file', importPath); await A.waitForFunction(() => /not allowed|Could not/.test(document.getElementById('imp-msg').textContent));
  check('stranger cannot import', (await A.textContent('#imp-msg')).includes('not allowed'));
  await A.click('.tabbar button[data-t="account"]'); await A.click('#acc-signout'); await A.waitForSelector('#acc-out:not([hidden])');
  // owner imports the subject
  await signIn(A, 'kais@test.com');
  await A.click('.tabbar button[data-t="account"]'); await A.setInputFiles('#imp-file', importPath); await A.waitForFunction(() => /saved/.test(document.getElementById('imp-msg').textContent), null, { timeout: 15000 });
  check('owner import saved 58', (await A.textContent('#imp-msg')).includes('58 questions'), await A.textContent('#imp-msg'));
  if (shots) await A.screenshot({ path: shots + '/b_account.png', fullPage: true });
  await A.click('.tabbar button[data-t="home"]');
  await openCh1(A);
  let diffs = 0;
  for (let i = 0; i < ch1.length; i++) {
    const q = ch1[i]; if (i) await A.click('#next');
    const s = await A.evaluate(() => ({ num: document.getElementById('qcount').textContent.split(' / ')[0], stem: document.querySelector('[data-role=stem]').textContent, opts: ['a','b','c','d','e'].map(k => document.querySelector(`[data-role=opt-${k}]`).textContent) }));
    if (JSON.stringify(s) !== JSON.stringify({ num: 'Q' + q.n, stem: q.stem, opts: L.map(k => q.options[k]) })) diffs++;
    if ((await A.evaluate(i => window.__copyText(0, i), i)) !== q.stem + '\n\n' + L.map(k => k + ') ' + q.options[k]).join('\n')) diffs++;
    const ans = await A.evaluate(() => 1); // placeholder to keep order
    if (i < 10) { await A.click(`.op[data-k="${i % 2 ? q.answer : L.find(k => k !== q.answer)}"]`);
      if (i === 0 && shots) await A.screenshot({ path: shots + '/b_q1.png', fullPage: true });
      const shownAns = await A.textContent('[data-role=answer]'); if (shownAns !== q.answer + ') ' + q.answer_text) diffs++; }
  }
  check('58 questions shown, copied, answered verbatim', diffs === 0, { diffs });
  const before = await mapState(A);
  if (shots) { await home(A); await A.screenshot({ path: shots + '/b_home.png', fullPage: true }); await openCh1(A); }
  await A.reload(); await A.waitForSelector('#chlist .row'); await openCh1(A);
  check('answers kept after reload', (await mapState(A)) === before, before.slice(0, 12));
  await cA.setOffline(true);
  await A.reload(); await A.waitForSelector('#chlist .row', { timeout: 10000 });
  await openCh1(A);
  check('opens offline with questions + answers', (await mapState(A)) === before);
  await goto(A, 11); await A.click(`.op[data-k="${ch1[11].answer}"]`);
  check('can answer offline', (await mapState(A))[11] === 'o');
  check('offline status shown', (await A.evaluate(() => document.getElementById('syncmsg').textContent)).includes('Offline'));
  await cA.setOffline(false); await A.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(2000);

  // second device
  const [cB, B] = await newDevice(browser, errs);
  await signIn(B, 'kais@test.com'); await sleep(1500);
  await home(B); check('B home shows synced count', (await B.textContent('#k-ans')) === '11', await B.textContent('#k-ans'));
  await openCh1(B); await sleep(800);
  check('B sees all A answers (incl. offline one)', (await mapState(B)) === (await mapState(A)), (await mapState(B)).slice(0, 14));
  await cB.setOffline(true);
  await goto(B, 12); await B.click(`.op[data-k="${ch1[12].answer}"]`);
  await goto(A, 13); await A.click(`.op[data-k="${ch1[13].answer}"]`);
  await sleep(1200);
  await cB.setOffline(false); await B.evaluate(() => window.dispatchEvent(new Event('online'))); await sleep(2500);
  const fa = await mapState(A), fb = await mapState(B);
  check('after reconnect both match', fa === fb && fa[12] === 'o' && fa[13] === 'o', { A: fa.slice(0, 15), B: fb.slice(0, 15) });
  for (let i = 0; i < ch1.length; i++) if ((await mapState(A))[i] === '-') { await goto(A, i); await A.click(`.op[data-k="${ch1[i].answer}"]`); }
  if (shots) await A.screenshot({ path: shots + '/b_done.png', fullPage: true });
  // incorrect-answers review: first answers stay unchanged
  const beforeRev = await mapState(A); await home(A); await A.click('.tabbar button[data-t="wrong"]');
  const wrongN = +(await A.textContent('#wrongview .big'));
  check('incorrect tab counts wrong answers', wrongN === (beforeRev.match(/x/g) || []).length, { wrongN, beforeRev });
  if (shots) await A.screenshot({ path: shots + '/b_wrong.png', fullPage: true });
  await A.click('#startreview'); await A.click('.op[data-k="a"]');
  check('review shows Incorrect label', (await A.textContent('#chnum')) === 'Incorrect');
  await A.click('#back'); await A.click('#filters .pill[data-f="all"]'); await openCh1(A);
  check('review leaves first answers unchanged', (await mapState(A)) === beforeRev);
  await A.click('#reset'); await A.click('#reset'); await sleep(2500);
  check('reset reaches other device', !/[ox]/.test(await mapState(B)), (await mapState(B)).slice(0, 10));
  // sign out hides questions
  await home(B); await B.click('.tabbar button[data-t="account"]'); await B.click('#acc-signout'); await sleep(300); await B.click('.tabbar button[data-t="home"]');
  check('signed out hides subjects', !(await B.isHidden('#signedout')) && (await B.$$('#chlist .row')).length === 0);
  check('no page errors', errs.length === 0, errs);
  console.log(JSON.stringify(results, null, 1));
  await browser.close();
})();
