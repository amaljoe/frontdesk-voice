# Overnight security research plan (authorized hackathon testing)

Scope: only AssemblyAI PRODUCTION endpoints I hold a hackathon key for, and reading the
open-source `assembly` CLI + skill already on disk. No labs/internal hosts. Defensive intent:
every finding ships with a reproduction and a concrete fix, as a responsible-disclosure report.

Thesis: "If you build exactly the way AssemblyAI's own quickstart/starter tells you to, are you safe?"
The starters mint browser tokens and call them short-lived & single-use — the justification for
putting them in a URL. Verify each claim; a gap there affects every developer who copies the starter.

## Test matrix (each = one script in security/probes/, each prints PASS/FAIL + evidence)
1. token-lifecycle: is the Voice Agent /v1/token single-use? reusable? concurrent? what TTL is actually enforced vs requested?
2. token-scope: does a token minted for one product (streaming / voice-agent / tts) work on the others?
3. token-ttl-bounds: can you request an absurd expiry (1 day, 1 year)? is it clamped? (a long-lived URL token is a bearer secret)
4. key-in-url: does any starter/path put the raw API key in a URL or client-visible place? (grep the generated code)
5. error-verbosity: do error messages leak internal hosts, stack traces, model lists, account info?
6. tts-abuse-surface: unauth billing — can a leaked token drive paid TTS/LLM without limit? (cost-of-leak)
7. input-validation: oversized/malformed frames, injection in text fields reflected back, resource exhaustion signals.

## Deliverable
security/REPORT.md — ranked, CVSS-style severity, repro command + observed output per finding, fix.
Fold the sharpest ones into the top-level FINDINGS.md. A short "disclosure.txt" ready to email security@assemblyai.com.
