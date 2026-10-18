// One phone call: AssemblyAI streaming STT -> LLM Gateway -> AssemblyAI streaming TTS.
// The "line" is anything with send(jsonOrBuffer): a browser WebSocket or the headless simulator.
import WebSocket from 'ws';
import { personas, applyAction, plausible } from './personas.mjs';

const KEY = () => process.env.ASSEMBLYAI_API_KEY;
const TTS_URL = 'wss://streaming-tts.assemblyai.com/v1/ws';
const STT_URL = 'wss://streaming.assemblyai.com/v3/ws';
const LLM_URL = 'https://llm-gateway.assemblyai.com/v1/chat/completions';
export const LLM_MODEL = process.env.LLM_MODEL || 'qwen3.5-4b-32k-fast';

// Preset voices are bound to one language on this deployment.
export const LANG_VOICES = { english: null, french: 'estelle', german: 'juergen', italian: 'giovanni', portuguese: 'rafael', spanish: 'lola' };
const BYE = { english: 'Thanks for calling, goodbye!', french: 'Merci de votre appel, au revoir !', spanish: '¡Gracias por llamar, adiós!', german: 'Danke für Ihren Anruf, auf Wiederhören!', italian: 'Grazie per la chiamata, arrivederci!', portuguese: 'Obrigado pela ligação, tchau!' };
const AGAIN = { english: 'Sorry, could you say that again?', french: 'Pardon, pouvez-vous répéter ?', spanish: 'Perdón, ¿puede repetirlo?', german: 'Entschuldigung, können Sie das wiederholen?', italian: 'Scusi, può ripetere?', portuguese: 'Desculpe, pode repetir?' };
const LANG_CODES = { en: 'english', fr: 'french', es: 'spanish', de: 'german', it: 'italian', pt: 'portuguese' };

// The server's `Cancel` does not stop audio that is already queued for a flush, so on barge-in we
// drop the socket (and every in-flight chunk with it) and open a fresh one.
function openTts({ voice, language, sampleRate, encoding }) {
  const q = new URLSearchParams({ voice, language, sample_rate: sampleRate, encoding });
  const ws = new WebSocket(`${TTS_URL}?${q}`, { headers: { Authorization: KEY() } });
  ws.ready = new Promise((res, rej) => {
    ws.once('message', (m) => {
      const j = JSON.parse(m);
      j.type === 'Begin' ? res(j) : rej(new Error(j.error || 'TTS failed to start'));
    });
    ws.once('error', rej);
  });
  ws.ready.catch(() => {});
  return ws;
}

// The account allows a handful of concurrent TTS sessions and a just-closed one lingers briefly,
// so retry "too many concurrent sessions" with backoff instead of failing the call.
async function connectTts(opts, onRetry) {
  for (let attempt = 0; ; attempt++) {
    const ws = openTts(opts);
    try { await ws.ready; return ws; } catch (e) {
      ws.terminate();
      if (!/concurrent/i.test(e.message) || attempt >= 20) throw e;
      onRetry?.(attempt);
      await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 5000)));
    }
  }
}

export class Call {
  constructor(line, opts = {}) {
    this.line = line;
    this.p = personas[opts.persona] || personas.dental;
    this.state = this.p.state();
    this.voice = opts.voice || this.p.voice;
    this.language = opts.language || 'english';
    this.homeVoice = this.voice;
    if (LANG_VOICES[this.language]) this.voice = LANG_VOICES[this.language];
    this.phone = !!opts.phone; // 8 kHz mu-law, i.e. a real telephone line
    this.sampleRate = this.phone ? 8000 : 24000;
    this.encoding = this.phone ? 'pcm_mulaw' : 'pcm_s16le';
    this.multilingual = !!opts.multilingual;
    this.history = [{ role: 'assistant', content: this.p.greeting }];
    this.gen = 0;          // bumps on every interruption; stale work checks it
    this.speaking = false; // agent audio is generating or still playing on the client
    this.closed = false;
  }

  send(obj) { if (!this.closed) this.line.send(obj); }
  event(type, data = {}) { this.send({ type, t: Date.now(), ...data }); }

  async start() {
    this.event('config', {
      persona: { name: this.p.name, business: this.p.business },
      voice: this.voice, language: this.language, sampleRate: this.sampleRate, encoding: this.encoding,
      model: LLM_MODEL, state: this.state,
    });
    this.openStt();
    this.warmLlm();
    this.tts = this.attachTts(await connectTts(this.ttsOpts(), () => this.event('error', { source: 'tts', message: 'TTS busy (session cap) — retrying' })));
    this.speak(this.p.greeting, this.gen);
  }

