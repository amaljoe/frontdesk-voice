// Usage: node scripts/findings/voices-per-language.mjs $ASSEMBLYAI_API_KEY  (see FINDINGS.md)
import WebSocket from 'ws';
const lang=process.argv[3];
for(let i=0;i<30;i++){ const r=await new Promise(r=>{ const ws=new WebSocket(`wss://streaming-tts.assemblyai.com/v1/ws?language=${lang}&voice=zzz`,{headers:{Authorization:process.argv[2]}});
  ws.on('message',m=>{const j=JSON.parse(m); if(j.type==='Error'){ws.terminate(); r(j.error)}}); setTimeout(()=>r('t'),6000)});
  if(!/concurrent/.test(r)){console.log(lang, r.match(/\[.*\]/)?.[0]||r); break}
  await new Promise(r=>setTimeout(r,5000)); }
process.exit();
