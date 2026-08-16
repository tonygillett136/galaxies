#!/usr/bin/env python3
"""
Documentary narration track.

Timings come from the finished segment files, not from a re-estimate, so the
cues cannot drift against the cut. The script also reports the speaking rate it
implies for each segment: narration that needs more than about 2.6 words per
second is too dense to read, and saying so here beats discovering it on YouTube.
"""
import os, subprocess, json

SP = os.path.dirname(os.path.abspath(__file__))
WORK = './work'
XF = 1.0

# One entry per segment, in order. Each is a list of subtitle-sized lines.
NARRATION = [
    # 0 title card
    ["Two galaxies, gravity, and nothing else."],
    # 1 the control
    ["A galaxy at rest.",
     "A hundred and fifty thousand stars,",
     "each on its own orbit,",
     "held by gravity that is mostly dark matter.",
     "Undisturbed, it will simply turn,",
     "as it has for ten billion years."],
    # 2 prograde
    ["Now give it a companion.",
     "An equal mass, falling in along a parabola,",
     "passing at twenty five thousand parsecs.",
     "That is close. Each disc is about that wide itself.",
     "Watch the near side of each galaxy.",
     "Those stars are already moving",
     "in the direction the companion is pulling them.",
     "They stay in step with that pull,",
     "and so they keep being drawn outward,",
     "further, and further away.",
     "That is a tidal tail.",
     "Nothing exploded, nothing collided, the stars never touch.",
     "Only one force is at work here: gravity.",
     "Toomre and Toomre showed this",
     "in nineteen seventy two.",
     "Until then we had reached for magnetic fields,",
     "and for explosions."],
    # 3 retrograde
    ["The same two galaxies. The same orbit.",
     "The same closest approach.",
     "One thing is different.",
     "These discs are turning the other way.",
     "Stars orbiting against the companion's pull",
     "feel it reverse before it can do much with them.",
     "Turning with the encounter,",
     "a galaxy throws fifteen per cent of its disc",
     "beyond twenty thousand parsecs.",
     "Turning against it, two and a half.",
     "Reversing the spin spares the galaxy as much",
     "as moving the whole encounter",
     "almost twice as far away."],
    # 4 mice
    ["A closer pass, and both discs gently inclined.",
     "Two long, thin, almost parallel tails,",
     "and a bridge of stars strung between them.",
     "There is a real pair that looks like this,",
     "three hundred million light years away.",
     "We call them the Mice.",
     "The tails are what remains",
     "of two ordinary spiral galaxies,",
     "caught in the act of ruining one another."],
    # 5 antennae
    ["Sixteen thousand parsecs, on a bound orbit,",
     "with both discs steeply inclined",
     "to the plane they travel in.",
     "Now the tails leave that plane altogether.",
     "That is what gives these encounters their shape,",
     "and why the real ones look so unlike a spiral.",
     "The stars out there are not lost.",
     "Most are still bound, on long, patient orbits,",
     "and in time a great many will return.",
     "What you are watching is a single passage.",
     "The encounter itself will take billions of years."],
    # 6 provenance
    ["The same encounter, with every star coloured",
     "by the galaxy it was born in.",
     "The tails are not shared wreckage.",
     "Each galaxy throws out its own stars,",
     "and the two streams keep largely to themselves.",
     "A little does cross over.",
     "Somewhere in that thin bridge of light,",
     "stars are changing hands,",
     "and some will finish their lives",
     "orbiting a galaxy they were not born in."],
    # 7 ring
    ["Now send a smaller companion",
     "almost exactly through the centre of the disc.",
     "The pull is nearly symmetric this time.",
     "So instead of drawing stars out to one side,",
     "it drives a wave outward through the whole disc,",
     "like a stone dropped into still water.",
     "The densest region leaves the centre",
     "and travels outward, as a ring.",
     "The density there rises three and a half times.",
     "Ring galaxies like the Cartwheel are made this way.",
     "They are rare, because the aim must be very good."],
    # 8 minor
    ["A companion at one tenth of the mass,",
     "on an orbit that will bring it back.",
     "Even a small visitor raises a warp, and a tail.",
     "It simply takes longer,",
     "and asks less of the galaxy each time it passes.",
     "This is the ordinary case.",
     "Most galaxies are not caught in great collisions.",
     "They are being quietly rearranged",
     "by companions far smaller than themselves,",
     "across spans of time that make a human life",
     "look like a single photograph.",
     "Our own galaxy is doing this now,",
     "to the small companions that orbit it."],
    # 9 merger
    ["This time the galaxies will not escape each other.",
     "As each moves through the other's halo of dark matter,",
     "it leaves a wake of gathered mass behind it,",
     "and that wake pulls back on the galaxy that made it.",
     "We do not simulate the wake itself.",
     "We put in the pull that it makes.",
     "Orbital energy drains away into the dark.",
     "The orbit decays.",
     "Every passage is closer than the one before.",
     "The first brings them to within",
     "twenty nine thousand parsecs.",
     "Then closer. Then closer still.",
     "After seventeen hundred million years,",
     "the two centres are within five thousand parsecs,",
     "deep inside what is left of both discs.",
     "Two galaxies went in.",
     "What emerges looks like a single slow-turning cloud.",
     "But the memory of the two spirals is still in there,",
     "written into the orbits of the stars.",
     "This is how the great elliptical galaxies",
     "are thought to have been built."],
    # 10 reversal
    ["Gravity has a curious property.",
     "Run the clock backwards, and it works just as well.",
     "Not the drag we just watched.",
     "That only runs one way.",
     "It is why a merger cannot be undone.",
     "But this encounter is reversible.",
     "The tail forms. Then time reverses.",
     "This is not the film played backwards.",
     "The same equations are being solved,",
     "with time itself given a negative sign,",
     "and every star retraces its own path,",
     "back to where it began.",
     "The universe, at least in this respect,",
     "does not care which way the clock runs."],
    # 11 detect
    ["Finally, a real observation.",
     "A photograph of two real galaxies.",
     "The simulation is laid over it, at the true scale.",
     "The question is which encounter",
     "produced what the telescope actually saw.",
     "We cannot answer that yet.",
     "Nothing here was fitted to this image.",
     "Every interacting pair in the sky",
     "is a single frame from a film",
     "we will never watch to the end."],
    # 12 close card
    ["Gravity, and enough time.",
     "That is all it takes.",
     "You can run every one of these yourself."],
]


