// Finding probe: is a Voice Agent browser token single-use, as the official starter's comment claims?
// "a short-lived, single-use token minted here — so your API key never reaches the client"
import { mintToken, probe, sleep } from '../lib.mjs';

const VA = 'wss://agents.assemblyai.com/v1/ws';
const openWith = (token) => probe(`${VA}?token=${encodeURIComponent(token)}`, undefined,
  { type: 'session.update', session: { greeting: 'probe' } }, 7000);
const ok = (r) => r.first?.type?.startsWith('session') && r.first?.type !== 'session.error';
const why = (r) => r.first?.type ? `${r.first.type}${r.first.error ? ' ' + r.first.error : ''}${r.first.message ? ' ' + r.first.message : ''}` : (r.error || (r.http && `http ${r.http}`) || (r.closed && `close ${r.closed} ${r.reason}`) || 'timeout');

console.log('# Voice Agent /v1/token lifecycle\n');

const t = (await mintToken('voice-agent', 60)).token;
const a = await openWith(t); console.log(`use #1: ${ok(a) ? 'ACCEPTED' : 'rejected'} (${why(a)})`);
await sleep(1500);
const b = await openWith(t); console.log(`use #2 (same token, after #1 closed): ${ok(b) ? 'ACCEPTED — NOT single-use' : 'rejected (good)'} (${why(b)})`);
await sleep(1500);
const c = await openWith(t); console.log(`use #3 (same token again): ${ok(c) ? 'ACCEPTED' : 'rejected'} (${why(c)})`);

await sleep(1500);
const sh = (await mintToken('voice-agent', 3)).token;
await sleep(8000);
const expd = await openWith(sh);
console.log(`\nexpiry: minted 3s TTL, used after 8s: ${ok(expd) ? 'ACCEPTED — TTL not enforced' : 'rejected (good)'} (${why(expd)})`);

for (const sec of [86400, 31536000]) {
  const r = await mintToken('voice-agent', sec);
  console.log(`TTL request ${sec}s (${(sec/86400).toFixed(0)}d): mint status ${r.status}${r.token ? ' — token issued' : ' — ' + r.raw}`);
  await sleep(500);
}
