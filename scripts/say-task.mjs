// Turn a typed task into speech for AssemblyAI's voice coding agent (`assembly live <file>`).
//   node scripts/say-task.mjs "Add a taqueria persona" task.wav
import 'dotenv/config';
import fs from 'node:fs';
import WebSocket from 'ws';

const [text, out = 'task.wav'] = process.argv.slice(2);
const ws = new WebSocket('wss://streaming-tts.assemblyai.com/v1/ws?voice=paul&sample_rate=16000', { headers: { Authorization: process.env.ASSEMBLYAI_API_KEY } });
const chunks = [];
let pending = 0;
ws.on('open', () => {
  for (const s of text.match(/[^.!?]+[.!?]*/g)) { ws.send(JSON.stringify({ type: 'Generate', text: s.trim() })); ws.send(JSON.stringify({ type: 'Flush' })); pending++; }
});
ws.on('message', (m) => {
  const j = JSON.parse(m);
  if (j.type === 'Error') { console.error(j.error); process.exit(1); }
  if (j.type === 'Audio') chunks.push(Buffer.from(j.audio, 'base64'));
  if (j.type !== 'FlushDone' || --pending) return;
  const data = Buffer.concat([...chunks, Buffer.alloc(64000)]), h = Buffer.alloc(44); // 2 s of tail silence ends the turn
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(out, Buffer.concat([h, data]));
  ws.send(JSON.stringify({ type: 'Terminate' }));
  setTimeout(() => process.exit(0), 200);
});
