#!/bin/bash
# Two masters from the spatialised stems.
#
#   stereo   binaural, for YouTube - which delivers uploads as stereo, so this is
#            the version the audience will actually hear
#   5.1      a separate master for anywhere that can carry it. Dialogue sits in
#            the centre channel alone, which is the real reason to bother.
set -e
cd "$(dirname "$0")"
SP=/private/tmp/claude-501/-Volumes-SSD1-code-research/f532c871-428d-4ac3-97ac-dd89d3350582/scratchpad
VENV=$SP/venv/bin/python
say () { echo; echo "=========== $* ==========="; date +%H:%M:%S; }

say "binaural stereo mix"
ffmpeg -v error -y -i score_spatial.wav -i narration_spatial.wav \
  -filter_complex_script mix.filter -map '[out]' -c:a pcm_s24le soundtrack_spatial.wav

say "5.1 mix"
$VENV - <<'PY'
import numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt
SR = 44100
six, _ = sf.read('score_51.wav')
nar, _ = sf.read('narration.wav')
if nar.ndim > 1: nar = nar.mean(1)
n = len(six)
nar = np.pad(nar, (0, max(0, n - len(nar))))[:n]

# Dialogue to the CENTRE CHANNEL alone. With the voice discrete, the music no
# longer has to be pushed out of its way, so the duck can be far gentler than the
# stereo mix needs: -4.5 dB against roughly -9.5 there.
env = np.abs(nar)
env = sosfilt(butter(2, 2.2, 'lp', fs=SR, output='sos'), env)
env /= max(env.max(), 1e-9)
duck = 1.0 - 0.40 * np.clip(env * 3.0, 0, 1)          # ~-4.5 dB at full speech

out = six.copy()
for ch in (0, 1, 4, 5):                                # FL FR BL BR
    out[:, ch] *= duck
out[:, 3] *= 0.85 * (1.0 - 0.20 * np.clip(env * 3.0, 0, 1))   # LFE, barely ducked
out[:, 2] += nar * 1.05                                # FC

pk = np.abs(out).max()
out = out / max(pk, 1e-9) * 0.89
sf.write('soundtrack_51.wav', out, SR, subtype='PCM_24')
for i, nm in enumerate(('FL','FR','FC','LFE','BL','BR')):
    r = np.sqrt((out[:, i] ** 2).mean())
    print(f"    {nm:4s} {20*np.log10(max(r,1e-9)):7.1f} dBFS")
print(f"    peak {np.abs(out).max():.3f}")
PY

say "mux: stereo master (the YouTube upload)"
ffmpeg -v error -y -i galaxies_showcase_4k60.mp4 -i soundtrack_spatial.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 320k -shortest \
  galaxies_showcase_4k60_spatial.mp4

say "mux: 5.1 master"
ffmpeg -v error -y -i galaxies_showcase_4k60.mp4 -i soundtrack_51.wav \
  -map 0:v -map 1:a -c:v copy -c:a eac3 -b:a 640k -ac 6 -shortest \
  galaxies_showcase_4k60_51.mp4

say "verify"
for f in galaxies_showcase_4k60_spatial.mp4 galaxies_showcase_4k60_51.mp4; do
  echo "  $f"
  ffprobe -v error -show_entries stream=codec_type,codec_name,channels,channel_layout \
    -of default=nw=1 "$f" | sed 's/^/    /'
done
ls -la galaxies_showcase_4k60_spatial.mp4 galaxies_showcase_4k60_51.mp4 | awk '{printf "  %-42s %7.1f MB\n", $9, $5/1048576}'
