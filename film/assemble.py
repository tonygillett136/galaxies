#!/usr/bin/env python3
"""
Assemble the 4K60 showcase.

Two things changed from the 1080p cut, and both simplify it:

  * The footage comes from an offline renderer rather than a screen recorder,
    so every clip is clean from frame zero. All the start-detection machinery
    that the recorder needed (and that put the merger twenty seconds early) is
    gone.

  * Close-ups are cut into their wide shot at matching epochs. The close-up was
    rendered with the SAME steps-per-frame as the wide it interrupts, so the
    simulation clock runs at the same rate through the cut and it reads as a
    camera move rather than a jump in time.

The timeline is still computed once, and the video, the subtitles and the
chapter markers are all derived from that single object.
"""
import json, os, subprocess, sys, glob

SP = os.path.dirname(os.path.abspath(__file__))
FILM = os.path.join(SP, 'film4k')
WORK = './work'
FONT = '/System/Library/Fonts/Supplemental/Arial.ttf'
FONTB = '/System/Library/Fonts/Supplemental/Arial Bold.ttf'
W, H, FPS = 3840, 2160, 60
XF = 1.0            # dissolve between scenes
CU_XF = 0.45        # dissolve into and out of a close-up: shorter, less showy
os.makedirs(WORK, exist_ok=True)

# Wide shots, matching batch4k.sh. Close-ups name the epoch window they replace.
SHOTS = {
    'discs':      dict(t0=-45, t1=-44,  secs=17),
    'prograde':   dict(t0=-45, t1=95,   secs=48, cu=('cu_prograde', 6, 26)),
    'retrograde': dict(t0=-45, t1=95,   secs=34),
    'mice':       dict(t0=-38, t1=105,  secs=44, cu=('cu_mice', 22, 42)),
    'antennae':   dict(t0=-50, t1=115,  secs=52, cu=('cu_antennae', 32, 57)),
    'provenance': dict(t0=-50, t1=110,  secs=34),
    'ring':       dict(t0=-34, t1=95,   secs=44, cu=('cu_ring', 4, 24)),
    'minor':      dict(t0=-42, t1=100,  secs=46),
    'merger':     dict(t0=-60, t1=420,  secs=64, cu=('cu_merger', 300, 360)),
    'reversal':   dict(t0=-45, t1=45,   secs=40),
    'detect':     dict(t0=60,  t1=110,  secs=28),
}


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write(' '.join(cmd[:8]) + ' ...\n' + r.stderr[-1800:] + '\n')
        raise SystemExit(1)
    return r


def dur(f):
    return float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                      '-of', 'default=nw=1:nk=1', f]).stdout.strip())


def esc(p):
    return p.replace(':', r'\:').replace("'", r"\'")


def fade_alpha(t_in, hold, t_out=0.9):
    a, b = t_in, t_in + 0.9
    c, d = t_in + 0.9 + hold, t_in + 0.9 + hold + t_out
    return (f"if(lt(t,{a}),0,if(lt(t,{b}),(t-{a})/0.9,"
            f"if(lt(t,{c}),1,if(lt(t,{d}),({d}-t)/{t_out},0))))")


def tf(name, s):
    p = os.path.join(WORK, name)
    open(p, 'w').write(s)
    return p


def compose_scene(sid, idx):
    """The scene's pictures: wide, or wide with a close-up cut into it."""
    wide = os.path.join(FILM, f'{sid}.mp4')
    sh = SHOTS[sid]
    out = os.path.join(WORK, f'raw{idx:02d}.mp4')
    if 'cu' not in sh or not os.path.exists(os.path.join(FILM, sh['cu'][0] + '.mp4')):
        return wide, dur(wide)

    cu_name, ta, tb = sh['cu']
    cu = os.path.join(FILM, cu_name + '.mp4')
    D = dur(wide)
    # where those epochs fall in the wide shot: the clock is linear in frame index
    cut_in = (ta - sh['t0']) / (sh['t1'] - sh['t0']) * D
    cut_out = (tb - sh['t0']) / (sh['t1'] - sh['t0']) * D
    a_len, b_start = cut_in, cut_out
    b_len = D - b_start
    cu_len = dur(cu)

    fc = (f"[0:v]trim=0:{a_len:.3f},setpts=PTS-STARTPTS[a];"
          f"[2:v]trim={b_start:.3f}:{D:.3f},setpts=PTS-STARTPTS[b];"
          f"[a][1:v]xfade=transition=fade:duration={CU_XF}:offset={a_len - CU_XF:.3f}[ac];"
          f"[ac][b]xfade=transition=fade:duration={CU_XF}:"
          f"offset={a_len - CU_XF + cu_len - CU_XF:.3f}[v]")
    p = os.path.join(WORK, f'fc{idx}.txt'); open(p, 'w').write(fc)
    run(['ffmpeg', '-v', 'error', '-y', '-i', wide, '-i', cu, '-i', wide,
         '-/filter_complex', p, '-map', '[v]', '-c:v', 'libx264', '-crf', '16',
         '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', str(FPS), out])
    return out, dur(out)