  // The gateway's first request on a connection is noticeably slower; spend it during the greeting.
  warmLlm() {
    fetch(LLM_URL, { method: 'POST', headers: { authorization: KEY(), 'content-type': 'application/json' },
      body: JSON.stringify({ model: LLM_MODEL, max_tokens: 1, messages: [{ role: 'system', content: this.p.prompt(this.state) }, { role: 'user', content: 'hi' }] }) }).catch(() => {});
  }

  ttsOpts() { return { voice: this.voice, language: this.language, sampleRate: this.sampleRate, encoding: this.encoding }; }

  // One persistent TTS socket per call (the account caps concurrent TTS sessions, and closed
  // sessions linger server-side). `Cancel` does not abort flushes already being synthesized, so
  // after a Cancel we discard audio until the server's `Cancelled` marker arrives.
  attachTts(ws) {
    this.discarding = false;
    this.pendingFlushes = 0;
    this.agentAudioMs = 0;     // ms of agent audio sent to the line this turn
    this.audioStartedAt = 0;   // wall clock when that audio started playing (approx.)
    ws.on('message', (m) => {
      if (this.closed) return;
      const j = JSON.parse(m);
      if (j.type === 'Cancelled') { this.discarding = false; return; }
      if (this.discarding) { if (j.type === 'FlushDone') this.pendingFlushes = Math.max(0, this.pendingFlushes - 1); return; }
      if (j.type === 'Audio') {
        const buf = Buffer.from(j.audio, 'base64');
        if (!this.firstAudioAt && this.turnEndAt) {
          this.firstAudioAt = Date.now();
          this.event('metric', { name: 'first_audio', ms: this.firstAudioAt - this.turnEndAt });
        }
        const now = Date.now();
        if (!this.audioStartedAt || now > this.audioStartedAt + this.agentAudioMs) { this.audioStartedAt = now; this.agentAudioMs = 0; }
        this.agentAudioMs += (buf.length / (this.encoding === 'pcm_s16le' ? 2 : 1) / this.sampleRate) * 1000;
        this.line.send(buf);
      } else if (j.type === 'WordBoundaries') {
        this.event('words', { flush_id: j.flush_id, audio_start_ms: j.audio_start_ms, words: j.words });
      } else if (j.type === 'FlushDone') {
        this.pendingFlushes = Math.max(0, this.pendingFlushes - 1);
        this.event('flush_done', { flush_id: j.flush_id, audio_duration_ms: j.audio_duration_ms });
      } else if (j.type === 'Error') {
        this.event('error', { source: 'tts', message: j.error });
      }
    });
    ws.on('close', (c) => { if (ws === this.tts && !this.closed) { this.event('error', { source: 'tts', message: `closed ${c}, reconnecting` }); this.reopenTts(); } });
    return ws;
  }

  reopenTts() {
    // Callers await this.tts.ready, so park a pending promise there until the new socket is live.
    const pending = connectTts(this.ttsOpts());
    this.tts = { ready: pending, send() {} };
    pending.then((ws) => { if (this.closed) return ws.terminate(); this.tts = this.attachTts(ws); this.tts.ready = Promise.resolve(); },
      (e) => this.event('error', { source: 'tts', message: e.message }));
  }

  // Stop agent speech now: tell TTS to cancel, drop everything until it confirms, tell the client to flush its buffer.
  cancelTts() {
    if (this.pendingFlushes > 0) { this.discarding = true; try { this.tts.send(JSON.stringify({ type: 'Cancel' })); } catch {} }
    this.pendingFlushes = 0;
    this.audioStartedAt = 0; this.agentAudioMs = 0;
    this.event('tts_reset');
  }

  // Is the caller (probably) still hearing agent audio?
  agentAudible() { return this.pendingFlushes > 0 || (this.audioStartedAt && Date.now() < this.audioStartedAt + this.agentAudioMs + 150); }

  ttsSend(text) {
    this.tts.send(JSON.stringify({ type: 'Generate', text }));
    this.tts.send(JSON.stringify({ type: 'Flush' }));
    this.pendingFlushes++;
  }

  async speak(text, gen) {
    await this.tts.ready;
    if (gen !== this.gen) return;
    this.speaking = true;
    this.ttsSend(text);
    this.event('agent', { text, final: true });
  }

  openStt() {
    const q = new URLSearchParams({
      sample_rate: 16000, encoding: 'pcm_s16le',
      speech_model: this.multilingual ? 'universal-streaming-multilingual' : 'universal-3-6-pro',
      ...(this.multilingual ? { language_detection: 'true', format_turns: 'true' } : {}),
      keyterms_prompt: JSON.stringify(this.keyterms()),
    });
    this.stt = new WebSocket(`${STT_URL}?${q}`, { headers: { Authorization: KEY() } });
    this.stt.on('message', (m) => this.onStt(JSON.parse(m)));
    this.stt.on('error', (e) => this.event('error', { source: 'stt', message: e.message }));
    this.stt.on('close', (c, r) => { if (!this.closed) this.event('error', { source: 'stt', message: `closed ${c} ${r}` }); });
  }

