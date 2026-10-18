// One phone call on AssemblyAI's Voice Agent API: a single socket does STT, LLM, TTS, turn-taking
// and barge-in. Same interface and line events as `Call` in agent.mjs, so the browser and the
// simulator don't care which engine they're talking to.
import WebSocket from 'ws';
import { personas, applyAction, plausible } from './personas.mjs';

const VA_URL = 'wss://agents.assemblyai.com/v1/ws';
export const VA_VOICES = ['alba', 'anna', 'charles', 'estelle', 'eve', 'george', 'giovanni', 'iris', 'jane', 'jean', 'juergen', 'lola', 'mary', 'michael', 'paul', 'rafael', 'reid', 'vera'];

// Real tools instead of ACTION lines. Each persona only gets the ones that make sense for it.
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const TOOLS = {
  book: { description: "Book the appointment. Call this as soon as you have the caller's name and the time they picked. Saying they're booked doesn't put them on the calendar, only this does.",
    parameters: obj({ name: { type: 'string', description: "The caller's name, as they said it." }, slot: { type: 'string', description: 'The time they picked, written exactly like the calendar list.' } }) },
  add_item: { description: 'Put something on the order. Call it once for each thing the caller asks for, right when they ask.',
    parameters: obj({ item: { type: 'string', description: 'The menu item, like pepperoni or garlic knots.' }, size: { type: 'string', enum: ['medium', 'large', 'none'], description: 'Pizza size. Use none for sides and drinks.' }, qty: { type: 'integer', description: 'How many.' } }) },
  place_order: { description: "Send the order to the kitchen. Do this when the caller says that's everything.",
    parameters: obj({ name: { type: 'string', description: "The caller's name, or unknown." }, mode: { type: 'string', enum: ['pickup', 'delivery'] } }, ['mode']) },
  reserve: { description: "Reserve a room. Only once the guest has picked a room type and told you their name.",
    parameters: obj({ name: { type: 'string', description: "The guest's name." }, room: { type: 'string', enum: ['standard', 'deluxe'] }, nights: { type: 'integer', description: 'How many nights. One if they did not say.' } }, ['name', 'room']) },
  transfer: { description: 'Put the caller through to a real person, when they ask for one.', parameters: obj({}) },
  hangup: { description: 'End the call. Use it after the caller says goodbye and you have said bye back.', parameters: obj({}) },
};
const TOOLSETS = { dental: ['book', 'transfer', 'hangup'], pizza: ['add_item', 'place_order', 'transfer', 'hangup'], hotel: ['reserve', 'transfer', 'hangup'] };

export class VoiceAgentCall {
  constructor(line, opts = {}) {
    this.line = line;
    this.key = personas[opts.persona] ? opts.persona : 'dental';
    this.p = personas[this.key];
    this.state = this.p.state();
    this.voice = VA_VOICES.includes(opts.voice) ? opts.voice : this.p.voice; // every voice speaks every output language
    this.language = opts.language || 'english';
    this.phone = !!opts.phone;
    this.sampleRate = this.phone ? 8000 : 24000;
    this.encoding = this.phone ? 'pcm_mulaw' : 'pcm_s16le';
    this.userTurns = [];
    this.pendingTools = [];
    this.lastEvent = null;   // drives the tool.result timing rule (see flushTools)
    this.replying = false;   // server has a reply in flight
    this.awaiting = false;   // caller finished a turn / tool result sent, reply not started yet
    this.agentAudioMs = 0; this.audioStartedAt = 0;
    this.closed = false;
  }

  send(obj) { if (!this.closed) this.line.send(obj); }
  event(type, data = {}) { this.send({ type, t: Date.now(), ...data }); }

  // The simulator and server poll these the same way they poll `Call`.
  get llmAbort() { return this.replying || this.awaiting || this.pendingTools.length ? { abort() {} } : null; }
  get pendingFlushes() { return this.replying ? 1 : 0; }
  agentAudible() { return this.replying || (this.audioStartedAt && Date.now() < this.audioStartedAt + this.agentAudioMs + 150); }

  prompt() {
    // The managed model sometimes says "you're booked" without calling the tool, so say it plainly once.
    return this.p.prompt(this.state, { tools: true }) +
      "\n\nYou have tools for booking, orders and so on. Nothing is real until you use them, so the moment you have what you need, use the tool, then tell the caller it's done. Don't ask them to confirm twice." +
      (this.language !== 'english' ? `\nThe caller speaks ${this.language}, so reply in ${this.language}.` : '');
  }

