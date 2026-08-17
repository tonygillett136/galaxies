#!/usr/bin/env python3
"""
Places the score in a space, and the narration in front of it.

THE BRIEF WAS ATMOSPHERE, NOT EFFECTS, and the placements below follow from that:
almost everything sits close to centre, and the width comes from the reverberant
field. The only elements given any real angle are the two halves of the pad — and
those are genuinely different signals, not one signal widened, so the separation
is real rather than a phase trick.

Nothing sweeps, orbits or moves. A documentary score that pans around the
listener draws attention to the mix; one that simply sits in a large room draws
attention to the picture.

The narration stays dead centre with only a trace of room on it. Close-miked
speech with a long tail sounds like a PA system, and intelligibility is the one
thing that must not be traded for atmosphere.
"""
import sys, os, numpy as np, soundfile as sf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score_v3 import render_stems, marks_for, SR
from spatial import binaural, reverberate, iacc, mono_penalty, to_51

SP = os.path.dirname(os.path.abspath(__file__))

#                      azimuth   send to the room
PLACE = {
    'drone':       (   0.0,  0.12),   # the ground: solid, central, barely any room
    'sub':         (   0.0,  0.08),
    'bell':        (   0.0,  0.80),   # the bell's TAIL is where the space comes from
    # +/-70 chosen by measurement, not taste. Interaural cross-correlation over
    # mid-film: +/-32 -> 0.73, +/-50 -> 0.58, +/-70 -> 0.47, +/-85 -> 0.42, while
    # the mono fold-down cost runs -0.67, -1.11, -1.57, -1.85 dB. Good concert
    # halls measure 0.2-0.5, so +/-70 buys a genuinely enveloping field for a
    # fold-down loss that only touches the music - and the narration, which is
    # centred and untouched, actually gains a little separation on a phone.
    'pad_a':       ( -70.0,  0.55),   # the two genuinely decorrelated halves of the
    'pad_b':       ( +70.0,  0.55),   # pad, and the widest thing in the film
    'ostinato':    ( -26.0,  0.50),   # slightly off-centre: symmetry sounds like a plate
    'stringtheme': (  +8.0,  0.65),
    'brass':       ( +15.0,  0.55),
}

# 5.1: dialogue to FC alone, which is most of what surround is actually for.
PLACE_51 = {
    'drone':       {'FC': 0.5, 'FL': 0.35, 'FR': 0.35},
    'sub':         {'FC': 0.5, 'FL': 0.35, 'FR': 0.35},
    'bell':        {'FC': 0.55, 'FL': 0.3, 'FR': 0.3, 'BL': 0.22, 'BR': 0.22},
    'pad_a':       {'FL': 0.7, 'BL': 0.55, 'FC': 0.12},
    'pad_b':       {'FR': 0.7, 'BR': 0.55, 'FC': 0.12},
    'ostinato':    {'FL': 0.5, 'BL': 0.35, 'FR': 0.2},
    'stringtheme': {'FL': 0.5, 'FR': 0.5, 'FC': 0.25, 'BL': 0.2, 'BR': 0.2},
    'brass':       {'FL': 0.45, 'FR': 0.55, 'FC': 0.3},
}


def main():
    total = float(sys.argv[1]) if len(sys.argv) > 1 else 525.0
    print(f"  rendering stems for {total:.0f}s")
    B = render_stems(total, marks_for(total))
    n = len(next(iter(B.values())))

    print("  placing")
    dryL = np.zeros(n); dryR = np.zeros(n); send = np.zeros(n)
    for name, x in B.items():
        az, wet = PLACE[name]
        l, r = binaural(x, az)
        dryL += l; dryR += r
        send += x * wet

    print("  reverberating (one shared room: they are all in the same place)")
    wetL, wetR = reverberate(send, wet=1.0, seconds=4.6, seed=17)

    L = dryL + wetL * 0.62
    R = dryR + wetR * 0.62
    pk = max(np.abs(L).max(), np.abs(R).max(), 1e-9)
    L, R = L / pk * 0.89, R / pk * 0.89
    st = np.stack([L, R], axis=1)
    sf.write(os.path.join(SP, 'score_spatial.wav'), st, SR, subtype='PCM_24')

    # ---- narration: centre, and only a breath of the same room
    npath = os.path.join(SP, 'narration.wav')
    if os.path.exists(npath):
        nar, nsr = sf.read(npath)
        if nar.ndim > 1:
            nar = nar.mean(1)
        if len(nar) < n:
            nar = np.pad(nar, (0, n - len(nar)))
        nar = nar[:n]
        nwL, nwR = reverberate(nar, wet=1.0, seconds=2.4, seed=5)
        nL = nar + nwL * 0.055
        nR = nar + nwR * 0.055
        p = max(np.abs(nL).max(), np.abs(nR).max(), 1e-9)
        sf.write(os.path.join(SP, 'narration_spatial.wav'),
                 np.stack([nL / p * 0.82, nR / p * 0.82], axis=1), SR, subtype='PCM_24')
        print("  narration placed centre with a trace of room")

    # ---- 5.1
    print("  5.1 fold")
    six = to_51(B, PLACE_51)
    six = six / max(np.abs(six).max(), 1e-9) * 0.85
    sf.write(os.path.join(SP, 'score_51.wav'), six, SR, subtype='PCM_24')

    # ---- measurement, because a spatial claim needs one
    print("\n  MEASURED")
    seg = slice(int(total * 0.35 * SR), int(total * 0.45 * SR))   # mid-Act II
    print(f"    score IACC (mid-film)        {iacc(L, R, lo=seg.start, hi=seg.stop):.3f}"
          "   (low = enveloping)")
    print(f"    score mono fold-down         {mono_penalty(L, R):+.2f} dB")
    if os.path.exists(npath):
        print(f"    narration IACC               {iacc(nL, nR):.3f}   (high = centred and stable)")
        print(f"    narration mono fold-down     {mono_penalty(nL, nR):+.2f} dB")
    print(f"    5.1 channel rms, dBFS:")
    for i, name in enumerate(('FL', 'FR', 'FC', 'LFE', 'BL', 'BR')):
        r = np.sqrt((six[:, i] ** 2).mean())
        print(f"      {name:4s} {20*np.log10(max(r,1e-9)):7.1f}")


main()
