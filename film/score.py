#!/usr/bin/env python3
"""
Original score, written in the idiom of early-80s analog synthesiser scoring:
slow harmonic movement, heavily detuned sawtooth pads, a sub drone, sparse bell
arpeggios, and a long reverb tail.

This is composed here, from scratch. It is not a reproduction of any existing
piece. The idiom (stacked detuned saws, i-VI-III-VII in a minor key, very slow
chord rate) is a technique, not a work.

Structure follows the film: sparse under the control, opening out at the first
tidal tail, thinning for the analytical sections, largest at the merger, and
resolving under the closing card.
"""
import numpy as np, sys, os
from scipy.signal import oaconvolve, butter, sosfilt

SR = 44100
SP = os.path.dirname(os.path.abspath(__file__))


def adsr(n, a, d, s, r, sr=SR):
    a, d, r = int(a * sr), int(d * sr), int(r * sr)
    sus = max(0, n - a - d - r)
    return np.concatenate([
        np.linspace(0, 1, a, endpoint=False) ** 1.6,
        np.linspace(1, s, d, endpoint=False),
        np.full(sus, s),
        np.linspace(s, 0, r) ** 1.4,
    ])[:n]


def saw(freq, n, sr=SR):
    """Band-limited-ish saw by additive synthesis, cheap and warm."""
    t = np.arange(n) / sr
    out = np.zeros(n)
    k = 1
    while freq * k < sr / 2.2 and k <= 14:
        out += np.sin(2 * np.pi * freq * k * t) / k
        k += 1
    return out * 0.55


def pad_voice(freq, n, detune_cents=(-7, -3, 0, 4, 9)):
    """A stack of detuned saws: the sound of the era, and the reason it moves."""
    out = np.zeros(n)
    for c in detune_cents:
        f = freq * 2 ** (c / 1200.0)
        ph = np.random.rand() * 2 * np.pi
        t = np.arange(n) / SR
        v = np.zeros(n); k = 1
        while f * k < SR / 2.2 and k <= 12:
            v += np.sin(2 * np.pi * f * k * t + ph * k) / (k ** 1.15)
            k += 1
        out += v
    return out / len(detune_cents)


def lowpass_sweep(x, f0, f1):
    """Slow filter opening, the other half of the era's signature."""
    n = len(x)
    out = np.zeros(n)
    blocks = 64
    edges = np.linspace(0, n, blocks + 1).astype(int)
    cut = np.linspace(f0, f1, blocks)
    for i in range(blocks):
        a, b = edges[i], edges[i + 1]
        if b <= a:
            continue
        sos = butter(2, min(cut[i], SR / 2 * 0.98), 'lp', fs=SR, output='sos')
        pre = max(0, a - 2048)
        seg = sosfilt(sos, x[pre:b])
        out[a:b] = seg[a - pre:]
    return out


NOTE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6,
        'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def hz(name, octave):
    return 440.0 * 2 ** ((NOTE[name] + (octave - 4) * 12 - 9) / 12.0)


# i - VI - III - VII in D minor: spacious, unresolved, goes round for ever.
PROG = [
    ('D',  ['D', 'F', 'A'],      2),
    ('A#', ['A#', 'D', 'F'],     1),
    ('F',  ['F', 'A', 'C'],      2),
    ('C',  ['C', 'E', 'G'],      1),
]

# Intensity through the film, by time in seconds. Keyed to the cut.
def intensity(t):
    pts = [(0, 0.30), (9, 0.34), (25, 0.55), (60, 0.62), (71, 0.42),
           (104, 0.50), (146, 0.66), (196, 0.72), (206, 0.50), (229, 0.58),
           (271, 0.66), (316, 0.60), (376, 0.92), (378, 0.86), (418, 0.52),
           (444, 0.44), (460, 0.28)]
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return float(np.interp(t, xs, ys))


def reverb_ir(seconds=3.4, pre=0.02):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.random.randn(n) * np.exp(-t * 2.1)
    sos = butter(2, 5200, 'lp', fs=SR, output='sos')
    ir = sosfilt(sos, ir)
    ir[:int(pre * SR)] = 0
    ir /= np.max(np.abs(ir))
    return ir * 0.42