  keyterms() { return [this.p.name, this.p.business, ...this.p.business.split(' ')].filter((w) => w.length > 2); }

  audio(buf) {
    this.micBytes = (this.micBytes || 0) + buf.length;
    if (process.env.DEBUG && this.micBytes % 64000 < buf.length) console.log('mic bytes', this.micBytes, 'stt state', this.stt?.readyState);
    if (this.stt?.readyState === WebSocket.OPEN) this.stt.send(buf);
  }

  onStt(j) {
    if (process.env.DEBUG && j.type !== 'Turn') console.log('stt', JSON.stringify(j).slice(0, 300));
    if (j.type === 'Begin') return this.event('stt_ready', { model: j.configuration?.speech_model || j.configuration?.model });
    if (j.type !== 'Turn') return;
    const text = (j.transcript || '').trim();
    if (!text) return;
    this.event('user', { text, final: !!j.end_of_turn, turn: j.turn_order });
    // Barge-in: the caller talks over the agent. Two words avoids triggering on coughs and echo.
    if ((this.agentAudible() || this.llmAbort) && !j.end_of_turn && text.split(/\s+/).length >= 2) this.interrupt('barge-in');
    if (j.end_of_turn && (j.turn_is_formatted || !this.multilingual)) {
      if (this.lastTurn === j.turn_order) return; // unformatted + formatted finals share an order
      this.lastTurn = j.turn_order;
      if (this.multilingual && j.language_code) this.maybeSwitchLanguage(j.language_code);
      this.respond(j.utterance || text);
    }
  }

  maybeSwitchLanguage(code) {
    const lang = LANG_CODES[code];
    if (!lang || lang === this.language) return;
    this.language = lang;
    this.voice = LANG_VOICES[lang] || this.homeVoice;
    this.event('language', { language: lang, voice: this.voice });
    this.interrupt('language-switch');
    try { this.tts.send(JSON.stringify({ type: 'Terminate' })); } catch {}
    const old = this.tts; old.removeAllListeners('close'); old.removeAllListeners('message');
    setTimeout(() => old.terminate(), 300);
    this.reopenTts();
  }

  interrupt(reason) {
    if (!this.agentAudible() && !this.llmAbort) return;
    this.gen++;
    this.llmAbort?.abort();
    this.llmAbort = null;
    this.speaking = false;
    this.cancelTts();
    this.event('interrupt', { reason });
  }

  // Client reports what it actually played; keeps the LLM's memory honest after a barge-in.
  heard(text) {
    const last = this.history[this.history.length - 1];
    const note = `${text || ''}… [cut off by the caller]`;
    if (last?.role === 'assistant') { if (!text || text.length < last.content.length) last.content = note; }
    else this.history.push({ role: 'assistant', content: note });
  }

  playbackDone() { if (this.pendingFlushes <= 0 && !this.llmAbort) this.speaking = false; }

