# Frontdesk: notes for coding agents

Real-time AI phone receptionist on AssemblyAI. Node ESM, `ws`, with no build step. Run it with `npm start`, then open :3000.

- `agent.mjs`: custom pipeline engine (Streaming STT → LLM Gateway → Streaming TTS). The gateway model has no
  tool calling, so actions come from `ACTION {json}` lines.
- `voice-agent.mjs`: Voice Agent API engine. Uses real tool calls.
- `personas.mjs`: each business has `brief(state)` (written like a manager briefing staff, so keep that tone),
  `actions` (the ACTION-line format), and `state()`. `plausible()` and `applyAction()` are the guardrails and the till.
- Both engines emit the same events to `public/app.js`, so keep that contract intact.
- Test without a browser: `npm run simulate -- dental`. Add `--barge`, `--phone`, or `--engine voice-agent`.
- The account allows only ~5 concurrent TTS sessions. Reuse sockets and never open one per sentence.
- Never put the API key anywhere under `public/`.
