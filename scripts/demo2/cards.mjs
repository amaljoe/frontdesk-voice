// Title, segment-label, scorecard-hold, and end cards for the 90s demo.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
fs.mkdirSync('out/demo2/cards', { recursive: true });
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage();
const base = `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet"><style>
  html,body{margin:0;width:1440px;height:900px;font-family:Inter,sans-serif;color:#e9ecf2;overflow:hidden}
  .full{width:100%;height:100%;background:radial-gradient(circle at 50% 38%,#16223f,#0b0d12 62%);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 80px;box-sizing:border-box}
  h1{font-size:104px;margin:0;font-weight:900;letter-spacing:-3px}h1 span{color:#6d8bff}
  .sub{font-size:30px;color:#aeb6c6;margin:20px 0 0;max-width:30ch}
  .pills{display:flex;gap:14px;margin-top:46px;font-family:'JetBrains Mono',monospace;font-size:20px}
  .pill{border:1.5px solid #2c3446;border-radius:999px;padding:10px 24px;color:#c7cedb}.arr{color:#6d8bff;align-self:center;font-size:22px}
  .foot{position:absolute;bottom:52px;font-family:'JetBrains Mono',monospace;font-size:19px;color:#6b7governed}
  .foot{color:#6b7488}
  /* segment label card */
  .seg{width:100%;height:100%;background:#0b0d12;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;padding:0 110px;box-sizing:border-box}
  .seg .num{font-family:'JetBrains Mono',monospace;font-size:26px;color:#6d8bff;letter-spacing:.3em}
  .seg h2{font-size:76px;margin:14px 0 0;font-weight:800;letter-spacing:-2px}
  .seg p{font-size:30px;color:#9099a8;margin:18px 0 0;max-width:34ch}
  .seg .rule{width:120px;height:4px;background:#6d8bff;margin-top:34px;border-radius:2px}
</style>`;
const cards = {
  title: `<div class="full"><h1>Front<span>desk</span></h1><p class="sub">A phone receptionist you can talk over — built entirely on AssemblyAI.</p>
    <div class="pills"><span class="pill">Streaming STT</span><span class="arr">→</span><span class="pill">LLM Gateway</span><span class="arr">→</span><span class="pill">Streaming TTS</span></div>
    <div class="foot">live, unedited calls · one API key</div></div>`,
  seg1: `<div class="seg"><div class="num">ENGINE 01</div><h2>The pipeline<br>we wired ourselves</h2><p>Streaming STT → LLM Gateway → Streaming TTS. Talk over it and it stops instantly.</p><div class="rule"></div></div>`,
  seg2: `<div class="seg"><div class="num">ENGINE 02</div><h2>AssemblyAI<br>Voice Agent API</h2><p>One socket. Real tool calls. The booking is a genuine function call.</p><div class="rule"></div></div>`,
  seg3: `<div class="seg"><div class="num">AND THEN…</div><h2>We read the<br>fine print</h2><p>The official quickstart ships a browser token it calls “single-use”.</p><div class="rule" style="background:#ff6b7d"></div></div>`,
  end: `<div class="full"><h1 style="font-size:84px">A product. A vulnerability.<br><span>Built with their own tools.</span></h1>
    <div class="foot" style="font-size:22px;color:#aeb6c6">github.com/amaljoe/frontdesk-voice</div></div>`,
};
for (const [k, html] of Object.entries(cards)) {
  await p.setViewport({ width: 1440, height: 900 });
  await p.setContent(base + html, { waitUntil: 'load', timeout: 8000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
  await p.screenshot({ path: `out/demo2/cards/${k}.jpg`, type: 'jpeg', quality: 92 });
}
await b.close(); console.log('cards:', Object.keys(cards).join(', '));
