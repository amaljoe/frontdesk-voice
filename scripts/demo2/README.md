# Demo video build (~2:17 cut)

Regenerates `out/frontdesk-demo.mp4`: a title card, both engines answering a live call, the security
finding reproduced in a terminal, and the scorecard — narrated by an AssemblyAI TTS voice (so even the
voiceover is built from the product). Everything here is scripted and reproducible; intermediates land in
`out/demo2/` (gitignored).

```sh
# server must be running on :3123
PORT=3123 node ../../server.mjs &

node narration.mjs            # (data) the six voiceover lines
node tts-narration.mjs        # synthesize VO with AssemblyAI TTS (voice reid) -> out/demo2/vo/
node make-mic.mjs             # scripted caller audio for both engine segments
node record-segment.mjs out/demo2/mic-pipeline-t.wav pipeline pipeline dental 24
node record-segment.mjs out/demo2/mic-va-t.wav       va       voice-agent dental 22
node record-security.mjs      # animated terminal of the token probe
node cards.mjs                # title / segment / end cards (+ scorecard shot)
bash build.sh                 # ffmpeg: time each segment to its narration, mix, concat, loudnorm
```

The caller audio is trimmed for pacing with a small silence-capping pass (see the git history / inline);
the app segments are real recordings of the app, not mockups — the bookings you see actually fire.
