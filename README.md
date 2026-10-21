# Frontdesk: a real-time AI phone receptionist, 100% AssemblyAI

Call it, talk normally, **interrupt it whenever you like**, and it actually books the appointment.

Frontdesk is a voice agent for the jobs that are moving to AI first: receptionists, order lines, hotel
concierges. A single AssemblyAI key powers the whole loop:

```
 mic ──16 kHz PCM──▶ Universal-Streaming STT ──turn──▶ LLM Gateway (streamed) ──sentence──▶ Streaming TTS ──PCM/μ-law──▶ speaker
          ▲                                                     │ ACTION {json}                    │ WordBoundaries
          └──────────── barge-in: Cancel + discard ◀─────────── ▼ guarded tool execution          ▼ live captions
```

🛡️ **Headline security finding — [security/REPORT.md](security/REPORT.md):** AssemblyAI's own Voice Agent
quickstart ships a browser token it calls "single-use" and "one-time". On production it is none of those:
**one token opened 5 concurrent sessions, was reusable for its full 600 s life, and worked across every
product** (a streaming token drives paid TTS and the Voice Agent, and vice-versa). Responsibly disclosed, with
runnable reproductions in [`security/probes/`](security/probes/) and a one-page report at
[`security/scorecard.html`](security/scorecard.html). TTL enforcement and error hygiene are solid — credited in the report.

