#!/usr/bin/env python3
"""
The score again, but emitted as DISCRETE BUSES rather than summed to mono.

Nothing about the composition changes — the instruments, the theme, the harmony
and the structural marks are imported unchanged from score_v2. The only
difference is that each element lands in its own buffer, so it can be placed in
a space afterwards. Summing first and panning later throws away exactly the
information spatialisation needs.
"""
import numpy as np, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score_v2 import (SR, hz, adsr, bell, strings, pluck, sub, brass,
                      lowpass_sweep, place, THEME, BEAT)

SP = os.path.dirname(os.path.abspath(__file__))

BUSES = ('drone', 'bell', 'pad_a', 'pad_b', 'sub', 'ostinato', 'stringtheme', 'brass')


def theme_to(dst, at, octave, voice, gain, beat=BEAT, transpose=0, hold=1.0):
    for i, (nm, o) in enumerate(THEME):
        f = hz(nm, octave + o) * 2 ** (transpose / 12.0)
        n = int(beat * hold * 1.35 * SR)
        place(dst, voice(f, n), at + i * beat, gain)


def chord_to(B, at, secs, root, notes, octave, gain, sweep=(500, 2200)):
    """Pad and its root go to SEPARATE buses: the pad wants width, the root must
    stay centred and mono or the low end smears and the fold-down suffers.

    The pad itself is split across TWO buses by alternating its voices. Those
    voices already carry independent random phases, so the two halves are
    genuinely decorrelated signals rather than the same signal put through a
    phase trick. That is real width, and unlike a widener it survives a fold to
    mono."""
    n = int((secs + 3.5) * SR)
    half = {'a': np.zeros(n), 'b': np.zeros(n)}
    i = 0
    for oc in (octave, octave + 1):
        for nm in notes:
            v = strings(hz(nm, oc), n) * (1.0 if oc == octave else 0.55)
            half['a' if i % 2 == 0 else 'b'] += v
            i += 1
    env = adsr(n, 2.4, 1.8, 0.78, 3.2)
    for k, dst in (('a', 'pad_a'), ('b', 'pad_b')):
        place(B[dst], lowpass_sweep(half[k] * env, *sweep), at, gain * 0.30 * 1.4)
    sub_dst = B['sub']
    place(sub_dst, sub(hz(root, 1), n) * adsr(n, 1.6, 1.0, 0.85, 2.8), at, gain * 0.26)


def render_stems(total, marks):
    n = int(total * SR)
    B = {k: np.zeros(n) for k in BUSES}
    A1, A2, A3, CODA = marks['act1'], marks['act2'], marks['act3'], marks['coda']
    HUSH1, HUSH2 = marks['hush1'], marks['hush2']

    # ---- ACT I
    m = int((A2 - 0) * SR)
    place(B['drone'], sub(hz('D', 1), m) * adsr(m, 6, 4, 0.55, 8), 0, 0.20)
    theme_to(B['bell'], A1, 4, bell, 0.34)
    theme_to(B['bell'], A1 + 6 * BEAT + 2.5, 5, bell, 0.16)

    # ---- ACT II
    prog = [('D', ['D', 'F', 'A']), ('A#', ['A#', 'D', 'F']),
            ('F', ['F', 'A', 'C']), ('C', ['C', 'E', 'G'])]
    t, ci = A2 - 2.5, 0
    while t < A3 - 1:
        root, notes = prog[ci % 4]
        chord_to(B, t, 11.0, root, notes, 3, 0.85)
        for k in range(int(11.0 / 1.55)):
            place(B['ostinato'], pluck(hz(notes[k % 3], 5), int(1.5 * SR)),
                  t + 0.8 + k * 1.55, 0.085)
        t += 11.0; ci += 1
    theme_to(B['stringtheme'], A2 + 6.0, 4,
             lambda f, nn: strings(f, nn) * adsr(nn, 0.5, 1.2, 0.7, 1.6), 0.20)
    theme_to(B['stringtheme'], A2 + (A3 - A2) * 0.55, 4,
             lambda f, nn: strings(f, nn) * adsr(nn, 0.6, 1.4, 0.7, 1.8), 0.17, transpose=5)

    # ---- ACT III
    prog3 = [('D', ['D', 'F', 'A']), ('G', ['G', 'A#', 'D']),
             ('A#', ['A#', 'D', 'F']), ('F', ['F', 'A', 'C'])]
    t, ci = A3, 0
    while t < CODA - 1:
        if HUSH1 - 0.5 < t < HUSH1 + 4.5:
            t += 4.0; continue
        root, notes = prog3[ci % 4]
        chord_to(B, t, 12.0, root, notes, 3, 1.0, sweep=(420, 2600))
        t += 12.0; ci += 1
    theme_to(B['stringtheme'], A3 + 4, 2,
             lambda f, nn: strings(f, nn) * adsr(nn, 1.4, 1.6, 0.75, 2.4), 0.22, beat=BEAT * 1.6)
    place(B['brass'], brass(hz('D', 3), int(9 * SR)), HUSH1 + 4.6, 0.20)
    place(B['brass'], brass(hz('A', 3), int(9 * SR)), HUSH1 + 6.2, 0.14)

    # ---- CODA
    chord_to(B, CODA, 16.0, 'D', ['D', 'F#', 'A'], 3, 0.75, sweep=(600, 2000))
    theme_to(B['bell'], CODA + 1.5, 4, bell, 0.30)

    # the two deliberate silences, carved from every bus alike
    for h, w in ((HUSH1, 3.4), (HUSH2, 2.6)):
        s0, s1 = int(h * SR), int((h + w) * SR)
        ramp = np.ones(s1 - s0); f = int(0.5 * SR)
        ramp[:f] = np.linspace(1, 0.04, f); ramp[-f:] = np.linspace(0.04, 1, f)
        ramp[f:-f] = 0.04
        for k in B:
            B[k][s0:s1] *= ramp
    return B


def marks_for(total):
    return dict(act1=6.0, act2=total * 0.185, act3=total * 0.60,
                coda=total * 0.905, hush1=total * 0.735, hush2=total * 0.885)


if __name__ == '__main__':
    total = float(sys.argv[1]) if len(sys.argv) > 1 else 525.0
    B = render_stems(total, marks_for(total))
    for k, v in B.items():
        r = np.sqrt((v ** 2).mean())
        print(f"  {k:<12} peak {np.abs(v).max():.4f}  rms {20*np.log10(max(r,1e-9)):7.1f} dBFS")
