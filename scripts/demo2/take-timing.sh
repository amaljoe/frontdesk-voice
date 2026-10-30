#!/bin/bash
# Analyze a stereo call recording: L=agent, R=caller. Print when each voice is active, so we can
# judge whether the agent clearly speaks BEFORE the caller's barge-in.
set -e
f="$1"
cd "$(dirname "$0")/../.."
wav="${f%.webm}.wav"
ffmpeg -loglevel error -y -i "$f" "$wav"
echo "=== AGENT (left) speech regions ==="
ffmpeg -loglevel error -i "$wav" -af "pan=mono|c0=c0,silencedetect=noise=-38dB:d=0.25" -f null - 2>&1 | grep -oE "silence_(start|end): [0-9.]+" | head -14
echo "=== CALLER (right) speech regions ==="
ffmpeg -loglevel error -i "$wav" -af "pan=mono|c0=c1,silencedetect=noise=-38dB:d=0.25" -f null - 2>&1 | grep -oE "silence_(start|end): [0-9.]+" | head -14
