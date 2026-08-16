#!/usr/bin/env python3
"""
Narration synthesised a PARAGRAPH at a time, with the subtitles derived from the
resulting audio rather than the other way round.

WHY. The pipeline used to run: write subtitle-shaped lines -> build an SRT ->
synthesise each cue (later, each sentence) from the SRT. That makes the caption
box the author of the prose rhythm, and it is why the delivery sounded chopped:
a TTS engine given a clause at a time has no idea where the thought is going, so
it places stress and pauses as if every fragment were a complete utterance.

Here the whole segment is one call. The engine sees the entire paragraph and can
place its own cadence across it — where to lean in, where to let a clause fall
away, where the sentence boundaries really are. The subtitles are then fitted to
the audio that came out.

WHAT THIS IS NOT. It is not forced alignment. Real word-level alignment needs an
aligner and another model; here the measured paragraph duration is divided across
its lines by the same affine weight the rest of the pipeline uses (a fixed cost
per line plus a per-character cost). Subtitles need to be readable and roughly in
step, and this is accurate to a fraction of a line. Stated so nobody later reads
"derived from the audio" as a stronger claim than it is.

The voice remains Kokoro bm_lewis. Parler-TTS large was tried as the "bigger
model" and rejected on measurement: 47x realtime on this machine, a median pitch
of 233 Hz against the 100 Hz the brief asks for, and — decisively — 0% silence
across a clip containing a full stop, where Kokoro gives 41%. Continuous energy
with no pauses is a degenerate generation, not a voice.
"""
import os, json, subprocess, numpy as np, soundfile as sf
from scipy.signal import resample_poly

SP = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(SP, 'work')
OUT = os.path.join(SP, 'narration.wav')
SRT = os.path.join(SP, 'galaxies_showcase_4k60.srt')
SR = 44100
VOICE = 'bm_lewis'
BASE_SPEED = 0.92
MAX_SPEED = 1.15
XF = 1.0                      # must match assemble.py
LEAD_CARD, LEAD_SHOT = 1.6, 2.2
TAIL = 1.2

os.environ.setdefault('ESPEAK_DATA_PATH', '/opt/homebrew/share/espeak-ng-data')
from kokoro_onnx import Kokoro
kok = Kokoro(os.path.join(SP, 'tts_model/kokoro-v1.0.onnx'),
             os.path.join(SP, 'tts_model/voices-v1.0.bin'))


def dur(f):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                 '-of', 'default=nw=1:nk=1', f],
                                capture_output=True, text=True).stdout.strip())


def srt_time(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f'{h:02d}:{m:02d}:{s:06.3f}'.replace('.', ',')


segs = json.load(open(os.path.join(SP, 'script.json')))['segments']
durs = [dur(os.path.join(WORK, f'seg{i:02d}.mp4')) for i in range(len(segs))]

# the same timeline assemble.py builds: each segment starts XF before the last ends
tl, t = [], 0.0
for i, d in enumerate(durs):
    tl.append(t)
    t += d - (XF if i < len(durs) - 1 else 0)
total = t
print(f"  {len(segs)} segments, {total:.1f}s timeline")

bed = np.zeros(int((total + 4) * SR), dtype=np.float32)
cues, n = [], 1
refit = 0
tight = []

for i, (s, d) in enumerate(zip(segs, durs)):
    lines = s.get('lines') or []
    if not lines:
        continue
    lead = LEAD_CARD if s.get('kind') == 'card' else LEAD_SHOT
    allowed = max(3.0, d - lead - TAIL)
    text = ' '.join(lines)

    # ONE call for the whole paragraph. This is the point of the file.
    speed = BASE_SPEED
    a, sr = kok.create(text, voice=VOICE, speed=speed, lang='en-gb')
    got = len(a) / sr
    tries = 0
    while got > allowed and speed < MAX_SPEED and tries < 4:
        speed = min(MAX_SPEED, speed * got / allowed * 1.02)
        a, sr = kok.create(text, voice=VOICE, speed=speed, lang='en-gb')
        got = len(a) / sr
        tries += 1
    if tries:
        refit += 1
    if got > allowed + 0.05:
        tight.append((s['id'], got, allowed))

    start = tl[i] + lead
    a = resample_poly(a.astype(np.float32), SR, sr)
    f = int(0.012 * SR)
    if len(a) > 2 * f:
        a[:f] *= np.linspace(0, 1, f); a[-f:] *= np.linspace(1, 0, f)
    s0 = int(start * SR)
    m = min(len(a), len(bed) - s0)
    bed[s0:s0 + m] += a[:m]

    # subtitles fitted to the audio that actually came out
    wts = [20 + len(x) for x in lines]
    tot = sum(wts)
    c = start
    for line, w in zip(lines, wts):
        seg_d = got * (w / tot)
        cues.append((n, c, c + seg_d - 0.10, line)); c += seg_d; n += 1
    print(f"  {s['id']:<11} {len(lines):3d} lines  {got:5.1f}s into {allowed:5.1f}s"
          f"  speed {speed:.2f}{'  TIGHT' if got > allowed + 0.05 else ''}")

peak = float(np.max(np.abs(bed)))
bed = bed / max(peak, 1e-9) * 0.82
sf.write(OUT, np.stack([bed, bed], axis=1), SR, subtype='PCM_16')
open(SRT, 'w').write(''.join(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{x}\n\n" for i, a, b, x in cues))

speech = float(np.mean(np.abs(bed) > 0.01))
print(f"\n  {len(segs)} paragraphs, {len(cues)} subtitle cues, {refit} needed a quicker read")
print(f"  {OUT}  {len(bed)/SR:.1f}s, speech in {speech*100:.0f}% of the runtime")
overlaps = sum(1 for k in range(len(cues) - 1) if cues[k][2] > cues[k + 1][1] + 0.01)
print(f"  subtitle overlaps: {overlaps}")
if tight:
    print(f"  WARNING: {len(tight)} paragraphs still overrun their segment:")
    for sid, g, al in tight:
        print(f"    {sid}: {g:.1f}s into {al:.1f}s")
else:
    print("  every paragraph fits its segment")
