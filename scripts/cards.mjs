// Renders title / end cards and lower-third callouts as PNGs for the demo video.
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' });
const p = await b.newPage();
const base = `<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet"><style>
body{margin:0;width:1440px;height:900px;font-family:Inter,sans-serif;color:#e7eaf0;overflow:hidden}
.full{width:100%;height:100%;background:radial-gradient(circle at 50% 40%,#16352b,#0b0d12 60%);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
h1{font-size:92px;margin:0;font-weight:800;letter-spacing:-2px} h1 span{color:#7cf0c5}
p{font-size:30px;color:#a9b2c4;margin:18px 0 0} .pills{display:flex;gap:14px;margin-top:44px}
.pill{border:2px solid #2c3446;border-radius:99px;padding:10px 24px;font-size:22px} .arrow{font-size:26px;color:#6d8bff;align-self:center}
ul{font-size:30px;text-align:left;line-height:1.7;margin-top:30px} li::marker{color:#7cf0c5}
.lt{position:absolute;left:470px;bottom:28px;background:#7cf0c5;color:#04140d;font-weight:800;font-size:26px;padding:12px 24px;border-radius:12px;box-shadow:0 8px 30px #0008}
.lt small{display:block;font-weight:600;font-size:17px;opacity:.75}
</style>`;
const shots = {
  title: `<div class="full"><h1>Front<span>desk</span></h1><p>A real-time AI phone receptionist that books, orders & reserves — while you talk over it.</p>
    <div class="pills"><div class="pill">Universal-Streaming STT</div><div class="arrow">→</div><div class="pill">LLM Gateway</div><div class="arrow">→</div><div class="pill">AssemblyAI Streaming TTS</div></div>
    <p style="font-size:22px;margin-top:40px">100% AssemblyAI · one API key · live, unedited call below</p></div>`,
  end: `<div class="full"><h1>Front<span>desk</span></h1><ul>
    <li>Sentence-level streaming into TTS → ~0.6–1.2 s caller-stops-to-first-audio</li>
    <li>Barge-in: Cancel + flush_id discard, agent remembers what you actually heard</li>
    <li>Word-synced captions from TTS WordBoundaries</li>
    <li>Real actions with guardrails: bookings, orders, reservations</li>
    <li>8 kHz μ-law phone mode · 6 languages with auto voice switching</li></ul>
    <p style="font-size:22px">+ a TTS API findings report (security & reliability) in the repo</p></div>`,
  lt_greet: `<div class="lt">Streaming TTS greeting · captions synced to WordBoundaries<small>voice “jane”, 24 kHz PCM</small></div>`,
  lt_barge: `<div class="lt">Barge-in — the caller talks over Ivy, she stops instantly<small>TTS Cancel + stale-flush discard, client buffer flushed</small></div>`,
  lt_book: `<div class="lt">Real action executed → appointment booked<small>name verified against what the caller actually said</small></div>`,
  lt_lat: `<div class="lt">Latency panel: caller stops → first agent audio<small>LLM tokens streamed sentence-by-sentence into TTS</small></div>`,
};
for (const [k, html] of Object.entries(shots)) {
  await p.setViewport({ width: 1440, height: 900 });
  await p.setContent(base + html, { waitUntil: 'load', timeout: 8000 }).catch(() => {}); await new Promise((r) => setTimeout(r, 400));
  await p.screenshot({ path: `out/cards/${k}.png`, omitBackground: k.startsWith('lt') });
}
await b.close();