def dur(f):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries',
                                 'format=duration', '-of', 'default=nw=1:nk=1', f],
                                capture_output=True, text=True).stdout.strip())


def srt_time(t):
    h = int(t // 3600); m = int((t % 3600) // 60); s = t % 60
    return f'{h:02d}:{m:02d}:{s:06.3f}'.replace('.', ',')


# The segment renders are large and transient; the words get revised long after
# they are gone. Measure them when they exist, and otherwise fall back to the
# cached durations, which were recovered from the shipped cut and reproduce its
# 459.6s total exactly. Rewriting a line must never silently retime the picture.
_cache = os.path.join(SP, 'segment_durations.json')
if all(os.path.exists(f'{WORK}/seg{i:02d}.mp4') for i in range(13)):
    durs = [dur(f'{WORK}/seg{i:02d}.mp4') for i in range(13)]
    json.dump(durs, open(_cache, 'w'), indent=1)
    print('  segment durations measured from the renders')
else:
    durs = json.load(open(_cache))
    print(f'  renders absent; using cached durations ({sum(durs) - XF * 12:.1f}s cut)')
tl, t = [], 0.0
for i, d in enumerate(durs):
    tl.append(t)
    t += d - (XF if i < len(durs) - 1 else 0)
total = t

cues, n, warn = [], 1, []
for i, lines in enumerate(NARRATION):
    if not lines:
        continue
    lead = 1.6 if i in (0, 12) else 2.2
    span = max(4.0, durs[i] - lead - 1.0)
    words = sum(len(x.split()) for x in lines)
    rate = words / span
    if rate > 2.65:
        warn.append(f"segment {i}: {rate:.2f} words/sec over {span:.0f}s ({words} words)")
    MIN, MAX = 1.35, 6.0
    # Speaking a line costs a fixed amount (onset, breath, the pause after it)
    # plus a per-character amount. Weighting purely by length therefore starves
    # short lines: "The stars never touch." was given 1.38s and needs 1.49s,
    # while long lines sat on slack. An affine weight spreads that fixed cost
    # properly and clears the collisions without changing a word.
    wts = [20 + len(x) for x in lines]
    tot = sum(wts)
    ds = [min(MAX, max(MIN, span * (w / tot))) for w in wts]
    c = tl[i] + lead
    for line, d in zip(lines, ds):
        cues.append((n, c, c + d - 0.12, line)); c += d; n += 1

out = os.path.join(SP, 'galaxies_showcase_4k60.srt')
with open(out, 'w') as f:
    for k, a, b, txt in cues:
        f.write(f"{k}\n{srt_time(a)} --> {srt_time(b)}\n{txt}\n\n")

longest = max(len(x) for _, _, _, x in cues)
shortest = min(b - a for _, a, b, _ in cues)
overlaps = sum(1 for k in range(len(cues) - 1) if cues[k][2] > cues[k + 1][1] + 0.01)
print(f"  {len(cues)} cues, {sum(len(x.split()) for _,_,_,x in cues)} words")
print(f"  longest line {longest} chars | shortest cue {shortest:.2f}s | overlaps {overlaps}")
print(f"  last cue ends {cues[-1][2]:.1f}s of {total:.1f}s")
print("  pacing warnings: " + ("; ".join(warn) if warn else "none"))
print(f"  written to {out}")
