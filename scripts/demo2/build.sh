#!/bin/bash
set -e
cd "$(dirname "$0")/../.."
D=out/demo2; C=$D/clips; FPS=30
mkdir -p $C
dur(){ ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }

# clip 0: title over intro VO
T0=$(echo "$(dur $D/vo/intro.wav) + 0.8" | bc)
ffmpeg -loglevel error -y -loop 1 -t $T0 -i $D/cards/title.jpg -i $D/vo/intro.wav \
  -filter_complex "[0:v]scale=1440:900,fps=$FPS,format=yuv420p[v];[1:a]adelay=400|400,apad=pad_dur=0.4[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 20 -c:a aac -ar 48000 -ac 2 $C/0title.mp4

# segment: 2.4s label card -> narration over held opening frame -> full call with its own clean audio
seg(){ # name card vo calltrim
  local name=$1 card=$2 vo=$3 calltrim=$4 frames=$D/frames-$1
  ffmpeg -loglevel error -y -i $D/audio-$1.webm -filter_complex "[0:a]pan=stereo|c0=c0+c1|c1=c0+c1,volume=1.5[a]" -map "[a]" $D/callmix-$1.wav
  ffmpeg -loglevel error -y -loop 1 -t 2.4 -i $D/cards/$card.jpg -f lavfi -t 2.4 -i anullsrc=r=48000:cl=stereo \
    -filter_complex "[0:v]scale=1440:900,fps=$FPS,format=yuv420p,fade=t=in:st=0:d=0.3[v]" -map "[v]" -map 1:a -c:v libx264 -crf 20 -c:a aac $C/${name}_card.mp4
  local introlen=$(echo "$(dur $vo) + 0.8" | bc)
  ffmpeg -loglevel error -y -loop 1 -t $introlen -i $frames/00000.jpg -i $vo \
    -filter_complex "[0:v]scale=1440:900,fps=$FPS,format=yuv420p[v];[1:a]adelay=400|400,volume=1.4,apad=pad_dur=0.4[a]" \
    -map "[v]" -map "[a]" -c:v libx264 -crf 20 -c:a aac -ar 48000 -ac 2 $C/${name}_intro.mp4
  ffmpeg -loglevel error -y -framerate 5 -i $frames/%05d.jpg -i $D/callmix-$1.wav \
    -filter_complex "[0:v]scale=1440:900,fps=$FPS,format=yuv420p[v];[1:a]aresample=48000[a]" \
    -map "[v]" -map "[a]" -t $calltrim -c:v libx264 -crf 20 -c:a aac -ar 48000 -ac 2 $C/${name}_call.mp4
}
seg pipeline seg1 $D/vo/pipeline.wav 40.5
seg va seg2 $D/vo/va.wav 35.5

# security: card + terminal (VO = security + security2)
ffmpeg -loglevel error -y -i $D/vo/security.wav -i $D/vo/security2.wav -filter_complex "[0:a][1:a]concat=n=2:v=0:a=1[a]" -map "[a]" $D/vo/sec_all.wav
ffmpeg -loglevel error -y -loop 1 -t 2.4 -i $D/cards/seg3.jpg -f lavfi -t 2.4 -i anullsrc=r=48000:cl=stereo \
  -filter_complex "[0:v]scale=1440:900,fps=$FPS,format=yuv420p,fade=t=in:st=0:d=0.3[v]" -map "[v]" -map 1:a -c:v libx264 -crf 20 -c:a aac $C/sec_card.mp4
SECV=$(echo "$(dur $D/vo/sec_all.wav) + 1.5" | bc)
ffmpeg -loglevel error -y -framerate 5 -i $D/frames-security/%05d.jpg -i $D/vo/sec_all.wav \
  -filter_complex "[0:v]scale=1440:900,fps=$FPS,format=yuv420p[v];[1:a]adelay=300|300,volume=1.5,apad=pad_dur=1[a]" \
  -map "[v]" -map "[a]" -t $SECV -c:v libx264 -crf 20 -c:a aac -ar 48000 -ac 2 $C/sec_term.mp4

# scorecard hold + end card over outro VO
ffmpeg -loglevel error -y -loop 1 -t 2.5 -i $D/cards/scorecard.jpg -f lavfi -t 2.5 -i anullsrc=r=48000:cl=stereo \
  -filter_complex "[0:v]scale=1440:900,fps=$FPS,format=yuv420p[v]" -map "[v]" -map 1:a -c:v libx264 -crf 20 -c:a aac $C/scorecard.mp4
TE=$(echo "$(dur $D/vo/outro.wav) + 1.2" | bc)
ffmpeg -loglevel error -y -loop 1 -t $TE -i $D/cards/end.jpg -i $D/vo/outro.wav \
  -filter_complex "[0:v]scale=1440:900,fps=$FPS,format=yuv420p,fade=t=in:st=0:d=0.3[v];[1:a]adelay=300|300,apad=pad_dur=0.9[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 20 -c:a aac -ar 48000 -ac 2 $C/end.mp4

for f in 0title pipeline_card pipeline_intro pipeline_call va_card va_intro va_call sec_card sec_term scorecard end; do echo "file '$PWD/$C/$f.mp4'"; done > $C/list.txt
ffmpeg -loglevel error -y -f concat -safe 0 -i $C/list.txt -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart $D/frontdesk-demo-v2.mp4
echo "built: $(dur $D/frontdesk-demo-v2.mp4)s"
