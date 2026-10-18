// Usage: node scripts/findings/token-reuse-and-scope.mjs $ASSEMBLYAI_API_KEY  (see FINDINGS.md)
import WebSocket from 'ws';
const K=process.argv[2];
const tok=(await (await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=120&max_session_duration_seconds=60',{headers:{Authorization:K}})).json()).token;
const open=(name,url)=>new Promise(r=>{const ws=new WebSocket(url);ws.on('message',m=>{const j=JSON.parse(m);console.log(new Date().toISOString().slice(11,19),name,j.type,j.error||'',j.expires_at?('expires_at in '+(j.expires_at-Date.now()/1000|0)+'s'):'');r(ws)});ws.on('unexpected-response',(q,res)=>{console.log(name,'HTTP',res.statusCode);r()});setTimeout(()=>r(),6000)});
// STT: single-use? 
const s1=await open('STT use#1','wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&token='+tok);
const s2=await open('STT use#2 (concurrent)','wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&token='+tok);
const t1=await open('TTS use#1 concurrent','wss://streaming-tts.assemblyai.com/v1/ws?token='+tok);
const t2=await open('TTS use#2 concurrent','wss://streaming-tts.assemblyai.com/v1/ws?token='+tok);
[s1,s2,t1,t2].forEach(w=>w?.terminate?.());
await new Promise(r=>setTimeout(r,100)); // token "expires_in_seconds=120" has passed
const t3=await open('TTS after token expiry (+12s)','wss://streaming-tts.assemblyai.com/v1/ws?token='+tok);
const s3=await open('STT after token expiry (+12s)','wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&token='+tok);
[t3,s3].forEach(w=>w?.terminate?.()); process.exit();
