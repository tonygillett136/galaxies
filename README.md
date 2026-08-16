# Galaxies

**Interacting galaxies, simulated and rendered in real time in the browser** — and the
foundations for an instrument that recovers encounter parameters from real observations.

### ▶ [galaxies.gillett-projects.com](https://galaxies.gillett-projects.com/)

Needs WebGPU: Chrome 113+, Edge, Safari 26+, Firefox 141+.

Two galaxies, gravity, and nothing else — and out of that come bridges, tidal tails, rings,
warps and mergers. 280,000–350,000 massless test particles orbiting live analytic potentials
on the GPU, at 60 fps.

---

## Four ways in

| Mode | What you do |
|---|---|
| **Sandbox** | Set mass ratio, pericentre, eccentricity, disc tilts and spins; scrub time in both directions |
| **Detect** | Load a real SDSS image of an observed pair with its published Galaxy Zoo fit alongside, at a redshift-calibrated scale, and try to match it |
| **Tour** | Seven guided steps through the physics, in the order the physics builds |
| **Atlas** | Drag through parameter space and feel its shape rather than read it |

Time runs backwards as **genuine reversed integration**, not replayed frames — except with
dynamical friction on, where it cannot, because dissipation is irreversible. The app says so
rather than quietly pretending.

## The one result worth pointing at

Disc **spin direction** does as much damage as distance does. Run the same encounter twice,
changing nothing but the sign of the disc's rotation:

- **prograde** throws **15.1%** of a disc beyond 20 kpc
- **retrograde** throws **2.5%**

a ratio of 6, with the two orbits asserted identical to 1e-6 first, so disc spin is
demonstrably the only difference. Insensitive to resolution (0.8% over 4×) and timestep
(0.1% over 4×). This is Toomre & Toomre's 1972 result, reproduced from first principles.

## How it is built

```
src/engine/    units, potentials, Kepler, disc initial conditions, float64 CPU reference,
               WGSL compute kernel, GPU sim, encounter construction
src/render/    HDR splat renderer, two-slab dust, bloom, AgX composite, camera
src/app/       application, detective mode, guided tour
test/          81 assertions, several paired with sensitivity checks that must FAIL
bench/mutate.mjs   MUTATION TESTING: reverts each fix and requires the suite to notice
docs/          UNITS, LITERATURE (verified/reported/inferred kept separate), IDENTIFIABILITY
data/          Galaxy Zoo tables, 62 targets, 56 SDSS cutouts
review_board/  six adversarial reviewer personas and the workflow that runs them
film/          the showcase film: offline renderer, edit, original score, narration
```

Plain ES modules, **no build step** — the files the dev server serves are the files that
deploy.

```bash
python3 bench/devserver.py 8787               # serves with Cache-Control: no-store
open http://127.0.0.1:8787/index.html
open http://127.0.0.1:8787/test/index.html    # 96 standing assertions
node bench/mutate.mjs                         # break the code, require the suite to notice
```

### Two tiers, and the difference never blurs

- **Interactive**: WebGPU, float32, real time, approximate.
- **Science**: float64 CPU reference, offline, the one that gets believed.

The GPU kernel is asserted against the CPU reference: GPU and CPU agree to 9.95e-4 kpc over
2000 steps, with a sensitivity control (a 1% mass error diverges to 5.09) proving the
comparison can detect a difference at all. **Never quote an interactive-tier number as a
scientific result.**

---

## What is honest about it

The point of this project is that the physics can be believed, so the parts that are *not*
established are stated as loudly as the parts that are. This section is the reason the
repository is worth reading.

- **The identifiability claim is retracted.** This project published "the parameters are
  recoverable from morphology alone" and it is not supported by its own objective: an
  exhaustive grid puts the global minimum nowhere near the truth at any N up to 2400, and the
  optimiser's own endpoint scores *better* than the truth. What is established is that the
  optimiser converges. Whether the objective's minimum *is* the answer is open, and the
  evidence currently points the wrong way. `docs/IDENTIFIABILITY.md` has the numbers.
- **Three exact degeneracies**, two of them discrete and therefore far more dangerous than the
  flat one, because a discrete degeneracy gives a confident, tight, *wrong* answer with a small
  residual: mass-epoch (invariant to 9.2e-9), (i, ω, Ω) → (−i, ω+π, Ω+π) which is bit-identical
  at *every* geometry, and reflection through the sky plane when coplanar.
- **23 of the 62 published fits lie outside this model's domain** — 15 have an apocentre inside
  the disc radius, so the two galaxies never separate. Detect says so instead of drawing
  something.
- Scenarios named "Mice-like" and "Antennae-like" are **morphological resemblances, not
  published fits**.
