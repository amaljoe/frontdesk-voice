// Usage: node scripts/findings/auth-and-input.mjs $ASSEMBLYAI_API_KEY  (see FINDINGS.md)
import WebSocket from 'ws';
const K=process.argv[2];
const t=(name,url,opts={},after)=>new Promise(r=>{const ws=new WebSocket(url,opts);const out=[];const tm=setTimeout(()=>{ws.terminate();console.log(name,'=>',out.join(' | ')||'timeout');r()},6000);
 ws.on('unexpected-response',(q,res)=>{let b='';res.on('data',d=>b+=d);res.on('end',()=>{clearTimeout(tm);console.log(name,'=> HTTP',res.statusCode,b.slice(0,200));r()})});
 ws.on('open',()=>after&&after(ws)); ws.on('message',(m)=>{const j=JSON.parse(m); out.push(j.type==='Audio'?'Audio':JSON.stringify(j).slice(0,200)); if(j.type!=='Audio'&&j.type!=='Begin'){clearTimeout(tm);ws.terminate();console.log(name,'=>',out.join(' | '));r()}}); ws.on('error',e=>out.push('err '+e.message));});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
await t('no auth','wss://streaming-tts.assemblyai.com/v1/ws'); await wait(1500);
await t('bad key','wss://streaming-tts.assemblyai.com/v1/ws',{headers:{Authorization:'deadbeef'}}); await wait(1500);
const tok=(await (await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=60&max_session_duration_seconds=60',{headers:{Authorization:K}})).json()).token;
await t('STT temp token on TTS','wss://streaming-tts.assemblyai.com/v1/ws?token='+tok,{},ws=>{ws.send(JSON.stringify({type:'Generate',text:'scope test'}));ws.send(JSON.stringify({type:'Flush'}))}); await wait(1500);
await t('STT temp token reused 2nd time','wss://streaming-tts.assemblyai.com/v1/ws?token='+tok); await wait(1500);
await t('huge text','wss://streaming-tts.assemblyai.com/v1/ws',{headers:{Authorization:K}},ws=>{ws.send(JSON.stringify({type:'Generate',text:'a '.repeat(60000)}));}); await wait(1500);
await t('SSML/markup','wss://streaming-tts.assemblyai.com/v1/ws',{headers:{Authorization:K}},ws=>{ws.send(JSON.stringify({type:'Generate',text:'<speak><break time="3s"/>hi</speak>'}));ws.send(JSON.stringify({type:'Flush'}))}); await wait(1500);
await t('empty generate+flush','wss://streaming-tts.assemblyai.com/v1/ws',{headers:{Authorization:K}},ws=>{ws.send(JSON.stringify({type:'Flush'}))}); await wait(1500);
await t('binary frame','wss://streaming-tts.assemblyai.com/v1/ws',{headers:{Authorization:K}},ws=>{ws.send(Buffer.from([1,2,3]))}); await wait(1500);
await t('VoiceReference w/o clone','wss://streaming-tts.assemblyai.com/v1/ws',{headers:{Authorization:K}},ws=>{ws.send(JSON.stringify({type:'VoiceReference',audio:'AAAA'}))}); await wait(1500);
await t('voice_clone via message flag','wss://streaming-tts.assemblyai.com/v1/ws?voice_clone=1',{headers:{Authorization:K}}); 
process.exit();
