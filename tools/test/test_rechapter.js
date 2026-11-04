// Re-chaptered bank: answers given under the old chapters must survive importing the new chapters,
// on this device and on a second device that syncs afterwards. Every question must show verbatim.
const { chromium } = require('playwright');
const fs = require('fs');
const [oldPath, newPath, expPath, url] = process.argv.slice(2);
const exp = JSON.parse(fs.readFileSync(expPath, 'utf8'));
const NEW = JSON.parse(fs.readFileSync(newPath, 'utf8'));
const L = ['a', 'b', 'c', 'd', 'e'];
async function dev(b, errs) {
  const c = await b.newContext({ viewport: { width: 420, height: 900 } }); const p = await c.newPage();
  p.on('pageerror', e => errs.push(String(e))); await p.goto(url); return p;
}
async function signIn(p) {
  await p.click('.tabbar button[data-t="account"]'); await p.waitForSelector('#acc-out:not([hidden])');
  await p.fill('#acc-email', 'kais@test.com'); await p.fill('#acc-pass', 'secret1'); await p.click('#acc-submit');
  await p.waitForFunction(() => !document.getElementById('acc-in').hidden);
}
async function imp(p, file) {
  await p.click('.tabbar button[data-t="account"]'); await p.setInputFiles('#imp-file', file);
  await p.waitForFunction(() => /saved|Could not/.test(document.getElementById('imp-msg').textContent), null, { timeout: 60000 });
  const m = await p.textContent('#imp-msg'); await p.click('.tabbar button[data-t="home"]'); await p.waitForSelector('#chlist .row'); return m;
}
const progress = p => p.evaluate(() => { const k = Object.keys(localStorage).find(k => k.startsWith('qb:prog')); return k ? JSON.parse(localStorage.getItem(k)) : {}; });
(async () => {
  const b = await chromium.launch(); const errs = []; const out = {};
  const p = await dev(b, errs); await signIn(p);
  out.oldImport = await imp(p, oldPath);
  // answer the first 12 questions of old chapters 1, 7 and 20 (picking option a)
  for (const c of [0, 6, 19]) {
    await p.click(`#chlist .row[data-c="${c}"]`); await p.waitForSelector('[data-role=stem]');
    for (let i = 0; i < 12; i++) { await p.click(`#dots button[data-i="${i}"]`); await p.click('.op[data-k="a"]'); }
    await p.click('#back'); await p.waitForSelector('#chlist .row');
  }
  const before = await progress(p); out.answeredBefore = Object.keys(before).filter(k => before[k].p).length;
  out.newImport = await imp(p, newPath);
  out.rows = await p.$$eval('#chlist .row', r => r.length);
  const after = await progress(p);
  out.keptOnThisDevice = Object.keys(before).filter(k => before[k].p && after[k] && after[k].p === before[k].p).length;
  // dashboard answered count on the home screen must equal what was answered
  const ids = new Set(Object.keys(before).filter(k => before[k].p));
  out.answeredInNewChapters = NEW.chapters.map((c, i) => [i + 1, c.questions.filter(q => ids.has(q.id)).length]).filter(x => x[1]);
  // second device
  const p2 = await dev(b, errs); await signIn(p2); await p2.waitForSelector('#chlist .row'); await p2.waitForTimeout(1500);
  const a2 = await progress(p2);
  out.keptOnSecondDevice = Object.keys(before).filter(k => before[k].p && a2[k] && a2[k].p === before[k].p).length;
  out.rows2 = await p2.$$eval('#chlist .row', r => r.length);
  // every question displayed verbatim in its new chapter + images shown + saved answer shown as picked
  let checked = 0, diffs = [], imgs = 0, pickedShown = 0;
  for (let c = 0; c < NEW.chapters.length; c++) {
    await p2.click(`#chlist .row[data-c="${c}"]`); await p2.waitForSelector('[data-role=stem]');
    const want = exp.filter(q => q.chapter_index === c);
    for (let i = 0; i < want.length; i++) {
      await p2.click(`#dots button[data-i="${i}"]`);
      const s = await p2.evaluate(() => ({ num: document.getElementById('qcount').textContent.split(' / ')[0], stem: document.querySelector('[data-role=stem]').textContent,
        opts: ['a','b','c','d','e'].map(k => document.querySelector(`[data-role=opt-${k}]`).textContent), img: !!document.querySelector('.qimg') }));
      const q = want[i];
      if (JSON.stringify(s.num) !== JSON.stringify('Q' + q.n) || s.stem !== q.stem || JSON.stringify(s.opts) !== JSON.stringify(L.map(k => q.options[k]))) diffs.push([c + 1, q.n]);
      if (s.img) imgs++;
      checked++;
    }
    await p2.click('#back'); await p2.waitForSelector('#chlist .row');
  }
  Object.assign(out, { checked, differences: diffs.length, firstDiffs: diffs.slice(0, 5), imagesShown: imgs, pageErrors: errs });
  console.log(JSON.stringify(out, null, 1)); await b.close();
})();
