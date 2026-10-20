// Scripted caller audio for the two app segments (Chrome fake-mic input).
// Gaps are tuned so the AGENT finishes its sentence before the next caller line — except ONE
// deliberate barge-in in the pipeline segment, where the caller cuts in while the agent is talking.
import 'dotenv/config';
import fs from 'node:fs';
import WebSocket from 'ws';
const RATE = 48000;
// [gapBeforeThisLine, text]. Gap = silence to leave for the agent to speak first.
const scripts = {
  pipeline: [
    [1.0, "Hi! I'd like to book a teeth cleaning, please."],
    // agent starts offering slots; caller cuts in ~1.8s into that reply — the showcase barge-in.
    [2.6, 'Sorry, could you check Wednesday instead?'],  // deliberate barge-in: lands while Ivy is mid-reply
    [7.0, 'Wednesday at nine is perfect.'],   // let the agent answer in full
    [6.5, "My name is Alex Kim."],
    [6.5, 'Great, thank you. Bye!'],
    [6.0, null],
  ],
  va: [
    [1.0, "Hi, I'd like to book a cleaning for Tuesday afternoon."],
    [7.0, "Two thirty is great."],
    [6.5, "My name is Priya Sharma."],
    [6.5, "That's everything, thank you. Goodbye!"],
    [6.0, null],
  ],
};
async function voice() {
  const ws = new WebSocket(`wss://streaming-tts.assemblyai.com/v1/ws?voice=paul&sample_rate=${RATE}`, { headers: { Authorization: process.env.ASSEMBLYAI_API_KEY } });
  await new Promise((r) => ws.once('open', r));
  return { say: (text) => new Promise((res) => { const c = []; const h = (m) => { const j = JSON.parse(m); if (j.type === 'Audio') c.push(Buffer.from(j.audio, 'base64')); if (j.type === 'FlushDone') { ws.off('message', h); res(Buffer.concat(c)); } }; ws.on('message', h); ws.send(JSON.stringify({ type: 'Generate', text })); ws.send(JSON.stringify({ type: 'Flush' })); }), close: () => ws.terminate() };
}
fs.mkdirSync('out/demo2', { recursive: true });
const v = await voice();
for (const [name, lines] of Object.entries(scripts)) {
  const out = [];
  for (const [gap, text] of lines) { out.push(Buffer.alloc(Math.round(RATE * gap) * 2)); if (text) out.push(await v.say(text)); }
  const data = Buffer.concat(out), h = Buffer.alloc(44);
  h.write('RIFF',0);h.writeUInt32LE(36+data.length,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(RATE,24);h.writeUInt32LE(RATE*2,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(data.length,40);
  fs.writeFileSync(`out/demo2/mic-${name}.wav`, Buffer.concat([h, data]));
  console.log(`mic-${name}.wav`, (data.length / 2 / RATE).toFixed(1), 's');
}
v.close(); setTimeout(() => process.exit(0), 300);
