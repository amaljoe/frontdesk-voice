// Usage: node scripts/findings/cancel-inflight.mjs $ASSEMBLYAI_API_KEY  (see FINDINGS.md)
import WebSocket from 'ws';
const ws=new WebSocket('wss://streaming-tts.assemblyai.com/v1/ws',{headers:{Authorization:process.argv[2]}});
const t0=Date.now(); const seen={};
const S=o=>ws.send(JSON.stringify(o));
ws.on('message',m=>{const j=JSON.parse(m); if(j.type==='Audio'){seen[j.flush_id]=(seen[j.flush_id]||0)+1; if(seen[j.flush_id]===1)console.log(Date.now()-t0,'first audio flush',j.flush_id);return} console.log(Date.now()-t0,j.type,j.flush_id??'',j.error||'')});
ws.on('open',async()=>{
 S({type:'Generate',text:'One. This is the first long sentence that keeps going for quite a while longer than needed.'});S({type:'Flush'});
 S({type:'Generate',text:'Two. Second sentence also queued here.'});S({type:'Flush'});
 await new Promise(r=>setTimeout(r,700)); console.log(Date.now()-t0,'CANCEL'); S({type:'Cancel'});
 S({type:'Generate',text:'Three after cancel.'});S({type:'Flush'});
 await new Promise(r=>setTimeout(r,4000)); console.log(seen); S({type:'Terminate'});
});
ws.on('close',()=>process.exit());
