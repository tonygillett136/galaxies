# Galaxy collisions — build log

Started Friday 2026-08-14 21:18 BST, against a stop at 09:00 Saturday.

Everything below is what actually happened, including the parts that went wrong, because the
wrong turns are where the reusable knowledge is. Numbers are measured unless they say
otherwise; where something is an estimate it says estimate, and when the measurement arrives
the estimate is replaced rather than left standing next to it.

---

## Why this project exists, and what the gap actually is

Model and visualise colliding galaxies, comprehensively enough that it might surface something
the field has not established, with a genuinely stunning interactive front end.

The first hour went on a literature check rather than code, on the principle that the cheapest
line on any roadmap is the one where the work is already done. It changed the plan.

- **Toomre & Toomre 1972** established that bridges and tails are tidal, using massless test
  particles around rigid potentials. A handful of encounters, matched by hand.
- **Barnes & Hibbard 2009**, Identikit: hybrid test-particle and self-consistent modelling
  through an interactive GUI. Around 30 of 36 synthetic encounters recovered, median angle
  errors under 15 degrees. *(From the abstract. Flagged for confirmation from the paper body.)*
- **Mortazavi et al. 2016** semi-automated the Identikit 2 search against 15 known GADGET
  configurations: 7 good, 4 fair, 4 poor. Pericentric distance about 30 per cent high on
  average face-on. Viewing angle scattered −30 to +10 degrees. Retrograde and polar encounters
  could not be modelled effectively; human judgement still needed for tidal-feature box
  selection. Output is point estimates with asymmetric error bars.
- **Holincheck et al. 2016**, Galaxy Zoo Mergers: JSPAM restricted three-body with a dynamical
  friction approximation, 10^5 parameter samples per system across 62 pairs, more than 3
  million simulations reviewed by citizen scientists.
- **Odisseo 2025** (arXiv:2511.22468): differentiable N-body in JAX on GPU, gradient-based
  parameter recovery. Applied to **stellar streams only**. Interacting disc galaxies not
  addressed.

So the enabling method is published and one year old, and has not been pointed at this
problem. The working hypothesis, and it is a hypothesis: **gradient-based, fully automated,
posterior-producing recovery of encounter geometry for individual observed pairs** is open.
That is a claim about absence resting on one search session, and it is labelled as such in
`docs/LITERATURE.md`. It shapes the build; it is not a finding.

Two consequences.

**There is a measurable incumbent.** Mortazavi's 7-good-of-15 with a 30 per cent pericentre
bias is the number to beat on comparable synthetic ground truth. Measuring against zero would
have flattered anything.

**Two assets exist and should not be rebuilt.** JSPAM is published under AFL 3.0 in the ASCL,
so restricted three-body with dynamical friction has a reference implementation to validate
against. And the Galaxy Zoo data is downloadable: best-fit parameters per system plus every
parameter set the volunteers scored.

## The architecture decision, and the convergence that made it easy

Two tiers: an interactive one that must hit 60 fps and an offline one that must be right.
One artefact doing both produces neither. The interactive tier gets a written list of what it
cannot see, and that list rather than the frame rate is the risk register.

The part that was not obvious until it was: **the renderer and the loss function want to be
the same object.** Drawing particles as Gaussian splats with additive blending is both the
physically honest way to render emission and a differentiable rasteriser, so the image on
screen and the comparison against an observed frame are one code path. The visual ambition and
the research ambition stopped competing for the architecture.

Second: leapfrog KDK is time-reversible, so a gradient backward pass can recompute states
rather than store them, making gradients through a long rollout cost constant memory. The same
property gives the UI genuine time reversal rather than replayed frames.

---

## Stage 0 — foundations

Machine checks first, per the machine notes: `/Volumes/SSD1` confirmed as a real mount on
`/dev/disk7s1` with 5.3 TB free, because `mkdir -p` against an unmounted volume silently fills
the boot disk instead.

