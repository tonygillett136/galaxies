# Galaxy Collisions

Interacting galaxies, simulated and visualised in the browser, and the foundations for an
instrument that recovers encounter parameters from real observations.

**Live: https://galaxy-collisions.pages.dev** (needs WebGPU: Chrome 113+, Edge, Safari 26+)

Read **`DEVLOG.md`** first. It is the narrative build log, including what went wrong, and it
carries the reasoning that nothing else does.

---

## What it does

Two galaxies, gravity, and nothing else — and out of that come bridges, tidal tails, rings,
warps and mergers. 280,000-350,000 massless test particles orbiting live analytic potentials
on the GPU.

**The frame rate, stated properly**, because the project's own check table demands the
scenario, the epoch, N and the resolution — *and, it turns out, what else was on the GPU*.
Measured over 150 frames per scenario at a 2400x2440 backing store (DPR 2), Apple M4:

| scenario | N | camera | median | fps |
|---|---|---|---|---|
| prograde | 300k | 193 kpc | 17-23 ms | 44-60 |
| antennae | 350k | 170 kpc | 17-22 ms | 46-60 |
| ring | 320k | 332 kpc | 17 ms | 58-60 |
| merger | 320k | 174 kpc | 18 ms | 56-60 |
| flyby | 280k | 222 kpc | 16.7 ms | 60 |

A range rather than a point, because that is what is actually true. On an **isolated Chrome
with an idle GPU** every scenario is vsync-locked at 16.7 ms / 60 fps. With other WebGPU tabs
on the same GPU the same build measures 22-32 ms. The application is vsync-limited when it has
the GPU to itself and contention-limited when it does not, and no single number describes both.

> **This section was wrong twice, in opposite directions, and the second time was worse.**
> It claimed a flat 60 fps until 2026-08-15. I then "corrected" it to 31-46 fps with a table of
> point values and a confident causal story: that framing the encounter properly costs frame
> rate, because it means "rasterising all 300,000 particles instead of the fraction that
> happened to be in view".
>
> Both halves were wrong. The measurements were taken while six other WebGPU tabs — review
> agents driving their own browsers — were on the same GPU. And the mechanism was backwards:
> **there is no culling in this renderer**, so no particle was ever skipped for being
> off-screen, and pulling the camera *back* makes each splat cover *fewer* pixels, not more.
> Run as a controlled experiment — both camera distances interleaved in one session so ambient
> load hits both arms equally — the shipped 193 kpc framing measures **17.8 ms against 28.7 ms
> at the old 66 kpc**. Framing the encounter properly made it *faster*.
>
> The lesson is not about frame rates. A wrong figure with a plausible mechanism attached is
> far more durable than a wrong figure on its own, because the mechanism is what stops anyone
> re-measuring. This one survived until a reviewer measured it on a quiet machine.

Scrubbing is NOT 60 fps: one `queue.submit` per step makes a full-span seek cost ~1.6 s of
wall time (measured at 3.1-3.4 s under load). It is chunked across frames with a busy indicator
so the tab stays alive, and batching the submits is an open action.

Four modes:

| Mode | What you do |
|---|---|
| **Sandbox** | Set mass ratio, pericentre, eccentricity, disc tilts and spins; scrub time in both directions |
| **Detect** | Load a real SDSS image of an observed pair with the published Galaxy Zoo fit alongside, at a redshift-calibrated scale, and try to match it |
| **Tour** | Seven guided steps through the physics, in the order the physics builds |
| **Atlas** | Drag through parameter space and feel its shape rather than read it |

Time runs backwards as **genuine reversed integration**, not replayed frames — except with
dynamical friction on, where it cannot, because dissipation is irreversible.

## Two tiers, and the difference never blurs

- **Interactive**: WebGPU, float32, real time, approximate.
- **Science**: float64 CPU reference, offline, the one that gets believed.

The GPU kernel is asserted against the CPU reference: GPU and CPU agree to 9.95e-4 kpc over 2000 steps, with a
sensitivity control (1% mass error diverges to 5.09) proving the comparison can detect a
difference at all. **Never quote an interactive-tier number as a scientific result.**

## Running it

```bash
python3 bench/devserver.py 8787     # serves with Cache-Control: no-store
open http://127.0.0.1:8787/index.html
open http://127.0.0.1:8787/test/index.html      # 79 standing assertions
open http://127.0.0.1:8787/bench/nbody_bench.html
```

No build step. The files the dev server serves are the files that deploy.

```bash
bash build_dist.sh
npx wrangler pages deploy dist --project-name galaxy-collisions --branch main
```

## Layout

```
src/engine/    units, potentials, Kepler, disc ICs, float64 CPU reference,
               WGSL kernel, GPU sim, encounter construction
src/render/    HDR splat renderer, two-slab dust, bloom, AgX composite, camera
src/app/       application, detective mode, guided tour
test/          79 assertions, several paired with sensitivity checks that must FAIL
bench/mutate.mjs  MUTATION TESTING: reverts each fix and requires the suite to notice
bench/         throughput harness and measured results
docs/          UNITS, LITERATURE (verified/reported/inferred kept separate), IDENTIFIABILITY
data/          Galaxy Zoo tables, 62 targets, 56 SDSS cutouts
review_board/  six adversarial reviewer personas and the workflow that runs them
```

