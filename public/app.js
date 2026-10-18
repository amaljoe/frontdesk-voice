import { startMic, Player } from './audio.js';

const $ = (id) => document.getElementById(id);
let ws, ctx, player, analyser, stopMic, call = null;
let agentTurn = null;     // current agent bubble
let userPartial = null;   // current partial-transcript bubble
let words = [];           // {word, at, end, el} scheduled for highlighting
const firstAudio = [];

const personas = await (await fetch('/api/personas')).json();
for (const [k, p] of Object.entries(personas.personas)) $('persona').add(new Option(`${p.business} — ${p.name}`, k));

function status(s) { const el = $('status'); el.textContent = s; el.className = `status ${s}`; }
function bubble(cls, text, label) {
  const d = document.createElement('div');
  d.className = `msg ${cls}`;
  d.innerHTML = `<span class="lbl">${label}</span><span class="t"></span>`;
  d.querySelector('.t').textContent = text;
  $('transcript').append(d); $('transcript').scrollTop = 1e9;
  return d;
}
function sys(text) { const d = document.createElement('div'); d.className = 'sys'; d.textContent = text; $('transcript').append(d); $('transcript').scrollTop = 1e9; }

$('call').onclick = () => (call ? hangup() : dial());
$('typeform').onsubmit = (e) => {
  e.preventDefault();
  const text = $('typed').value.trim(); if (!text || !ws) return;
  ws.send(JSON.stringify({ type: 'text', text })); $('typed').value = '';
};

async function dial() {
  ctx = new AudioContext();
  analyser = ctx.createAnalyser(); analyser.fftSize = 512; analyser.connect(ctx.destination);
  player = new Player(ctx, analyser);
  player.onIdle = () => { ws?.send(JSON.stringify({ type: 'playback_done' })); if (call) status('listening'); };
  $('transcript').innerHTML = ''; $('actions').innerHTML = ''; $('caption').innerHTML = '';
  const q = new URLSearchParams({ persona: $('persona').value, voice: $('voice').value, phone: $('phone').checked ? 1 : 0, multilingual: $('multi').checked ? 1 : 0 });
  ws = new WebSocket(`${location.origin.replace('http', 'ws')}/call?${q}`);
  ws.binaryType = 'arraybuffer';
  call = { micLevel: 0 };
  $('call').textContent = 'Hang up'; $('call').classList.add('live');
  ws.onmessage = (e) => (typeof e.data === 'string' ? onEvent(JSON.parse(e.data)) : onAudio(e.data));
  ws.onclose = () => hangup(true);
  try {
    stopMic = await startMic(ctx, (pcm) => ws.readyState === 1 && ws.send(pcm), (lvl) => (call && (call.micLevel = lvl)));
  } catch (e) { sys(`Microphone unavailable (${e.message}) — use “Type instead”.`); }
  if (new URLSearchParams(location.search).has('record')) record();
}

// ?record: capture caller + agent audio of the call (used to produce the demo video).
function record() {
  const dest = ctx.createMediaStreamDestination();
  analyser.connect(dest);
  stopMic?.source.connect(dest);
  const rec = new MediaRecorder(dest.stream), parts = [];
  rec.ondataavailable = (e) => parts.push(e.data);
  rec.onstop = async () => {
    const buf = await new Blob(parts).arrayBuffer();
    let bin = ''; const u = new Uint8Array(buf);
    for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
    window.__recording = btoa(bin);
  };
  window.__recordingStartedAt = performance.now();
  rec.start(1000);
  window.__stopRecording = () => rec.state !== 'inactive' && rec.stop();
}

function hangup(remote) {
  if (!call) return;
  call = null;
  window.__stopRecording?.();
  stopMic?.(); stopMic = null;
  if (!remote) ws?.close();
  setTimeout(() => ctx?.close(), 1500);
  $('call').textContent = 'Start call'; $('call').classList.remove('live');
  status('idle'); sys('Call ended');
}

function onAudio(buf) {
  player.push(buf);
  status('speaking');
}

