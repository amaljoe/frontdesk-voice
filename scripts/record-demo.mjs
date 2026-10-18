// Records a real browser call into a demo video: Chrome's fake mic plays the scripted caller,
// the page captures caller+agent audio (?record), and screenshots become the video track.
//   node scripts/record-demo.mjs out/demo-mic.wav out/demo.mp4 [persona] [seconds]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const [mic = 'out/demo-mic.wav', out = 'out/demo.mp4', persona = 'dental', secs = '52'] = process.argv.slice(2);
const url = process.env.URL || 'http://localhost:3123';
const frames = 'out/frames';
fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });

const b = await puppeteer.launch({
  executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${fs.realpathSync(mic)}`,
    '--autoplay-policy=no-user-gesture-required', '--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox', '--allow-file-access-from-files'],
});
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('PAGEERR', e.message));
const marks = [];
p.on('console', (m) => { const t = m.text(); if (t.startsWith('MARK ')) marks.push({ t: (Date.now() - (globalThis.t0 || Date.now())) / 1000, ev: t.slice(5) }); });
await p.goto(`${url}/?record`);
await p.select('#persona', persona);
await new Promise((r) => setTimeout(r, 500));
await p.click('#call');
await p.waitForFunction(() => window.__recordingStartedAt, { timeout: 15000 });
const t0 = (globalThis.t0 = Date.now()), FPS = 4;
let n = 0;
while (Date.now() - t0 < Number(secs) * 1000) {
  const due = t0 + (n * 1000) / FPS;
  if (Date.now() < due) await new Promise((r) => setTimeout(r, due - Date.now()));
  // A frame that takes longer than the interval is repeated so the video stays in sync with audio.
  const shot = await p.screenshot({ type: 'jpeg', quality: 85 });
  const k = Math.max(n, Math.floor(((Date.now() - t0) * FPS) / 1000));
  for (; n <= k; n++) fs.writeFileSync(`${frames}/${String(n).padStart(5, '0')}.jpg`, shot);
}
await p.evaluate(() => window.__stopRecording?.());
await p.waitForFunction(() => window.__recording, { timeout: 15000 });
const audio = Buffer.from(await p.evaluate(() => window.__recording), 'base64');
fs.writeFileSync('out/demo-audio.webm', audio);
console.log('transcript:\n' + (await p.$eval('#transcript', (e) => e.innerText)));
console.log('ACTIONS', await p.$eval('#actions', (e) => e.innerText));
await b.close();
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', `${frames}/%05d.jpg`, '-i', 'out/demo-audio.webm', '-af', 'loudnorm=I=-16:TP=-1.5',
  '-c:v', 'libx264', '-r', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', out]);
fs.writeFileSync(out.replace(/\.mp4$/, '.marks.json'), JSON.stringify(marks, null, 1));
console.log('wrote', out, 'marks', marks.map((m) => `${m.t.toFixed(1)} ${m.ev}`).join(' | '));