  async start() {
    this.event('config', {
      persona: { name: this.p.name, business: this.p.business },
      voice: this.voice, language: this.language, sampleRate: this.sampleRate, encoding: this.encoding,
      model: 'AssemblyAI Voice Agent API', state: this.state,
    });
    // The session cap is small and closed sessions linger, so retry a busy handshake rather than fail the call.
    for (let attempt = 0; ; attempt++) {
      try { return await this.connect(); } catch (e) {
        if (this.closed || attempt >= 8 || !/capacity|concurrent|server_error|1008|1011/i.test(e.message)) throw e;
        this.event('error', { source: 'voice-agent', message: `${e.message} — retrying` });
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 8000)));
      }
    }
  }

  connect() {
    // Bearer auth, unlike every other AssemblyAI API (per the skill and the starter's AGENTS.md).
    const ws = this.ws = new WebSocket(VA_URL, { headers: { Authorization: `Bearer ${process.env.ASSEMBLYAI_API_KEY}` } });
    return new Promise((resolve, reject) => {
      let ready = false;
      ws.on('open', () => ws.send(JSON.stringify({ type: 'session.update', session: {
        system_prompt: this.prompt(),
        greeting: this.p.greeting,
        tools: TOOLSETS[this.key].map((name) => ({ type: 'function', name, ...TOOLS[name] })),
        // 24 kHz PCM16 both ways, as in the starter's SESSION_CONFIG. Other sample_rates are echoed back
        // in session.updated, then the session dies with internal_error before session.ready.
        input: { format: { encoding: 'audio/pcm' }, keyterms: [this.p.name, this.p.business],
          // STT context (separate from system_prompt): callers spell out first and last names.
          transcription_prompt: `A phone call to ${this.p.business}. Callers give their first and last name, times and dates.` },
        output: { voice: this.voice, format: { encoding: this.phone ? 'audio/pcmu' : 'audio/pcm' } },
      } })));
      ws.on('message', (m) => {
        const j = JSON.parse(m);
        if (j.type === 'session.ready') { ready = true; resolve(); }
        if (j.type === 'session.error' && !ready) return reject(new Error(`${j.code}: ${j.message}`));
        this.onEvent(j);
      });
      ws.on('error', (e) => (ready ? this.event('error', { source: 'voice-agent', message: e.message }) : reject(e)));
      ws.on('close', (c, r) => {
        if (!ready) return reject(new Error(`closed ${c} ${r}`));
        if (!this.closed && !this.ended) this.event('error', { source: 'voice-agent', message: `socket closed ${c} ${r}` });
      });
    });
  }

  onEvent(j) {
    if (process.env.DEBUG && j.type !== 'reply.audio') console.log('va', JSON.stringify(j).slice(0, 300));
    if (this.closed) return;
    switch (j.type) {
      case 'session.ready': return this.event('stt_ready', { model: 'voice-agent' });
      // The server often sends transcript.user and even reply.started *before* input.speech.stopped,
      // so a turn's end is whichever of those arrives first.
      case 'input.speech.started':
        this.lastEvent = j.type; this.turnEndAt = null; this.turnAnswered = false;
        // Flush on speech start, like the AssemblyAI voice-agent starter (assembly init, static/app.js bargeIn):
        // audio the server already finished sending may still be playing here, and the server won't
        // send reply.done "interrupted" for that. Only while we're audible, so a cough in silence is a no-op.
        if (!this.replying && this.agentAudible()) this.flushPlayback('barge-in');
        return;
      case 'input.speech.stopped': if (!this.turnAnswered) this.turnEndAt ||= Date.now(); return;
      case 'transcript.user.delta': return this.event('user', { text: j.text, final: false }); // cumulative partial
      case 'transcript.user':
        if (!this.turnAnswered) this.turnEndAt ||= Date.now();
        this.userTurns.push(j.text);
        if (!this.replying) this.expectReply();
        return this.event('user', { text: j.text, final: true });
      case 'reply.started':
        this.lastEvent = j.type; this.replying = true; this.awaiting = false; this.replyStartedAt = Date.now();
        // reply.started fires before any LLM output, so it's no proxy for first token; only first audio is measured.
        this.measureFrom = this.turnEndAt; this.turnEndAt = null; this.turnAnswered = true; // one measurement per caller turn
        return;
      // Base64 PCM is on `data` (as in the starter's AGENTS.md invariants), not `audio` as the skill's event table implies.
      case 'reply.audio': return this.onAudio(Buffer.from(j.data ?? j.audio, 'base64'));
      case 'transcript.agent.delta': return this.event('agent', { text: j.delta, final: false, raw: true }); // keeps its own spacing
      case 'transcript.agent':
        // No WordBoundaries on this API, so the caption shows the whole reply instead of word-by-word.
        this.event('caption', { text: j.text });
        return this.event('agent', { text: j.text, final: true });
      case 'reply.done':
        this.lastEvent = j.type; this.replying = false; this.measureFrom = null;
        if (j.status === 'interrupted') { this.pendingTools = []; this.flushPlayback('barge-in'); }
        else if (this.hangupAfterReply) { this.hangupAfterReply = false; setTimeout(() => this.event('hangup'), 200); }
        return this.flushTools();
      case 'tool.call': this.pendingTools.push(j); return this.flushTools();
      case 'session.error': return this.event('error', { source: 'voice-agent', message: `${j.code}: ${j.message}` });
      case 'session.ended': this.ended = true; return;
    }
  }

  onAudio(buf) {
    if (this.measureFrom) { // only the first audio of a reply to the caller (not the greeting or tool follow-ups)
      this.event('metric', { name: 'first_audio', ms: Date.now() - this.measureFrom });
      this.measureFrom = null;
    }
    // Track the client's playback clock so we know when the caller can still hear us.
    const now = Date.now();
    if (!this.audioStartedAt || now > this.audioStartedAt + this.agentAudioMs) { this.audioStartedAt = now; this.agentAudioMs = 0; }
    this.agentAudioMs += (buf.length / (this.phone ? 1 : 2) / this.sampleRate) * 1000;
    this.line.send(buf);
  }

  flushPlayback(reason) {
    this.audioStartedAt = 0; this.agentAudioMs = 0;
    this.event('interrupt', { reason });
    this.event('tts_reset');
  }

  // Per the API's turn-taking rule, a tool.result goes out only while `reply.done` is the latest
  // event: earlier and the agent is mid transition phrase, later and a new turn has begun.
  // Tools run here too, so an interrupted call (discarded on reply.done) never touches state.
  flushTools() {
    if (this.lastEvent !== 'reply.done' || !this.pendingTools.length) return;
    const latest = this.userTurns.at(-1) || '', all = this.userTurns.join(' ');
    for (const c of this.pendingTools.splice(0)) {
      const a = { type: c.name, ...(c.arguments || {}) };
      let result, isError = false;
      if (!plausible(a, latest, all)) {
        this.event('action_rejected', { action: a });
        result = { ok: false, message: "The caller hasn't actually said that. Check with them first." };
        isError = true;
      } else {
        const r = applyAction(this.p, this.state, a);
        this.event('action', { action: a, result: r, state: this.state });
        result = { ok: r.ok, message: `${r.title}: ${r.detail}`, state: this.state };
        isError = !r.ok;
        if (a.type === 'hangup') { this.hangupAfterReply = true; setTimeout(() => this.hangupAfterReply && this.event('hangup'), 6000); }
      }
      this.wsSend({ type: 'tool.result', call_id: c.call_id, result: JSON.stringify(result), is_error: isError });
      this.expectReply(); // the result auto-fires the agent's next reply
    }
    // The open slots / order / rooms in the prompt are now stale; the prompt is mutable mid-call.
    this.wsSend({ type: 'session.update', session: { system_prompt: this.prompt() } });
  }

  // A reply should start soon; count it as in flight so pollers don't think the line went quiet.
  expectReply() { this.awaiting = true; clearTimeout(this.awaitTimer); this.awaitTimer = setTimeout(() => (this.awaiting = false), 8000); }

  wsSend(obj) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj)); }

  // Browser mic is 16 kHz; the API only takes 24 kHz PCM, so upsample 2:3 with linear interpolation.
  // Position is kept in thirds of an input sample (integer, no drift); index 0 is the previous
  // chunk's last sample so chunks join without a seam.
  audio(buf) {
    if (this.ws?.readyState !== WebSocket.OPEN || buf.length < 2) return;
    const n = buf.length >> 1, prev = this.prevSample ?? buf.readInt16LE(0);
    const at = (i) => (i === 0 ? prev : buf.readInt16LE((i - 1) * 2));
    const out = Buffer.alloc((Math.floor((n * 3) / 2) + 2) * 2);
    let t3 = this.phase3 || 0, o = 0;
    for (; t3 < n * 3; t3 += 2) {
      const i = Math.floor(t3 / 3), a = at(i);
      out.writeInt16LE(Math.round(a + ((at(i + 1) - a) * (t3 % 3)) / 3), o); o += 2;
    }
    this.phase3 = t3 - n * 3; this.prevSample = buf.readInt16LE((n - 1) * 2);
    this.ws.send(JSON.stringify({ type: 'input.audio', audio: out.subarray(0, o).toString('base64') }));
  }

  heard() {}        // the server already knows where it was cut off (transcript.agent `interrupted`)
  playbackDone() { this.audioStartedAt = 0; this.agentAudioMs = 0; }
  respond() { this.event('error', { source: 'voice-agent', message: "Typed input isn't supported by the Voice Agent API engine (it only takes audio)." }); }

  close() {
    this.closed = true;
    clearTimeout(this.awaitTimer);
    // session.end stops billing now; a bare close would hold a resumable (billed) session for 30 s.
    this.wsSend({ type: 'session.end' });
    setTimeout(() => this.ws?.terminate(), 1000);
  }
}
