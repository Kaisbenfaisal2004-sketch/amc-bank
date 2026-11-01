const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const c = await b.newContext(); const p = await c.newPage(); const out = {};
  await p.goto(process.argv[2]); await p.evaluate(() => navigator.serviceWorker.ready); await p.reload();
  await p.click('.tabbar button[data-t="account"]'); await p.fill('#acc-email', 'kais@test.com'); await p.fill('#acc-pass', 'secret1'); await p.click('#acc-submit');
  await p.waitForFunction(() => !document.getElementById('acc-in').hidden);
  await p.click('.tabbar button[data-t="account"]'); await p.setInputFiles('#imp-file', '/tmp/claude-0/bad_import.json');
  await p.waitForFunction(() => /valid|Could not/.test(document.getElementById('imp-msg').textContent));
  out.badFileRejected = await p.textContent('#imp-msg');
  // open a non-app file inside the app's scope, then reopen the app (online and offline)
  await p.goto(process.argv[2] + 'icons/icon-512.png'); await p.goto(process.argv[2]); await p.waitForSelector('#home');
  await c.setOffline(true); await p.reload(); 
  out.appStillLoadsOffline = await p.isVisible('#home');
  console.log(JSON.stringify(out)); await b.close();
})();
