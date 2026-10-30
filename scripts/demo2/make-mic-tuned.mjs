import 'dotenv/config';
import fs from 'node:fs';
import WebSocket from 'ws';
const RATE = 48000, which = process.argv[2];
const lines = JSON.parse(fs.readFileSync(process.env.ASR_LINES, 'utf8'));
const ws = new WebSocket(`wss://streaming-tts.assemblyai.com/v1/ws?voice=paul&sample_rate=${RATE}`, { headers: { Authorization: process.env.ASSEMBLYAI_API_KEY } });
await new Promise((r) => ws.once('open', r));
const say = (text) => new Promise((res) => { const c = []; const h = (m) => { const j = JSON.parse(m); if (j.type === 'Audio') c.push(Buffer.from(j.audio, 'base64')); if (j.type === 'FlushDone') { ws.off('message', h); res(Buffer.concat(c)); } }; ws.on('message', h); ws.send(JSON.stringify({ type: 'Generate', text })); ws.send(JSON.stringify({ type: 'Flush' })); });
const out = [];
for (const [gap, text] of lines) { out.push(Buffer.alloc(Math.round(RATE * gap) * 2)); if (text) out.push(await say(text)); }
const data = Buffer.concat(out), h = Buffer.alloc(44);
h.write('RIFF',0);h.writeUInt32LE(36+data.length,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(RATE,24);h.writeUInt32LE(RATE*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(data.length,40);
fs.writeFileSync(`out/demo2/mic-${which}.wav`, Buffer.concat([h, data]));
ws.terminate(); setTimeout(() => process.exit(0), 200);
