# Phase 2 — self-gravity, three acts, motion blur

Written 2026-08-16. Main build session: **Friday 2026-08-21, overnight.**

Agreed order, and it is an order of dependency rather than preference:
**self-gravity → three-act restructure → motion blur.** The first makes the
story true, the second makes it a film, the third makes it look like one. Each is
independently worth having if we stop after it.

---

## 1. Self-gravity

### Why this and not something cheaper

Every particle today is a massless test particle in a rigid analytic potential.
Nothing feels anything else. That one fact caps almost everything we want:

| Wanted | Blocked by | Unblocked by self-gravity |
|---|---|---|
| Spiral arms, bars, growing warps | collective, needs mutual force | they **grow on their own** |
| "This is how ellipticals were built" | remnant is a cloud of test particles | measure the remnant's profile against r¼ |
| Honest dynamical friction | analytic Chandrasekhar drag on centres | the wake is real, the disclaimer goes |
| Discs that do not start perfect | rigid potential permits perfection | a live disc is never perfect for long |

The narration line this buys is the one no amount of writing can fake:
**"We did not put the spiral arms in. They grew."**

### Solver choice: direct N², and the reason is measurement

`bench/RESULTS.md` already contains the number that decides this. Direct
all-pairs self-gravity on this M4 saturates at **1.16e11 pair-interactions/s**
(run A, idle machine, 2026-08-14). Everything below follows from it.

**Interactive tier**, sharing a 16.67 ms frame with the renderer:

| physics budget | N at 60 fps |
|---|---|
| 8 ms (renderer gets the rest) | ~30,000 |
| 16.7 ms (physics only) | ~44,000 |

**Film tier**, offline, no frame budget:

| N | ms/step | 2 steps/frame × 27,576 frames |
|---|---|---|
| 100k | 86 | 1.3 h |
| 150k | 194 | **3.0 h** |
| 200k | 345 | 5.3 h |
| 300k | 776 | 11.9 h |

Direct N² wins for Friday because it is **exact** — no opening angle, no grid
resolution, no tree to build — and because the kernel already exists and is
already benchmarked. Barnes-Hut is O(N log N) and would carry 300k–1M, but it
needs Morton codes, a GPU radix sort and an LBVH build, and every one of those is
a way to lose a night. It is the optimisation *after* this works, not the way in.

Particle-mesh was considered and rejected for now on resolution, not memory:
device limits measured today are `maxBufferSize` and
`maxStorageBufferBindingSize` both **4 GiB**, so even a 512³ field (512 MiB)
fits comfortably. But a 512³ grid over the ~400 kpc box these encounters need is
0.78 kpc per cell against a 3 kpc disc scale length and a far smaller bulge. The
bulge would be unresolved. Adaptive resolution is the point of a tree, and a grid
does not have it.

**Decision: direct N² for both tiers. Revisit Barnes-Hut only if N becomes the
binding constraint on the film.**

### The hard part is the initial conditions, as always

Two traps, both of which produce a galaxy that looks entirely plausible while
being wrong. CLAUDE.md names this failure mode and it will present here.

**Trap 1 — double-counted disc mass.** The shipped potential is a composite:
Hernquist bulge 1.42%, Plummer disc 4.69%, Hernquist halo 93.9%. If the disc
particles become live and carry mass, the rigid potential **must drop its Plummer
disc component**, and the live particles must sum to exactly that mass. Miss
this and the disc sits in 2x its own gravity, contracts, and looks like a
perfectly nice compact galaxy.

Then the circular velocity has to be recomputed from (rigid bulge + rigid halo +
**live disc**), and the live disc's own contribution to v_circ is not the Plummer
term it replaces. For an exponential disc there is an analytic result
(Freeman 1970, in Bessel functions) — use it, and assert against it.

**Trap 2 — Toomre Q is the dial the whole result hangs on.**

    Q = σ_R κ / (3.36 G Σ)

