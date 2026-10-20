// Do errors leak internals (hosts, stack traces, infra names, full model lists) to an unauth/low-priv caller?
import { mintToken, probe, sleep } from '../lib.mjs';
const leaky = /labs|internal|traceback|\.py|aws|us-east|k8s|pod|namespace|10\.\d|exception|at .*\(/i;
const scan = (s) => { const hits = (s||'').match(leaky); return hits ? `LEAK: ${hits[0]}` : 'clean'; };

console.log('# Error-message verbosity\n');
// Bad voice -> does the error dump the full internal voice/model catalog or just names?
const r1 = await probe('wss://streaming-tts.assemblyai.com/v1/ws?voice=../../etc', { headers: { Authorization: process.env.ASSEMBLYAI_API_KEY } }, undefined, 6000);
console.log('tts bad voice:', JSON.stringify(r1.first).slice(0,200), '->', scan(JSON.stringify(r1.first)));
await sleep(1200);
// Malformed JSON on voice-agent
const r2 = await probe('wss://agents.assemblyai.com/v1/ws', { headers: { Authorization: `Bearer ${process.env.ASSEMBLYAI_API_KEY}` } }, 'not-json{', 6000);
console.log('va malformed json:', JSON.stringify(r2.first).slice(0,200), '->', scan(JSON.stringify(r2.first)));
await sleep(1200);
// Unknown top-level field
const r3 = await probe('wss://agents.assemblyai.com/v1/ws', { headers: { Authorization: `Bearer ${process.env.ASSEMBLYAI_API_KEY}` } }, { type: 'session.update', session: { __proto__: 1, bogus_field: { x: 1 } } }, 6000);
console.log('va bogus field:', JSON.stringify(r3.first).slice(0,200), '->', scan(JSON.stringify(r3.first)));
await sleep(1200);
// HTTP mint with malformed auth — does the 4xx body leak anything
const res = await fetch('https://agents.assemblyai.com/v1/token?expires_in_seconds=60', { headers: { Authorization: 'Bearer not-a-real-key-xxxx' } });
const body = await res.text();
console.log('mint bad key: http', res.status, body.slice(0,200), '->', scan(body));
// LLM gateway model list exposure: does a bad model name enumerate all models for a low-cred caller?
const g = await fetch('https://llm-gateway.assemblyai.com/v1/chat/completions', { method:'POST', headers:{authorization:process.env.ASSEMBLYAI_API_KEY,'content-type':'application/json'}, body: JSON.stringify({model:'definitely-not-real',messages:[{role:'user',content:'x'}],max_tokens:1})});
const gb = await g.text();
console.log('llm bad model: http', g.status, gb.slice(0,220), '->', scan(gb));
