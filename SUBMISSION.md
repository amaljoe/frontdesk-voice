# Hackathon submission — copy/paste for the Google Form

**Project name:** Frontdesk — real-time AI phone receptionist (100% AssemblyAI)

**Category:** Build with the TTS API **+** Bug bounty / security findings

**One-liner:** A voice receptionist you can actually interrupt: it streams AssemblyAI STT → LLM Gateway → Streaming TTS,
stops the moment you talk over it, shows word-synced captions, and really books appointments, takes orders and reserves rooms.

**Description (short):**
Frontdesk answers calls for a dental clinic, a pizzeria and a Paris hotel. Every piece runs on one AssemblyAI key:
Universal-Streaming for the caller, LLM Gateway for the brain, and the new Streaming TTS for the voice.
LLM tokens are streamed sentence-by-sentence into TTS (`Generate`+`Flush`), so caller-stops-to-first-audio is
~0.6–1.3 s. Barge-in cancels TTS, discards stale flushes until `Cancelled`, flushes the browser buffer and tells the LLM
exactly what the caller heard (from `WordBoundaries` vs. the playback clock). Captions light up word-by-word from
`WordBoundaries`. Actions (bookings/orders/reservations) are executed live with guardrails against small-model
hallucinations; totals come from a till, not the LLM. Also: 8 kHz μ-law phone-line mode and automatic language
detection with voice switching (fr/es/de/it/pt). A headless simulator has a second TTS voice phone the agent for
end-to-end tests.

**TTS API findings (see FINDINGS.md, with repro scripts):**
1. (Security) STT temporary tokens are accepted by the TTS service — token scope isn't product-bound.
2. (Security) Temporary tokens are multi-use: one token opened concurrent sessions until expiry.
3. `Cancel` doesn't abort in-flight/queued flushes — audio keeps streaming (bad for barge-in, still billed).
4. 5-session concurrency cap counts already-closed sessions for 30–60 s → reconnect patterns lock you out.
5. SSML/markup is spoken literally. 6. Voices are language-bound and undiscoverable (one voice per non-English language).
7. `Cancelled.audio_duration_seconds` is always 0. 8. Full reverse-engineered protocol reference.

**Demo video:** out/frontdesk-demo.mp4 (upload to YouTube/Drive and paste the link)
**Repo:** https://github.com/amaljoe/frontdesk-voice
**Tech:** Node.js, ws, Web Audio (AudioWorklet), AssemblyAI Universal-Streaming v3, LLM Gateway, Streaming TTS v1