def render(total_seconds):
    n = int(total_seconds * SR)
    left = np.zeros(n); right = np.zeros(n)
    bar = 12.0                       # seconds per chord: very slow, deliberately
    rng = np.random.default_rng(7)

    t_chord = 0.0
    ci = 0
    while t_chord < total_seconds:
        root, triad, weight = PROG[ci % len(PROG)]
        dur = bar * weight
        i0 = int(t_chord * SR)
        ln = min(int((dur + 5.0) * SR), n - i0)     # +5s so the tail overlaps
        if ln <= 0:
            break
        amp = intensity(t_chord)

        # --- pad: triad voiced across two octaves
        pad = np.zeros(ln)
        for oct_ in (3, 4):
            for j, nm in enumerate(triad):
                v = pad_voice(hz(nm, oct_), ln)
                pad += v * (0.9 if oct_ == 3 else 0.55)
        pad *= adsr(ln, 2.6, 2.0, 0.75, 4.5)
        pad = lowpass_sweep(pad, 420 + 700 * amp, 1500 + 2600 * amp)

        # --- sub drone
        sub = np.sin(2 * np.pi * hz(root, 1) * np.arange(ln) / SR)
        sub *= adsr(ln, 1.8, 1.0, 0.85, 3.0) * 0.5

        # --- sparse bell arpeggio, only when the film is open
        arp = np.zeros(ln)
        if amp > 0.5:
            step = 0.75
            k = 0
            while k * step * SR < ln - SR:
                nm = triad[k % 3]
                oc = 5 if (k % 4) < 2 else 6
                s0 = int(k * step * SR)
                sl = min(int(2.6 * SR), ln - s0)
                if sl > 100:
                    tt = np.arange(sl) / SR
                    f = hz(nm, oc)
                    bell = (np.sin(2 * np.pi * f * tt)
                            + 0.35 * np.sin(2 * np.pi * f * 2.01 * tt)
                            + 0.12 * np.sin(2 * np.pi * f * 3.02 * tt))
                    bell *= np.exp(-tt * 1.5) * 0.16 * (0.6 + 0.4 * rng.random())
                    arp[s0:s0 + sl] += bell
                k += 1

        seg = pad * 0.30 * amp + sub * 0.30 * amp + arp * amp
        # slow stereo drift, so the pad never sits still
        pan = 0.5 + 0.18 * np.sin(2 * np.pi * (np.arange(ln) / SR) / 23.0 + ci)
        left[i0:i0 + ln] += seg * (1 - pan)
        right[i0:i0 + ln] += seg * pan

        t_chord += dur
        ci += 1

    ir = reverb_ir()
    wet_l = oaconvolve(left, ir)[:n]
    wet_r = oaconvolve(right, ir)[:n]
    out_l = left * 0.62 + wet_l * 0.85
    out_r = right * 0.62 + wet_r * 0.85

    # gentle fades so nothing clicks at the ends
    fi, fo = int(4 * SR), int(7 * SR)
    out_l[:fi] *= np.linspace(0, 1, fi); out_r[:fi] *= np.linspace(0, 1, fi)
    out_l[-fo:] *= np.linspace(1, 0, fo); out_r[-fo:] *= np.linspace(1, 0, fo)

    st = np.stack([out_l, out_r], axis=1)
    st /= max(1e-9, np.max(np.abs(st))) / 0.89
    return st


if __name__ == '__main__':
    secs = float(sys.argv[1]) if len(sys.argv) > 1 else 30.0
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(SP, 'score_test.wav')
    audio = render(secs)
    from scipy.io import wavfile
    wavfile.write(out, SR, (audio * 32767).astype(np.int16))
    peak = np.max(np.abs(audio))
    rms = np.sqrt(np.mean(audio ** 2))
    print(f"  {out}  {secs:.0f}s  peak {peak:.3f}  rms {rms:.4f}  "
          f"({20*np.log10(rms):.1f} dBFS)")
