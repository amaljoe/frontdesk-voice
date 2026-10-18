# AssemblyAI Streaming TTS (`wss://streaming-tts.assemblyai.com/v1/ws`): findings report

I tested the API while building Frontdesk (2026-10-17/18). There are no public docs for this endpoint yet,
so I worked out the protocol by probing it. Every finding below comes with a reproduction and the
observed server output. Most use `node` and the `ws` package. Repro snippets are in
[`scripts/findings/`](scripts/findings/).

| # | Severity | Area | Finding |
|---|---|---|---|
| 1 | **Medium (security)** | Auth | A Streaming **STT** temporary token (`/v3/token`) is accepted by the **TTS** service. Token scope is not bound to a product. |
| 2 | **Medium (security)** | Auth | Temporary tokens are **not single-use**. One token opened 2 concurrent STT sessions and was reused for further sessions until its expiry. |
| 3 | Medium (reliability) | Control | `Cancel` does **not** stop flushes that are already being synthesized. Audio for every queued flush keeps streaming, and `Cancelled` only arrives after it. |
| 4 | Medium (reliability) | Quota | A cap of **5 concurrent TTS sessions** per account. Closed or terminated sessions **keep counting for 30-60 s**, so reconnect patterns lock you out. |
| 5 | Low | Input | SSML or markup is **read aloud literally**: `<speak><break time="3s"/>` is spoken and shows up in WordBoundaries. |
| 6 | Low | DX | Preset voices are bound to one language. English has 13; fr/de/it/pt/es have **one voice each** (`estelle`, `juergen`, `giovanni`, `rafael`, `lola`). This is only discoverable from error messages. |
| 7 | Low | DX | `Cancelled` carries `audio_duration_seconds: 0` even when seconds of audio were already sent for the cancelled flush. |
| 8 | Info | Docs | The protocol is fully discoverable from error strings (message types, parameter enums, limits). That's helpful, but undocumented. Reference below. |

Things that are good and worth keeping: errors are precise and actionable. Missing or bad keys get a
clean `1008`. Expired tokens are rejected (`Signature has expired`). The 2000-character `Generate`
limit, binary frames, and `VoiceReference` without `voice_clone` all fail with clear messages.
`voice_clone=true` is refused on this deployment.

---

## 1. STT temporary tokens authenticate TTS sessions (cross-product token scope)

Temporary tokens exist so a browser never sees the real API key. A token minted for **Streaming STT**
is also accepted by the **TTS** service, and that session synthesizes audio.

