#!/usr/bin/env python3
"""
Build the observed-target catalogue for detective mode.

Merges Galaxy Zoo Mergers Table 1 (identity and position) with Table 4 (the
published best-fit encounter parameters) and fetches an SDSS colour cutout for
each system.

Cite Holincheck et al. 2016 (MNRAS 459, 720) for any use of these parameters,
per the data page's requirement. Images are from the SDSS SkyServer cutout
service and carry SDSS's own attribution requirements.

IMPORTANT about Table 4: the Min/Max columns are SEARCH BOUNDS, not credible
intervals (Max mass ratio reaches 889.8). Only the '+-' value is a spread. This
script keeps them in separate fields so they cannot be confused downstream.
"""

import json, os, re, sys, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
GZ = os.path.join(HERE, 'galaxy_zoo_mergers', 'tables')
OUT_JSON = os.path.join(HERE, 'targets', 'targets.json')
IMG_DIR = os.path.join(HERE, 'targets', 'images')


def sex_to_deg_ra(s):
    h, m, sec = [float(x) for x in s.strip().split(':')]
    return 15.0 * (h + m / 60.0 + sec / 3600.0)


def sex_to_deg_dec(s):
    s = s.strip()
    sign = -1.0 if s.startswith('-') else 1.0
    d, m, sec = [float(x) for x in s.lstrip('+-').split(':')]
    return sign * (d + m / 60.0 + sec / 3600.0)


def angular_scale_kpc_per_arcsec(z, H0=70.0, om=0.3):
    """
    kpc per arcsec at redshift z, flat LambdaCDM.

    Done properly rather than with cz/H0 because the whole point of this number
    is to let a simulated kpc be compared against an observed arcsec. If the
    scale is wrong, a visual 'match' is meaningless, and it would be a very
    comfortable kind of wrong: everything would still look plausible.
    """
    if not z or z <= 0:
        return None
    c = 299792.458                       # km/s
    ol = 1.0 - om
    n = 2000
    h = z / n
    total = 0.0
    for i in range(n + 1):
        zi = i * h
        e = (om * (1 + zi) ** 3 + ol) ** 0.5
        w = 1 if i in (0, n) else (4 if i % 2 else 2)
        total += w / e
    dc = (c / H0) * (h / 3.0) * total    # Mpc, comoving (Simpson)
    da = dc / (1.0 + z)                  # Mpc, angular diameter
    return da * 1000.0 * 4.84813681e-6   # kpc per arcsec


def pick_redshift(row, head):
    """
    First usable redshift, preferring spectroscopic over photometric and the
    primary galaxy over the secondary. 0.0 in this table means ABSENT, not z=0,
    and treating it as a measurement would place a galaxy at zero distance.
    """
    def get(name):
        if name not in head:
            return None
        i = head.index(name)
        if i >= len(row):
            return None
        try:
            v = float(row[i])
        except ValueError:
            return None
        return v if v > 1e-5 else None

    for name in ('PRI_DR7_SPECZ', 'PRI_DR8_SPECZ', 'SEC_DR7_SPECZ', 'SEC_DR8_SPECZ'):
        v = get(name)
        if v:
            return v, 'spec'
    for name in ('PRI_DR7_PHOTOZ', 'PRI_DR8_PHOTOZ', 'SEC_DR7_PHOTOZ', 'SEC_DR8_PHOTOZ'):
        v = get(name)
        if v:
            return v, 'photo'
    return None, None


def read_tsv(path):
    with open(path, encoding='utf-8', errors='replace') as f:
        rows = [line.rstrip('\n').split('\t') for line in f if line.strip()]
    head = [h.strip() for h in rows[0]]
    return head, rows[1:]


def parse_pm(cell):
    """'1.167 +- 0.391' -> (1.167, 0.391). Missing spread -> (value, None)."""
    cell = cell.strip()
    m = re.match(r'^([-\d.eE+]+)\s*\+-\s*([-\d.eE+]+)$', cell)
    if m:
        return float(m.group(1)), float(m.group(2))
    try:
        return float(cell), None
    except ValueError:
        return None, None


