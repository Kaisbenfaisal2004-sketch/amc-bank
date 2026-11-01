const { chromium } = require('playwright');
(async()=>{const b=await chromium.launch();const p=await b.newPage();const errs=[];
p.on('pageerror',e=>errs.push(String(e)));p.on('console',m=>{if(/Content Security Policy|Refused|SyntaxError/.test(m.text()))errs.push(m.text().slice(0,160))});
await p.goto('http://127.0.0.1:8842/');await p.click('.tabbar button[data-t="account"]');await p.waitForSelector('#acc-out:not([hidden])',{timeout:15000});
await p.fill('#acc-email','a@b.com');await p.fill('#acc-pass','secret1');await p.click('#acc-submit');
await p.waitForSelector('#acc-err:not([hidden])',{timeout:30000});
console.log('err shown:',await p.textContent('#acc-err'));console.log('problems:',errs);await b.close();})();
