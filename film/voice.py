#!/usr/bin/env python3
"""
Neural narration, built from the subtitle file.

Voice is Kokoro 'bm_lewis', a British male synthetic voice chosen by measurement
rather than by name: 96 Hz median pitch and the widest intonation range of the
four available (4.99 semitones), which is the low, warm, expressive profile a
documentary wants. It is a synthesiser, and it is not an imitation of any real
person.

The important detail is that speech is synthesised PER SENTENCE, not per
subtitle cue. Subtitles are split at clause boundaries for reading comfort, and
feeding those fragments to a TTS engine one at a time produces the flat, chopped
delivery that makes synthetic narration obvious. Whole sentences let the engine
place its own stress and cadence. The audio is then anchored to the first cue of
each sentence, so picture, subtitles and voice stay in step.
"""
import os, re, subprocess, numpy as np, soundfile as sf
from scipy.signal import resample_poly

SP = os.path.dirname(os.path.abspath(__file__))
SRT = os.path.join(SP, 'galaxies_showcase_4k60.srt')
OUT = os.path.join(SP, 'narration.wav')
SR = 44100
VOICE = 'bm_lewis'
BASE_SPEED = 0.92          # unhurried
MAX_SPEED = 1.18

os.environ.setdefault('ESPEAK_DATA_PATH', '/opt/homebrew/share/espeak-ng-data')

from kokoro_onnx import Kokoro
kok = Kokoro(os.path.join(SP, 'tts_model/kokoro-v1.0.onnx'),
             os.path.join(SP, 'tts_model/voices-v1.0.bin'))


def parse_srt(path):
    cues, block = [], []
    for line in open(path):
        if line.strip() == '':
            if len(block) >= 3:
                m = re.match(r'(\d+):(\d+):([\d,]+) --> (\d+):(\d+):([\d,]+)', block[1])
                to_s = lambda h, mi, s: int(h)*3600 + int(mi)*60 + float(s.replace(',', '.'))
                cues.append([to_s(*m.group(1, 2, 3)), to_s(*m.group(4, 5, 6)),
                             ' '.join(block[2:])])
            block = []
        else:
            block.append(line.rstrip('\n'))
    return cues


cues = parse_srt(SRT)

# group consecutive cues into sentences
utts, cur = [], None
for i, (a, b, txt) in enumerate(cues):
    if cur is None:
        cur = {'start': a, 'end': b, 'text': txt, 'first': i}
    else:
        cur['text'] += ' ' + txt
        cur['end'] = b
    if txt.rstrip().endswith(('.', '?', '!', ':')) or i == len(cues) - 1:
        utts.append(cur); cur = None

total = cues[-1][1] + 4.0
bed = np.zeros(int(total * SR), dtype=np.float32)
refit = 0

overruns = []
prev_end = 0.0
for j, u in enumerate(utts):
    nxt = utts[j + 1]['start'] if j + 1 < len(utts) else total
    # A long sentence may borrow a little of the silence before it. Starting up
    # to half a second early is imperceptible against the picture, and it is far
    # better than letting the line run into the next one, which is audible as
    # words colliding.
    borrow = max(0.0, min(0.5, u['start'] - prev_end - 0.15))
    start = u['start'] - borrow
    allowed = max(1.0, nxt - start - 0.12)
    speed = BASE_SPEED
    a, sr = kok.create(u['text'], voice=VOICE, speed=speed, lang='en-gb')
    d = len(a) / sr
    # Duration is not exactly inversely proportional to the speed parameter, so
    # a single correction lands short and the line still collides by a tenth of
    # a second. Iterate to the fit instead of assuming one pass reaches it, and
    # stop either when it fits or when the voice would start to sound hurried.
    tries = 0
    while d > allowed and speed < MAX_SPEED and tries < 4:
        speed = min(MAX_SPEED, speed * d / allowed * 1.02)
        a, sr = kok.create(u['text'], voice=VOICE, speed=speed, lang='en-gb')
        d = len(a) / sr
        tries += 1
    if tries:
        refit += 1
    if d > allowed + 0.05:
        overruns.append((start, d, allowed, u['text'][:60]))
    prev_end = start + d
    u['start'] = start
    a = resample_poly(a.astype(np.float32), SR, sr)
    f = int(0.010 * SR)
    if len(a) > 2 * f:
        a[:f] *= np.linspace(0, 1, f); a[-f:] *= np.linspace(1, 0, f)
    s0 = int(u['start'] * SR)
    n = min(len(a), len(bed) - s0)
    bed[s0:s0 + n] += a[:n]

bed = bed / max(float(np.max(np.abs(bed))), 1e-9) * 0.82
sf.write(OUT, np.stack([bed, bed], axis=1), SR, subtype='PCM_16')
speech = float(np.mean(np.abs(bed) > 0.01))
print(f"  {len(cues)} cues grouped into {len(utts)} spoken sentences")
print(f"  {refit} sentences needed a slightly quicker read")
print(f"  {OUT}  {len(bed)/SR:.1f}s, speech in {speech*100:.0f}% of the runtime")
if overruns:
    print(f"  WARNING: {len(overruns)} sentences still overrun and will collide:")
    for st, d, al, t in overruns:
        print(f"    {int(st//60)}:{st%60:05.2f}  {d:.2f}s into a {al:.2f}s slot   \"{t}...\"")
else:
    print("  no sentence overruns its slot: nothing collides")
