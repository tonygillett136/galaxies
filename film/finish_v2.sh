#!/bin/bash
# The second audio pass: paragraph-first narration and the re-composed score,
# over the picture the first pass already cut.
#
# Run AFTER finish.sh has produced a complete film. That first pass is the
# fallback: if anything here is worse, the baseline still exists and is good.
set -e
cd "$(dirname "$0")"
SP=/private/tmp/claude-501/-Volumes-SSD1-code-research/f532c871-428d-4ac3-97ac-dd89d3350582/scratchpad
VENV=$SP/venv/bin/python
export ESPEAK_DATA_PATH=/opt/homebrew/share/espeak-ng-data

say () { echo; echo "=========== $* ==========="; date +%H:%M:%S; }

# keep the first pass so it can be compared against, and fallen back to
for f in galaxies_showcase_4k60_scored.mp4 galaxies_showcase_4k60.srt narration.wav score.wav; do
  [ -f "$f" ] && cp -n "$f" "v1_$f" 2>/dev/null || true
done

DUR=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 galaxies_showcase_4k60.mp4)
echo "  picture ${DUR}s"

say "narration, a paragraph at a time"
$VENV voice_paragraph.py

say "score, re-composed"
$VENV score_v2.py "$DUR" score.wav

say "mix"
ffmpeg -v error -y -i score.wav -i narration.wav \
  -filter_complex_script mix.filter -map '[out]' -c:a pcm_s24le soundtrack.wav

say "speech-to-music check"
# Measure the ducked music against the processed voice, both pre-loudnorm. This
# is the comparison that was got wrong before by measuring the mixed output
# against the voice-only stem.
cat > /tmp/branches.filter <<'EOF'
[0:a]volume=0.45[m];
[1:a]highpass=f=95,equalizer=f=250:t=q:w=1.2:g=-2,equalizer=f=3200:t=q:w=1.4:g=2.5,aecho=0.8:0.85:55:0.12,volume=1.25[v];
[v]asplit=2[vmain][vkey];
[m][vkey]sidechaincompress=threshold=0.028:ratio=7:attack=30:release=850:makeup=1[mduck]
EOF
ffmpeg -v error -y -i score.wav -i narration.wav -filter_complex_script /tmp/branches.filter \
  -map '[mduck]' -c:a pcm_s16le /tmp/chk_m.wav -map '[vmain]' -c:a pcm_s16le /tmp/chk_v.wav
$VENV - <<'PY'
import soundfile as sf, numpy as np
v,sr = sf.read('/tmp/chk_v.wav'); m,_ = sf.read('/tmp/chk_m.wav')
v=v.mean(1); m=m.mean(1); n=min(len(v),len(m)); v,m=v[:n],m[:n]
w=int(0.05*sr); env=np.abs(v[:n//w*w]).reshape(-1,w).max(1); sp=env>0.02
vb=v[:n//w*w].reshape(-1,w); mb=m[:n//w*w].reshape(-1,w)
rv=np.sqrt((vb[sp]**2).mean()); rm=np.sqrt((mb[sp]**2).mean())
rq=np.sqrt((mb[~sp]**2).mean())
print(f"  speech occupies {sp.mean()*100:.0f}% of the runtime")
print(f"  speech-to-music {20*np.log10(rv/rm):.1f} dB   duck depth {20*np.log10(rq/rm):.1f} dB")
print("  (the shipped v1 mix measured 8.9 dB on this same instrument)")
PY

say "mux"
ffmpeg -v error -y -i galaxies_showcase_4k60.mp4 -i soundtrack.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -shortest \
  galaxies_showcase_4k60_scored.mp4

say "done"
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,r_frame_rate \
  -of default=nw=1 galaxies_showcase_4k60_scored.mp4
ls -la galaxies_showcase_4k60_scored.mp4 galaxies_showcase_4k60.srt
