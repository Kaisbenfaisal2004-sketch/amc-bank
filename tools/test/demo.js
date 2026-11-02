const { chromium } = require('playwright');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, recordVideo: { dir: '/tmp/claude-0/vid', size: { width: 390, height: 780 } } });
  const p = await c.newPage(); const url = process.argv[2];
  await p.goto(url); await p.click('.tabbar button[data-t="account"]');
  await p.fill('#acc-email', 'kais@test.com'); await p.fill('#acc-pass', 'secret1'); await p.click('#acc-submit');
  await p.waitForFunction(() => !document.getElementById('acc-in').hidden);
  await p.click('.tabbar button[data-t="account"]'); await p.setInputFiles('#imp-file', process.argv[3]);
  await p.waitForFunction(() => /saved/.test(document.getElementById('imp-msg').textContent), null, { timeout: 30000 });
  await sleep(600); await p.click('.tabbar button[data-t="home"]'); await sleep(1800);
  await p.click('#chlist .row[data-c="0"]'); await sleep(900);
  const ans = await p.evaluate(() => 0);
  // wrong answer on Q1 (correct is e)
  await p.click('.op[data-k="a"]'); await sleep(1600);
  await p.mouse.wheel(0, 300); await sleep(700); await p.mouse.wheel(0, -300); await sleep(300);
  await p.click('#next'); await sleep(900);
  await p.click('.op[data-k="b"]'); await sleep(1500);
  await p.click('#back'); await sleep(1600);
  await p.click('.tabbar button[data-t="wrong"]'); await sleep(1200);
  await p.click('#startreview'); await sleep(800);
  await p.click('.op[data-k="e"]'); await sleep(2600);
  await c.close(); await b.close();
})();
