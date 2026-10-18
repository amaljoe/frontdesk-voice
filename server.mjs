import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { Call, LLM_MODEL } from './agent.mjs';
import { personas } from './personas.mjs';

if (!process.env.ASSEMBLYAI_API_KEY) { console.error('Set ASSEMBLYAI_API_KEY (see .env.example)'); process.exit(1); }

const PORT = Number(process.env.PORT || 3000);
const PUB = path.join(path.dirname(new URL(import.meta.url).pathname), 'public');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/personas') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ model: LLM_MODEL, personas: Object.fromEntries(Object.entries(personas).map(([k, p]) => [k, { name: p.name, business: p.business, voice: p.voice }])) }));
  }
  const file = path.join(PUB, url.pathname === '/' ? 'index.html' : path.normalize(url.pathname));
  if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('content-type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/call' });
wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  const line = { send: (m) => ws.readyState === 1 && ws.send(Buffer.isBuffer(m) ? m : JSON.stringify(m)) };
  const call = new Call(line, {
    persona: q.get('persona'), voice: q.get('voice') || undefined, language: q.get('language') || undefined,
    phone: q.get('phone') === '1', multilingual: q.get('multilingual') === '1',
  });
  call.start().catch((e) => line.send({ type: 'error', source: 'start', message: e.message }));
  ws.on('message', (m, isBinary) => {
    if (isBinary) return call.audio(m);
    const j = JSON.parse(m);
    if (j.type === 'heard') call.heard(j.text);
    else if (j.type === 'playback_done') call.playbackDone();
    else if (j.type === 'text') { line.send({ type: 'user', text: j.text, final: true }); call.respond(j.text); }
  });
  ws.on('close', () => call.close());
});

server.listen(PORT, () => console.log(`Voice receptionist on http://localhost:${PORT}  (LLM: ${LLM_MODEL})`));