def build_segment(seg, idx):
    out = os.path.join(WORK, f'seg{idx:02d}.mp4')
    if seg.get('kind') == 'card':
        d = seg['duration']
        t1, t2 = tf(f'c{idx}a.txt', seg['title']), tf(f'c{idx}b.txt', seg['sub'])
        vf = (f"drawtext=fontfile={esc(FONTB)}:textfile={esc(t1)}:x=(w-text_w)/2:y=h/2-140:"
              f"fontsize=152:fontcolor=white:alpha='{fade_alpha(0.8, d-3.4)}',"
              f"drawtext=fontfile={esc(FONT)}:textfile={esc(t2)}:x=(w-text_w)/2:y=h/2+80:"
              f"fontsize=60:fontcolor=0x9AA6BC:alpha='{fade_alpha(1.4, d-4.4)}'")
        run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi',
             '-i', f'color=c=0x05060A:s={W}x{H}:d={d}:r={FPS}', '-vf', vf,
             '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', out])
        return out

    src = seg['_pic']
    t1, t2 = tf(f's{idx}a.txt', seg['title']), tf(f's{idx}b.txt', seg['params'])
    # No scrim. A drawbox has no alpha expression, so the tinted bar the first
    # cut used stayed for the whole segment while the type it existed for faded
    # after seven seconds. The type carries its own shadow instead.
    sh = "shadowcolor=black@0.9:shadowx=4:shadowy=4:borderw=2:bordercolor=black@0.35"
    vf = (f"drawtext=fontfile={esc(FONTB)}:textfile={esc(t1)}:x=192:y=h-372:"
          f"fontsize=104:fontcolor=white:{sh}:alpha='{fade_alpha(1.0, 5.2)}',"
          f"drawtext=fontfile={esc(FONT)}:textfile={esc(t2)}:x=196:y=h-232:"
          f"fontsize=50:fontcolor=0xB8C2D6:{sh}:alpha='{fade_alpha(1.5, 5.2)}'")
    run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-vf', vf, '-c:v', 'libx264',
         '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-an', out])
    return out


def srt_time(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f'{h:02d}:{m:02d}:{s:06.3f}'.replace('.', ',')


def main():
    segs = json.load(open(os.path.join(SP, 'script.json')))['segments']
    for i, s in enumerate(segs):
        if s.get('kind') == 'card':
            s['duration'] = s['seconds']; continue
        pic, d = compose_scene(s['clip'], i)
        s['_pic'], s['duration'] = pic, round(d, 3)
        cu = ' + close-up' if 'cu' in SHOTS[s['clip']] else ''
        print(f"  {s['id']:<11} {d:6.1f}s{cu}")

    t = 0.0
    for i, s in enumerate(segs):
        s['tl_in'] = t
        t += s['duration'] - (XF if i < len(segs) - 1 else 0)
    print(f"\n  total {t/60:.1f} min ({t:.0f}s) at {W}x{H} {FPS}fps\n")

    files = [build_segment(s, i) for i, s in enumerate(segs)]
    inputs = []
    for f in files:
        inputs += ['-i', f]
    parts, prev, acc = [], '0:v', segs[0]['duration']
    for i in range(1, len(files)):
        off = acc - XF
        parts.append(f"[{prev}][{i}:v]xfade=transition=fade:duration={XF}:offset={off:.3f}[x{i}]")
        prev, acc = f'x{i}', off + segs[i]['duration']
    p = os.path.join(WORK, 'chain.txt'); open(p, 'w').write(';'.join(parts))
    outv = os.path.join(SP, 'galaxies_showcase_4k60.mp4')
    run(['ffmpeg', '-v', 'warning', '-y'] + inputs + ['-/filter_complex', p, '-map', f'[{prev}]',
        '-r', str(FPS), '-c:v', 'libx264', '-crf', '17', '-preset', 'slow',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outv])

    cues, n = [], 1
    for s in segs:
        lines = s.get('lines') or []
        if not lines: continue
        lead = 2.2 if s.get('kind') != 'card' else 1.6
        span = max(4.0, s['duration'] - lead - 1.2)
        MIN, MAX = 1.45, 6.0
        wts = [max(12, len(x)) for x in lines]; tot = sum(wts)
        ds = [min(MAX, max(MIN, span * (w / tot))) for w in wts]
        c = s['tl_in'] + lead
        for line, d in zip(lines, ds):
            cues.append((n, c, c + d - 0.14, line)); c += d; n += 1
    open(os.path.join(SP, 'galaxies_showcase_4k60.srt'), 'w').write(''.join(
        f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{x}\n\n" for i, a, b, x in cues))

    def stamp(x): return f'{int(x//60)}:{int(x%60):02d}'
    ch = []
    for i, s in enumerate(segs):
        nm = s.get('title') if s.get('kind') != 'card' else ('Introduction' if i == 0 else 'Where to find it')
        ch.append(f"{stamp(0 if i == 0 else s['tl_in'] + 1.0)} {nm}")
    open(os.path.join(SP, 'youtube_chapters.txt'), 'w').write('\n'.join(ch) + '\n')
    print(f"  video     {outv}\n  subtitles {len(cues)} cues\n  chapters  {len(ch)}")


main()
