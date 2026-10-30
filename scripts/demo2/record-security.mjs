// Capture the security terminal as frames (typed-reveal animation), then hold.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
const frames = 'out/demo2/frames-security';
fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await p.goto('file://' + fs.realpathSync('scripts/demo2/security-term.html'), { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 600)); // fonts
const count = await p.evaluate(() => window.__count);
const FPS = 5, holdS = 2;
let n = 0;
// Reveal one line roughly every 0.9s, matching the ~16s security narration.
const perLine = 0.9;
const totalS = count * perLine + holdS;
const t0 = Date.now();
while (Date.now() - t0 < totalS * 1000) {
  const elapsed = (Date.now() - t0) / 1000;
  await p.evaluate((i) => window.__reveal(i), Math.floor(elapsed / perLine));
  const shot = await p.screenshot({ type: 'jpeg', quality: 88 });
  const k = Math.max(n, Math.floor(elapsed * FPS));
  for (; n <= k; n++) fs.writeFileSync(`${frames}/${String(n).padStart(5, '0')}.jpg`, shot);
  await new Promise((r) => setTimeout(r, 1000 / FPS));
}
console.log(`security: ${n} frames, ${totalS.toFixed(1)}s`);
await b.close();
