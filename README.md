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
scenario, the epoch, N and the resolution and no reviewer had ever measured it: median
**16.6-16.7 ms (59.9-60.2 fps)** with p95 18.4-18.7 ms, measured over 150 frames on the FULL
scene at a 2400x2328 backing store (DPR 2) on an Apple M4. That is every shipped scenario —
prograde, antennae, ring, merger and flyby — so the best and the worst are 0.3 fps apart and
the figure is vsync-limited rather than headroom-limited.

Scrubbing is NOT 60 fps: one `queue.submit` per step makes a full-span seek cost ~1.6 s of
wall time. It is chunked across frames with a busy indicator so the tab stays alive, and
batching the submits is an open action.

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
open http://127.0.0.1:8787/test/index.html      # 78 standing assertions
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
test/          78 assertions, several paired with sensitivity checks that must FAIL
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
- Dust extinction is a two-slab approximation, disabled in science view — and it does **not**
  currently produce a visible lane. The extinction's vertical extent is measured *broader*
  than the emission it should silhouette. Open.
- A reverse-mode **adjoint exists as a spike**: gradients agree with finite differences to
  4e-10 and the angle gradient the optimiser consumes is separately asserted. It differentiates
  disc orientation only, with the galaxy trajectory held fixed.
- Not built: posteriors, the 62-system benchmark, differentiating through the orbit, gas,
  star formation, disc self-gravity.

## How much of this is guarded

78 standing assertions is the wrong number to quote on its own, because five review rounds
found assertions that pass when the code they guard is deleted. So:

```bash
node bench/mutate.mjs      # reverts each fix; requires the suite to NOTICE
```

15 mutations, 15 killed, 0 survived — each by the check *named* for it, not by collateral
damage. It prints its own coverage limits, and they matter: it runs 63 of the 78 checks and
reaches **0%** of `src/app` and `src/render`. A green run means the engine's node-runnable
subset is guarded. It does not mean the project is guarded.

## Data

Galaxy Zoo: Mergers (Holincheck et al. 2016, MNRAS 459, 720) — cite it for any use of the
fitted parameters. Images from the SDSS DR18 SkyServer cutout service.