- Q < 1 → the disc fragments violently. Spectacular and wrong.
- Q ≈ 1.2–1.5 → flocculent spiral arms grow. **This is the target.**
- Q > 2 → featureless. No arms, and the headline line is unearned.

Q must be **swept**, not chosen. It is a silent knob in exactly the sense the
project's own check table describes, and "the arms appeared" is not evidence that
Q was right — it is evidence that Q was below about 2.

### Staging, so Friday cannot fail outright

- **Stage 1 — live disc and bulge, rigid halo.** Gets spiral arms and bars, which
  is the entire visual and narrative payoff. Keeps the analytic Chandrasekhar
  drag, so the film's "we do not simulate the wake" line stays. Lower risk.
- **Stage 2 — live halo as well.** Gets genuine dynamical friction and retires the
  disclaimer. Higher risk, and the reason is mass resolution: the halo is 93.9% of
  the mass, so at a 150k budget split 90k halo / 50k disc / 10k bulge, each halo
  particle is **~11x heavier** than a disc particle. Heavy neighbours heat a cold
  disc by two-body relaxation, and a heated disc loses exactly the spiral
  structure Stage 1 just bought. Mitigations are softening and halo particle
  count; both need measuring, not assuming.

**Do Stage 1 first and completely. Stage 2 only if it is holding up.**

### Standing assertions this needs before it is believed

The existing table in CLAUDE.md applies, plus:

- an **isolated live disc holds its scale length and thickness** over many
  rotations (the current equilibrium check, re-pointed at the live model)
- total **energy and momentum conserved** with self-gravity on, drift reported
- the live disc **reproduces the analytic v_circ** including its own contribution
- **Q sweep**: 0.8 / 1.2 / 1.5 / 2.0 / 3.0, with the resulting arm amplitude
  recorded, not graded
- **softening sweep** at fixed mass model, which is the real softening study
  `OPEN_ACTIONS` has wanted since round 2
- **N convergence**: does the arm pattern survive 0.5x and 2x particle count, or
  is it a resolution artefact
- the merger remnant's **surface-brightness profile against a de Vaucouleurs r¼
  law** — this is the one that turns the film's closing assertion into a result

---

## 2. Three-act restructure

The current film is a catalogue with commentary: prograde, retrograde, mice,
antennae, ring, minor, merger, reversal, detect. Catalogues inform. They do not
grip.

    Act I   — the puzzle.    The sky is full of wreckage nobody could explain.
                             Open on real photographs, not simulation. Magnetic
                             fields and explosions. Withhold the mechanism.
    Act II  — one force.     Gravity alone. Resonance, spin, geometry. Toomre and
                             Toomre settling it in 1972 on a primitive computer.
    Act III — consequence.   How the galaxies we see came to be. Mergers,
                             morphological transformation, the Hubble sequence
                             populated rather than merely classified. End on the
                             Milky Way and Andromeda, where the viewer lives.

Same footage, restructured. Existing segments map onto the acts; the reversal and
detect material becomes a coda rather than sitting mid-film.

**Before any of Act III is written**, its claims go through `docs/LITERATURE.md`
with verified / reported / inferred kept separate, as everything else does.
Hierarchical assembly, major mergers producing ellipticals, discs surviving where
there has been no major merger since z~1–2, S0s from stripping and harassment,
the morphology–density relation, and the Milky Way–Andromeda encounter are all
mainstream — but "mainstream" is not a citation and this project does not quote
one.

---

## 3. Motion blur

The cheapest large win available, and it rests on a number already measured:
offline rendering costs **~17.9 ms/frame**. The film is 459.6 s at 60 fps =
**27,576 frames**.

| samples/frame | render time | what it buys |
|---|---|---|
| 1 (today) | 8 min | every frame an infinitely sharp instant — the CG "tell" |
| 8 | 1.1 h | |
| 16 | **2.2 h** | target |
| 32 | 4.4 h | |
| 64 | 8.8 h | stretch |

