#!/usr/bin/env python3
"""
Original score, written to the three-act cut.

WHAT WAS WRONG WITH THE FIRST ONE. It was not the synthesis. The reference is
Vangelis and the original Cosmos, which ARE synthesiser scores, so "synthetic" is
not the problem. The problems were compositional, and there were five:

  1. One texture for seven and a half minutes. A detuned-saw pad and nothing else.
  2. No tune. Pads with no melody are wallpaper; you cannot leave humming them.
  3. Harmonic stasis — i-VI-III-VII going round for the whole film, no modulation.
  4. No pulse. Even a slow score needs something to measure time against.
  5. It never stopped. Music that never stops has no way to mark anything.

So this one has a THEME — six notes, stated plainly on a bell at the top, given
to strings in Act II, put in the bass in augmentation under the merger, and
returned alone and quiet at the end. It has an orchestration arc from one voice
to many and back. It modulates, and it ends on a major chord after seven minutes
of minor. It has a pulse under Act II. And it stops twice, both times on purpose.

Everything is synthesised here from scratch: additive and subtractive synthesis,
Karplus-Strong for the plucked voice, and a convolution reverb built from noise.
It is an original composition in an idiom, not a reproduction of any work.
"""
import numpy as np, sys, os, json
from scipy.signal import oaconvolve, butter, sosfilt

SR = 44100
SP = os.path.dirname(os.path.abspath(__file__))

NOTE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6,
        'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def hz(name, octave):
    return 440.0 * 2 ** ((NOTE[name] + (octave - 4) * 12 - 9) / 12.0)


def adsr(n, a, d, s, r, sr=SR):
    a, d, r = int(a * sr), int(d * sr), int(r * sr)
    sus = max(0, n - a - d - r)
    return np.concatenate([
        np.linspace(0, 1, a, endpoint=False) ** 1.6,
        np.linspace(1, s, d, endpoint=False),
        np.full(sus, s),
        np.linspace(s, 0, max(r, 1)) ** 1.4,
    ])[:n]


# ---------------------------------------------------------------- instruments
def bell(f, n, bright=1.0):
    """Struck, inharmonic. Carries the theme at the beginning and the end."""
    t = np.arange(n) / SR
    parts = [(1.0, 1.0, 1.0), (2.01, 0.42, 1.6), (2.99, 0.22, 2.2),
             (4.18, 0.12, 3.0), (5.43, 0.07, 4.0)]
    out = np.zeros(n)
    for mult, amp, decay in parts:
        out += amp * np.sin(2 * np.pi * f * mult * t) * np.exp(-t * decay * 0.9)
    # a little breath of noise at the strike, which is most of what "struck" means
    k = min(int(0.006 * SR), n)
    out[:k] += np.random.randn(k) * 0.25 * np.exp(-np.arange(k) / (0.0015 * SR))
    return out * 0.5 * bright


def strings(f, n, detune=(-9, -4, 0, 5, 11), vib=0.22):
    """Bowed ensemble: detuned saws, slow swell, slight vibrato, lowpassed."""
    t = np.arange(n) / SR
    out = np.zeros(n)
    for c in detune:
        fq = f * 2 ** (c / 1200.0)
        # vibrato that starts late, as a player would
        v = 1 + (vib / 100) * np.sin(2 * np.pi * 4.6 * t) * np.clip((t - 0.6) / 1.2, 0, 1)
        ph = np.cumsum(2 * np.pi * fq * v / SR) + np.random.rand() * 6.28
        k = 1
        s = np.zeros(n)
        while fq * k < SR / 2.2 and k <= 12:
            s += np.sin(ph * k) / (k ** 1.25)
            k += 1
        out += s
    return out / len(detune)


def pluck(f, n, damp=0.996):
    """Karplus-Strong. The harp-like voice under Act II."""
    L = max(2, int(SR / f))
    buf = np.random.randn(L)
    # a gentler pick than raw noise
    sos = butter(2, 2500, 'lp', fs=SR, output='sos')
    buf = sosfilt(sos, buf)
    out = np.zeros(n)
    idx = 0
    for i in range(n):
        out[i] = buf[idx]
        buf[idx] = damp * 0.5 * (buf[idx] + buf[(idx + 1) % L])
        idx = (idx + 1) % L
    return out * 0.55


def sub(f, n):
    t = np.arange(n) / SR
    x = np.sin(2 * np.pi * f * t)
    return np.tanh(x * 1.4) * 0.7


