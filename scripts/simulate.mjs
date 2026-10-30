// Headless end-to-end test: an AssemblyAI TTS "caller" phones the agent.
// Caller lines are synthesized at 16 kHz and streamed in real time into the agent's STT;
// both sides are mixed into a stereo WAV (L = caller, R = agent) for listening back.
//   node scripts/simulate.mjs [persona] [out.wav] [--barge] [--phone] [--engine voice-agent]
import 'dotenv/config';
import fs from 'node:fs';
import WebSocket from 'ws';
import { Call } from '../agent.mjs';
import { VoiceAgentCall } from '../voice-agent.mjs';

const persona = process.argv[2] || 'dental';
const out = process.argv[3] || `out/sim-${persona}.wav`;
const barge = process.argv.includes('--barge');
const phone = process.argv.includes('--phone'); // 8 kHz mu-law agent audio, decoded for the mix
const engine = process.argv.includes('--engine') ? process.argv[process.argv.indexOf('--engine') + 1] : 'pipeline';
const scripts = {
  dental: ["Hi, I'd like to book a teeth cleaning.", "Tuesday afternoon works best for me.", "Two thirty is perfect. My name is Priya Sharma.", "That's everything, thank you so much, bye!"],
  pizza: ["Hey, I'd like to order for pickup.", "One large pepperoni please.", "And garlic knots. That's it, name is Sam.", "Thanks, bye!"],
  hotel: ["Bonjour, avez-vous une chambre pour ce soir?", "Une chambre deluxe pour deux nuits, s'il vous plaît.", "Je m'appelle Lucas Martin.", "Merci, au revoir!"],
};
const lines = scripts[persona];
const AGENT_RATE = 24000, RATE = 16000;

// One reusable TTS socket for the caller's voice (the account caps concurrent TTS sessions).
async function callerVoice(voice, language) {
  const q = new URLSearchParams({ voice, sample_rate: RATE, language });
  const ws = new WebSocket(`wss://streaming-tts.assemblyai.com/v1/ws?${q}`, { headers: { Authorization: process.env.ASSEMBLYAI_API_KEY } });
  let chunks = [], done;
  ws.on('message', (m) => { const j = JSON.parse(m); if (j.type === 'Audio') chunks.push(Buffer.from(j.audio, 'base64')); if (j.type === 'FlushDone') done(); if (j.type === 'Error') throw new Error(j.error); });
  await new Promise((r) => ws.once('open', r));
  return {
    say: (text) => new Promise((res) => { chunks = []; done = () => res(Buffer.concat(chunks)); ws.send(JSON.stringify({ type: 'Generate', text })); ws.send(JSON.stringify({ type: 'Flush' })); }),
    close: () => { ws.send(JSON.stringify({ type: 'Terminate' })); setTimeout(() => ws.terminate(), 300); },
  };
}

function mulawTo24k(u8) { // decode G.711 mu-law and upsample 8k -> 24k by sample repetition
  const out = Buffer.alloc(u8.length * 6);
  for (let i = 0; i < u8.length; i++) {
    let u = ~u8[i] & 0xff; const sign = u & 0x80, exp = (u >> 4) & 7, man = u & 0x0f;
    let v = (((man << 3) + 0x84) << exp) - 0x84; v = sign ? -v : v;
    for (let k = 0; k < 3; k++) out.writeInt16LE(v, (i * 3 + k) * 2);
  }
  return out;
}

