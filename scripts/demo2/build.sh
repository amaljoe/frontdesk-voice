#!/bin/bash
set -e
cd "$(dirname "$0")/../.."
D=out/demo2; C=$D/clips; FPS=30
dur(){ ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }
VO_INTRO=$(dur $D/vo/intro.wav); VO_PIPE=$(dur $D/vo/pipeline.wav); VO_VA=$(dur $D/vo/va.wav)
VO_SEC=$(dur $D/vo/security.wav); VO_SEC2=$(dur $D/vo/security2.wav); VO_OUT=$(dur $D/vo/outro.wav)

# --- clip 0: title (hold card for intro VO + 0.6s tail) ---
T0=$(echo "$VO_INTRO + 0.8" | bc)
ffmpeg -loglevel error -y -loop 1 -t $T0 -i $D/cards/title.jpg -i $D/vo/intro.wav \
  -filter_complex "[0:v]scale=1440:900,fps=$FPS,format=yuv420p[v];[1:a]adelay=400|400,apad=pad_dur=0.4[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 20 -c:a aac -ar 48000 -ac 2 $C/0title.mp4

# --- segment helper: label card (2.4s) then the recorded call, VO over the call start, call audio ducked ---
seg(){ # $1 name  $2 card  $3 vo  $4 fallbackframes
  local name=$1 card=$2 vo=$3 frames=$D/frames-$1 au=$D/audio-$1.wav
  local calldur=$(dur $au); local vodur=$(dur $vo)
  # card clip
  ffmpeg -loglevel error -y -loop 1 -t 2.4 -i $D/cards/$card.jpg \
    -f lavfi -t 2.4 -i anullsrc=r=48000:cl=stereo \
    -filter_complex "[0:v]scale=1440:900,fps=$FPS,format=yuv420p,fade=t=in:st=0:d=0.3[v]" \
    -map "[v]" -map 1:a -c:v libx264 -crf 20 -c:a aac $C/${name}_card.mp4
  # call clip: frames -> video, VO mixed over ducked call audio (VO starts 0.5s in)
  ffmpeg -loglevel error -y -framerate 5 -i $frames/%05d.jpg -i $au -i $vo \
    -filter_complex "[0:v]scale=1440:900,fps=$FPS,format=yuv420p[v];\
      [1:a]volume=0.35[call];[2:a]adelay=500|500,volume=1.6[nar];\
      [call][nar]amix=inputs=2:duration=first:dropout_transition=0,aresample=48000[a]" \
    -map "[v]" -map "[a]" -t $calldur -c:v libx264 -crf 20 -c:a aac -ar 48000 -ac 2 $C/${name}_call.mp4
}
seg pipeline seg1 $D/vo/pipeline.wav
seg va seg2 $D/vo/va.wav

# --- security: seg3 card + terminal frames, VO = security + security2 concatenated ---
ffmpeg -loglevel error -y -i $D/vo/security.wav -i $D/vo/security2.wav \
  -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[a]" -map "[a]" $D/vo/sec_all.wav
ffmpeg -loglevel error -y -loop 1 -t 2.4 -i $D/cards/seg3.jpg -f lavfi -t 2.4 -i anullsrc=r=48000:cl=stereo \
  -filter_complex "[0:v]scale=1440:900,fps=$FPS,format=yuv420p,fade=t=in:st=0:d=0.3[v]" -map "[v]" -map 1:a -c:v libx264 -crf 20 -c:a aac $C/sec_card.mp4
SECDUR=$(dur $D/vo/sec_all.wav); SECV=$(echo "$SECDUR + 1.5" | bc)
ffmpeg -loglevel error -y -framerate 5 -i $D/frames-security/%05d.jpg -i $D/vo/sec_all.wav \
  -filter_complex "[0:v]scale=1440:900,fps=$FPS,format=yuv420p[v];[1:a]adelay=300|300,volume=1.6,apad=pad_dur=1[a]" \
  -map "[v]" -map "[a]" -t $SECV -c:v libx264 -crf 20 -c:a aac -ar 48000 -ac 2 $C/sec_term.mp4

# --- scorecard hold + outro VO ---
TE=$(echo "$VO_OUT + 1.2" | bc)
ffmpeg -loglevel error -y -loop 1 -t 3 -i $D/cards/scorecard.jpg -f lavfi -t 3 -i anullsrc=r=48000:cl=stereo \
  -filter_complex "[0:v]scale=1440:900,fps=$FPS,format=yuv420p[v]" -map "[v]" -map 1:a -c:v libx264 -crf 20 -c:a aac $C/scorecard.mp4
ffmpeg -loglevel error -y -loop 1 -t $TE -i $D/cards/end.jpg -i $D/vo/outro.wav \
  -filter_complex "[0:v]scale=1440:900,fps=$FPS,format=yuv420p,fade=t=in:st=0:d=0.3[v];[1:a]adelay=300|300,apad=pad_dur=0.9[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 20 -c:a aac -ar 48000 -ac 2 $C/end.mp4

# --- concat ---
for f in 0title pipeline_card pipeline_call va_card va_call sec_card sec_term scorecard end; do echo "file '$PWD/$C/$f.mp4'"; done > $C/list.txt
ffmpeg -loglevel error -y -f concat -safe 0 -i $C/list.txt -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart $D/frontdesk-demo-v2.mp4
echo "=== done ==="; dur $D/frontdesk-demo-v2.mp4