def brass(f, n):
    """Swelling, bright-ish. Only Act III gets this."""
    t = np.arange(n) / SR
    out = np.zeros(n)
    k = 1
    while f * k < SR / 2.2 and k <= 16:
        out += np.sin(2 * np.pi * f * k * t + k * 0.3) / (k ** 0.95)
        k += 1
    env = np.clip(t / 1.1, 0, 1) ** 1.5
    return out * env * 0.28


def lowpass_sweep(x, f0, f1, blocks=48):
    n = len(x)
    out = np.zeros(n)
    edges = np.linspace(0, n, blocks + 1).astype(int)
    cut = np.linspace(f0, f1, blocks)
    for i in range(blocks):
        a, b = edges[i], edges[i + 1]
        if b <= a:
            continue
        sos = butter(2, min(cut[i], SR / 2 * 0.98), 'lp', fs=SR, output='sos')
        pre = max(0, a - 2048)
        out[a:b] = sosfilt(sos, x[pre:b])[a - pre:]
    return out


def reverb_ir(seconds=3.8, pre=0.022):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.random.randn(n) * np.exp(-t * 1.9)
    ir = sosfilt(butter(2, 5600, 'lp', fs=SR, output='sos'), ir)
    ir[:int(pre * SR)] = 0
    return ir / np.max(np.abs(ir)) * 0.45


# ---------------------------------------------------------------- the theme
# Six notes. Up a fifth, up a minor third, and a slow fall back. Plain enough to
# recognise the third time it appears, which is the entire job of a theme.
THEME = [('D', 0), ('A', 0), ('C', 1), ('A', 0), ('G', 0), ('F', 0)]
BEAT = 1.9                     # seconds per theme note, unhurried


def place(dst, x, at, gain=1.0):
    s = int(at * SR)
    if s < 0 or s >= len(dst):
        return
    m = min(len(x), len(dst) - s)
    dst[s:s + m] += x[:m] * gain


def theme(dst, at, octave, voice, gain, beat=BEAT, transpose=0, hold=1.0):
    for i, (nm, o) in enumerate(THEME):
        f = hz(nm, octave + o) * 2 ** (transpose / 12.0)
        n = int(beat * hold * 1.35 * SR)
        place(dst, voice(f, n), at + i * beat, gain)


def chord(dst, at, secs, root, notes, octave, gain, sweep=(500, 2200)):
    n = int((secs + 3.5) * SR)
    pad = np.zeros(n)
    for oc in (octave, octave + 1):
        for nm in notes:
            pad += strings(hz(nm, oc), n) * (1.0 if oc == octave else 0.55)
    pad *= adsr(n, 2.4, 1.8, 0.78, 3.2)
    pad = lowpass_sweep(pad, *sweep)
    place(dst, pad, at, gain * 0.30)
    place(dst, sub(hz(root, 1), n) * adsr(n, 1.6, 1.0, 0.85, 2.8), at, gain * 0.26)


