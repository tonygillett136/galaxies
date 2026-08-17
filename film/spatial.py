#!/usr/bin/env python3
"""
Spatialisation for the film: binaural stereo, and a 5.1 fold.

THE DESIGN PRINCIPLE, because it decides everything else. A sense of space comes
from a **diffuse, decorrelated reverberant field**, not from panning dry sources
around the listener. Hard-panned dry material announces itself as an effect. A
fairly centred source sitting in a convincing field simply sounds like a place.

So the dry signals stay close to where they were, and almost all of the width
comes from the reverberation: a set of early reflections arriving from scattered
directions, and a late tail built from two INDEPENDENT noise sequences, which is
what makes the tail decorrelated and therefore enveloping rather than merely wide.

MONO COMPATIBILITY IS NOT OPTIONAL. A great many people will hear this on a phone
speaker. Interaural time difference — the main horizontal cue — becomes comb
filtering the moment the two channels are summed. The fix is standard and is
applied here: everything below the crossover stays mono and centred, and ITD is
only applied above it. That also keeps the bass from smearing.

The head model is physical rather than a measured HRTF dataset:

  ITD   Woodworth's spherical-head approximation, dt = (a/c)(theta + sin theta)
  ILD   frequency-dependent shadowing of the far ear, as a one-pole lowpass whose
        corner falls with angle, plus a modest broadband level difference

That is less accurate than a measured HRTF for ELEVATION, which this film does
not use, and close enough for a wide horizontal field. It also has the advantage
of being explainable and testable, which an opaque dataset is not.
"""
import numpy as np
from scipy.signal import butter, sosfilt, oaconvolve, lfilter

SR = 44100
HEAD_R = 0.0875        # metres, standard head radius
C = 343.0              # m/s
XOVER = 250.0          # below this, mono and centred: mono-compatibility


def _split(x, sr=SR, f=XOVER):
    """Low band (kept mono) and high band (spatialised)."""
    lo = sosfilt(butter(4, f, 'lp', fs=sr, output='sos'), x)
    return lo, x - lo


def itd_samples(az_deg, sr=SR):
    """Woodworth. Positive azimuth = to the listener's right."""
    th = np.clip(np.deg2rad(az_deg), -np.pi / 2, np.pi / 2)
    return (HEAD_R / C) * (th + np.sin(th)) * sr


def _frac_delay(x, d):
    """Fractional delay by linear interpolation. d in samples, d >= 0."""
    if d <= 0:
        return x.copy()
    i = int(np.floor(d)); f = d - i
    y = np.zeros_like(x)
    if i + 1 < len(x):
        y[i:] = x[:len(x) - i] * (1 - f)
        y[i + 1:] += x[:len(x) - i - 1] * f
    return y


def _shadow(x, az_deg, ear, sr=SR):
    """
    Head shadowing of the far ear. The corner frequency falls as the source moves
    behind the head; the near ear is left alone.
    """
    # +1 for the right ear, -1 for the left
    facing = np.cos(np.deg2rad(az_deg) - (np.pi / 2) * ear)
    if facing >= 0:
        return x                                  # near ear: unshadowed
    shade = min(1.0, -facing)                     # 0..1
    fc = 12000.0 * (1.0 - 0.86 * shade)           # down to ~1.7 kHz when fully shadowed
    y = sosfilt(butter(2, fc, 'lp', fs=sr, output='sos'), x)
    return y * (1.0 - 0.28 * shade)               # and a modest broadband loss


def binaural(x, az_deg, sr=SR, xover=XOVER):
    """One mono source placed at an azimuth. Returns (L, R)."""
    lo, hi = _split(x, sr, xover)
    d = itd_samples(az_deg, sr)
    # the far ear is delayed; the near ear is not
    if d >= 0:                                     # source to the right
        hiL, hiR = _frac_delay(hi, abs(d)), hi.copy()
    else:
        hiL, hiR = hi.copy(), _frac_delay(hi, abs(d))
    hiL = _shadow(hiL, az_deg, -1, sr)
    hiR = _shadow(hiR, az_deg, +1, sr)
    # the low band stays mono and centred, which is what keeps the fold-down clean
    return lo + hiL, lo + hiR


# --------------------------------------------------------------- reverberation
# A pattern of early reflections. Times in ms, gains, and arrival azimuths.
# Deliberately scattered rather than symmetric: a symmetric pattern collapses to
# the centre and sounds like a plate, not a place.
EARLY = [(11, 0.42, -55), (17, 0.36, 68), (23, 0.30, -110), (29, 0.27, 125),
         (37, 0.24, -34), (43, 0.21, 152), (51, 0.19, -145), (61, 0.17, 41),
         (73, 0.14, -80), (89, 0.12, 100), (107, 0.10, -20), (127, 0.09, 165)]


