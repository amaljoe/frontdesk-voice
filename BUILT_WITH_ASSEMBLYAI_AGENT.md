# How AssemblyAI's own agent tooling was used

AssemblyAI ships three things for building with coding agents. Frontdesk used all three, and this page
records what each one produced and where it lives in the repo.

## 1. AssemblyAI CLI, `assembly` ([github.com/AssemblyAI/cli](https://github.com/AssemblyAI/cli))

Installed from source at commit `90f7d7c`: `uv tool install .`.

| Command | What it produced | Where it's used |
|---|---|---|
| `assembly init voice-agent --no-install` | The official Voice Agent starter: session config, browser audio pipeline, barge-in helpers, and an `AGENTS.md` with the API's invariants | [`assemblyai-generated/voice-agent-starter/`](assemblyai-generated/voice-agent-starter/). Our `voice-agent.mjs` engine follows its message shapes and auth (`Bearer`, `reply.audio.data`, 24 kHz PCM16) |
| `assembly agent --show-code` | The CLI's generated reference client for the Voice Agent API | [`assemblyai-generated/voice_agent_reference.py`](assemblyai-generated/voice_agent_reference.py). Used as ground truth for the session lifecycle |
| `assembly live` (their tool-using coding/voice agent: deepagents on the LLM Gateway + streaming STT/TTS, with sandboxed file tools) | I spoke tasks to it with a TTS-generated WAV as the input | **Blocked on this key.** See below |

### `assembly live` on a hackathon key

`assembly live` always sends tool definitions (its planner `write_todos`, the file tools, and web search) to the LLM
Gateway. A hackathon key only has `qwen3.5-4b-32k-fast`, and that model rejects tools:

```
$ assembly live task.wav --model qwen3.5-4b-32k-fast -o text
Error code: 400 - {'metadata': {'errors': ['model qwen3.5-4b-32k-fast does not support tools']}, ...}
```
`--no-files` gives the same error, and the CLI's default model, `kimi-k2.5`, returns "not supported". So the
coding agent can't take a single turn on the model hackathon participants are given. I also had to
point the installed CLI at the production TTS host (`streaming-tts.assemblyai.com`). The build it ships
treats streaming TTS as sandbox-only, but the hackathon endpoint is production. Both points are reported in
[FINDINGS.md](FINDINGS.md#9-assemblyais-coding-agent-cant-run-on-a-hackathon-key).

When a tool-capable model is enabled on the key, the intended loop is the one the repo is set up for.
From the repo root:

```bash
node scripts/say-task.mjs "Add a Spanish-speaking taqueria persona to personas.mjs" task.wav
assembly live task.wav --model <tool-capable model> --auto-write . -o text
```
`assembly live` reads this repo's `AGENTS.md` for project context. It auto-approves writes only inside
`--auto-write` directories, and runs commands sandboxed in the repo.

## 2. The AssemblyAI skill ([github.com/AssemblyAI/assemblyai-skill](https://github.com/AssemblyAI/assemblyai-skill))

Installed at commit `ef37bb3` with `npx skills add AssemblyAI/assemblyai-skill` (or by copying `skills/assemblyai/` to `.claude/skills/`). It isn't vendored here because the repo ships no license. The second call engine,
[`voice-agent.mjs`](voice-agent.mjs), was written by a coding agent that had this skill loaded and was told to treat
it as the source of truth over its own memory. The skill's `references/voice-agents.md` supplied the
event lifecycle, tool-call shape, barge-in semantics, and mid-session `session.update`.

## 3. AssemblyAI's APIs as the runtime

Both engines run on AssemblyAI end to end. One key covers both of them:
- **Custom pipeline** (`agent.mjs`): Universal-Streaming STT, then the LLM Gateway, then Streaming TTS.
- **Voice Agent API** (`voice-agent.mjs`): one socket, with real tool calls for bookings, orders and reservations.

You can switch between them in the UI ("Engine").
