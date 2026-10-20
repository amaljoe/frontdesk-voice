// How bad is the multi-use token? (1) concurrent sessions from ONE token, (2) cross-product use.
import { mintToken, probe, sleep } from '../lib.mjs';
const VA = 'wss://agents.assemblyai.com/v1/ws';
const ST = 'wss://streaming.assemblyai.com/v3/ws';
const TT = 'wss://streaming-tts.assemblyai.com/v1/ws';
const openVA = (tok) => probe(`${VA}?token=${encodeURIComponent(tok)}`, undefined, { type: 'session.update', session: { greeting: 'x' } }, 7000);
const openST = (tok) => probe(`${ST}?sample_rate=16000&token=${encodeURIComponent(tok)}`, undefined, undefined, 7000);
const openTT = (tok) => probe(`${TT}?token=${encodeURIComponent(tok)}`, undefined, undefined, 7000);
const sess = (r) => r.first?.type?.startsWith('session') && r.first?.type !== 'session.error';
const beg = (r) => r.first?.type === 'Begin';
const why = (r) => r.first?.type ? `${r.first.type}${r.first.error||r.first.message?(' '+(r.first.error||r.first.message)):''}` : (r.error || (r.http&&`http ${r.http}`) || (r.closed&&`close ${r.closed}`) || 'timeout');

console.log('# Concurrency: how many sessions can ONE Voice Agent token open at once?\n');
const t = (await mintToken('voice-agent', 300)).token;
const results = await Promise.all([0,1,2,3,4].map(() => openVA(t)));
const okN = results.filter(sess).length;
console.log(`one token, 5 simultaneous VA sessions: ${okN}/5 accepted`);
results.forEach((r,i)=>console.log(`  [${i}] ${why(r)}`));

console.log('\n# Cross-product: does a token minted for one product open another?\n');
await sleep(2000);
const stTok = (await mintToken('streaming', 120)).token;
await sleep(500);
const vaTok = (await mintToken('voice-agent', 120)).token;
await sleep(500);
const x1 = await openTT(stTok); console.log(`streaming token on TTS:         ${beg(x1)?'ACCEPTED — cross-product':'rejected'} (${why(x1)})`);
await sleep(1500);
const x2 = await openVA(stTok); console.log(`streaming token on Voice Agent: ${sess(x2)?'ACCEPTED — cross-product':'rejected'} (${why(x2)})`);
await sleep(1500);
const x3 = await openTT(vaTok); console.log(`voice-agent token on TTS:       ${beg(x3)?'ACCEPTED — cross-product':'rejected'} (${why(x3)})`);
await sleep(1500);
const x4 = await openST(vaTok); console.log(`voice-agent token on streaming: ${beg(x4)?'ACCEPTED — cross-product':'rejected'} (${why(x4)})`);