function onEvent(ev) {
  if (['interrupt', 'action', 'metric', 'user'].includes(ev.type) && (ev.type !== 'user' || ev.final)) console.log('MARK ' + ev.type + (ev.name ? ':' + ev.name : '') + (ev.result ? ':' + ev.result.title : ''));
  switch (ev.type) {
    case 'config':
      player.configure(ev.sampleRate, ev.encoding);
      $('who-name').textContent = ev.persona.name; $('who-biz').textContent = ev.persona.business;
      $('state').textContent = JSON.stringify(ev.state, null, 2);
      sys(`Connected · voice ${ev.voice} · ${ev.sampleRate / 1000} kHz ${ev.encoding} · ${ev.model}`);
      break;
    case 'stt_ready': status('listening'); break;
    case 'user':
      if (!userPartial) userPartial = bubble('user partial', ev.text, 'Caller');
      userPartial.querySelector('.t').textContent = ev.text;
      if (ev.final) { userPartial.classList.remove('partial'); userPartial = null; agentTurn = null; status('thinking'); }
      break;
    case 'agent':
      if (!agentTurn) { agentTurn = bubble('agent', '', $('who-name').textContent); agentTurn.spoken = ''; }
      if (ev.final) agentTurn.querySelector('.t').textContent = ev.text;
      else agentTurn.querySelector('.t').textContent += (agentTurn.querySelector('.t').textContent ? ' ' : '') + ev.text;
      break;
    case 'words': scheduleWords(ev); break;
    case 'interrupt': {
      // What did the caller actually hear? Tell the server so the LLM remembers the truth.
      const heard = words.filter((w) => w.at <= ctx.currentTime).map((w) => w.word).join(' ');
      player.reset(); words = []; $('caption').innerHTML = '';
      if (agentTurn) { agentTurn.classList.add('cut'); agentTurn = null; }
      ws.send(JSON.stringify({ type: 'heard', text: heard }));
      status('listening');
      break;
    }
    case 'tts_reset': player.reset(); words = []; break;
    case 'metric': metric(ev); break;
    case 'action': action(ev); break;
    case 'language': sys(`Caller language detected → ${ev.language}, voice ${ev.voice}`); break;
    case 'hangup': setTimeout(() => hangup(), 2500); break;
    case 'error': sys(`⚠ ${ev.source}: ${ev.message}`); break;
  }
}

// Map TTS word boundaries (ms on the socket's audio clock) to AudioContext time and render a caption.
function scheduleWords(ev) {
  const cap = $('caption');
  if (!agentTurn || !agentTurn.capStarted) { cap.innerHTML = ''; words = words.filter((w) => w.at == null || w.at > ctx.currentTime); if (agentTurn) agentTurn.capStarted = true; }
  for (const w of ev.words) {
    const el = document.createElement('span');
    el.className = 'w'; el.textContent = w.word + ' ';
    cap.append(el);
    words.push({ word: w.word, ms: ev.audio_start_ms + w.start, el });
  }
}

function tick() {
  requestAnimationFrame(tick);
  if (ctx && player) {
    for (const w of words) {
      if (w.at == null) w.at = player.timeOf(w.ms);
      if (w.at != null && w.at <= ctx.currentTime) w.el.classList.add('on');
    }
  }
  drawOrb();
}

function metric(ev) {
  if (ev.name === 'first_audio') {
    firstAudio.push(ev.ms);
    $('m-first').textContent = `${ev.ms}ms`;
    $('m-avg').textContent = `${Math.round(firstAudio.reduce((a, b) => a + b, 0) / firstAudio.length)}ms`;
    const max = Math.max(...firstAudio, 1500), n = firstAudio.length;
    const pts = firstAudio.map((v, i) => `${n === 1 ? 120 : (i / (n - 1)) * 236 + 2},${46 - (v / max) * 42}`).join(' ');
    $('spark').innerHTML = `<polyline fill="none" stroke="var(--agent)" stroke-width="2" points="${pts}"/>`;
  }
  if (ev.name === 'llm_first_token') $('m-llm').textContent = `${ev.ms}ms`;
}

function action(ev) {
  const first = $('actions').querySelector('.muted'); if (first) first.remove();
  const d = document.createElement('div');
  d.className = `act ${ev.result.ok ? '' : 'bad'}`;
  d.innerHTML = `<b></b><span></span>`;
  d.querySelector('b').textContent = `${ev.result.ok ? '✓' : '✗'} ${ev.result.title}`;
  d.querySelector('span').textContent = ev.result.detail;
  $('actions').prepend(d);
  $('state').textContent = JSON.stringify(ev.state, null, 2);
}

// Audio-reactive orb: agent output drives the ring, caller mic level drives the glow.
const orb = $('orb').getContext('2d');
const fft = new Uint8Array(256);
let glow = 0;
function drawOrb() {
  const W = 360, cx = W / 2, cy = W / 2;
  orb.clearRect(0, 0, W, W);
  const css = getComputedStyle(document.documentElement);
  const agentC = css.getPropertyValue('--agent').trim(), userC = css.getPropertyValue('--user').trim();
  glow = glow * 0.85 + (call?.micLevel || 0) * 0.15 * 3;
  if (analyser) analyser.getByteFrequencyData(fft); else fft.fill(0);
  const pts = 96, t = performance.now() / 1000;
  orb.beginPath();
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * Math.PI * 2;
    const f = (i % pts) / pts, v = fft[Math.floor((f < 0.5 ? f : 1 - f) * 2 * 64) + 2] / 255; // mirrored: no seam
    const r = 92 + v * 46 + Math.sin(a * 3 + t * 1.5) * 3;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    i ? orb.lineTo(x, y) : orb.moveTo(x, y);
  }
  orb.closePath();
  const g = orb.createRadialGradient(cx, cy, 20, cx, cy, 140);
  g.addColorStop(0, agentC + '55'); g.addColorStop(1, agentC + '05');
  orb.fillStyle = g; orb.fill();
  orb.lineWidth = 2.5; orb.strokeStyle = agentC; orb.stroke();
  if (glow > 0.02) {
    orb.beginPath(); orb.arc(cx, cy, 150, 0, Math.PI * 2);
    orb.lineWidth = Math.min(10, glow * 30); orb.strokeStyle = userC + '99'; orb.stroke();
  }
}
tick();
