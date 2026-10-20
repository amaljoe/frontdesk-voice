# Frontdesk security research: AssemblyAI real-time token model

**Authorized testing** — AssemblyAI TTS Hackathon #2 (Oct 15–23 2026), which explicitly invites finding
security vulnerabilities. All testing used our own hackathon API key against **production** endpoints only,
plus reading AssemblyAI's own open-source `assembly` CLI and starter code. No internal/labs/sandbox hosts
were touched. Defensive intent: every finding ships with a reproduction and a fix. Reproductions live in
[`security/probes/`](probes/); raw output in [`security/evidence-token.txt`](evidence-token.txt). **Reproduced on production 2026-10-20 and re-verified 2026-10-21.**

## TL;DR

AssemblyAI's own Voice Agent starter (`assembly init voice-agent`) mints a browser token and puts it in a
WebSocket URL, with this justification in its code and its user-facing page:

> "a short-lived, **single-use** token minted here — so your API key never reaches the client"
> "The browser connects straight to AssemblyAI's Voice Agent API with a **one-time token**" (page subtitle)

**The token is not single-use, not single-session, and not scoped to one product.** We opened five
concurrent sessions from one token, reused it repeatedly, and used a token minted for one product to drive
the others we tested directly — Streaming STT, Streaming TTS, and the Voice Agent (a Voice Agent session in
turn runs the LLM Gateway on the account's behalf). The TTL *is* correctly enforced and capped at 600s —
so the real exposure window is "up to 10 minutes," not "forever," but within it the token is a reusable,
cross-product bearer credential that any developer following the quickstart ships to the client.

Error handling, by contrast, is clean — no internal hosts, stack traces, or infra names leaked. Credit where due.

## Findings

| # | Severity | CVSS 3.1 | Title |
|---|---|---|---|
| A | **High** | 7.1 | Browser tokens are reusable and multi-session despite "single-use" documentation |
| B | **High** | 7.1 | Tokens are not scoped to the product they were minted for (STT ⇄ TTS ⇄ Voice Agent) |
| C | Medium | 5.0 | No per-token connection/spend cap → one leaked token = concurrent paid work across all products |
| D | Low | 3.1 | `GET /v1/token` with a bad key returns HTTP 404 (should be 401/403) |
| ✓ | — (positive) | — | Error messages are clean; TTL is enforced and capped at 600s |

Scores model the *post-leak* abuse (a browser token is designed to be exposed in a client URL, so obtaining
one is low-effort — the whole point of findings A/B is that exposure is expected and the token is supposed to
be worthless once used). Vectors are given per finding; they are the researcher's assessment, not an official
AssemblyAI rating.

---

### A. "Single-use" tokens are reusable and multi-session — High

**CVSS 3.1: 7.1** (`AV:N/AC:L/PR:N/UI:N/S:C/C:L/I:L/A:L`) — a leaked token stays usable for its full life across a scope change (S:C), with low impact to each of C/I/A (another user's billed sessions, injected agent text, resource use).

**Claim under test.** The starter and its page call the token "single-use" / "one-time". That property is
the entire security argument for placing a token in a client-visible URL: even if it leaks (URLs land in
browser history, server logs, proxies, referrer headers), a single-use token is spent and worthless.

**Observed** (`node security/probes/token-lifecycle.mjs`):
```
use #1: ACCEPTED (session.updated)
use #2 (same token, after #1 closed): ACCEPTED — NOT single-use
use #3 (same token again): ACCEPTED
```
And concurrently (`token-concurrency-scope.mjs`):
```
one token, 5 simultaneous VA sessions: 5/5 accepted
```
One minted token opened five Voice Agent sessions at the same time and kept working across sequential
reuses, for its whole 600s life.

**Impact.** A token scraped from a browser URL, a log line, or a shared link is a working credential for up
to 10 minutes — not the one-shot the documentation promises. Every app built from the official starter
inherits this.

**Fix.** Make tokens genuinely single-use: bind a `jti` and burn it on the first `session.ready`/`Begin`.
If multi-use is intended, stop calling them "single-use/one-time" in the starter and page copy, and offer a
`max_sessions=1` mint option. (TTL enforcement is already correct — keep it.)

### B. Tokens are not product-scoped — High

**CVSS 3.1: 7.1** (`AV:N/AC:L/PR:N/UI:N/S:C/C:L/I:L/A:L`) — the token crosses the product-authorization boundary it was issued for (S:C): capability it was never scoped to becomes reachable.

**Observed** (`token-concurrency-scope.mjs`):
```
streaming token on TTS:         ACCEPTED — cross-product (Begin)
streaming token on Voice Agent: ACCEPTED — cross-product (session.updated)
voice-agent token on TTS:       ACCEPTED — cross-product (Begin)
voice-agent token on streaming: ACCEPTED — cross-product (Begin)
```
A token minted at `streaming/v3/token` drives paid Streaming TTS and the $4.50/hr Voice Agent; a token
minted at `agents/v1/token` drives Streaming STT and TTS. The mint endpoint does not stamp a product/audience
into the token.

**Impact.** A transcription widget that only ever needed STT hands out, in its page, a credential that also
synthesizes speech and runs full voice-agent sessions — all billed to the account. Least-privilege is violated
by default.

**Fix.** Put an `aud`/scope claim in the token at mint time (`stt` | `tts` | `voice-agent`) and enforce it at
each service's WebSocket handshake. This is the single highest-leverage fix; it also contains finding A's blast radius.

### C. No per-token cap → quantified cost of a leak — Medium

**CVSS 3.1: 5.0** (`AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`) — availability/billing impact (uncapped concurrent paid sessions) with no direct C or I impact on its own.

**Observed** (`cost-of-leak.mjs`): a browser token alone (no API key) drove billed TTS — 5.4s of audio in
1.5s wall — and, combined with A and B, can do so concurrently across products with no per-token
connection or spend limit we could find.

**Impact.** Pricing is public (Voice Agent $4.50/hr, Streaming STT $0.45/hr, LLM Gateway per-token). One
scraped 600s token therefore authorizes up to ten minutes of *concurrent* paid sessions across four products
per use. At scale (a token harvested from many users of a popular starter-based app) this is a real cost-amplification / resource-abuse vector against the account owner.

**Fix.** Cap concurrent sessions per token (ideally 1, see A), and expose per-key spend/rate limits so a leak
is bounded.

### D. Bad-key mint returns 404 — Low

**CVSS 3.1: 3.1** (`AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N`) — minor information-quality/response-correctness issue; a 404 vs 401 can leak endpoint-existence signal and muddies integrator error handling.

`GET https://agents.assemblyai.com/v1/token` with an invalid key returns **HTTP 404** `{"detail":"Invalid API
key"}`. An auth failure should be `401` (or `403`); `404` is misleading for integrators and muddies
monitoring. Minor.

## What's done right (so the picture is fair)

- **TTL is enforced and capped.** A 3s token was rejected after 8s; requests for 1-day/1-year TTL are refused
  with `422 … less than or equal to 600`. This is exactly right and limits every finding above to a 10-minute window.
- **Errors don't leak.** Malformed JSON, bogus fields, path-like voice names, and bad keys all return terse,
  non-reflective errors with no internal hosts, file paths, or stack traces.

## Responsible disclosure

These are reported to help, not to exploit. [`security/disclosure.txt`](disclosure.txt) is a ready-to-send
summary for security@assemblyai.com. Nothing here was used against another account; all tests hit only our
own hackathon key.
