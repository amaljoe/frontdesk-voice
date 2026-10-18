# Live two-way voice conversation with an AssemblyAI voice agent.
# Requires audio support:  pip install sounddevice websockets
# Tip: use headphones — the mic stays open while the agent speaks.
import base64
import json
import os
import queue
import threading

import sounddevice as sd
from websockets.sync.client import connect

API_KEY = os.environ["ASSEMBLYAI_API_KEY"]
WS_URL = "wss://agents.assemblyai.com/v1/ws"
RATE = 24000  # Voice Agent native PCM16 mono sample rate

# ONE full-duplex stream (mic + speaker together) at the agent's native 24 kHz. Opening
# two separate input/output streams on one device fails on macOS CoreAudio, which
# silently kills capture; a single sd.RawStream callback handles both directions.
mic_queue: queue.Queue = queue.Queue()
play_buffer = bytearray()
buffer_lock = threading.Lock()
ready = threading.Event()


def on_audio(indata, outdata, _frames, _time, _status):
    mic_queue.put_nowait(bytes(indata))  # capture -> queue for the agent
    # Playback: drain the agent's audio into the output, zero-filling any shortfall.
    needed = len(outdata)
    with buffer_lock:
        take = bytes(play_buffer[:needed])
        del play_buffer[:needed]
    outdata[: len(take)] = take
    if len(take) < needed:
        outdata[len(take):] = b"\x00" * (needed - len(take))


def send_mic(ws):
    while True:
        chunk = mic_queue.get()
        if not ready.is_set():
            continue
        try:
            ws.send(json.dumps({"type": "input.audio", "audio": base64.b64encode(chunk).decode()}))
        except Exception:
            return  # socket closed (session over): end the mic thread quietly


stream = sd.RawStream(
    samplerate=RATE, channels=1, dtype="int16", blocksize=RATE // 10, callback=on_audio
)
stream.start()

with connect(WS_URL, additional_headers={"Authorization": f"Bearer {API_KEY}"}) as ws:
    ws.send(json.dumps({
        "type": "session.update",
        "session": {
            "system_prompt": "You're Ivy at Brightsmile Dental.",
            "greeting": "Hi, Brightsmile Dental, this is Ivy.",
            "output": {"voice": "ivy"},
        },
    }))
    threading.Thread(target=send_mic, args=(ws,), daemon=True).start()
    print("Connected — start talking. (Ctrl-C to stop)")
    try:
        for raw in ws:
            event = json.loads(raw)
            etype = event.get("type")
            if etype == "session.ready":
                ready.set()
            elif etype == "reply.audio" and event.get("data"):
                with buffer_lock:
                    play_buffer += base64.b64decode(event["data"])
            elif etype == "transcript.user":
                print("you:  ", event.get("text", ""))
            elif etype == "transcript.agent":
                print("agent:", event.get("text", ""))
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
