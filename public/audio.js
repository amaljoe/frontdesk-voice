// Browser audio: 16 kHz PCM mic capture, and gapless playback of streamed TTS chunks
// with a timeline so word boundaries can be mapped onto what is actually audible.

const WORKLET = `
class Mic extends AudioWorkletProcessor {
  constructor(o) { super(); this.ratio = sampleRate / 16000; this.acc = []; this.pos = 0; }
  process([input]) {
    const ch = input[0]; if (!ch) return true;
    // Naive decimation with averaging; plenty for speech recognition.
    for (let i = 0; i < ch.length; i++) {
      this.acc.push(ch[i]);
    }
    const out = [];
    while (this.pos + this.ratio <= this.acc.length) {
      const a = Math.floor(this.pos), b = Math.max(a + 1, Math.floor(this.pos + this.ratio));
      let s = 0; for (let k = a; k < b; k++) s += this.acc[k];
      out.push(s / (b - a)); this.pos += this.ratio;
    }
    const drop = Math.floor(this.pos); this.acc = this.acc.slice(drop); this.pos -= drop;
    if (out.length) {
      const pcm = new Int16Array(out.length);
      let peak = 0;
      for (let i = 0; i < out.length; i++) { const v = Math.max(-1, Math.min(1, out[i])); pcm[i] = v * 32767; peak = Math.max(peak, Math.abs(v)); }
      this.port.postMessage({ pcm: pcm.buffer, peak }, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor('mic', Mic);`;

export async function startMic(ctx, onChunk, onLevel) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' })));
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'mic');
  // Batch into ~100 ms frames (STT wants 50-1000 ms per message).
  let pending = [], n = 0;
  node.port.onmessage = ({ data }) => {
    onLevel?.(data.peak);
    pending.push(new Int16Array(data.pcm)); n += data.pcm.byteLength / 2;
    if (n >= 1600) {
      const out = new Int16Array(n); let o = 0;
      for (const p of pending) { out.set(p, o); o += p.length; }
      pending = []; n = 0;
      onChunk(out.buffer);
    }
  };
  src.connect(node);
  const stop = () => { stream.getTracks().forEach((t) => t.stop()); node.disconnect(); };
  stop.source = src;
  return stop;
}

function mulawToFloat(u) {
  u = ~u & 0xff;
  const sign = u & 0x80, exp = (u >> 4) & 7, man = u & 0x0f;
  let s = (((man << 3) + 0x84) << exp) - 0x84;
  return (sign ? -s : s) / 32768;
}

export class Player {
  constructor(ctx, analyser) { this.ctx = ctx; this.out = analyser || ctx.destination; this.configure(24000, 'pcm_s16le'); this.reset(); }
  configure(rate, encoding) { this.rate = rate; this.encoding = encoding; }
  // `segments` maps the TTS socket's own audio clock (ms) onto AudioContext time.
  reset() {
    for (const s of this.sources || []) { try { s.stop(); } catch {} }
    this.sources = []; this.segments = []; this.socketMs = 0; this.playhead = 0;
  }
  push(arrayBuf) {
    let f;
    if (this.encoding === 'pcm_mulaw') { const u = new Uint8Array(arrayBuf); f = new Float32Array(u.length); for (let i = 0; i < u.length; i++) f[i] = mulawToFloat(u[i]); }
    else { const i16 = new Int16Array(arrayBuf); f = new Float32Array(i16.length); for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768; }
    if (!f.length) return;
    const buf = this.ctx.createBuffer(1, f.length, this.rate);
    buf.copyToChannel(f, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.connect(this.out);
    const at = Math.max(this.ctx.currentTime + 0.03, this.playhead);
    src.start(at);
    const dur = f.length / this.rate;
    this.segments.push({ ms: this.socketMs, at, dur });
    this.socketMs += dur * 1000; this.playhead = at + dur;
    this.sources.push(src);
    src.onended = () => { this.sources = this.sources.filter((s) => s !== src); if (!this.sources.length) this.onIdle?.(); };
  }
  // AudioContext time at which socket-clock millisecond `ms` is heard (null if not yet received).
  timeOf(ms) {
    for (const s of this.segments) if (ms >= s.ms && ms < s.ms + s.dur * 1000) return s.at + (ms - s.ms) / 1000;
    return null;
  }
  get playing() { return this.playhead > this.ctx.currentTime; }
}
