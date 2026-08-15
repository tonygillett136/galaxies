# Guide

Everything the site does, and how to use it.

**▶ [galaxies.gillett-projects.com](https://galaxies.gillett-projects.com/)**

---

## Contents

- [What you are looking at](#what-you-are-looking-at)
- [Getting started in 60 seconds](#getting-started-in-60-seconds)
- [The four modes](#the-four-modes)
  - [Sandbox](#sandbox--build-an-encounter)
  - [Detect](#detect--match-a-real-galaxy-pair)
  - [Tour](#tour--seven-steps-through-the-physics)
  - [Atlas](#atlas--feel-the-parameter-space)
- [Every control](#every-control)
- [Reading the display](#reading-the-display)
- [Keyboard and mouse](#keyboard-and-mouse)
- [Sharing a state](#sharing-a-state)
- [How to not fool yourself](#how-to-not-fool-yourself)
- [Troubleshooting](#troubleshooting)

---

## What you are looking at

Two galaxies passing close enough to pull each other apart.

Each galaxy is a **disc of 140,000–175,000 test particles** on circular orbits in its own
gravitational potential. The two galaxies attract each other; the particles feel both galaxies
but not each other. That is a *restricted three-body* model, and it is the same approximation
Alar and Juri Toomre used in 1972 to show that bridges and tails are tidal, not magnetic or
explosive.

It buys enormous speed — 300,000 particles at 60 fps in a browser tab — at the cost of leaving
out gas, star formation and the disc's self-gravity. **Nothing you see here is a fluid.** What
it does capture, it captures honestly: the orbits are integrated with a symplectic scheme, and
running time backwards genuinely re-integrates rather than replaying stored frames.

**Units:** distances in kiloparsecs (kpc — about 3,260 light years), time in millions of years
(Myr), masses relative to a Milky Way-like galaxy of roughly 7×10¹¹ solar masses.

---

## Getting started in 60 seconds

1. Open the site. The default encounter is already running — two galaxies approaching.
2. Watch until the clock passes **0 Myr** (marked *pericentre*, the closest approach). A tail
   grows out of one disc.
3. Press **`space`** to pause, and drag the **timeline** at the bottom to scrub back and forth.
4. In the panel, click **Retrograde passage**. Same orbit, disc spinning the other way. Watch
   it again.

That second run is the point of the whole site. See [the one result](#the-one-result-below).

---

## The four modes

Switch with the buttons at the top of the panel, or keys **`1`–`4`**.

### Sandbox — build an encounter

Eight preset scenarios, then every parameter free to change.

| Preset | What it shows |
|---|---|
| **Prograde passage** | Disc spin aligned with the orbit — the strong-tail case |
| **Retrograde passage** | The identical orbit, disc spun the other way |
| **Mice-like** | Two long antiparallel tails, resembling NGC 4676 |
| **Antennae-like** | A closer, more violent pass |
| **Minor companion** | A small galaxy disrupting a big one |
| **Distant fly-by** | A gentle warp instead of a tail |
| **Merger (with friction)** | Dynamical friction on, so the orbit decays and they coalesce |
| **Ring galaxy** | A companion straight through the disc centre |

Names ending in "-like" are **morphological resemblances, not published fits** — they look
like those systems, they are not solutions for them.

#### The one result below

Load **Prograde passage**, let it run past pericentre, then load **Retrograde passage**. The
orbits are identical to one part in a million; the only difference is the direction the disc
spins.

- prograde throws **15.1%** of the disc beyond 20 kpc
- retrograde throws **2.5%**

A factor of six, from spin alone. Particles orbiting *with* the companion's tug stay in
resonance with it and get dragged out; particles orbiting against it feel the pull reverse
before it can do much. **Which way a galaxy spins matters more than how close the encounter
is** — that is the counter-intuitive core of tidal interaction, and you can reproduce it here
in two clicks.

### Detect — match a real galaxy pair

Loads a real **SDSS telescope image** of an observed interacting pair behind the simulation,
scaled so one screen width equals the correct number of kiloparsecs at that galaxy's distance.
Your job is to find the encounter that reproduces it.

- **Target** — choose from 62 pairs catalogued by Galaxy Zoo: Mergers
- **Load published fit** — sets the sliders to the published best-fit parameters
- **Image opacity / scale** — fade the photograph up and down against your simulation

Read the notes it prints. They will tell you when a redshift is photometric (so the physical
scale may be badly wrong), when a target has no redshift at all (**UNCALIBRATED**), and when
the published fit lies **outside this model's domain** — 23 of the 62 do, usually because the
two galaxies never actually separate, and drawing something anyway would be a fiction.

One parameter of the published five, `beta`, is **not** mapped, because its convention has not
been confirmed from the paper. Guessing an angle is how you get a confident wrong overlay.

### Tour — seven steps through the physics

A guided sequence, in the order the physics builds:

1. **Two undisturbed discs** — the control. Left alone, they must stay put
2. **The prograde passage** — the tail appears
3. **The same orbit, spun the other way** — and it does not
4. **Where the tail came from** — colour by birth radius and watch the outer disc leave
5. **A companion through the middle** — the ring case
6. **What the pretty view hides** — bloom and dust off, linear scale on
7. **Against the real sky** — a real observation behind the model

Each step sets the scene and pauses. **Next** / **Back**, or **`↑`** / **`↓`**.

### Atlas — feel the parameter space

A draggable pad: horizontal is disc tilt, vertical is pericentre distance. Drag and the
simulation rebuilds continuously, so you can *feel* which regions produce tails and which do
nothing. The pad is keyboard-reachable — tab to it and use the arrow keys, shift for bigger
steps.

---

## Every control

### Encounter (Sandbox and Detect)

| Control | Range | What it does |
|---|---|---|
| **Mass ratio** | 0.05 – 1.00 | Secondary mass over primary. 1.0 is an equal pair; 0.05 is a small satellite |
| **Pericentre** | 0.5 – 90 kpc | Closest approach *requested*. Discs are ~13.5 kpc, so below ~15 kpc the companion passes through the disc |
| **Eccentricity** | 0.4 – 5.0 | Below 1 is a bound orbit that returns; 1.0 is parabolic; above 1 flies past once and never comes back |
| **Dynamical friction (lnΛ)** | 0 – 6 | Drag from the dark halos. Non-zero makes the orbit decay so the pair can merge. **Turns time-reversal approximate**, because friction is dissipative — the app says so when you enable it |
| **Primary / secondary tilt** | ±90° | Inclination of each disc against the orbital plane. 0° is coplanar |
| **Primary / secondary retrograde** | checkbox | Flip a disc's spin direction. *The most important control on the page* |

If the pericentre solver cannot deliver what you asked for, the panel says so and reports the
value the orbit **actually executes** rather than the one you requested.

### Playback

| Control | Range | What it does |
|---|---|---|
| **Speed** | 0.05× – 3× | Simulation rate |
| **Play / Pause** | — | Also **`space`** |
| **Reset** | — | Back to the scenario's start. Also **`r`** |
| **Timeline** | scenario-dependent | Scrub through time. The orange mark is pericentre |

Scrubbing far is not instant — it re-integrates every step rather than replaying frames, and a
full-span scrub takes a second or two. A progress cursor shows while it works.

### Appearance

| Control | Range | What it does |
|---|---|---|
| **Splat size** | 0.03 – 1.0 kpc | Rendered size of one particle. Small looks grainy, large looks like smoke |
| **Intensity** | 0.002 – 0.09 | Brightness per particle |
| **Exposure** | 0.1 – 4 | Overall exposure, like a camera |
| **Bloom** | 0 – 1 | Glow around bright regions. Beautiful, and it hides structure |
| **Dust extinction** | 0 – 8 | Dark lanes. Dust in each disc's own plane absorbs light from behind it |
| **Camera follows** | — | Primary, secondary, the pair's midpoint, or the fixed barycentre |
| **Colour by** | — | **Stellar population** (by birth radius), **Origin galaxy** (which disc a particle started in — the clearest way to see material swapped between galaxies), or **Speed** |
| **Science view** | checkbox | See below. Also **`s`** |

### Science view

The deliberately ugly one, and the only quantitative view: **linear brightness, no bloom, no
dust, no starfield, calibrated scale.** In the pretty view, brightness is tone-mapped like a
photograph, so you cannot read density off the screen. In science view you can, because pixel
value maps to density by a stated, fixed rule.

If you want to judge whether a feature is real or an artefact of the rendering, turn this on.
That is what it is for.

---

## Reading the display

**Top right**
- **fps / ms** — measured on the real scene, not an idle one
- **test particles** — how many are being integrated
- **separation** — current 3-D distance between the two galaxy centres. Note *3-D*: a pair can
  look close on screen and be far apart along the line of sight

**Bottom right**
- **Clock** — millions of years before or after pericentre
- **Scale bar** — physical size, live, at the current zoom

**Bottom left**
- **Colour legend** — sampled from the same ramp the shader uses, so key and picture cannot
  drift apart

**Warnings** appear in the panel in amber. They are worth reading: they cover a
non-converged pericentre, time-reversal made approximate by friction, an unreliable
photometric redshift, and a fit outside the model's domain.

---

## Keyboard and mouse

| Input | Action |
|---|---|
| **drag** | Orbit the camera |
| **shift-drag** | Pan |
| **scroll** | Zoom |
| **`space`** | Play / pause |
| **`←` `→`** | Step one frame back / forward |
| **`r`** | Reset to the scenario start |
| **`f`** | Frame the content — use this if the view ever looks empty |
| **`s`** | Toggle science view |
| **`1`–`4`** | Sandbox / Detect / Tour / Atlas |
| **`↑` `↓`** | Previous / next tour step (in Tour) |

Letter shortcuts are suppressed only while you are typing in a text field. Arrow keys belong
to a focused slider, so a slider you have tabbed to still works normally.

The camera reframes itself as the encounter evolves — but **only until you zoom**. Once you
have set a zoom, it is yours; press **`f`** to hand framing back to the app.

---

## Sharing a state

**Copy link to this state** puts everything in the URL: mode, scenario, all orbit and disc
parameters, the epoch on the clock, colour mode, science view, playback speed, camera follow,
the selected Detect target, and the **viewing geometry**.

The camera travels deliberately. In an encounter, orientation is a *fitted parameter* rather
than a preference — two people looking at the same simulation from different angles are not
looking at the same claim.

---

## How to not fool yourself

A simulation of colliding galaxies is *persuasive*. It will produce a picture with tidal tails
that looks like evidence, whatever you feed it. Some habits:

- **Always run the control.** Before believing a feature comes from what you changed, run the
  case that should *not* produce it. Prograde against retrograde is the model example, and it
  is two clicks.
- **Turn off the bloom.** Glow makes everything look like a galaxy. Science view (**`s`**) is
  the honest picture.
- **Check the separation readout, not the screen.** Overlap on screen is a projection effect.
- **Move the sliders you did not think mattered.** If the result moves when you change splat
  size or the timestep, the result was the rendering or the resolution — not physics.
- **Believe the amber warnings.** They exist because the alternative was drawing something
  plausible and wrong.

And the standing limits: no gas, no star formation, no disc self-gravity, test particles that
do not attract each other. **A good visual match does not mean you have found the encounter** —
[the repository explains why](../README.md#what-is-honest-about-it), including three exact
degeneracies that give confident, tight, *wrong* answers.

---

## Troubleshooting

**"This browser cannot run it yet"** — the site needs **WebGPU**. Chrome or Edge 113+, Safari
26+ (macOS 26 / iOS 26), or Firefox 141+. On iPhone and iPad every browser uses Safari
underneath, so iOS 26 is the requirement whichever you use.

**"WebGPU is present, but no graphics adapter was offered"** — hardware acceleration is
switched off, or you are in a remote/virtual session. In Chrome or Edge, enable *Use graphics
acceleration when available* in Settings → System and restart. `chrome://gpu` names the exact
reason.

**The screen is black but the counters are moving** — press **`f`** to reframe. If it persists,
please [open an issue](https://github.com/tonygillett136/galaxies/issues); a black frame with a
live particle count has been a real bug more than once.

**It runs slowly** — reduce the particle count by choosing a lighter scenario, turn bloom down,
or shrink the window. Frame rate scales with the number of pixels, not just particles.

**Scrubbing is sluggish** — expected. Each step is genuinely re-integrated; it is not a video.

---

## Going deeper

- [**README**](../README.md) — what is established and what is not
- [**DEVLOG**](../DEVLOG.md) — the full build log, including everything that went wrong
- [**IDENTIFIABILITY**](IDENTIFIABILITY.md) — why the parameter-recovery claim was retracted
- [**UNITS**](UNITS.md) — the unit system and its verification
- [**LITERATURE**](LITERATURE.md) — sources, with verified / reported / inferred kept separate