const t0 = Date.now();
const callerTrack = [], agentTrack = []; // [{ms, pcm(16k or 24k)}]
const metrics = [];
let agentDone = null, turnDone = 0, inFlight = 0;
const line = {
  send(m) {
    if (Buffer.isBuffer(m)) { agentTrack.push({ ms: Date.now() - t0, pcm: phone ? mulawTo24k(m) : m }); return; }
    if (m.type === 'agent' && !m.final && engine !== 'voice-agent') console.log(`  AGENT  ${m.text}`); // voice-agent deltas are single words
    if (m.type === 'agent' && m.final) console.log(`  AGENT  ${m.text}`);
    if (m.type === 'user' && m.final) console.log(`CALLER   ${m.text}`);
    if (m.type === 'metric') { metrics.push(m); console.log(`         [${m.name} ${m.ms}ms]`); }
    if (m.type === 'action') console.log(`         ** ${m.result.title}: ${m.result.detail}`);
    if (m.type === 'interrupt') console.log(`         !! interrupt (${m.reason})`);
    if (m.type === 'error') console.log(`         ERR ${m.source} ${m.message}`);
    if (m.type === 'flush_done') { turnDone = Date.now(); }
  },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function streamCaller(pcm) {
  const frame = RATE * 2 / 10; // 100 ms
  for (let o = 0; o < pcm.length; o += frame) {
    const f = pcm.subarray(o, o + frame);
    callerTrack.push({ ms: Date.now() - t0, pcm: f });
    call.audio(f);
    await sleep(100);
  }
}
async function silence(ms) { const f = Buffer.alloc(RATE * 2 / 10); for (let i = 0; i < ms / 100; i++) { call.audio(f); await sleep(100); } }

// Wait until the agent has been quiet (no audio, nothing pending) for a moment.
async function waitAgent() {
  while (true) {
    await silence(300);
    if (!call.llmAbort && !call.agentAudible()) { await silence(500); if (!call.llmAbort && !call.agentAudible()) return; }
  }
}

const language = persona === 'hotel' ? 'french' : 'english';
const Engine = engine === 'voice-agent' ? VoiceAgentCall : Call;
const call = new Engine(line, { persona, multilingual: persona === 'hotel', phone });
await call.start();
console.log(`== ${persona}: ${call.p.business} (${call.p.name}, voice ${call.voice}, engine ${engine})`);
const voice = await callerVoice(language === 'french' ? 'estelle' : 'paul', language);
const pre = [];
for (const l of lines) pre.push(await voice.say(l));
const bargeLine = barge ? await voice.say('Sorry, actually, do you have anything on Wednesday instead?') : null;
voice.close();
await waitAgent();
for (let i = 0; i < lines.length; i++) {
  await streamCaller(pre[i]);
  if (barge && i === 0) {
    // Let the agent start answering, then talk over it.
    while (!call.agentAudible()) await silence(100);
    await silence(1200);
    console.log('         >> caller barges in');
    await streamCaller(bargeLine);
  }
  await waitAgent();
}
await silence(4000);
call.close();

// Mix to stereo WAV at 24 kHz.
const end = Math.max(...agentTrack.map((c) => c.ms + c.pcm.length / 2 / AGENT_RATE * 1000), ...callerTrack.map((c) => c.ms + 100)) + 500;
const N = Math.ceil(end / 1000 * AGENT_RATE), L = new Int16Array(N), R = new Int16Array(N);
let agentCursor = 0;
for (const c of agentTrack) { // agent chunks play back-to-back (gapless), starting no earlier than arrival
  const start = Math.max(agentCursor, Math.floor(c.ms / 1000 * AGENT_RATE));
  const s = new Int16Array(c.pcm.buffer, c.pcm.byteOffset, c.pcm.length / 2);
  for (let i = 0; i < s.length && start + i < N; i++) R[start + i] = s[i];
  agentCursor = start + s.length;
}
for (const c of callerTrack) {
  const start = Math.floor(c.ms / 1000 * AGENT_RATE), s = new Int16Array(c.pcm.buffer, c.pcm.byteOffset, c.pcm.length / 2);
  for (let i = 0; i < s.length * 1.5 && start + i < N; i++) L[start + i] = s[Math.floor(i / 1.5)];
}
const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { data.writeInt16LE(L[i], i * 4); data.writeInt16LE(R[i], i * 4 + 2); }
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
h.writeUInt32LE(AGENT_RATE, 24); h.writeUInt32LE(AGENT_RATE * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync(out, Buffer.concat([h, data]));
const fa = metrics.filter((m) => m.name === 'first_audio').map((m) => m.ms);
console.log(`\nwrote ${out} · first-audio latency: ${fa.join(', ')} ms · state: ${JSON.stringify(call.state)}`);
setTimeout(() => process.exit(0), 800);