```js
const { token } = await (await fetch('https://streaming.assemblyai.com/v3/token?expires_in_seconds=60',
  { headers: { Authorization: KEY } })).json();
const ws = new WebSocket(`wss://streaming-tts.assemblyai.com/v1/ws?token=${token}`);
ws.onopen = () => { ws.send('{"type":"Generate","text":"scope test"}'); ws.send('{"type":"Flush"}'); };
```
Observed: `Begin` → 15 × `Audio` → `FlushDone {audio_duration_ms: 1200}`.

**Impact.** An app that only meant to hand a browser STT capability also hands out TTS capability
billed to the same account. The reverse may hold too. Any token leaked from a transcription widget can
be used to generate speech.
**Suggested fix.** Add an `aud`/scope claim to temporary tokens (`stt`, `tts`, `agent`) and check it at
each service.

## 2. Temporary tokens are reusable and can run concurrent sessions

```
STT use#1 (token T)               Begin
STT use#2 (same T, concurrently)  Begin
STT after more sessions (same T)  Begin
```
Expiry **is** enforced: after `expires_in_seconds` both services reply `Unauthorized: Signature has expired`.
Within that window, though, a single token is a multi-use bearer credential.

**Impact.** A token intercepted or scraped from a page (URL query parameters end up in logs, proxies
and browser history) can open parallel sessions for its whole lifetime, and with finding 1, on another product.
**Suggested fix.** Make tokens single-use (record a `jti` on the first `Begin`), or offer a
`max_sessions=1` option on `/token`.

## 3. `Cancel` does not interrupt in-flight synthesis

```js
send Generate("One. This is the first long sentence…"); send Flush       // flush 0
send Generate("Two. Second sentence also queued here."); send Flush       // flush 1
// 700 ms later, audio for flush 0 is already streaming
send Cancel
send Generate("Three after cancel."); send Flush                          // flush 3
```
Observed:
```
1245 ms  first audio flush 0
1680 ms  CANCEL sent
2217 ms  FlushDone 0         (all 62 chunks of flush 0 were still delivered)
2217 ms  first audio flush 1 (flush 1 was queued before Cancel and still synthesized: 40 chunks)
2457 ms  Cancelled
2457 ms  first audio flush 3
chunks per flush: { 0: 62, 1: 40, 3: 18 }
```
For barge-in, the main voice-agent use of `Cancel`, the agent keeps talking for the rest of every
queued sentence. Clients have to drop audio until `Cancelled` arrives (Frontdesk does this, see
`agent.mjs → cancelTts`). That costs about 0.8 s of wasted synthesis per interruption, and it is billed.
**Suggested fix.** Abort the current flush and drop queued flushes when `Cancel` arrives, then send `Cancelled` right away.

## 4. Session cap counts sessions that have already closed

With 5 sessions open, the 6th gets `Error: Too many concurrent sessions for this account; try again
later`. After all 5 were `terminate()`d client-side, new connections kept failing for about 30-60 s. Sending a
graceful `{"type":"Terminate"}` (which returns `Termination`) shortens this but doesn't remove it.
The obvious barge-in pattern ("close the socket and open a fresh one", which you'd reach for because
of #3) locks the account out after a few interruptions. I hit this in testing.
**Suggested fix.** Release the slot on socket close. Document the cap and return it in `Begin` or in the error.

## 5. SSML is spoken literally
`Generate {"text":"<speak><break time=\"3s\"/>hi</speak>"}` produces 3.76 s of audio that reads the tags
aloud. WordBoundaries contains `"<speak><break"` and `"time=\"3s\"/>hi</speak>"`. LLM output often
contains markdown or tags, so either strip them or support a small SSML subset (breaks, say-as).

## 6-7. Smaller DX issues
- Voices are tied to a language, and the list only comes back in errors:
  `Voice 'vera' speaks english, but this connection serves french. Available: ['estelle'].`
  A `GET /v1/voices` endpoint would help.
- `Cancelled.audio_duration_seconds` is `0` even when audio for the cancelled flush was delivered.

## 8. Protocol reference (reverse-engineered)

**Connect:** `wss://streaming-tts.assemblyai.com/v1/ws` with an `Authorization: <key>` header or `?token=`.
Query params:
- `voice`: en: alba anna charles eve george iris jane jean mary michael paul reid vera; fr estelle; de juergen; it giovanni; pt rafael; es lola
- `language`: english, french, german, italian, portuguese, spanish
- `sample_rate`: 8000, 16000, 22050, 24000 (default), 44100, 48000
- `encoding`: pcm_s16le (default), pcm_mulaw/mulaw, pcm_alaw/alaw
- also `inactivity_timeout` (s), `word_boundaries`, `voice_clone`, `voice_clone_preprocess`

**Client → server (JSON text only):** `Generate {text ≤ 2000 chars}`, `Flush`, `Cancel`, `KeepAlive`,
`Terminate`, `VoiceReference` (only when `voice_clone=true`).

**Server → client:** `Begin {id, expires_at, configuration}`, `Audio {audio: base64, flush_id}`,
`FlushDone {flush_id, audio_duration_ms}`, `WordBoundaries {flush_id, audio_start_ms, words[{word,start,end,confidence}]}`,
`Cancelled`, `Termination {session_duration_seconds, total_input_char_length, audio_duration_seconds}`,
`Error {error_code, error}` (`1008` auth, `3006` protocol or params; the socket then closes with the same code).

Notes: `flush_id` increases per Flush, and a Cancel uses up an id. WordBoundaries times are relative to the
session's audio clock (`audio_start_ms` + `start`). The session lasts about 1 h (`expires_at`).