Hardware, verified rather than assumed: Apple M4, 10 GPU cores, 24 GB unified memory, Metal 4.
Node 22.17.1. Python 3.14.6 with numpy/scipy/matplotlib/pandas; no JAX, MLX, torch, astropy.
**No Metal compiler**, which settled the platform question on the spot: a native path needs a
full Xcode install, WebGPU needs nothing and is publishable. Chrome, Safari, Firefox all present.

Cloudflare was added as a deployment target mid-stage. Checked existing practice rather than
inventing one and found the `lenny` project's method in memory: `npx wrangler pages deploy
<dir> --project-name <name>`, manual CLI deploys, custom domain on `gillett-projects.com`. A
WebGPU app is entirely static so this works with no server side. The constraint it creates is
a 25 MiB per-file limit, so the large Galaxy Zoo files stay in the science tier and never
enter the browser bundle.

That decided the build tooling too. **Plain ES modules, no build step.** The files the dev
server serves are the files that deploy. For a physics engine I would normally want
TypeScript; the compensation is that the numerically load-bearing code has a CPU reference
implementation and an assertion that the GPU matches it, which is worth more than types.

### The benchmark, and the answer that was too good

The first run reported **8.6e14 pair-interactions per second**. On a 10-core integrated GPU
that is around 17 PFLOPS.

The pipelines were created with `layout: 'auto'`, and WebGPU's automatic layout **omits any
binding the entry point does not statically reference**. The `direct` kernel never touches the
`massives` buffer at binding 0, so binding 0 vanished from its layout, every bind group was
rejected, every dispatch was silently dropped, and the timer measured an empty command buffer.
Infinite speed, because nothing happened.

What makes this the interesting kind of bug is that **the failure produced a better-looking
result than success would have.** Nothing said "error". It said 8.6e14. Had the number been
merely implausible rather than absurd it would have been believed and used to size the
particle budget.

Fixes: an explicit `GPUBindGroupLayout` shared by both pipelines, and — more importantly — a
**read-back assertion that the particles actually moved**, plus a check that the rate sits
below a ceiling derived from the hardware. A benchmark that can return a number without the
kernel running is not a slow instrument, it is a broken one, and its output cannot be
falsified by looking at it.

Real numbers in `bench/RESULTS.md`. Two matter.

**Direct self-gravity saturates at 1.16e11 pair-interactions/s**, flat from N=32k upward,
which is what a saturated GPU looks like. 32k particles at 107 steps/s, 65k at 27. My
pre-measurement arithmetic said 6e10 and 32k-at-60fps: right order, pessimistic by about two.

**Restricted saturates at 3.1e9 particle-updates/s and is memory-bound, not compute-bound.**
Each particle does two force evaluations but moves 64 bytes; at 8.4M particles that is 537 MB
per step in 5.27 ms, about 102 GB/s, near this part's bandwidth. So more arithmetic per
particle is nearly free and more particles is not — the opposite of the intuition I started with.

The architectural consequence is the real result of Stage 0: **the interactive tier is
rendering-bound, not physics-bound.** A million test particles cost 0.67 ms of a 16.7 ms
frame. The effort belongs in the renderer, and we can afford a particle count high enough that
a galaxy reads as continuous light instead of a cloud of dots.

The inference tier is tractable on a desktop: a 100k-particle, 500-step encounter is about
35 ms, so a 200-iteration gradient fit is on the order of 14 seconds, and reproducing Galaxy
Zoo's 10^5 samples for one system is about an hour of unattended compute against the three
million human classifications it took in 2016.

These are not application frame rates. Nothing was rendered.

### The 62-versus-56 discrepancy that was mine

I had recorded that the Galaxy Zoo page offered 56 target files against the paper's 62, and
flagged it "do not assume". Checked against the actual files: `table1.txt` has 62 targets,
`table4.txt` has 62 rows of best-fit parameters, and the page links 62 parameter files. The
count is 62 and the paper is consistent.

The "56" came from an LLM summary of the data page, not from the page. `target_info.txt` has
55 rows plus a header and is a different subset, most likely what the summary saw. **A fetch
summary is a report, not an observation.** Flagging it as unverified was right; the
inconsistency was manufactured by the instrument I used to read the source.

Also worth recording from Table 4: the `Min`/`Max` columns are **search bounds, not credible
intervals** — Max mass ratio reaches 889.8. Only the `±` is a spread. Conflating them would
flatter any comparison enormously.

And the first download of the 62 files "succeeded" with 62 files of 145 bytes each: a 302
redirect that `curl` did not follow because I omitted `-L`. The re-run validates gzip magic
bytes and a minimum size per file, so "downloaded" cannot again mean "received an error page".

---

## Stage 1 — the engine

Split by precision rather than convenience: the two-body galaxy orbit integrates on the **CPU
in float64** through the same `RestrictedSim` used as the test reference, and the test
particles integrate on the **GPU in float32**. Two bodies cost nothing on the CPU, and the
encounter geometry that every fitted parameter will depend on never touches float32.

The CPU reference exists so the WGSL kernel has something independent to be checked against.
Two implementations written from the same equations, in different languages, with opposite
sign conventions, agreeing to float32 tolerance is evidence. Either one agreeing with its own
earlier output is evidence about nothing.

### The standing assertions, and what they caught

26 physics checks and 5 GPU cross-checks. Three are paired with a **sensitivity check that
must fail** under a broken configuration, because a test never observed to fail is
indistinguishable from a test that cannot fail.

The sharpest is the **Laplace-Runge-Lenz vector**. Energy and angular momentum are conserved
by *any* central force, so neither can tell an inverse-square law from a softened one. LRL is
conserved only for exact 1/r², so it can. Measured: 7.3e-6 drift over three orbits with a
point mass, and 1.19 — five orders larger — with softening at half the pericentre distance.

Four failures on the first run, three of them real.

**Hernquist v_circ² vs r·|accel| off by 3.7e-12.** My own `+ 1e-12` added to r inside the
force law. An epsilon there is not a safety net, it is a systematic error.

**Time reversal residual 4.1e-7** where KDK is algebraically exact. The particle arrays were
`Float32Array` while the galaxies were `Float64Array`. Made the reference float64 throughout;
residual dropped to **5.07e-16**. The float32 number is now *recorded on purpose* as a
characterisation test, because the shipped engine and the planned gradient adjoint both run in
float32 and that residual is the floor on gradient accuracy through a long rollout.

**Energy convergence ratio 2.13 instead of 4.** Not the integrator: I was measuring the
*maximum* error over samples, and the sampling changes with the step count. Measured at a
fixed physical time instead, the ratio is exactly 4.00.

**Closure convergence 3.50 → 2.66 → 1.71**, getting *worse* with resolution. That is an error
floor, and it was the float32 bug again in a third disguise: `keplerSim` built its initial
condition as `Float32Array`, quantising the start to ~6e-8 before the float64 integrator saw
it, which put a floor near 1e-5 that the discretisation error dropped below around 20k steps.
Float64 initial conditions: **4.00 → 4.00 → 4.00** across three halvings. Textbook second order.

The lesson worth keeping: **float32 contamination of a float64 reference presented itself
three different ways** — as a reversibility failure, as a convergence-rate failure, and as an
error floor — and only one of those looked like a precision problem.

### The green suite that was not running

The GPU suite reported 27/27 green while running one of its five checks: `runGpuTests` fired
`checkAsync` without awaiting, so `report()` ran before the rest resolved.

That is the **same failure as the benchmark**, in a different subsystem, three hours apart: a
green result produced by work that never happened. So the fix was not just the missing
`await`. The harness now declares how many checks a suite intends to run and **fails on a
count mismatch**. A pass rate cannot detect missing tests; only a count can.

Final state: **31/31, expected 31, complete.** The GPU cross-check agrees with the CPU
reference to 1.03e-3 over 2000 steps, while a deliberate 1 per cent mass error diverges to
4.38 — the comparison is about 4000 times more sensitive than its own noise floor.

---

## The tree loss

At **22:02:50** the entire working tree was deleted. Only `src/render/` survived, because two
files happened to be written a few seconds afterwards and recreated the path.

I cannot identify what did it. The volume is healthy: writes persist, `log show` reports no
unmount, eject or APFS errors in the window, and there is no shadow copy on the boot disk. It
was not, as far as I can reconstruct, any command I ran, but I cannot rule that out either and
I am not going to invent a cause to close the question.

Everything was recreated from context within about twenty minutes, in its final fixed state,
and re-verified at 31/31. The genuine loss was the downloaded Galaxy Zoo data, re-fetched.

The response that matters: **git**, which would have made this a `git checkout` instead of a
rebuild. It is now initialised and every stage is committed. Doing that at the start would
have cost thirty seconds.

---

## Stage 2 — the renderer

Three stages: additive Gaussian splats into an `rgba16float` HDR target with no depth test
(emission does not occlude emission, and sorting a million particles per frame to fake that
would be both slow and wrong); a six-level bloom chain, 13-tap downsample and tent upsample;
then AgX tone mapping to the swapchain.

The design principle is **do not fake brightness**. The enormous dynamic range of a galaxy
comes from the *density* of overlapping splats, and the tone mapper then does what a camera
does. That is why the core saturates and the tails stay faint without either being authored.

AgX rather than Reinhard or ACES specifically because a galaxy core is many stops above its
tails: Reinhard desaturates bright regions to white and ACES pushes them yellow, while AgX
holds hue into the highlights, so a saturated core stays the colour of the stars in it.

A **science view** drops bloom, the tone curve, the vignette and the starfield entirely and
outputs a linear readout with a known mapping, because the beautiful image is not
quantitatively readable and pretending otherwise is how you fool yourself.

### 198 warnings, none of which named the cause

The canvas rendered black at 60 fps with zero errors and 198 warnings, all variations of
"Invalid CommandBuffer is invalid due to a previous error".

I nearly acted on a theory — that read-only storage buffers in the vertex stage were
unsupported — and checked it instead. The limit is 8. The theory was wrong.

The actual cause, found with `pushErrorScope`: **`ref` is a reserved keyword in WGSL** and I
had named a variable that. One shader compile error, one invalid pipeline, and then hundreds
of downstream warnings per frame, none mentioning the shader.

The systemic fix matters more than the rename: every shader module now goes through a helper
that checks `getCompilationInfo()`, logs with the label and line, and **throws** on error. A
compile failure now surfaces as itself instead of as an unreadable flood.

### First light

**300,000 test particles at 60 fps / 16.7 ms**, showing two tidally distorted discs, a bridge
between them, and long sweeping tails.

And the validation that matters more than the picture: the **prograde and retrograde scenarios
run the same orbit, the same pericentre, the same time after pericentre, and differ only in
disc spin direction. Prograde produces spectacular tails and a bridge; retrograde produces
essentially none** — just mildly thickened discs.

That asymmetry is the central result of Toomre & Toomre 1972, and it emerges here from the
equations without being asked for. It is *not* a reproduction of their paper: their parameters
have not been read, and the scenarios named "Mice-like" and "Antennae-like" are configurations
chosen to look right, not published fits.

### Turning the picture into a number

The paragraph above originally ended there, and it should not have. "Prograde produces
spectacular tails and retrograde produces none" was a claim drawn from **looking at two
pictures**, which is precisely what this project's own check table forbids. So it became
`test/morphology.test.js`, which measures the tidal fraction — the share of each galaxy's own
material now beyond 9 kpc **from its own centre**, so a wide separation cannot masquerade as a
tail.

**Prograde 27.2 per cent. Retrograde 0.2 per cent. A ratio of 131.5.**

The control is the important part: same masses, same pericentre, same eccentricity, same
epoch, same random seed, and the test asserts the two orbits are identical to 1e-6 (both give
separation 14.258) before comparing. The only difference is the sign of the disc spin. Without
that assertion the result would only show that two scenarios differ, not *why*.

Two more, because a number that has not been challenged is not a result:

- **Not a resolution artefact.** 27.09 / 27.18 / 27.12 per cent across a 4x range of particle
  count. Spread 0.3 per cent.
- **Not a timestep artefact.** 27.18 / 27.18 / 27.19 per cent across a 4x range of timestep at
  fixed physical end time. Spread 0.0 per cent.

And one that deliberately does **not** assert:

- **Softening changes the answer.** 27.98 / 27.18 / 24.80 per cent at 0.5x / 1x / 2x, an 11.3
  per cent spread. This is recorded rather than bounded, because the honest expectation is that
  softening matters, and pretending otherwise would be inventing an insensitivity the physics
  does not have. It is now the largest known systematic in the morphology numbers, it is
  written down, and any future change to the default is a visible decision rather than a silent
  one.

---

## Stage 3 — the four modes, and the honesty problem in detective

Sandbox, Detect, Tour and Atlas, plus shareable URL state and keyboard access throughout.

Detective is the one worth writing about, because building it was mostly an exercise in
refusing to fake things.

It runs on real data: 62 Galaxy Zoo target systems with the published Table 4 encounter fits,
and 56 SDSS DR18 colour cutouts. Six targets have no image because they fall outside the SDSS
footprint, the Antennae among them, being too far south. (Note for anyone reading quickly:
that 56 is a real, explained number, unrelated to the phantom 56 from Stage 0.)

**The scale problem.** The first version laid the simulation over the observation and looked
convincing, and it was meaningless. The image is measured in arcseconds and the simulation in
kpc, and without the target's distance the two are unrelated: any two things can be made to
look alike at some scale. So each target's redshift now drives a proper flat-LambdaCDM
angular-diameter distance, and the camera is positioned so one simulated kpc covers the same
screen distance as one observed kpc. For Arp 242, the Mice, that is 0.442 kpc/arcsec and a
158 kpc frame. Only now does a visual match carry information, and the first thing it says is
that the simulated discs are too small for the real system, which is exactly what an honest
overlay is for.

**Three refusals**, all surfaced in the interface rather than buried:

- **Photometric redshifts are flagged as unreliable.** Arp 240's photo-z is 0.107 against a
  true value near 0.023, which would make its physical scale wrong by roughly four. 40 of the
  54 calibrated targets are spectroscopic; the other 14 say so on screen.
- **Targets with no redshift say UNCALIBRATED** rather than quietly displaying a wrong scale.
- **`beta` is not mapped.** Table 4 publishes five fitted parameters; four translate into this
  engine directly. I have not read Holincheck et al. closely enough to know what `beta`
  parameterises, and guessing at an angle convention is precisely how you produce a confident
  wrong overlay.

And **clamping is reported**. Several published fits sit outside what this engine models — Arp
240's has eccentricity 3.7 and an 81 kpc pericentre — so loading them requires clamping. A
button labelled "load published fit" that quietly loads something else is worse than one that
refuses, so it now says what it changed.

The standing caveat, in the panel every time: the published fits were obtained with JSPAM's
potential and disc model, not this one. The numbers transfer; the result does not.

## Deployment

Live at **https://galaxy-collisions.pages.dev**, Cloudflare Pages free tier, following the
existing `lenny` project's pattern. `build_dist.sh` assembles 1.5 MB across 74 files: index,
`src/`, the target catalogue and the 56 cutouts. Test suite, benchmarks and raw Galaxy Zoo
archives stay out.

Verified **on the live URL** rather than only locally, because the deployed environment is the
one that counts: 62 targets, 300k particles, 60 fps, no render validation errors.
