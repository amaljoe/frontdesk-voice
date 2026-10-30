// Synthesize each narration line to a 48 kHz WAV with AssemblyAI TTS. Prints real durations.
import 'dotenv/config';
import fs from 'node:fs';
import WebSocket from 'ws';
import { NARRATION } from './narration.mjs';

const RATE = 48000, VOICE = 'reid';
fs.mkdirSync('out/demo2/vo', { recursive: true });
const durations = {};
for (const { id, text } of NARRATION) {
  const ws = new WebSocket(`wss://streaming-tts.assemblyai.com/v1/ws?voice=${VOICE}&sample_rate=${RATE}`, { headers: { Authorization: process.env.ASSEMBLYAI_API_KEY } });
  const chunks = []; let pending = 0;
  await new Promise((res, rej) => {
    ws.on('open', () => { for (const s of text.match(/[^.!?]+[.!?]*/g) || [text]) { ws.send(JSON.stringify({ type: 'Generate', text: s.trim() })); ws.send(JSON.stringify({ type: 'Flush' })); pending++; } });
    ws.on('message', (m) => { const j = JSON.parse(m); if (j.type === 'Error') return rej(new Error(j.error)); if (j.type === 'Audio') chunks.push(Buffer.from(j.audio, 'base64')); if (j.type === 'FlushDone' && --pending === 0) { ws.send(JSON.stringify({ type: 'Terminate' })); } if (j.type === 'Termination') res(); });
    setTimeout(res, 20000);
  });
  ws.terminate();
  const data = Buffer.concat(chunks), h = Buffer.alloc(44);
  h.write('RIFF',0);h.writeUInt32LE(36+data.length,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(RATE,24);h.writeUInt32LE(RATE*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(data.length,40);
  fs.writeFileSync(`out/demo2/vo/${id}.wav`, Buffer.concat([h, data]));
  durations[id] = +(data.length / 2 / RATE).toFixed(2);
  console.log(`${id}: ${durations[id]}s`);
  await new Promise((r) => setTimeout(r, 800));
}
fs.writeFileSync('out/demo2/vo/durations.json', JSON.stringify(durations, null, 2));
console.log('total VO', Object.values(durations).reduce((a,b)=>a+b,0).toFixed(1), 's');