## What is honest about it

The point of the project is that the physics can be believed, so the parts that are *not*
established are stated as loudly as the parts that are:

- Scenarios named "Mice-like" and "Antennae-like" are **morphological resemblances, not
  published fits**. Toomre & Toomre 1972 has not been read in full.
- Detective mode maps four of the five published Galaxy Zoo parameters. **`beta` is not
  mapped**, because its convention has not been read from the paper and guessing an angle is
  how you get a confident wrong overlay. Clamping is reported. Photometric redshifts are
  flagged as unreliable, and targets without one say UNCALIBRATED rather than showing a wrong
  scale.
- **THE IDENTIFIABILITY CLAIM IS RETRACTED.** This project published "the parameters are
  recoverable from morphology alone" and it is not supported by its own objective: an
  exhaustive grid puts the global minimum nowhere near the truth at any N up to 2400, and the
  optimiser's own endpoint scores better than the truth. What is established is that the
  optimiser converges. Whether the objective's minimum *is* the answer is open, and the
  evidence currently points the wrong way. `docs/IDENTIFIABILITY.md` carries the numbers.
- **THREE exact degeneracies**, two of them discrete and therefore far more dangerous than the
  flat one, because a discrete degeneracy gives a confident, tight, WRONG answer with a small
  residual: mass-epoch (invariant to 9.2e-9), (i, ω, Ω) → (−i, ω+π, Ω+π) which is bit-identical
  at *every* geometry, and reflection through the sky plane when coplanar.
- **23 of the 62 published fits lie outside this model's domain** — 15 have an apocentre inside
  the disc radius, so the two galaxies never separate. Detect says so instead of drawing
  something.
- The claimed literature gap rests on **one search session** and is labelled a hypothesis.
- Dust extinction is a two-slab approximation, disabled in science view. It now lies in each
  galaxy's **own** disc plane at a 0.06 kpc scale height, against a stellar rms height of
  0.297 kpc. Measured on antennae with its control: **14.55% of the light extinguished with
  the real disc normals against 3.70% with the old [0,0,1] fallback**, a factor of 3.9, with
  the extinction's position angle agreeing with the stellar one to 7.2° (co-planar) and its
  axis ratio flatter (0.32 against 0.55, which is what a thinner layer must project to).
  *This is the third state this bullet has been in.* It said the dust produced no lane; then
  said it did, on a measurement taken on the one galaxy in the project whose inclination is 0
  — where the fallback was accidentally correct. The delivery of the disc normal is now
  guarded by an assertion on a **tilted** disc, and by a mutation that deletes the field.
- The dust plane is computed once at t=0 and never updated, so it stays fixed while the discs
  warp, precess and merge. For the merger scenario that means a planar slab drawn through what
  has become a spheroid. Not fixed, stated.
- A reverse-mode **adjoint exists as a spike**: gradients agree with finite differences to a
  worst relative error of 4.7e-7 over 15 components, and the angle gradient the optimiser
  consumes is separately asserted. It differentiates disc orientation only, with the galaxy
  trajectory held fixed. *(This file said 4e-10 until round 7 — a figure produced by no check
  in the project and 550x better than the code measures. It is now registered in the claims
  guard. The tolerance on that registration is deliberately wide, because the same check
  measures 2.2e-7 under node and 4.7e-7 under Chrome: the residual is **finite-difference
  cancellation noise, not adjoint error**, and it differs between JavaScript engines. Quoting
  it to two significant figures as a property of the adjoint would be the same mistake in a
  new costume.)*
- Not built: posteriors, the 62-system benchmark, differentiating through the orbit, gas,
  star formation, disc self-gravity.

## How much of this is guarded

79 standing assertions is the wrong number to quote on its own, because five review rounds
found assertions that pass when the code they guard is deleted. So:

```bash
node bench/mutate.mjs      # reverts each fix; requires the suite to NOTICE
```

20 mutations: **17 killed, 0 survived, 3 not covered** (those three need a browser) — each kill
by the check *named* for it, not by collateral damage. It prints its own coverage limits,
derived from the run rather than typed, and they matter: it reaches 64 of the 79 checks and
**0%** of `src/app` and `src/render`. A green run means the engine's node-runnable subset is
guarded. It does not mean the project is guarded — round 7 found five defects in `src/app`
alone, all of them in code this harness cannot see.

The three browser-only mutations were run by hand against a served copy, and both round-7
attacks on the claims guard now die by name:

```
claims/bypass-sparing-canary → "25 registered claims never reached the comparison: …"
claims/tolerance-floor       → "the effective tolerance does not match the declared one for: …"
```

Doing that correctly matters more than it sounds: `bench/devserver.py` chdirs to **its own**
repo root, so serving a mutated copy the obvious way silently serves the original and every
mutation appears to survive. That trap cost twenty minutes and is now documented beside the
`chdir` that causes it.

## Data

Galaxy Zoo: Mergers (Holincheck et al. 2016, MNRAS 459, 720) — cite it for any use of the
fitted parameters. Images from the SDSS DR18 SkyServer cutout service.