  async respond(userText) {
    this.interrupt('new-turn');
    const gen = this.gen;
    this.turnEndAt = Date.now();
    this.firstAudioAt = null;
    this.history.push({ role: 'user', content: userText });
    const abort = new AbortController();
    this.llmAbort = abort;
    this.speaking = true;

    let full = '', spoken = '', buf = '', firstToken = null;
    const speakable = () => full.split(/\n?\s*ACTION\s*\{/)[0];
    const pushSentences = (final) => {
      const avail = speakable().slice(spoken.length);
      buf = avail;
      // Ship each complete sentence to TTS as soon as it exists: first audio doesn't wait for the full reply.
      const re = final ? /[\s\S]+/ : /^[\s\S]*?[.!?…](?=\s)|^[\s\S]{80,}?[,;:](?=\s)/;
      let m;
      while ((m = buf.match(re)) && m[0].trim()) {
        const s = m[0];
        if (gen !== this.gen) return;
        this.ttsSend(s.trim());
        this.event('agent', { text: s.trim(), final: false });
        spoken += s;
        buf = buf.slice(s.length);
        if (final) break;
      }
    };

    try {
      await this.tts.ready;
      const body = JSON.stringify({
        model: LLM_MODEL, stream: true, max_tokens: 220, temperature: 0.4,
        messages: [{ role: 'system', content: this.p.prompt(this.state) + (this.language !== 'english' ? `\nThe caller speaks ${this.language}; reply in ${this.language}.` : '') }, ...this.history],
      });
      // The gateway occasionally stalls a request for tens of seconds: give it a short deadline to
      // produce headers, then retry once on a fresh request.
      let res;
      for (let attempt = 0; attempt < 3 && !res; attempt++) {
        const deadline = new AbortController();
        const onAbort = () => deadline.abort();
        abort.signal.addEventListener('abort', onAbort);
        const timer = setTimeout(() => deadline.abort(), attempt ? 4000 : 2500);
        try {
          res = await fetch(LLM_URL, { method: 'POST', signal: deadline.signal, headers: { authorization: KEY(), 'content-type': 'application/json' }, body });
        } catch (e) {
          if (abort.signal.aborted) throw e;
          this.event('metric', { name: 'llm_retry', ms: Date.now() - this.turnEndAt });
        } finally { clearTimeout(timer); abort.signal.removeEventListener('abort', onAbort); }
      }
      if (!res) throw new Error('LLM gateway timed out');
      if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const dec = new TextDecoder();
      let sse = '';
      for await (const chunk of res.body) {
        sse += dec.decode(chunk, { stream: true });
        const lines = sse.split('\n');
        sse = lines.pop();
        for (const l of lines) {
          if (!l.startsWith('data:') || l.includes('[DONE]')) continue;
          const d = JSON.parse(l.slice(5)).choices?.[0]?.delta?.content;
          if (!d) continue;
          if (!firstToken) { firstToken = Date.now(); this.event('metric', { name: 'llm_first_token', ms: firstToken - this.turnEndAt }); }
          full += d;
          pushSentences(false);
          this.runActions(full, userText, false); // execute each ACTION as soon as its line is complete
        }
      }
      if (gen !== this.gen) return;
      pushSentences(true);
      if (!speakable().trim()) { // the small model sometimes emits only an ACTION line
        const fallback = (/hangup/.test(full) ? BYE : AGAIN)[this.language] || (/hangup/.test(full) ? BYE : AGAIN).english;
        this.ttsSend(fallback); this.event('agent', { text: fallback, final: false }); full = fallback + '\n' + full;
      }
      this.history.push({ role: 'assistant', content: speakable().trim() });
      this.event('metric', { name: 'llm_total', ms: Date.now() - this.turnEndAt });
      this.runActions(full, userText, true);
      if (!/ACTION/.test(full) && /\b(book(ed)?|reserv(ed|e)|added|placed|confirm(ed)?|réserv|noté)\b/i.test(speakable())) this.recoverAction(userText);
    } catch (e) {
      if (e.name !== 'AbortError') this.event('error', { source: 'llm', message: e.message });
    } finally {
      if (this.llmAbort === abort) this.llmAbort = null;
    }
  }

  // Small models often *say* they booked something without emitting the ACTION line.
  // Ask once, non-streamed, for just the action implied by the last exchange.
  async recoverAction(userText) {
    try {
      const res = await fetch(LLM_URL, { method: 'POST', headers: { authorization: KEY(), 'content-type': 'application/json' },
        body: JSON.stringify({ model: LLM_MODEL, max_tokens: 80, temperature: 0, messages: [
          { role: 'system', content: this.p.prompt(this.state) },
          ...this.history,
          { role: 'user', content: 'SYSTEM CHECK: output only the ACTION line(s) your last reply requires, or NONE. No other text.' },
        ] }) });
      const text = (await res.json()).choices?.[0]?.message?.content || '';
      if (/ACTION/.test(text)) { this.event('metric', { name: 'action_recovered', ms: 0 }); this.runActions(`\n${text}`, userText, true); }
    } catch {}
  }

  runActions(full, userText, final) {
    this.actionsDone ||= new Set();
    for (const m of full.matchAll(final ? /ACTION\s*(\{[^\n]*\})/g : /ACTION\s*(\{[^\n]*\})\s*\n/g)) {
      const key = `${this.turnEndAt}:${m.index}`;
      if (this.actionsDone.has(key)) continue;
      this.actionsDone.add(key);
      let a;
      try { a = JSON.parse(m[1]); } catch { continue; }
      if (!plausible(a, userText, this.history.filter((h) => h.role === 'user').map((h) => h.content).join(' '))) { this.event('action_rejected', { action: a }); continue; }
      const result = applyAction(this.p, this.state, a);
      this.event('action', { action: a, result, state: this.state });
      if (a.type === 'hangup') setTimeout(() => this.event('hangup'), 200);
    }
  }

  close() {
    this.closed = true;
    this.llmAbort?.abort();
    try { this.stt?.send(JSON.stringify({ type: 'Terminate' })); } catch {}
    setTimeout(() => this.stt?.terminate(), 500);
    for (const ws of [this.tts]) {
      try { ws?.send(JSON.stringify({ type: 'Terminate' })); } catch {}
      setTimeout(() => ws?.terminate(), 500);
    }
  }
}