def render(total, marks):
    n = int(total * SR)
    L = np.zeros(n); R = np.zeros(n)
    mono = np.zeros(n)
    rng = np.random.default_rng(11)

    A1, A2, A3, CODA = marks['act1'], marks['act2'], marks['act3'], marks['coda']
    HUSH1, HUSH2 = marks['hush1'], marks['hush2']

    # ---- ACT I: one voice. The theme, stated plainly on a bell over a drone.
    place(mono, sub(hz('D', 1), int((A2 - 0) * SR)) * adsr(int((A2 - 0) * SR), 6, 4, 0.55, 8), 0, 0.20)
    theme(mono, A1, 4, bell, 0.34)
    theme(mono, A1 + 6 * BEAT + 2.5, 5, bell, 0.16)      # a quiet echo an octave up

    # ---- ACT II: strings take the theme; a pluck ostinato gives it a pulse.
    prog = [('D', ['D', 'F', 'A']), ('A#', ['A#', 'D', 'F']),
            ('F', ['F', 'A', 'C']), ('C', ['C', 'E', 'G'])]
    # Start Act II a beat BEFORE its mark so the strings swell into the act
    # break rather than leaving a hole after the drone's release. Measured
    # before this: a 3s dip to -47.7 dB at the boundary, which read as a gap
    # rather than as a breath.
    t = A2 - 2.5
    ci = 0
    while t < A3 - 1:
        root, notes = prog[ci % 4]
        secs = 11.0
        chord(mono, t, secs, root, notes, 3, 0.85)
        # ostinato: two plucked notes a bar, off the beat, quiet
        for k in range(int(secs / 1.55)):
            f = hz(notes[k % 3], 5)
            place(mono, pluck(f, int(1.5 * SR)), t + 0.8 + k * 1.55, 0.085)
        t += secs; ci += 1
    theme(mono, A2 + 6.0, 4, lambda f, nn: strings(f, nn) * adsr(nn, 0.5, 1.2, 0.7, 1.6), 0.20)
    # the lift: the theme a fourth up, where Act II turns from mechanism to geometry
    theme(mono, A2 + (A3 - A2) * 0.55, 4,
          lambda f, nn: strings(f, nn) * adsr(nn, 0.6, 1.4, 0.7, 1.8), 0.17, transpose=5)

    # ---- HUSH 1: everything stops before the merger's coalescence.
    # ---- ACT III: the theme in augmentation, in the bass, with brass over it.
    t = A3
    prog3 = [('D', ['D', 'F', 'A']), ('G', ['G', 'A#', 'D']),
             ('A#', ['A#', 'D', 'F']), ('F', ['F', 'A', 'C'])]
    ci = 0
    while t < CODA - 1:
        if HUSH1 - 0.5 < t < HUSH1 + 4.5:      # leave the hush empty
            t += 4.0; continue
        root, notes = prog3[ci % 4]
        chord(mono, t, 12.0, root, notes, 3, 1.0, sweep=(420, 2600))
        t += 12.0; ci += 1
    theme(mono, A3 + 4, 2, lambda f, nn: strings(f, nn) * adsr(nn, 1.4, 1.6, 0.75, 2.4),
          0.22, beat=BEAT * 1.6)               # augmentation: half speed, in the bass
    place(mono, brass(hz('D', 3), int(9 * SR)), HUSH1 + 4.6, 0.20)
    place(mono, brass(hz('A', 3), int(9 * SR)), HUSH1 + 6.2, 0.14)

    # ---- CODA: back to one voice, and the only major chord in the film.
    chord(mono, CODA, 16.0, 'D', ['D', 'F#', 'A'], 3, 0.75, sweep=(600, 2000))
    theme(mono, CODA + 1.5, 4, bell, 0.30)

    # hushes: carve them out rather than hoping nothing landed there
    for h, w in ((HUSH1, 3.4), (HUSH2, 2.6)):
        s0, s1 = int(h * SR), int((h + w) * SR)
        ramp = np.ones(s1 - s0)
        f = int(0.5 * SR)
        ramp[:f] = np.linspace(1, 0.04, f); ramp[-f:] = np.linspace(0.04, 1, f)
        ramp[f:-f] = 0.04
        mono[s0:s1] *= ramp

    # slow stereo drift so the bed never sits still
    t = np.arange(n) / SR
    pan = 0.5 + 0.16 * np.sin(2 * np.pi * t / 27.0)
    L = mono * (1 - pan); R = mono * pan
    ir = reverb_ir()
    L = L * 0.60 + oaconvolve(L, ir)[:n] * 0.85
    R = R * 0.60 + oaconvolve(R, ir)[:n] * 0.85

    fi, fo = int(5 * SR), int(8 * SR)
    L[:fi] *= np.linspace(0, 1, fi); R[:fi] *= np.linspace(0, 1, fi)
    L[-fo:] *= np.linspace(1, 0, fo); R[-fo:] *= np.linspace(1, 0, fo)
    st = np.stack([L, R], axis=1)
    st /= max(1e-9, np.max(np.abs(st))) / 0.89
    return st


if __name__ == '__main__':
    total = float(sys.argv[1]) if len(sys.argv) > 1 else 478.0
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(SP, 'score.wav')
    # Structural marks, as fractions of the cut. Act boundaries follow the film:
    # Act I is the sky and the quiet disc, Act II the mechanism, Act III what
    # becomes of them. The hushes sit just before the coalescence and just before
    # Andromeda — the two places the film asks the audience to hold still.
    marks = dict(act1=6.0, act2=total * 0.185, act3=total * 0.60,
                 coda=total * 0.905, hush1=total * 0.735, hush2=total * 0.885)
    audio = render(total, marks)
    sf_written = False
    try:
        import soundfile as sf
        sf.write(out, audio, SR, subtype='PCM_24'); sf_written = True
    except Exception:
        from scipy.io import wavfile
        wavfile.write(out, SR, (audio * 32767).astype(np.int16))
    rms = np.sqrt(np.mean(audio ** 2))
    print(f"  {out}  {total:.0f}s  peak {np.max(np.abs(audio)):.3f}  "
          f"rms {rms:.4f} ({20*np.log10(rms):.1f} dBFS)")
    print(f"  marks: act1 {marks['act1']:.0f}s  act2 {marks['act2']:.0f}s  "
          f"act3 {marks['act3']:.0f}s  hush1 {marks['hush1']:.0f}s  "
          f"hush2 {marks['hush2']:.0f}s  coda {marks['coda']:.0f}s")
