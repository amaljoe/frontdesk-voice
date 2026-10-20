// Tiny shared helpers for the probes. Production hosts only.
import WebSocket from '../node_modules/ws/index.js';
export const KEY = process.env.ASSEMBLYAI_API_KEY;
if (!KEY) { console.error('set ASSEMBLYAI_API_KEY'); process.exit(1); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function mintToken(product, expires = 60, extra = {}) {
  // Documented token endpoints. streaming: /v3/token; voice-agent: /v1/token (Bearer on mint).
  const cfg = {
    streaming: { url: 'https://streaming.assemblyai.com/v3/token', bearer: false },
    'voice-agent': { url: 'https://agents.assemblyai.com/v1/token', bearer: true },
  }[product];
  const u = new URL(cfg.url);
  u.searchParams.set('expires_in_seconds', expires);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { Authorization: cfg.bearer ? `Bearer ${KEY}` : KEY } });
  const body = await res.text();
  let json; try { json = JSON.parse(body); } catch {}
  return { status: res.status, token: json?.token, raw: body.slice(0, 300), json };
}

// Open a WS, send optional first message, resolve with {first, close} — the first server
// message type/error and the close code. Never streams real user audio.
export function probe(url, opts, firstMsg, waitMs = 6000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, opts);
    let first = null;
    const done = (extra) => { try { ws.terminate(); } catch {} resolve({ first, ...extra }); };
    const timer = setTimeout(() => done({ timeout: true }), waitMs);
    ws.on('open', () => firstMsg && ws.send(typeof firstMsg === 'string' ? firstMsg : JSON.stringify(firstMsg)));
    ws.on('message', (m) => { try { first ||= JSON.parse(m); } catch { first ||= { type: 'binary', bytes: m.length }; } clearTimeout(timer); done({}); });
    ws.on('unexpected-response', (_q, r) => { clearTimeout(timer); done({ http: r.statusCode }); });
    ws.on('error', (e) => { clearTimeout(timer); done({ error: e.message }); });
    ws.on('close', (c, r) => { clearTimeout(timer); done({ closed: c, reason: r.toString().slice(0, 120) }); });
  });
}
