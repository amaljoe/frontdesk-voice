// Record one app segment to frames + audio. Like scripts/record-demo.mjs but engine-aware and quieter.
//   node scripts/demo2/record-segment.mjs <mic.wav> <name> <engine> <persona> <seconds>
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const [mic, name, engine = 'pipeline', persona = 'dental', secs = '26'] = process.argv.slice(2);
const url = 'http://localhost:3123';
const frames = `out/demo2/frames-${name}`;
fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });

const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fs.realpathSync(mic)}`,
    '--autoplay-policy=no-user-gesture-required', '--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox', '--allow-file-access-from-files'],
});
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
await p.goto(`${url}/?record`);
await p.select('#persona', persona);
await p.select('#engine', engine);
await new Promise((r) => setTimeout(r, 400));
await p.click('#call');
await p.waitForFunction(() => window.__recordingStartedAt, { timeout: 15000 });
const t0 = Date.now(), FPS = 5;
let n = 0;
while (Date.now() - t0 < Number(secs) * 1000) {
  const due = t0 + (n * 1000) / FPS;
  if (Date.now() < due) await new Promise((r) => setTimeout(r, due - Date.now()));
  const shot = await p.screenshot({ type: 'jpeg', quality: 88 });
  const k = Math.max(n, Math.floor(((Date.now() - t0) * FPS) / 1000));
  for (; n <= k; n++) fs.writeFileSync(`${frames}/${String(n).padStart(5, '0')}.jpg`, shot);
}
await p.evaluate(() => window.__stopRecording?.());
await p.waitForFunction(() => window.__recording, { timeout: 15000 });
fs.writeFileSync(`out/demo2/audio-${name}.webm`, Buffer.from(await p.evaluate(() => window.__recording), 'base64'));
const actions = await p.$eval('#actions', (e) => e.innerText).catch(() => '');
const transcript = await p.$eval('#transcript', (e) => e.innerText).catch(() => '');
console.log(`\n=== ${name} (${engine}) ===\n${transcript}\n--- ACTIONS: ${actions.replace(/\n/g, ' ')}`);
await b.close();
