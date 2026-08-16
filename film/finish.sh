#!/bin/bash
# Everything after the shot renders: the Andromeda plate, the Act I stills, the
# cut, the voice, the score and the mix. Detached and idempotent-ish, so it can
# be left alone and inspected from the log.
set -e
cd "$(dirname "$0")"
SP=/private/tmp/claude-501/-Volumes-SSD1-code-research/f532c871-428d-4ac3-97ac-dd89d3350582/scratchpad
VENV=$SP/venv/bin/python
export FILM_OUT=/Volumes/SSD1/code/research/galaxy_collisions/film4k
export FILM_SUB=16
export ESPEAK_DATA_PATH=/opt/homebrew/share/espeak-ng-data

say () { echo; echo "=========== $* ==========="; date +%H:%M:%S; }

# Wait for any shot render still in flight.
#
# NOT `pgrep -f render_live.mjs`. The shell wrapper that launched the render
# keeps the script name in its own command line, so -f matches the wrapper long
# after the node process has exited and this loop waits on a ghost for ever.
# That cost twenty minutes. `pgrep -x node` matches the process NAME, so only a
# real node process counts; it is deliberately broad, because waiting too long is
# recoverable and starting too early is not.
while pgrep -x node >/dev/null 2>&1; do sleep 20; done

say "Andromeda plate (discs, 40s)"
node render.mjs discs '{"scenario":"prograde","t0":-45,"t1":-42,"seconds":40,"stepsPerFrame":0.30,"theta0":0.0,"thetaSweep":1.1,"phi":1.35,"phiSweep":-0.40,"fixedDist":[135,108],"follow":"pair"}'

say "Act I stills"
bash imagery.sh

say "cut"
python3 make_script.py
python3 assemble.py

DUR=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 galaxies_showcase_4k60.mp4)
echo "  picture duration ${DUR}s"

say "voice"
$VENV voice.py

say "score"
$VENV score.py "$DUR" score.wav

say "mix"
ffmpeg -v error -y -i score.wav -i narration.wav \
  -filter_complex_script mix.filter -map '[out]' -c:a pcm_s24le soundtrack.wav

say "mux"
ffmpeg -v error -y -i galaxies_showcase_4k60.mp4 -i soundtrack.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -shortest \
  galaxies_showcase_4k60_scored.mp4

say "done"
ls -la galaxies_showcase_4k60_scored.mp4 galaxies_showcase_4k60.srt
ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,r_frame_rate \
  -of default=nw=1 galaxies_showcase_4k60_scored.mp4
