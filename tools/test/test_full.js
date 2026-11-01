// Full-bank check: import the whole subject into the app (stand-in Firebase), open every chapter,
// read every question as displayed and compare with the PDF text (+ approved corrections).
const { chromium } = require('playwright');
const fs = require('fs');
const [expPath, importPath, url] = process.argv.slice(2);
const exp = JSON.parse(fs.readFileSync(expPath, 'utf8'));
const L = ['a','b','c','d','e'];
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 420, height: 900 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(url); await p.click('.tabbar button[data-t="account"]');
  await p.fill('#acc-email', 'kais@test.com'); await p.fill('#acc-pass', 'secret1'); await p.click('#acc-submit');
  await p.waitForFunction(() => !document.getElementById('acc-in').hidden);
  await p.click('.tabbar button[data-t="account"]'); await p.setInputFiles('#imp-file', importPath);
  await p.waitForFunction(() => /saved/.test(document.getElementById('imp-msg').textContent), null, { timeout: 30000 });
  const msg = await p.textContent('#imp-msg');
  await p.click('.tabbar button[data-t="home"]'); await p.waitForSelector('#chlist .row');
  let checked = 0, diffs = [], imgs = 0;
  for (let c = 0; c < 30; c++) {
    await p.click(`#chlist .row[data-c="${c}"]`); await p.waitForSelector('[data-role=stem]');
    const want = exp.filter(q => q.chapter_index === c);
    for (let i = 0; i < want.length; i++) {
      await p.click(`#dots button[data-i="${i}"]`);
      const s = await p.evaluate(() => ({ num: document.getElementById('qcount').textContent.split(' / ')[0], stem: document.querySelector('[data-role=stem]').textContent,
        opts: ['a','b','c','d','e'].map(k => document.querySelector(`[data-role=opt-${k}]`).textContent), img: !!document.querySelector('.qimg') }));
      const q = want[i];
      if (JSON.stringify({ num: s.num, stem: s.stem, opts: s.opts }) !== JSON.stringify({ num: 'Q' + q.n, stem: q.stem, opts: L.map(k => q.options[k]) })) diffs.push([c + 1, q.n]);
      if (s.img) imgs++;
      checked++;
    }
    await p.click('#back');
  }
  console.log(JSON.stringify({ import: msg, checked, differences: diffs.length, firstDiffs: diffs.slice(0, 5), imagesShown: imgs, pageErrors: errs }));
  await b.close();
})();