Accumulating sub-frame samples gives **true motion blur**. The same accumulation
loop, jittered over an aperture instead of over time, gives **depth of field** —
so one mechanism buys both. Depth of field is astronomically a lie and
cinematically a gift; use it deliberately and sparingly (a rack focus from a
foreground tail to the far nucleus), never as a default.

### Overnight budget

Ten hours available. Physics and render are sequential per segment.

- **Target:** N = 150k, 16 samples → 3.0 h + 2.2 h = **5.2 h**. Comfortable.
- **Stretch:** N = 200k, 32 samples → 5.3 h + 4.4 h = 9.7 h. No room for a mistake.

Take the target. Spend what is left on a second pass, not on a bigger first one.

---

## 4. Cinematography, folded in where it is cheap

Not a separate workstream; these ride along with the re-render.

- **Parallax** — a slow lateral truck rather than a static or purely dollying
  camera. Nearly free, and the single strongest cue that this is a volume and not
  a flat picture. Currently underused.
- **The match cut** — cut from the simulated tail to the *real* frame of the same
  system at the same orientation and scale, holding composition through the cut.
  Detect mode already does the scale matching, so this project can do it better
  than anyone. Likely the shot people remember.
- **Speed ramp** into first pericentre.
- **2.39:1** letterbox. Costs nothing, reads as cinema.
- **A grade per act** — cool and clinical in Act I, warm through the merger.
- **Hold shots longer.** The current cut moves on quickly; nature documentaries
  trust the image.

---

## 5. Narration

Recording a human is still on the table and remains the strongest option, but the
agreed next step is **a larger open model first**.

The instinct that how text is fed to the model matters is right, and it is
currently the pipeline's biggest self-inflicted wound:

> We write subtitle-shaped lines → build an SRT from them → synthesise speech
> from the SRT. The prose is therefore shaped by the caption box before it ever
> reaches the ear. That is why it reads as a sequence of short declarative
> fragments.

**Invert it.** Write flowing paragraphs → synthesise the whole paragraph so the
engine places stress and cadence across a complete thought → derive subtitles from
the resulting audio by forced alignment. Speech quality goes up and subtitle sync
gets *better*, because the audio becomes the source of truth rather than the
consequence.

Also worth having, and cheap: YouTube supports multiple audio and subtitle
tracks. **A general-audience narration and a parallel "for astronomers" track over
identical picture** costs one extra script, not one extra film.

Prep task: shortlist and A/B larger open TTS models on the actual script, judged
on the same measured basis as last time (pitch median, intonation range) plus a
listen. Kokoro is 82M parameters, which is small.

---

## 6. Before Friday

- [ ] Re-run `bench/nbody_bench.html` on an idle machine to confirm 1.16e11 still
      holds, and extend the direct arm past 131k so the film-tier N is measured
      rather than extrapolated from a fit
- [ ] Derive and unit-test the exponential disc's analytic v_circ contribution
      (Freeman 1970) — this is Trap 1's guard and it can be written before the
      solver exists
- [ ] Literature pass for Act III, into `docs/LITERATURE.md`
- [ ] Shortlist larger open TTS models; A/B on a real paragraph
- [ ] Draft the three-act beat sheet so Friday is building, not writing
- [ ] Decide the real-imagery list for the match cuts, and check licensing
      terms rather than assuming NASA/ESA material is unrestricted

## 7. Risk register

| Risk | Why it bites | Guard |
|---|---|---|
| Disc mass double-counted | looks like a perfectly nice compact galaxy | assert v_circ against Freeman |
| Q chosen not swept | "the arms appeared" proves only Q < 2 | sweep and record |
| Heavy halo particles heat the disc | kills the spiral structure Stage 1 bought | Stage 2 gated on measurement |
| Arms are a resolution artefact | plausible at any N | 0.5x / 2x convergence |
| Overnight run overruns | one mistake costs the night | take the target, not the stretch |
| Act III claims outrun the sources | the failure round 9 just fixed | LITERATURE.md first |