def diffuse_tail(n, seconds=4.2, sr=SR, seed=0):
    """
    Two INDEPENDENT noise decays, one per ear. Independence is the whole point:
    it is what drives the interaural cross-correlation of the tail towards zero,
    and a low-correlation tail is what the ear reads as envelopment rather than
    as a wide mono source.
    """
    rng = np.random.default_rng(seed)
    m = int(seconds * sr)
    t = np.arange(m) / sr
    env = np.exp(-t * 1.7)
    sos = butter(2, 5200, 'lp', fs=sr, output='sos')
    irs = []
    for _ in range(2):
        ir = sosfilt(sos, rng.standard_normal(m)) * env
        ir[:int(0.028 * sr)] = 0                   # pre-delay: the room starts late
        irs.append(ir / np.max(np.abs(ir)))
    return irs


def reverberate(x, wet=0.34, seconds=4.2, sr=SR, seed=0):
    """Early reflections from scattered directions, plus a decorrelated tail."""
    n = len(x)
    eL = np.zeros(n); eR = np.zeros(n)
    for ms, g, az in EARLY:
        d = int(ms * 1e-3 * sr)
        if d >= n:
            continue
        tap = np.zeros(n); tap[d:] = x[:n - d] * g
        l, r = binaural(tap, az, sr)
        eL += l; eR += r
    irL, irR = diffuse_tail(n, seconds, sr, seed)
    tL = oaconvolve(x, irL)[:n]
    tR = oaconvolve(x, irR)[:n]
    mx = max(np.max(np.abs(tL)), np.max(np.abs(tR)), 1e-9)
    tL /= mx; tR /= mx
    peak = max(np.max(np.abs(x)), 1e-9)
    return (eL * 0.55 + tL * peak) * wet, (eR * 0.55 + tR * peak) * wet


# ------------------------------------------------------------------ measurement
def iacc(L, R, sr=SR, lo=None, hi=None):
    """
    Interaural cross-correlation. 1.0 = identical channels (a point in the middle
    of the head); near 0 = uncorrelated, which is what an enveloping field
    measures. Computed over +/-1 ms, which is the range the ear integrates.
    """
    a, b = np.asarray(L, float), np.asarray(R, float)
    if lo is not None:
        a, b = a[lo:hi], b[lo:hi]
    a = a - a.mean(); b = b - b.mean()
    na, nb = np.sqrt((a ** 2).sum()), np.sqrt((b ** 2).sum())
    if na < 1e-12 or nb < 1e-12:
        return 0.0
    m = int(1e-3 * sr)
    best = 0.0
    for d in range(-m, m + 1):
        s = np.dot(a[max(0, d):len(a) + min(0, d)], b[max(0, -d):len(b) + min(0, -d)])
        best = max(best, abs(s) / (na * nb))
    return float(best)


def mono_penalty(L, R):
    """
    Level lost when the mix is folded to mono, in dB. Phase-cancelling width
    shows up here and nowhere else, and a phone speaker will find it.
    """
    s = 0.5 * (np.asarray(L, float) + np.asarray(R, float))
    ref = np.sqrt(((np.asarray(L, float) ** 2 + np.asarray(R, float) ** 2) / 2).mean())
    got = np.sqrt((s ** 2).mean())
    return 20 * np.log10(max(got, 1e-12) / max(ref, 1e-12))


# ------------------------------------------------------------------------ 5.1
# FL FR FC LFE BL BR, the order ffmpeg expects for a 5.1 layout.
def to_51(buses, placements, lfe_from=('sub', 'drone'), sr=SR):
    """
    Discrete 5.1 placement. Dialogue belongs in FC and nowhere else — it is the
    single biggest intelligibility gain surround offers, and it is why the
    ducking can be gentler here than in the stereo mix.
    """
    n = max(len(v) for v in buses.values())
    ch = {k: np.zeros(n) for k in ('FL', 'FR', 'FC', 'LFE', 'BL', 'BR')}
    for name, x in buses.items():
        x = np.pad(x, (0, n - len(x)))
        p = placements.get(name)
        if p is None:
            continue
        for target, g in p.items():
            ch[target][:len(x)] += x * g
    for name in lfe_from:
        if name in buses:
            x = np.pad(buses[name], (0, n - len(buses[name])))
            ch['LFE'] += sosfilt(butter(4, 110, 'lp', fs=sr, output='sos'), x) * 0.8
    return np.stack([ch['FL'], ch['FR'], ch['FC'], ch['LFE'], ch['BL'], ch['BR']], axis=1)