🎬 **Demo video:** [youtu.be/frIsHwOCgHY](https://youtu.be/frIsHwOCgHY) — both engines answering live calls (agent speaks in full, one clean barge-in), then the token security finding reproduced live. Narrated with AssemblyAI TTS. Source file: [`out/frontdesk-demo.mp4`](out/frontdesk-demo.mp4).
🔍 **Full protocol notes for the TTS & Voice Agent APIs:** [FINDINGS.md](FINDINGS.md)
🤖 **Built with AssemblyAI's own agent tooling** (CLI scaffolder + code generator, coding-agent skill): [BUILT_WITH_ASSEMBLYAI_AGENT.md](BUILT_WITH_ASSEMBLYAI_AGENT.md)

## Two engines, switchable in the UI

| | Custom pipeline (`agent.mjs`) | Voice Agent API (`voice-agent.mjs`) |
|---|---|---|
| Wiring | Universal-Streaming STT → LLM Gateway → Streaming TTS, orchestrated by us | One AssemblyAI socket does STT + LLM + TTS |
| Actions | `ACTION {json}` lines + guardrails (the gateway model has no tool calling) | Real tool calls, same guardrails, refreshed prompt via `session.update` |
| Barge-in | TTS `Cancel` + discard until `Cancelled`, LLM told what was heard | Server-side, plus a client flush on speech start |
| Captions | Word-by-word from TTS `WordBoundaries` | Whole sentence (the API has no word timings) |
| Extras | Phone mode, multilingual voice switching, typed input | Phone mode (`audio/pcmu`) |
| First audio | ~0.6–1.3 s | ~0.55 s simple turns, 1–2 s with a tool call |

## What it does

- **Low-latency turn-taking.** LLM tokens stream in and each finished sentence goes to TTS
  (`Generate` + `Flush`) immediately, so the agent starts speaking before the LLM has finished.
  Caller-stops → first agent audio is about **0.6–1.3 s** warm. A live latency panel shows every turn.
- **Barge-in that actually works.** If the caller talks over the agent, it stops within one STT
  partial. The TTS `Cancel` doesn't abort audio already being synthesized ([finding #3](FINDINGS.md)),
  so Frontdesk drops stale audio until `Cancelled` and flushes the browser's playback buffer.
  It then tells the LLM **what the caller actually heard** (from word boundaries vs. playback clock),
  so the conversation stays honest: *"We have Tuesday at… [cut off by the caller]"*.
- **Word-synced captions.** TTS `WordBoundaries` are mapped from the socket's audio clock onto the
  Web Audio playback timeline, so each word lights up as it is spoken.
- **Real actions with guardrails.** The agent books appointments, takes pizza orders and reserves hotel
  rooms against live business state. The small gateway model doesn't support tool calls, so it emits
  `ACTION {json}` lines that are stripped from speech and run as soon as they stream in. Guardrails
  reject what small models get wrong: names the caller never said, items they never ordered, slots
  that don't exist. Prices and totals are computed by the "till", never by the LLM.
- **Phone-line mode.** 8 kHz G.711 μ-law output, exactly what a PSTN or Twilio media stream carries.
- **Multilingual.** With multilingual STT plus language detection, if a caller starts in French the agent
  answers in French and switches the TTS voice (`estelle`), and likewise for es/de/it/pt.
- **Three personas:** Brightsmile Dental (Ivy), Tony's Pizzeria (Marco), Hotel Lumière (Camille).
- **The API key never reaches the browser.** The Node server holds it and proxies the call over one WebSocket.

## Run it

```bash
npm install
cp .env.example .env        # put your AssemblyAI key in it
npm start                   # http://localhost:3000
```
Open the page, pick a business and press **Start call**. Headphones give the cleanest barge-in.
No mic? Expand "Type instead".

Optional: `LLM_MODEL=<gateway model id>` (default `qwen3.5-4b-32k-fast`, the model this key can use;
larger models will follow the action format more reliably).

### Headless end-to-end tests (no browser, no mic)

A second AssemblyAI TTS voice plays the caller, streamed in real time into the agent's STT. You get a
transcript, latencies, executed actions and a stereo WAV (L = caller, R = agent):

```bash
npm run simulate -- dental              # booking flow
npm run simulate -- dental out/b.wav --barge   # caller interrupts the agent mid-sentence
npm run simulate -- pizza               # order flow with priced till
npm run simulate -- hotel               # French caller → language + voice switch
npm run simulate -- dental out/p.wav --phone   # 8 kHz μ-law phone line
npm run simulate -- dental out/va.wav --engine voice-agent   # same call on the Voice Agent API
```

Browser test and demo recording use Chrome with a fake microphone fed from a WAV file:
`node scripts/make-demo-mic.mjs && node scripts/record-demo.mjs`. On macOS this needs
`--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox`, or the fake mic is silent.

## Files

| | |
|---|---|
| `agent.mjs` | Custom-pipeline engine: STT ⇄ LLM ⇄ TTS orchestration, barge-in, latency metrics, action execution |
| `voice-agent.mjs` | Voice Agent API engine with real tool calls, built with the AssemblyAI coding-agent skill |
| `assemblyai-generated/` | Code produced by AssemblyAI's CLI (`assembly init voice-agent`, `assembly agent --show-code`), used as reference |
| `AGENTS.md` | Context for coding agents (including AssemblyAI's `assembly live`). Install the AssemblyAI skill with `npx skills add AssemblyAI/assemblyai-skill` |
| `personas.mjs` | Businesses, prompts, state, action guardrails |
| `server.mjs` | Static UI + `/call` WebSocket bridge (key stays server-side) |
| `public/` | UI, mic capture worklet (→16 kHz), gapless player with an audio-clock ↔ word-boundary map |
| `scripts/simulate.mjs` | Headless TTS-caller ↔ agent conversations |
| `scripts/findings/` | Reproductions for every item in FINDINGS.md |

## Lessons from the TTS API (also in FINDINGS.md)
- Keep **one TTS socket per call**. There's a 5-session cap, and closed sessions keep counting for up to a
  minute, so "reconnect to stop audio" locks you out.
- After `Cancel`, discard audio until `Cancelled`.
- Voices are bound to a language: fr `estelle`, de `juergen`, it `giovanni`, pt `rafael`, es `lola`.
- `Generate` is limited to 2000 characters. Send sentences, not paragraphs, and it's faster anyway.
