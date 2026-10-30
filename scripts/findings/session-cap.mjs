// Usage: node scripts/findings/session-cap.mjs $ASSEMBLYAI_API_KEY  (see FINDINGS.md)
import WebSocket from 'ws';
const key=process.argv[2]; const socks=[];
for(let i=0;i<6;i++){ await new Promise(r=>{const ws=new WebSocket('wss://streaming-tts.assemblyai.com/v1/ws',{headers:{Authorization:key}}); socks.push(ws); ws.once('message',m=>{console.log(i,JSON.parse(m).type, JSON.parse(m).error||'');r()}); setTimeout(r,5000)}); }
socks.forEach(s=>s.terminate()); process.exit();
