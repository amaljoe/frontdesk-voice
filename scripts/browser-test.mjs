import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture=/tmp/mic.wav','--autoplay-policy=no-user-gesture-required','--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox','--allow-file-access-from-files'] });
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
p.on('console', m => console.log('console:', m.text())); p.on('pageerror', e => console.log('PAGEERR', e.message));
await p.goto('http://localhost:3123'); await new Promise(r=>setTimeout(r,800));
await p.click('#call');
for (let i = 1; i <= 8; i++) { await new Promise(r => setTimeout(r, 6000)); await p.screenshot({ path: `/tmp/shot${i}.png` }); }
console.log(await p.$eval('#transcript', e => e.innerText));
console.log('ACTIONS', await p.$eval('#actions', e => e.innerText));
console.log('METRICS', await p.$eval('.metrics', e => e.innerText.replace(/\n/g,' ')));
await b.close();