- Detective mode maps four of the five published Galaxy Zoo parameters. **`beta` is not
  mapped**, because its convention has not been read from the paper, and guessing an angle is
  how you get a confident wrong overlay. Photometric redshifts are flagged as unreliable, and
  targets without one say UNCALIBRATED rather than showing a wrong scale.
- A reverse-mode **adjoint exists as a spike**: gradients agree with finite differences to a
  worst relative error of 4.7e-7 over 15 components. It differentiates disc orientation only,
  with the galaxy trajectory held fixed. That figure is engine-dependent (2.2e-7 under Node,
  4.7e-7 under Chrome) because the residual is finite-difference cancellation noise rather than
  adjoint error.
- Dust extinction is a two-slab approximation, disabled in science view. It lies in each
  galaxy's **own** disc plane at a 0.06 kpc scale height against a stellar rms height of 0.297
  kpc — measured on antennae with its control: 14.55% of the light extinguished with the real
  disc normals against 3.70% with the old fallback.
- **The softening study is still open.** `softeningScale` scales all three component core radii,
  which is a *homology rescaling of the galaxy* rather than a change of numerical smoothing:
  v_circ(8 kpc) runs 303 / 220 / 152 km/s across the arms. A true study holds the mass model
  fixed.
- The claimed literature gap rests on **one search session** and is labelled a hypothesis.
- **Not built**: posteriors, the 62-system benchmark, differentiating through the orbit, gas,
  star formation, disc self-gravity.

## How much of this is actually guarded

96 standing assertions is the wrong number to quote on its own, because review rounds kept
finding assertions that pass when the code they guard is deleted. So the repository carries a
mutation harness:

```bash
node bench/mutate.mjs      # reverts each fix; requires the suite to NOTICE
```

24 mutations: **17 killed, 0 survived, 7 browser-only** (run by hand) — each kill by the check
*named* for it, not by collateral damage. It prints its own coverage limits, derived from the
run rather than typed, and they matter: it reaches 64 of the 81 checks and **0%** of `src/app`
and `src/render`.

The technique earned its place. Four review rounds of careful *reading* found essentially no
weak assertions; one round of *breaking the code* found fourteen inert ones in a single pass —
including checks whose own comments explained why they were necessary.

Every documented figure above is also registered in `test/claims.test.js`, which reads the
shipped prose back and fails the build when a number drifts from the measurement that produced
it. That guard took five attempts, and the review log records each way it was defeated.

### The most instructive bug in the repository

For its entire life the composite shader returned `vec4f(col, 0.0)` while the canvas was
configured `alphaMode: 'premultiplied'`. That was deliberate — alpha 0 gives purely additive
light over the observation in Detect — and Firefox renders it exactly as intended.

But premultiplied alpha declares the colour as *already multiplied by alpha*, which requires
`rgb <= a`. `rgb > 0` at `a = 0` is out of gamut, and Chrome and Safari are entitled to resolve
it by clamping rgb down to alpha: **black**. Two of three engines showed a black canvas with
the HUD, the frame counter and the particle count all perfectly alive on top of it.

Eight rounds of adversarial review and 311 findings did not catch it, because every automated
measurement screenshotted the **canvas element** — which captures the texture and bypasses page
compositing entirely. The instrument was structurally blind to the whole class of defect. A
user found it in one minute by opening the page in a second browser.

It is now guarded, and `DEVLOG.md` carries the full account.

---

## Reading order

0. **[`film/README.md`](film/README.md)** — how the showcase film was made: the offline
   renderer, the edit, the original score, and the narration pipeline. Includes what went
   wrong with each.
0. **[`docs/GUIDE.md`](docs/GUIDE.md)** — the user guide: every mode, every control, how to
   read the display, and how to not fool yourself with a persuasive picture. Start here if you
   want to *use* it rather than audit it.
1. **`DEVLOG.md`** — the narrative build log, written as it happened, including everything that
   went wrong. It carries the reasoning nothing else does.
2. `docs/IDENTIFIABILITY.md` — why the headline inference claim was retracted.
3. `review_board/REVIEW_LOG.md` — eight rounds of adversarial review, round by round.

## Data and citation

Galaxy Zoo: Mergers — **Holincheck et al. 2016, MNRAS 459, 720**. Cite it for any use of the
fitted parameters. Images from the SDSS DR18 SkyServer cutout service; please observe
[SDSS's acknowledgement guidance](https://www.sdss.org/collaboration/citing-sdss/).

## Licence

MIT — see [`LICENSE`](LICENSE). The bundled Galaxy Zoo tables and SDSS cutouts remain the
property of their respective surveys and are redistributed here for research and educational
use under their own terms.
