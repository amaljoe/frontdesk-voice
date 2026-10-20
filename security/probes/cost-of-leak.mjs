// Quantify the blast radius of ONE leaked 10-min token: with no per-token spend cap and cross-product
// scope, what can an attacker drive? We measure a tiny real sample, then extrapolate from public pricing.
import { mintToken, sleep } from '../lib.mjs';
import WebSocket from '../../node_modules/ws/index.js';

const tok = (await mintToken('streaming', 600)).token; // a 10-min browser token (max TTL)
// Drive paid TTS with the token (not the raw key) — proves billed work needs no API key.
const ws = new WebSocket(`wss://streaming-tts.assemblyai.com/v1/ws?token=${encodeURIComponent(tok)}&sample_rate=24000`);
let audioBytes = 0, t0;
await new Promise((res) => {
  ws.on('open', () => { t0 = Date.now(); ws.send(JSON.stringify({ type: 'Generate', text: 'This billed text-to-speech was generated with only a browser token, no API key.' })); ws.send(JSON.stringify({ type: 'Flush' })); });
  ws.on('message', (m) => { const j = JSON.parse(m); if (j.type === 'Audio') audioBytes += Buffer.from(j.audio, 'base64').length; if (j.type === 'FlushDone') { ws.send(JSON.stringify({ type: 'Terminate' })); } if (j.type === 'Termination' || j.type === 'Error') { if (j.type==='Error') console.log('err', j.error); res(); } });
  setTimeout(res, 15000);
});
const secs = audioBytes / 2 / 24000;
console.log(`# Cost-of-leak\nTTS driven by a browser token alone: ${secs.toFixed(1)}s audio in ${((Date.now()-t0)/1000).toFixed(1)}s wall`);
console.log('A leaked 600s token has no per-token spend/connection cap observed; it can be reused concurrently (see token-concurrency-scope).');
console.log('Public pricing: Voice Agent $4.50/hr; Streaming STT $0.45/hr; LLM Gateway billed per token.');
console.log('So one scraped token = up to 10 min of concurrent paid sessions across STT+TTS+VoiceAgent+LLM, per use, until it expires.');