def main():
    os.makedirs(IMG_DIR, exist_ok=True)

    h1, r1 = read_tsv(os.path.join(GZ, 'table1.txt'))
    h4, r4 = read_tsv(os.path.join(GZ, 'table4.txt'))
    print(f'table1: {len(r1)} rows, table4: {len(r4)} rows')

    # index table4 by short name
    fits = {}
    for r in r4:
        if not r or not r[0].strip():
            continue
        name = r[0].strip()
        get = lambda i: r[i] if i < len(r) else ''
        best_mr, err_mr = parse_pm(get(1))
        rmin, err_rmin = parse_pm(get(4))
        tmin, err_tmin = parse_pm(get(7))
        ecc, err_ecc = parse_pm(get(10))
        beta, err_beta = parse_pm(get(13))
        fits[name] = {
            'massRatio': best_mr, 'massRatio_err': err_mr,
            'rMin_kpc': rmin, 'rMin_err': err_rmin,
            'tMin_Myr': tmin, 'tMin_err': err_tmin,
            'ecc': ecc, 'ecc_err': err_ecc,
            'beta': beta, 'beta_err': err_beta,
            # search bounds kept deliberately separate; these are NOT uncertainties
            'searchBounds': {
                'massRatio': [get(2), get(3)], 'rMin': [get(5), get(6)],
                'tMin': [get(8), get(9)], 'ecc': [get(11), get(12)],
                'beta': [get(14), get(15)],
            },
        }

    # redshifts, for the angular scale that makes an overlay meaningful
    zmap = {}
    zpath = os.path.join(GZ, 'target_sdss_dr7_dr8.txt')
    if os.path.exists(zpath):
        hz, rz = read_tsv(zpath)
        idx = hz.index('SDSSID') if 'SDSSID' in hz else 1
        for r in rz:
            if len(r) > idx:
                z, kind = pick_redshift(r, hz)
                if z:
                    zmap[r[idx].strip()] = (z, kind)
        print(f'redshifts: {len(zmap)} of {len(rz)} rows usable')
    else:
        print('WARNING: no SDSS table; every overlay will be uncalibrated')

    targets = []
    for r in r1:
        if len(r) < 5 or not r[1].strip():
            continue
        name = r[1].strip()
        try:
            ra = sex_to_deg_ra(r[3])
            dec = sex_to_deg_dec(r[4])
        except Exception as e:
            print(f'  skip {name}: bad coords {r[3]!r} {r[4]!r} ({e})')
            continue
        sid = r[2].strip()
        z, zkind = zmap.get(sid, (None, None))
        kpc_per_arcsec = angular_scale_kpc_per_arcsec(z) if z else None
        targets.append({
            'order': int(r[0]) if r[0].strip().isdigit() else None,
            'name': name,
            'sdssId': sid,
            'ra': round(ra, 6), 'dec': round(dec, 6),
            'aliases': (r[5].strip() if len(r) > 5 else ''),
            'fit': fits.get(name),
            'image': f'images/{name.replace(" ", "_")}.jpg',
            'z': z, 'zKind': zkind,
            'kpcPerArcsec': round(kpc_per_arcsec, 5) if kpc_per_arcsec else None,
        })

    missing = [t['name'] for t in targets if not t['fit']]
    print(f'{len(targets)} targets, {len(missing)} without a Table 4 fit'
          + (f': {missing}' if missing else ''))

    # --- fetch cutouts ---
    SCALE = 0.7          # arcsec/pixel -> 512 px = 6.0 arcmin field
    SIZE = 512
    ok = bad = skip = 0
    for t in targets:
        path = os.path.join(HERE, 'targets', t['image'])
        if os.path.exists(path) and os.path.getsize(path) > 5000:
            skip += 1
            continue
        url = (f'https://skyserver.sdss.org/dr18/SkyServerWS/ImgCutout/getjpeg'
               f'?ra={t["ra"]}&dec={t["dec"]}&scale={SCALE}&width={SIZE}&height={SIZE}')
        try:
            with urllib.request.urlopen(url, timeout=45) as resp:
                data = resp.read()
            # validate by content, not by status: a small body is an error page
            if len(data) < 5000 or data[:2] != b'\xff\xd8':
                bad += 1
                print(f'  BAD  {t["name"]}: {len(data)} bytes, not a JPEG')
                continue
            with open(path, 'wb') as f:
                f.write(data)
            ok += 1
            print(f'  ok   {t["name"]:22} {len(data):7d} bytes')
        except Exception as e:
            bad += 1
            print(f'  FAIL {t["name"]}: {e}')
        time.sleep(0.4)      # be polite to a public service

    print(f'images: {ok} fetched, {skip} already present, {bad} failed')

    t_with_img = 0
    for t in targets:
        p = os.path.join(HERE, 'targets', t['image'])
        t['hasImage'] = os.path.exists(p) and os.path.getsize(p) > 5000
        if t['hasImage']:
            t_with_img += 1

    meta = {
        'source': 'Galaxy Zoo: Mergers (Holincheck et al. 2016, MNRAS 459, 720)',
        'imageSource': 'SDSS DR18 SkyServer ImgCutout',
        'cutoutScaleArcsecPerPixel': SCALE,
        'cutoutSizePx': SIZE,
        'note': ('Table 4 Min/Max columns are SEARCH BOUNDS, not credible intervals. '
                 'Only the +- value is a spread.'),
        'count': len(targets), 'withImage': t_with_img,
        'targets': targets,
    }
    with open(OUT_JSON, 'w') as f:
        json.dump(meta, f, indent=1)
    print(f'wrote {OUT_JSON}: {len(targets)} targets, {t_with_img} with images')


if __name__ == '__main__':
    main()
