# Galaxy Collisions

Interacting galaxies, simulated and visualised in the browser, and the foundations for an
instrument that recovers encounter parameters from real observations.

**Live: https://galaxy-collisions.pages.dev** (needs WebGPU: Chrome 113+, Edge, Safari 26+)

Read **`DEVLOG.md`** first. It is the narrative build log, including what went wrong, and it
carries the reasoning that nothing else does.

---

## What it does

Two galaxies, gravity, and nothing else — and out of that come bridges, tidal tails, rings,
warps and mergers. 300,000 massless test particles orbiting live analytic potentials on the
GPU at 60 fps.

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

The GPU kernel is asserted against the CPU reference: GPU and CPU agree to 3.09e-4 kpc over 2000 steps, with a
sensitivity control (1% mass error diverges to 5.09) proving the comparison can detect a
difference at all. **Never quote an interactive-tier number as a scientific result.**

## Running it

```bash
python3 bench/devserver.py 8787     # serves with Cache-Control: no-store
open http://127.0.0.1:8787/index.html
open http://127.0.0.1:8787/test/index.html      # 71 standing assertions
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
test/          71 assertions, several paired with sensitivity checks that must FAIL
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
- **Mass and epoch are an exactly flat direction** (invariant to 3.8e-8). Morphology cannot
  separate them. See `docs/IDENTIFIABILITY.md` for the declared gauge and for the degeneracies
  that have *not* been searched for.
- The claimed literature gap rests on **one search session** and is labelled a hypothesis.
- Dust extinction is a **two-slab approximation**, disabled entirely in science view.
- Not built: the differentiable inverse problem, amortised posteriors, the 62-system benchmark,
  viewing-angle parameters, gas, star formation.

## Data

Galaxy Zoo: Mergers (Holincheck et al. 2016, MNRAS 459, 720) — cite it for any use of the
fitted parameters. Images from the SDSS DR18 SkyServer cutout service.
