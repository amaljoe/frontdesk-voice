// "Ears" for the demo: upload a clip's audio to AssemblyAI and get word-level timestamps, so I can
// see exactly what is audible and when — to judge overlap and barge-in like a listener would.
import 'dotenv/config';
import fs from 'node:fs';
const KEY = process.env.ASSEMBLYAI_API_KEY;
const path = process.argv[2];
const up = await fetch('https://api.assemblyai.com/v2/upload', { method: 'POST', headers: { authorization: KEY }, body: fs.readFileSync(path) });
const { upload_url } = await up.json();
const mk = await fetch('https://api.assemblyai.com/v2/transcript', { method: 'POST', headers: { authorization: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ audio_url: upload_url, speech_model: 'universal' }) });
const { id } = await mk.json();
let t;
for (;;) { await new Promise((r) => setTimeout(r, 2500)); t = await (await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, { headers: { authorization: KEY } })).json(); if (t.status === 'completed' || t.status === 'error') break; }
if (t.status === 'error') { console.error(t.error); process.exit(1); }
console.log(`TRANSCRIPT: ${t.text}\n`);
// Print words with timestamps, grouping into a rough timeline
let line = '';
for (const w of t.words || []) { line += `[${(w.start/1000).toFixed(1)}] ${w.text} `; if (line.length > 90) { console.log(line); line = ''; } }
if (line) console.log(line);
