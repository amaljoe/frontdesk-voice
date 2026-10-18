// Builds the scripted caller audio used as Chrome's fake microphone for the demo recording.
// Timings are chosen so the second line lands while the agent is still talking (barge-in).
//   node scripts/make-demo-mic.mjs out/demo-mic.wav
import 'dotenv/config';
import fs from 'node:fs';
import WebSocket from 'ws';

const RATE = 48000;
const script = [
  [7.5, "Hi! I'd like to book a teeth cleaning, please."],
  [3.2, 'Sorry, actually, do you have anything on Wednesday instead?'],
  [7.5, "Wednesday at nine is great. My name is Alex Kim."],
  [7.5, 'Perfect, thanks so much. Bye!'],
  [12, null],
];
const ws = new WebSocket(`wss://streaming-tts.assemblyai.com/v1/ws?voice=paul&sample_rate=${RATE}`, { headers: { Authorization: process.env.ASSEMBLYAI_API_KEY } });
await new Promise((r) => ws.once('open', r));
const say = (text) => new Promise((res) => {
  const chunks = [];
  const h = (m) => { const j = JSON.parse(m); if (j.type === 'Audio') chunks.push(Buffer.from(j.audio, 'base64')); if (j.type === 'FlushDone') { ws.off('message', h); res(Buffer.concat(chunks)); } };
  ws.on('message', h);
  ws.send(JSON.stringify({ type: 'Generate', text })); ws.send(JSON.stringify({ type: 'Flush' }));
});
const out = [];
for (const [gap, text] of script) { out.push(Buffer.alloc(Math.round(RATE * gap) * 2)); if (text) out.push(await say(text)); }
ws.send(JSON.stringify({ type: 'Terminate' }));
const data = Buffer.concat(out), h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync(process.argv[2] || 'out/demo-mic.wav', Buffer.concat([h, data]));
console.log('caller audio', (data.length / 2 / RATE).toFixed(1), 's');
setTimeout(() => process.exit(0), 300);
