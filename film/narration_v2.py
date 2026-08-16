#!/usr/bin/env python3
"""
Narration for the three-act cut.

REGISTER. Written towards Attenborough in Life On Earth: warm, clear, and never
talking down. The warmth comes from evident interest in the thing itself, not
from adjectives — so there is no "incredible", no "amazing", and no adverbs doing
the work a fact should do. Technical words are used and explained in passing
rather than avoided. Numbers are made tangible by comparison wherever a
comparison is available, because "closer than the width of either disc" lands and
"twenty five thousand parsecs" does not.

Sentence rhythm matters as much as vocabulary: short declaratives against longer
flowing ones, questions posed and then answered, and the recurring move of
stating something ordinary and then turning it over to show it is not.

WHAT IS NOT HERE. Time reversal has been cut. It is a property of a
time-symmetric integrator, not a fact about galaxies, and it belongs in a film
about the modelling rather than this one.

Every quantity below is measured by the suite. The ones that are cited rather
than measured are marked in film/BEATSHEET.md and must stay hedged.
"""

NARRATION_V2 = [
    # ---------------------------------------------------------------- ACT I
    # 0 — title over real photographs
    ["Look up on a dark night, and the sky seems perfectly still.",
     "It is not."],

    # 1 — real photographs, held long
    ["These are photographs of real galaxies.",
     "Not paintings, and not simulations.",
     "Each one holds a hundred billion stars or more.",
     "And each one is being pulled apart.",
     "Look at those streamers of light.",
     "They run for a hundred thousand light years and further,",
     "longer than the galaxies that shed them.",
     "When astronomers first saw these shapes,",
     "they had no explanation for them at all.",
     "Something was drawing whole galaxies out into ribbons,",
     "and nobody could say what.",
     "So they reached for the most violent things they could imagine.",
     "Magnetic fields. Explosions.",
     "Matter flung out from the hearts of galaxies."],

    # 2 — the control: a live, self-gravitating disc
    ["To find the answer, it helps to begin somewhere quieter.",
     "Here is a galaxy that nothing at all is disturbing.",
     "A hundred and fifty thousand stars,",
     "each one on its own orbit,",
     "held by gravity that is mostly dark matter.",
     "Left alone, it simply turns.",
     "Once around, every quarter of a billion years.",
     "And it does something rather lovely as it does.",
     "Those arms were not drawn in.",
     "They grew.",
     "The disc's own gravity, gathering it into a pattern",
     "that moves through the stars like a wave through water."],

    # ---------------------------------------------------------------- ACT II
    # 3 — prograde
    ["So something must arrive. And here it comes.",
     "Another galaxy, much the same size,",
     "falling inward along a long curve.",
     "They will not collide. They will not even touch.",
     "They will simply pass close by,",
     "closer than either disc is wide.",
     "Watch the near side of each galaxy.",
     "Those stars are already moving",
     "in the direction of the pull,",
     "so they stay in step with it.",
     "And a gentle tug, applied patiently enough,",
     "draws them out, and out, and away.",
     "That is a tidal tail.",
     "Not one star has struck another.",
     "Only one force is at work here, and it is gravity."],

    # 4 — who worked it out
    ["Two brothers worked this out in 1972,",
     "with a computer that had less memory",
     "than the telephone in your pocket.",
     "They gave their stars nothing but gravity."],

    # 5 — retrograde, the control that proves it
    ["And here is the test that settles it.",
     "The same two galaxies, the same orbit,",
     "the same closest approach.",
     "One thing is different:",
     "these discs are turning the other way.",
     "Now those near-side stars move against the pull,",
     "and carry themselves away before it can do much.",
     "Turning with the encounter,",
     "a galaxy throws fifteen per cent of its disc into space.",
     "Turning against it: two and a half.",
     "Reversing the spin spares a galaxy as much",
     "as moving the encounter almost twice as far away."],

    # 6 — geometry: the Mice
    ["Change the angle, and you change everything.",
     "Two long, thin tails, very nearly parallel,",
     "with a bridge of stars strung between them.",
     "There is a real pair that looks just like this,",
     "three hundred million light years away.",
     "Astronomers call them the Mice."],

    # 7 — antennae, out of the plane
    ["Tilt the two discs more steeply,",
     "and the tails leave the orbital plane altogether.",
     "That is what gives these encounters their shape,",
     "and why the real ones look so little like a spiral.",
     "But the stars out there are not lost.",
     "Most are still bound, on long, patient orbits,",
     "and in time a great many of them will come back.",
     "What you are watching is a single passage.",
     "The whole encounter will take billions of years."],

    # 8 — provenance
    ["Colour every star by the galaxy it was born in,",
     "and something becomes clear.",
     "The tails are not shared wreckage.",
     "Each galaxy throws out its own stars,",
     "and the two streams keep largely to themselves.",
     "But look closely at the bridge between them.",
     "A few stars are crossing over.",
     "Some of them will spend the rest of their lives",
     "orbiting a galaxy they were not born in."],

    # 9 — the match cut, back to the real sky
    ["And here is that photograph again,",
     "with the simulation laid over it at the same scale.",
     "The question is which encounter,",
     "at which angle, and how long ago,",
     "produced what the telescope actually saw.",
     "We cannot answer that yet.",
     "Nothing here has been fitted to this image."],

    # ---------------------------------------------------------------- ACT III
    # 10 — the ring
    ["Now aim more carefully.",
     "Send a small companion straight through the middle of a disc.",
     "This time the pull is very nearly symmetric.",
     "So instead of drawing stars out to one side,",
     "it drives a wave outward through the whole disc,",
     "like a stone dropped into still water.",
     "The densest region leaves the centre,",
     "and travels outward, as a ring.",
     "Ring galaxies like the Cartwheel are made this way.",
     "They are rare, because the aim has to be very good indeed."],

    # 11 — the ordinary case
    ["But this is the dramatic case,",
     "and the universe is mostly not dramatic.",
     "Most galaxies are never caught in a great collision.",
     "They are simply being rearranged, quietly,",
     "by companions far smaller than themselves,",
     "across spans of time that make a human life",
     "look like a single photograph.",
     "Our own galaxy is doing it now,",
     "to the small companions that orbit it."],

    # 12 — the merger
    ["And sometimes two galaxies cannot escape one another.",
     "As each moves through the other's halo of dark matter,",
     "it gathers a wake of material behind it,",
     "and that wake pulls back on the galaxy that made it.",
     "Orbital energy drains away into the dark.",
     "The orbit decays.",
     "Every passage is closer than the one before.",
     "After some seventeen hundred million years,",
     "the two centres finally come together.",
     "Two spiral galaxies went in.",
     "What comes out is something else entirely.",
     "The ordered turning has gone.",
     "Where these stars once moved together,",
     "at two hundred kilometres every second,",
     "they now move at random.",
     "And the light changes shape along with them.",
     "A spiral's brightness falls away gently from its centre.",
     "This does not.",
     "It falls away the way an elliptical galaxy's light falls.",
     "This is how the great ellipticals are thought to have been built.",
     "Not as another kind of galaxy,",
     "but as what becomes of spirals that meet.",
     "Though not always. Mergers can leave a disc behind too,",
     "and it is still argued over."],

    # 13 — home
    ["Which brings us home.",
     "Our own galaxy has a large neighbour, Andromeda,",
     "and the two are approaching.",
     "For years we said they would certainly merge,",
     "in about four billion years.",
     "Then the measurements improved.",
     "And with the uncertainties honestly included,",
     "that certainty went away.",
     "The best estimate now is close to even odds,",
     "over the next ten billion years.",
     "We were sure. Then we looked more carefully,",
     "and found that we were not."],

    # 14 — close card
    ["Every interacting pair in the sky",
     "is a single frame from a film",
     "we will never watch to the end.",
     "The only way to see the rest",
     "is to work out the rules and run them.",
     "Gravity, and enough time."],
]

if __name__ == '__main__':
    total = sum(len(s) for s in NARRATION_V2)
    words = sum(len(l.split()) for s in NARRATION_V2 for l in s)
    print(f"  {len(NARRATION_V2)} segments, {total} lines, {words} words")
    print(f"  at 2.4 words/sec that is {words / 2.4 / 60:.1f} minutes of speech")
    longest = max((l for s in NARRATION_V2 for l in s), key=len)
    print(f"  longest line {len(longest)} chars: {longest!r}")
