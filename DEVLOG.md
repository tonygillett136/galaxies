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
material now beyond **20 kpc** from its own centre (`RCUT` in `test/morphology.test.js`), so a
wide separation cannot masquerade as a tail. The 9 kpc quoted here previously was the dwarf
model's cut and never matched the shipped check.

> **These numbers are from the DWARF model and are superseded.** They are kept because the
> method is the point, but the model they were measured on was wrong — see "The galaxies were
> dwarfs" below. The current figures, on the Milky Way-scale model with the corrected pair
> force, are **prograde 15.1 per cent of a disc beyond 20 kpc against 2.5 per cent retrograde,
> a ratio of 6.0**. A referee caught this section still presenting the old numbers as the
> project's headline validation result.
>
> And then it went stale a SECOND time. The 4.7 per cent that replaced the dwarf figure was
> itself measured before round 3 corrected the pair force, which was up to 3.09x too strong —
> a weaker mutual force means the pair moves more slowly through pericentre and forces the
> discs for longer, so the tidal fraction roughly quadrupled. Twice in three rounds the same
> sentence has been wrong. That is why the numbers are now regenerated by a test rather than
> by me.

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

---

## The review board, round 1

Six reviewers with different lenses, briefed to break rather than approve, each finding then
checked by an independent verifier told to refute it. **70 findings. 48 confirmed, 19 partial,
3 refuted.**

The three refutations are the loop working: two were things I had already fixed before the
verifier looked (slider sync, dust), and one was a misreading. Without the verification pass I
would have "fixed" work that was already done.

The synthesis made a point sharper than any individual finding: **the claims were consistently
wider than the checks behind them.** The disc that shipped was not the disc that was asserted.
The benchmark harness that produced every throughput number no longer existed. The "linear
readout" clipped and gamma-encoded. And the parameterisation the whole inverse problem will
sit on had an exactly flat direction nobody had looked for.

It also flagged its own limitation, which I should not skip past: **only a subset of the 70
findings were actually reproduced by a verifier.** Unverified criticals are *reported*, not
absent. Both Newton's-third-law reports were in that unverified set — I checked that one
myself, numerically, before touching anything.

### What round 1 actually changed

**Newton's third law was violated for every unequal-mass encounter.** Each galaxy felt the
other's extended potential evaluated independently, which breaks the third law the moment the
two profiles differ. Measured before the fix: 34 per cent force asymmetry at mass ratio 0.1.
The pair force is now computed once and applied equal and opposite, symmetric to 1.2e-16.

The part worth remembering is *why the existing test missed it*: my conservation check gave
both galaxies the **same Plummer scale**, so the asymmetry cancelled exactly. The test could
not detect the thing it existed to detect. It now uses mismatched scales.

**The units suite did not test the units.** Two checks compared code against numbers I had
typed from the same derivation; the other two cancelled the velocity unit algebraically and
pass with G wrong by any factor at all. Replaced with Kepler's third law for the Earth's orbit
— the AU, the solar mass and the Julian year, three quantities with nothing to do with the
kpc/1e10-Msun derivation — closing to 3.8e-5.

**The galaxies were dwarfs.** 1e10 solar masses, peak circular speed 118 km/s, rotation curve
falling as r^-0.33, no dark halo at all, used for scenarios named after large spirals. Now
bulge plus disc plus halo totalling 7.0e11 Msun with a circular speed flat at 208-220 km/s
from 3 to 25 kpc. Scenario pericentres moved from a few kpc to 14-55 kpc, because four of the
seven old ones put pericentre *inside* the primary's disc, which is a collision and not a
tidal encounter.

**"Pericentre" was not the pericentre.** The Kepler setup assumes point masses; extended
galaxies do not execute the orbit it prescribes. Asking for 25 kpc delivered 34.6. It now
solves for the Kepler value that delivers the requested one: 15.6 in, 25.0 out. This matters
well beyond tidiness, because detective mode maps *published* r_min values through that
parameter.

**Mass and epoch are an exactly flat direction.** Scaling every mass by 4 and every time by
1/2 reproduces every morphological moment to 3.8e-8. Morphology alone therefore cannot
separate total mass from time-since-pericentre. The gauge is now declared in
`docs/IDENTIFIABILITY.md` — hold m1 = 1, fit dimensionless quantities, take physical mass from
an external constraint — along with what has *not* been established: other degeneracies
unsearched, near-degeneracies more dangerous than exact ones, and viewing angle absent from
the parameter set entirely.

My first attempt at this test **refuted** the finding. The test was wrong: I evolved both runs
for the same total time when the scaled run must run for t/√λ, the very rescaling under test.
Verification needs verifying too.

**There was no dynamical friction**, so the galaxy centres conserved energy exactly and could
never merge, however close the passage — while one scenario was blurbed as a merger. Now
Chandrasekhar friction with per-component densities, force-symmetrised so momentum is still
conserved to 2.85e-15 while energy is not, which is the entire point. Apocentre decays from
296.7 to 29.1 kpc.

The first implementation *gained* energy by a factor of 250. Drag is stiff: where the
Hernquist density diverges as 1/r, the per-step impulse exceeded the relative velocity and
reversed it, so a decelerating force accelerated. Two limits, both physically motivated rather
than fudges: floor the separation used for density at half the larger scale radius, because
Chandrasekhar assumes a compact satellite in a smooth field and once cores overlap that has
already failed; and cap the per-step impulse at a quarter of the relative velocity.

Friction is **off by default**, because it breaks exact time reversal. That is not a defect to
apologise for: dissipation is irreversible, and leapfrog's reversibility only ever held for
velocity-independent forces. The interface says so whenever friction is on.

**And the float32 number was measured on the wrong system.** My 4.3e-7 came from a toy case:
one particle, a fixed point mass, float64 arithmetic quantised only at step boundaries.
Re-measured on the shipped GPU path at the shipped timestep through pericentre: median 2.0e-5,
p99 8.4e-4, worst 3.9e-3 kpc against 81 kpc of motion. A reviewer's independent 3.4e-4 sits
right at my p99.

Assertions went from 31 to 46, and the pass rate is not the point — the check-count guard is,
because two of the night's failures were green suites that had silently skipped work.

---

## The adjoint, which was supposed to be next session

The plan said the differentiable inverse problem was Phase 2 and explicitly not tonight,
because doing it badly under time pressure is worse than not doing it. That reasoning still
holds for the full system. But after the review-round fixes the foundations were solid enough
that the *one question the whole direction depends on* could be asked cheaply, and asking it
early is worth more than asking it well-rested:

**Does a reverse-mode gradient through the forward model agree with finite differences?**

It does.

- d(loss)/d(initial position): worst relative error **1.4e-7** over ten components
- d(loss)/d(initial velocity): worst relative error **7.9e-9**
- and a sensitivity control confirms a gradient corrupted by 1 per cent *is* caught, so the
  comparison is measuring something

The implementation is a hand-written adjoint of leapfrog KDK, using the analytic Jacobian of
each spherical potential, `da_i/dx_j = -f δ_ij - f'(r) d_i d_j / r`. The loss is L2 between
Gaussian-splatted density grids — the same operation the renderer performs, which is the
convergence noticed on the first evening finally paying off: the picture on screen and the
objective being minimised are one code path.

Then the obvious follow-on. From a start 0.695 away in parameter space, Adam over 220
iterations **recovered the disc angles that generated the target**: inclination 0.5500 against
a true 0.55, argument 0.9000 against a true 0.90, with the loss falling from 173.8 to 1.7e-8.

**What that is worth, precisely.** It recovers parameters from data generated by the *same*
forward model, so it tests the optimiser and not the model. That is the statistician
reviewer's point, and it is written into `docs/IDENTIFIABILITY.md` rather than left as a
caveat I might forget. The rungs above it are: recover from data generated by a *different*
code, then from real observations where there is no ground truth, then coverage tests to find
out whether a claimed 68 per cent interval actually contains the truth 68 per cent of the time.

Scope, so it is not overstated. The galaxy trajectory is held fixed, so the free parameters
are the disc orientations — exactly the sub-problem Identikit makes a human solve by hand.
float64 CPU only, because the float32 GPU path's measured reversal residual would dominate a
gradient. And states are stored rather than recomputed by reversal, because a gradient check
must not be validating the checkpointing scheme at the same time as the gradient.

---

## The review board, round 2

The same six reviewers, told what had changed and asked a sharper question: are the round-1
fixes **correct**, or merely present? A wrong fix is worse than the original defect, because it
now carries a comment asserting it is handled.

**47 findings, 41 confirmed, 7 partial, 0 refuted.** All six verdicts: "not yet".

It justified itself in the first two items.

### Two round-1 fixes were wrong, and no test could see either

**`erf` was wrong by 0.149 absolute.** Abramowitz & Stegun 7.1.26 has `exp(-x²)` multiplying the
whole polynomial; I had applied it to the last term only. erf(3) came out as 0.9494 against
0.99998, under a comment claiming 1.5e-7 accuracy. Every dynamical friction magnitude was wrong.

**The symmetrised pair force was 2.83x too strong** at close separation. Round 1 replaced a
one-sided evaluation (which broke Newton's third law) with the mean of two one-sided
evaluations. That is exactly momentum-conserving and still wrong: both estimates use the other
body's *full* mass at separation d, double-counting the softening each extended profile already
supplies. The true mutual force is the convolution of the two distributions, which for Plummer
spheres is exactly a Plummer force with the scale radii combined in quadrature. Verified against
that closed form to 1e-12.

**Neither was detectable by the tests that existed**, and the reason is the lesson:

> The friction checks assert that energy **falls** and the orbit **decays**. Half-strength drag
> does both. An erf wrong by 15 per cent of full scale does both. **An assertion on the sign of
> an effect cannot detect an error in its magnitude.**

So the fix was not only the arithmetic. It was adding checks against *analytic answers* rather
than against the code's own behaviour: erf against known values, the pair force against the
closed-form convolution, and Chandrasekhar drag against the formula written out independently in
the test.

### Which promptly found two more things

Writing that Chandrasekhar assertion exposed that the drag was **still half strength** after the
erf fix — I had averaged the two drag terms, copying the gravity symmetrisation. Gravity needed
it because two one-sided estimates of *one* force disagreed. Each drag is already its own
equal-and-opposite internal pair, so the total is their sum. A reviewer measured the ratio at
exactly 2.000 across 17,942 steps.

And it exposed something worse than a factor. Because the drag force scales as M², a heavy
galaxy ploughing through a tiny satellite's wispy halo out-drags the satellite twentyfold,
against a density a million times lower. That is not a small correction; it is Chandrasekhar
used outside its domain, which assumes a **compact** perturber in a smooth field. Each term is
now weighted by that condition.

### The ring, in three acts

Round 1 fixed the ring scenario's disc from coplanar to perpendicular. It still produced no ring.

Measuring rather than reasoning found the second cause: **the orbit precesses** in an extended
potential, so the companion arrived 64.7 degrees off the disc normal regardless of where the
setup had pointed it. Orienting the disc from the *measured* approach direction gave 0.00
degrees — and still no ring.

The third cause was that the companion was as diffuse as a spiral. With a 20 kpc halo scale,
almost none of its mass lies within a few kpc of the impact, so the impulse is far too weak.
Measured: **no ring at any mass ratio up to 2.0.** Real ring-galaxy intruders are compact. At
compactness 0.08 the ring appears, and is now asserted: the peak surface density moves from the
centre to ~7 kpc and rises 3.5x there.

> **These two figures were wrong here for a full round** — the DEVLOG and the review log both
> said ~11 kpc and 4.1x while the shipped check measured ~7 kpc and 3.5x. Three reviewers found
> the class of defect and one found this instance. They are now regenerated from the run by
> `test/claims.test.js`, which reads this file back and fails the build if the text and the
> measurement disagree.

The same precession also meant closest approach did not happen at t = 0 — the round-1 pericentre
*distance* fix had made the *epoch* worse. The clock is now anchored to executed closest
approach.

### And the part I would least like to have written

The synthesis's headline was that **the engine is close to sound and the documents are not**.

`docs/IDENTIFIABILITY.md` — the file whose heading is "Verified, not argued", and on which the
entire inverse problem is to be built — tabulated five morphological moments where the check
computes four, with numbers from a scratch script at a different particle count. Three reviewers
found it independently. The *result* was right; the table nobody regenerated was not.

`DEVLOG.md` still presented the abandoned dwarf model's 27.2 per cent and 131.5x as the
project's headline validation result.

And `encounter.js` asserted that "real interacting pairs pass at tens of kpc" — **refuted by
this project's own data.** Across the 62 Galaxy Zoo systems with a published fit, the median
r_min is 11.6 kpc and 82 per cent are under 20. Real pairs routinely pass inside the disc
radius. My justification for the retune was wrong even though the retune itself was right, for a
different reason: the old pericentres were small because the *model* was a dwarf.

Detective mode was clamping published pericentres at 20 kpc and eccentricities at 2.0 — dwarf-era
constants that silently rewrote 35 of 59 targets. Tested directly, the engine is exact at e = 5.0
and 90 kpc. A clamp should come from a demonstrated failure, not from a slider someone once chose.

Assertions went **46 → 57**.

### A limitation of the round itself

The synthesis reported that **no verifier result reached it** — all 47 findings arrived marked
`NOT CHECKED` — so it re-checked every load-bearing finding against the source itself and
labelled anything it had not personally reproduced as *reported*. It also noted the tree was
being edited while the reviewers wrote, so some of its own findings were already fixed. Both
limits are recorded in `review_board/REVIEW_LOG.md` rather than smoothed over.

---

## Round 3, and the night the force law turned out to be wrong

*2026-08-15, 00:12 to 04:30.*

Two process changes, both from round 2's own criticism of itself. The tree was
**frozen** for the duration — round 2 had been reviewed against files that were
moving underneath it — and verification was joined by **index** rather than by
title, because round 2's title join had failed silently and delivered all 47
findings to the synthesis marked `NOT CHECKED`.

Both worked. 36 findings, **30 confirmed, 6 partial, 0 refuted, 0 unchecked.**

### Freezing the tree turned out to be the productive constraint

I could not edit anything for thirty-two minutes, so I could only measure. That
is how the worst defect in the project was found — not by the reviewers, and not
by anything I would have done if I had been free to type.

I was checking something mundane: whether the Antennae scenario's 16 kpc
pericentre was defensible against the published 1.57 kpc. It was not, but the
interesting part was what happened when I ran the published fit. Eccentricity
0.493 is a **bound** orbit with a 4.6 kpc apocentre — the two galaxies should
oscillate inside 5 kpc. The engine flung them to 559 kpc.

My first hypothesis was that the extended potentials are shallower than a point
mass, so the Kepler velocity exceeds escape. I built a control: make the galaxies
point-like and the problem should vanish. **The numbers came back identical to
four significant figures**, which is not what a working control looks like. The
spec keys I had used did not exist, so `buildEncounter` had silently ignored them
and run the same configuration twice. The identical digits were the only reason I
noticed.

The decisive test was energy, computed at the initial state the builder actually
produces, independent of any integration:

| requested | E (point mass) | E (real potential) | |
|---|---|---|---|
| e=0.493, r_p=1.572 | −1.007e3 | **+1.289e3** | sign flip |
| e=0.493, r_p=5 | −5.379e2 | **+6.858e1** | sign flip |
| e=0.493, r_p=12 | −2.226e2 | −4.186e1 | bound |

`solveKeplerPericentre` corrects the **distance** of closest approach — the
comments say so, at length — and nothing corrects the **energy**. So an encounter
requested as bound was launched above escape speed in the potential it actually
inhabits. **24 of the 36 bound published fits**, including the Antennae.

And it was never only Detect mode. Nothing anywhere checked eccentricity, so the
sandbox slider was untrue too: it said 0.95 and executed 0.908, said 0.85 and
executed 0.693. Pericentre had been solved for; eccentricity had been assumed.
The label was wider than the check behind it, which is the same failure the review
board has now found in three separate places.

### The fix is exact, and it needed no iteration

For a bound orbit both turning points are known. At a turning point ṙ = 0, so

    E = L²/(2μ r_p²) + W(r_p) = L²/(2μ r_a²) + W(r_a)

Subtracting eliminates E and gives L in closed form; E follows. Verified to
reduce to Kepler for a point mass at **1e-16**, and to deliver requested
pericentre *and* eccentricity exactly — request 0.95, execute 0.95000.

Placing the pair at pericentre and rewinding through the shipped leapfrog makes
the executed pericentre correct by construction rather than secant-solved. The
rewind is **capped at apocentre**, because a tight bound orbit's radial period is
shorter than `tStart` and rewinding the full span wraps past apocentre and leaves
the pair *outbound* at t = 0. I found that by testing: a request for r_p = 5
executed at 10.7 with "pericentre" at t = 0. Round 3 found the same failure from
the Kepler side, on 23 of 59 fits.

### Making the orbit bound does not make it modellable

Ten catalogue fits have an apocentre **inside the disc radius**: the galaxies
never separate, and a rigid-potential model with discs equilibrated in isolation
is not describing them. Eleven more have the companion dominating the disc edge
even at apocentre. **21 of 59 are outside the model.**

My first attempt at a criterion was wrong in a way worth recording. I used one
perturbation ratio for everything and got 30–50 for the deepest systems, which
looked decisive and was garbage: when the apocentre is inside the disc my code
clamped the evaluation distance to 1e-3 kpc, so it was measuring the companion's
acceleration at its own centre. **A metric undefined in precisely the regime it
was built to judge.** The correct structure is two tiers, and the useful property
is that the *marginal bucket comes out empty* — the distribution is bimodal, so
the answer does not depend on where the threshold sits. That matters more than the
threshold, because an arbitrary threshold is what a referee should attack.

Detect mode now says so. Loading the Antennae's published fit reports
*"OUTSIDE THIS MODEL: apocentre 4.6 kpc is inside the 13.5 kpc disc"* instead of
drawing something and inviting a judgement.

### Meanwhile, the reviewers found that round 2's fixes were wrong

Two of them were mine, written confidently, under comments asserting they were
handled.

**The friction validity gate was inert.** It divided the perturber's *smallest*
component scale by the field's *largest* — a built-in factor of 40 — so w =
1.0000 at every mass ratio the interface can reach. Its asserting test passed
because it used bare single-component potentials where those coincide. **It
validated a branch `galaxyModel()` cannot construct.** Two reviewers found it
independently with identical arithmetic.

**The pair force was up to 3.09x too strong.** Round 2 had replaced a
2.83x-too-strong kernel with `M_i M_j d/(d²+a_i²+a_j²)^{3/2}` under a comment
claiming it was "exact for the Plummer components" and erred "toward more
softening rather than less". Measured against quadrature, every part of that was
false — 1.96x at 5 kpc, 2.51x at 10, **3.09x at 20**, for the halo carrying 94%
of the mass; and 1.29x at d=5 for Plummer–Plummer, so not exact there either. The
convolution of two Plummer *densities* is not a Plummer density; only a single
Plummer sphere's *potential* has the softened point-mass form, which is what I
had confused.

The pericentre solver had been hiding it for two rounds: it retunes until the
executed r_min matches the request, so the **distance** of closest approach
stayed right while the **speed** through it did not.

`src/engine/pairforce.js` now computes the exact force and the exact mutual
potential energy by quadrature. The angular integral reduces to a radial one with
an elementary inner step for both Hernquist and Plummer, so the exact answer costs
one well-behaved 1-D quadrature rather than a 2-D one.

The tabulation is cubic Hermite where the **force supplies the potential's nodal
derivative**, so F and W are consistent by construction rather than at the nodes
only. That is not a refinement: with linear interpolation the leapfrog stopped
conserving the energy being reported, 4.9e-4 relative drift over 3000 steps.
Hermite gives 1.5e-7. I got the sign wrong first, and the check that caught it was
the one comparing the two independently derived integrals against each other.

**The consequence is that every morphology number moved.** Prograde tidal fraction
3.9% → **15.1%**, retrograde zero → **2.5%**, ratio 6.0. A weaker mutual force
means the pair moves more slowly through pericentre and forces the discs for
longer. The qualitative result — the prograde/retrograde contrast — survives.
Every number built on the old force law did not.

### The documents are now checked against the measurements

Three rounds, three instances of the same defect: a number in prose that no longer
matches the check that produced it. Round 3 found six at once. Each previous time
I fixed it by hand, which restores the values and leaves the mechanism intact —
and the mechanism is that prose and measurement are not connected.

`test/claims.test.js` connects them. The suites record what they measured; the
check fetches the shipped text and fails the build when a registered figure has
drifted. Eleven figures across the HTML, the tour, the engine (blurb *and* file
header), the README, the adjoint and this file.

It caught the drift immediately, including two the reviewers had not listed — this
file's tidal cut radius said 9 kpc where the test uses 20, and `encounter.js`'s
own header carried the stale 4.7%. It has since fired three times on my own
changes within the same night. That is the point: **the failure is now loud.**

The 4.7% is worth dwelling on. It had already replaced the dwarf model's figure
after a referee caught that, and the correction notice is still in this file.
Then it went stale again when the force law changed. Twice in three rounds the
same sentence has been wrong, both times in a passage explaining that the previous
version was wrong. That is why it is a test now and not a discipline.

### The recovery demonstration was recovering the particle realisation

The finding that most changes what this project can claim.

It fitted (inclination, **argPeri**) against a target built from the same particle
draw. argPeri rotates an axisymmetric disc within its own plane: shifting every
particle's phase by δ and shifting argPeri by δ give identical states, **verified
to 3.6e-15**. So it is a relabelling of which particle sits where, visible only
through finite sampling — this project's own `IDENTIFIABILITY.md` already called
it a discretisation artefact, and the check was fitting it anyway. And sharing the
realisation with the target made the optimum exactly reachable, loss ~1e-30: a
demonstration that an optimiser can find a configuration it was handed.

It now fits (inclination, **node**) — the node rotates the disc *plane*, which was
hardcoded to zero — against an **independent** realisation, and reports error
against N:

| N | floor/L(start) | recovered inc | recovered node | error |
|---|---|---|---|---|
| 40 | **1.26** | 0.51 | **−0.95** | 1.853 |
| 150 | 0.62 | 0.76 | 1.15 | 0.329 |
| 600 | 0.32 | 0.61 | 1.17 | 0.274 |
| 2400 | 0.089 | 0.59 | 0.86 | 0.052 |

True: inclination 0.55, node 0.90. The error falls with sampling, so the
parameters *are* identifiable from morphology in principle. But at N = 40 two
independent draws of the same disc differ **more** than the true and starting
orientations do, so there is no signal above the sampling noise — and the node
converges to **−0.95** against a true **+0.90**.

I wrote here that the negative sign was the reflection degeneracy caught in the
act, and that the two findings corroborated each other. **Round 4 showed that was
false, and it is the mistake from this round I would least like to repeat.**

The reflection degeneracy flips the INCLINATION. The N = 40 fit returns
inclination +0.506 against a true +0.55 — sign unchanged. It is the NODE that
lands negative, which is a different quantity entirely. The wrong basin belongs to
a *third* degeneracy round 4 found and I had not: (i, ω, Ω) → (−i, ω+π, Ω+π),
which is exact at EVERY geometry rather than only when coplanar, because
R_z(π) R_x(−i) R_z(π) = R_x(i) identically. Verified to 5.0e-16.

Two results were adjacent in time and both involved a sign, and I narrated them
into agreement. Two findings agreeing is evidence. Two findings I have *arranged*
to agree is a story, and it is exactly the kind of story that feels like
understanding.

### Where this leaves it

Assertions **57 → 71**, all complete, deployed and verified live at 60 fps with
300k particles and no console output.

Six reviewers, six verdicts of "not yet". The A+ gate has not passed, and the
synthesis was right about why the process itself is the weak point: **round-1
fixes have not been re-verified since round 1**, and round 3's largest single
yield was round-2 fixes that were wrong. The untested hypothesis is that round-1
fixes are wrong too. Nothing in the loop would currently surface that.

---

## Round 4: the round that found my fixes were the problem

*2026-08-15, 01:38 to 04:00.*

Half the board on the new code, half aimed at the blind spots round 3's own
synthesis had named: round-1 fixes never re-verified, the GPU path that actually
ships, data provenance, and the review process itself. Two new lenses — a
regression auditor and a performance engineer.

**36 findings, 30 confirmed, 8 critical, 6 regressions.** One verdict of *serious
problems*. It was the strongest round by a distance, and most of its criticals
were mine from round 3.

### The demonstration I want to remember

A reviewer proved my friction-gate test inert by **deleting the gate from
`cpu.js` entirely** and running the suite. It passed with byte-identical output.

The test re-implemented the gate locally instead of calling it, so it was
checking a copy of the logic against itself while the shipped code could be
removed without consequence. Round 3's lesson was "a fix can be present,
commented as handled, and wrong". Round 4's is sharper: **a fix can be present,
commented as handled, and validated by an assertion that cannot fail, in a regime
the application never enters.**

### My gate was wrong in both directions at once

Round 2's gate was inert. I diagnosed that correctly and replaced it with
`R_perturber / separation`, which sounded like the right physical quantity —
Chandrasekhar assumes a point perturber in a locally uniform field, so compare
the perturber's size to the scale over which the field varies.

It failed at both ends. Beyond ~100 kpc both weights are exactly 1 and the M²
pathology runs at **20.4x** the physical term. Below ~33 kpc it zeroes *all*
drag, which is where friction physically dominates. **58.7% of the shipped
merger's dissipation came from the term the file itself calls "the formula being
used outside its domain."**

I found the too-strict half myself the previous evening, by noticing the merger
no longer merged. I did not find the too-loose half, and I would not have: I had
tested the gate at close separations because that was where I expected trouble.

Worse, one bad criterion undid two earlier rounds. Round 1 added friction
precisely so that "a scenario blurbed as a merger" could merge; round 2 raised
`tSpan` so a user could scrub to the second passage. My gate broke both.

The right criterion is the size **asymmetry** — which is exactly what round 2's
comment had always said it was. Its bug was taking the minimum over the
perturber's components and the maximum over the field's, a factor of 40. Using
the outer scale on both sides restores the stated intent:

| q | big → small | small → big |
|---|---|---|
| 1.0 | 1.000 | 1.000 |
| 0.6 | 0.976 | 1.000 |
| 0.1 | 0.385 | 1.000 |
| 0.05 | **0.055** | 1.000 |

Three attempts, and the correct answer was written in a comment the whole time.

### The disc I made thick was not in equilibrium

I set `thickness = 0.1` so the dust could produce a lane. Directly above that
default was a paragraph I had written earlier explaining that non-zero thickness
is **not** in equilibrium. I did not read it.

Giving every particle a height and a purely tangential velocity puts them all at
ψ = 0 — each at its own vertical extremum, at rest in z, *in phase*. They fall
through the midplane together: rms|z| collapsed 40% in 19 Myr. A coherent
breathing mode, which is precisely the "looks like a tidal response and is not"
failure this project's own check table warns about.

And the guard could not see it. The shipped equilibrium assertion measures the
**spherical** radius, which for these orbits is conserved by construction — it
returns ~4e-5 at thickness 0, 0.1, 0.5 *and* 2.0. It passes at every thickness,
including absurd ones.

My first fix was also wrong: a height plus a harmonic vertical velocity at random
phase is phase-mixed, but it *adds* vertical kinetic energy on top of a tangential
speed already set for the spherical radius, so the disc flew apart by a factor of
160. The correct construction is not a displacement at all. In a spherical
potential every orbit is planar and a circular orbit stays circular, so
**thickness is orbital inclination**: a circular orbit of radius r tilted by β has
|x| = r and |v| = v_c(r) exactly. Thick, phase-mixed, and in equilibrium with no
approximation. Measured rms|z| excursion 4.6%, cylindrical radius 0.02%.

### Two claims retracted

**"The parameters are identifiable in principle from morphology alone."** A
reviewer ran the control nobody had: an exhaustive 37×73 grid over the loss. The
global minimum is nowhere near the truth at any N, including 2400, and **Adam's
own endpoint beats the truth at every N**. What my four-row table measured was
where a fixed start stops after 200 iterations. Identifiability is a property of
the argmin. Retracted.

**"The two findings corroborate each other."** They do not. The sky-plane
degeneracy flips *inclination*; the N=40 fit returns inclination +0.506 against a
true +0.55, sign unchanged. It is the *node* that lands negative, and the basin
belongs to a third degeneracy I had not found: (i, ω, Ω) → (−i, ω+π, Ω+π), exact
at **every** geometry because R_z(π) R_x(−i) R_z(π) = R_x(i) identically. I
verified it at 5.0e-16.

I had two results that were adjacent in time and both involved a sign, and I
wrote them into agreement. That is the most seductive error in the whole night's
work, because corroboration is exactly what you want to find and it costs nothing
to assert.

### And the file that has now been wrong twice

`docs/IDENTIFIABILITY.md` — heading "Verified, not argued" — had every figure in
its mass-epoch table stale again, moved by my own pair-force correction. Round 2
caught the same table. The round-2 fix added a sentence telling the reader that
*"any future change to the check must regenerate this table rather than leave it
standing"*, and then a change to the check did exactly that and the table stood.

Which is the argument, as plainly as it can be made, against relying on a
sentence that asks a human to remember. All six figures are registered in the
claims guard now. The build fails instead.

### Three galaxies lost to a string join

`build_targets.py` joined Table 1 to Table 4 by name, and three names differ
between the tables. Three fits were dropped in silence — and the dropped r_min
values are 1.527, 8.734 and 4.953 kpc, **all below the median**, so the loss fell
on exactly the deep encounters the domain-of-validity argument turns on. Every
catalogue statistic in the project was computed on 59 rows of a 62-row table.
Meanwhile `LITERATURE.md` carries a proud section resolving a *phantom* 62-vs-56
discrepancy while a real 62-vs-59 one sat one script downstream.

### Instruments that lie

After `device.destroy()` the render loop kept running, the clock kept advancing,
and the fps readout held a steady 60 — *because* the device was dead. Every GPU
call becomes a no-op, so the rAF callback lands on vsync exactly. The instrument
was not merely wrong; it read **best when the situation was worst**, in a project
whose stated first principle is that instruments must not lie. Now handled:
`device.lost`, `uncapturederror`, the loop stops, and the readout says GPU LOST.

### Where it stands

**75 assertions, all complete, zero failures**, deployed and verified live.
Round 4's own verdict is *no*, and it is right: this is an excellent engine with
an evidence chain that could not, this morning, be trusted end to end. It is
better now than it was at midnight, and the honest summary is that four rounds
have moved the defects steadily *upward* — from the physics, to the fixes, to the
tests that guard the fixes, to the documents that describe them.

---

## Round 5: mutation testing, and the fix that failed at being a fix

*2026-08-15, 03:25 to 04:40.*

I pointed round 5 straight at round 4's work, because three of those fixes were
third attempts at the same defect and the pattern had held four rounds running.
The brief said to assume it had repeated until measured otherwise.

It had. **Six of eleven round-4 fixes were present, commented as handled, and
wrong.**

### The instrument this project should have had from the start

Round 5's reviewers stopped reading code and started **breaking it**. Take a `git
archive HEAD` copy, delete or revert a shipped fix, run the suite, see whether it
notices.

Thirteen mutations. Thirteen greens. Including:

- setting the friction validity weight to `1` outright — the entire gate
- reverting the disc thickness default to `0` — the entire feature, **byte-identical output**
- emptying the whole CLAIMS table — "0 documented figures match their measurements", green

A test that passes when you delete the code it guards is not evidence. Four rounds
of reading found real defects; one round of mutation found that fourteen of the
assertions protecting them were decorative.

### The fix that failed at being a fix

Round 4's headline lesson, in `cpu.js`, is *"A guard that does not call the thing
it guards is not a guard."* Immediately beneath it: *"`frictionWeight` below is
the same function the integrator uses."*

It was not. I exported the function so the test would stop re-implementing it,
and then left the integrator with an inline copy of the same smoothstep, sharing
only the ratio helper. So the test exercised a function nothing in the simulation
called — and the sentence asserting otherwise was false the moment I wrote it.

The claims guard failed the same way. Round 4 rewrote its sensitivity check "to
drive the real comparison" and gave it a private seven-line copy instead. Round 5
neutered the live loop *and* changed the headline physics figure in `index.html`
from 15.1% to 99.9% — a 580% error in a sentence a user reads — and the suite
reported 75/75 green with that check passing.

Both of those are fixes written specifically because a reviewer had proved the
previous version decorative. Writing the fix and writing the thing the fix was
for are apparently different acts, and I did the second badly while believing I
had done it.

### Wrong twice, in opposite directions, about one line

The drag impulse cap. Round 4 reported `0.25/dt` as dimensionally inconsistent —
it compares a per-mass force against a rate — and I agreed and changed it to
`0.25·v/dt`.

The drag is applied as `acc -= F * vx / mass`, where `vx` is a component of the
velocity **vector**, not a unit vector. So the acceleration is F|v|/m, and
|a|·dt ≤ 0.25|v| gives F/m ≤ 0.25/dt with |v| cancelling exactly. **The original
was right.** I made the cap |v| times too permissive on the strength of a report
I did not check, which is precisely what this project's own ways-of-working tells
me not to do: a report is the hypothesis to test, not the premise to act on.

Then round 5 over-corrected in the other direction, saying no lnΛ merges "under
the correct cap". I measured it: **the cap fires on 0.0% of steps at every lnΛ
from 0.2 to 6.** It is not the cap that limits the merger — the drag law is
asymptotic, and more drag is not monotonically faster because strong drag
circularises the orbit early at large radius. Verifying the reviewers is still
as necessary as verifying the code.

### The disc was a folded sheet

"Thickness is orbital inclination" was right per particle and wrong as an
ensemble. Every orbit tilted by the same β about the same node line, so ⟨z⟩ varied
coherently with azimuth — an m=1 moment 0.64 of rms|z|. A folded sheet, not a
disc.

And the assertions I wrote for it were azimuthal **averages**, which is exactly
the operation that cannot see an azimuthal defect. That is the round-4 lesson
recurring inside my round-4 fix: I measured the quantity I had been thinking
about rather than the one that could go wrong.

Tilting each orbit about its own random node axis fixes it — Rodrigues rotation is
exact, so the equilibrium is untouched — and takes the fold ratio from 0.56 to
**0.044 at N = 6,000**, which is the shot-noise floor rather than a property of
the disc: it falls as roughly 1/√N (0.038 at 6k, 0.015 at 24k, 0.003 at 64k).

> **Round 7 correction.** This said "from 0.6405 to 0.0135", and neither figure
> is what the shipped suite measures — it reports 0.56 and 0.044, and the 0.0135
> was one draw at an unstated, much larger N. Quoting a single draw of a
> shot-noise quantity without its N makes a random number look like a result. The
> honest claim is the stronger one anyway: after the fix the fold moment is *at
> the noise floor*, which survives a reseed, where "0.0135" does not.

### Where five rounds have got to

**75 assertions, all complete, zero failures**, deployed and verified live at
16.7 ms median / 59.9 fps on a single tab. (An earlier reading of 44 fps was six
browser tabs contending for the GPU, not a regression — worth measuring before
believing.)

Every round has found the previous round's fixes wrong. What has changed is
*where* the defects live: round 2 found them in the physics, round 3 in the fixes,
round 4 in the tests guarding the fixes, round 5 in the tests guarding the tests.
That is a real direction of travel, and it is not convergence. The gate has not
passed and will not until the guards are mutation-tested as a matter of course —
which is now the single most valuable process change available to this project.

---

## Round 6: the harness had the defect it was built to find

*2026-08-15, 04:38 to 06:15.*

I pointed round 6 at round 5's fixes and at the mutation harness itself, because
round 5's whole contribution was the claim that mutation testing would break the
pattern.

**It did not.** Five of round 5's eight changes were wrong — 63%, against 55% the
round before. Six rounds, 263 findings, and the rate has not improved.

### But something did change, and it is the first genuinely good news

**All three substantive engine fixes survived every mutation five reviewers aimed
at them.** The friction gate wiring, the impulse-cap dimensions, the disc's
per-orbit Rodrigues rotation — attacked directly, independently, and they held.

For the first time the *code* is right. Every failure this round was in a **guard,
the harness, or the prose**. That is a real direction of travel: round 2 found
defects in the physics, round 3 in the fixes, round 4 in the tests guarding the
fixes, round 5 in the tests guarding those tests, and round 6 in the instrument
built to test the tests.

### The bluntest thing in the report

`bench/mutate.mjs` reported **"12 killed, 0 survived"** on a tree where four
shipped interaction fixes had been deleted.

It reaches 61 of 76 checks and **zero** of `src/app` and `src/render`. A reviewer
reverted `setBusy`, the science-view backdrop, `onDeviceLost` and the chunked seek
*simultaneously*, and both the suite (76/76) and the harness (12 killed, 0
survived) reported perfection.

It was also scoring an **unparseable mutant as a kill** — the strongest-looking
result obtainable from the weakest possible evidence — and scoring mutations as
killed by *collateral* checks after their own guard had been destroyed.

I built an instrument to detect assertions that pass when the thing they guard is
broken, and the instrument passed when the thing it guarded was broken. There is
no cleverer way to say it.

It now names the check that *should* catch each mutation and reports `MISATTRIB`
when only collateral checks fire; treats a crash as `BROKEN` rather than a kill;
reports browser-only mutations as `NOT COVERED`; and prints its own coverage
limits in the summary, including the 0% for `src/app` and `src/render`.

### The guard that took four attempts and one idea

The claims guard has been neuterable in one line for four consecutive rounds.
Replace the comparison with `{status:'accepted'}` and every document in the
project can be arbitrarily wrong while it reports "22 documented figures match
their measurements".

Rounds 4 and 5 both rewrote the *sensitivity check* to fix this, and both failed
for the same structural reason: **a separate check exercises a separate call
site.** It cannot witness whether the live loop ran. Three rewrites of the wrong
thing.

The idea that works is a **canary inside the live loop**: a synthetic claim,
deliberately 3× wrong, evaluated through the same comparison as everything else
and required to be rejected. If the loop is disabled, short-circuited, or has its
tolerance widened, the canary stops being rejected and the check fails on itself.

Verified by mutation in a browser — neutering the comparison *and* drifting
`index.html`'s headline figure to 99.9% now produces:

> THE CANARY WAS NOT REJECTED (status "accepted"). A deliberately 3x-wrong figure
> passed the live comparison, so the comparison is not running and every other
> figure in this check is unverified.

A guard that verifies itself is a different category of thing from a guard with a
companion test, and it took six rounds to see that.

### Two more assertions that could not see their own subject

- **float64 at generation.** Changing every `Float64Array` in `galaxy.js` to
  `Float32Array` left the suite green while the birth error rose from 2.2e-16 to
  **1.7e-8** — a 10⁸ degradation of the float64 *reference* the GPU path is
  checked against. The file's own header explains why this matters. Nothing
  enforced it.
- **The impulse cap's asymmetric half.** `Math.max` → `Math.min` survived, because
  the only configuration exercising the cap used `massRatio: 1.0` — where max and
  min are identically equal. A check run at equal masses cannot distinguish the
  two bodies, which is the entire point of taking the worst of them.

Both are the same shape as everything else this week: the test measured the
quantity I had in mind rather than the one that could go wrong.

### Where six rounds leave it

**76 assertions, zero failures. Mutation harness: 14 killed, 0 survived, 1
honestly reported as not covered.** Deployed and verified live.

> Left as written, because it was true when written and the section is headed
> "where SIX rounds leave it". Round 7 immediately made it stale — the figures
> at the end of the night are 79 and 17/0/1 — and a state summary that silently
> updates itself to match the present is not a log. This is exactly the drift
> the claims guard exists to catch, and the guard does not read this line;
> `assertionCount` is registered against the README, which is the file a reader
> is pointed at. See the round-7 section at the end for the state that holds.

The gate has not passed and I do not think another round would pass it. What six
rounds have established is not a finished artefact but a reliable *method*, and
one uncomfortable fact about it: every instrument this project has built to check
itself has, at first, failed in exactly the way it was built to detect. The
assertions, the sensitivity checks, the claims guard, and finally the mutation
harness. The only defence that has worked more than once is the one that turns the
check on itself — `expectChecks` for the suite, the canary for the claims guard —
and that is the pattern worth carrying to the next project.


---

## The Laplace-Runge-Lenz check, and an instrument hiding a result from itself

*2026-08-15, 06:15 to 06:30.*

`CLAUDE.md`'s own check table names LRL as **the** force-law test, and gives the
reason: energy and angular momentum are conserved by *any* central force, so
neither can distinguish an inverse-square law from a softened one. The project had
LRL checks on the two-body galaxy pair. The **test-particle** integrator — a
different code path, feeling `P.accel()` directly, never touching the pair force,
and the one 300,000 particles actually use — had none. Three review briefs asked
for it and none got to it.

**My first attempt used a fixed tolerance and was the wrong test.** It failed at
1.17e-4 against a 1e-5 limit. The limit was the error: I used a quarter of the
steps per orbit the two-body check uses, and leapfrog is second order, so 4x the
step is 16x the drift. A tolerance chosen without that arithmetic measures the
timestep and reports it as physics.

**Convergence order separates them.** Integration error falls as dt²; a wrong
force law leaves a residual that does not converge, because it is a property of
the force rather than of the discretisation. Measured on the shipped path:

| steps per orbit | 2,000 | 4,000 | 8,000 |
|---|---|---|---|
| LRL drift over 3 orbits | 1.17e-4 | 2.93e-5 | 7.32e-6 |

Ratios **4.00 and 4.00**. Textbook second order, so the residual is integration
error and the test-particle force law is exactly inverse-square. A Plummer sphere
of the same mass drifts 1.19 at that same 2,000 steps per orbit — a factor of
**10,000** — and a mutation adding a 1e-3 non-1/r² term makes the drift stop
converging entirely (6.54e-3 → 6.66e-3 across a 4× refinement).

> **Round 7 correction, and it is the one that stings.** This paragraph said "a
> factor of 160,000". That divided the Plummer drift at 2,000 steps per orbit by
> the point-mass drift at 8,000 — a 4× finer timestep, hence 16× smaller drift,
> hence a ratio inflated exactly 16-fold. Three paragraphs above, the same
> passage argues that "a tolerance chosen without that arithmetic measures the
> timestep and reports it as physics". I made the error inside the confession
> about the error. Like for like, it is 10,000.

**How much power does this check actually have?** Asked and answered rather than
asserted, because "it is the right kind of test" is not a measurement. Perturbing
the force law to F ∝ r^−(2+δ) and bisecting the pass/fail boundary: the check
**misses δ = 1e-7 and catches δ = 3e-7**. Round 7's reviewer, scanning 180
log-spaced perturbations of both signs independently, put the threshold at
δ ≈ 1.8e-7 and found no re-entrant band where a larger error slips through. Two
independent measurements, agreeing. That is roughly 3,400× smaller than the 1e-3
term the mutation harness uses, so the harness's mutation is a comfortable kill
rather than a marginal one. Worth stating precisely: near the threshold the check
trips because the convergence ratios go *erratic* (they overshoot above 5.0
through partial cancellation), not because they collapse to 1. The clean collapse
signature starts around δ = 1e-5.

### And then the harness hid that from itself

The mutation harness reported `MISATTRIB` for that non-1/r² mutation — claiming
only collateral checks had fired — while the LRL check had in fact caught it
exactly as designed. The cause: I had sliced the failing-check list to the first
four entries, and the LRL check was fifth.

**The instrument's own reporting concealed the result it was measuring.** That is
the third time in one night that a thing built to detect a class of defect has
exhibited that defect: the assertions, then the claims guard, then the harness,
and now the harness's reporting. I have stopped being surprised by it and started
treating it as the expected behaviour of any new instrument — which is, in the
end, the most useful thing this project has taught me.


---

## The opening view, and why it took six rounds to see

*2026-08-15, 06:30 to 07:00.*

Two visual defects, both open since round 4, both fixed in half an hour, and
neither of them a correctness bug — which is exactly why they survived six rounds
of adversarial review aimed at correctness.

**The camera never framed anything.** Distance was set to 66 kpc at construction
and nothing ever changed it. Scenarios span 14 to 55 kpc pericentre and separate
to hundreds, so the subject was routinely a small object in a large black frame.
`frameToContent()` now sets the distance from the content extent on scenario load
and on `f`. The Antennae at +259 Myr goes from occupying a sixth of the frame
height to filling it; the scale bar moves 100 kpc → 20 kpc.

**And the opening view was framed by a calculation for a different mode.**
`fillTargets()` resolves *after* `start()` and calls `selectTarget(targets[0])`,
whose Detect-mode scale-matching sets the camera from the target's angular
diameter. It ran while the app sat in Sandbox, so every visitor's first impression
was the prograde encounter framed at **Arp 240's frame width** — 848 kpc for a
content radius of 34.

Round 4 found that exact mechanism and filed it as a *share-link* bug: it
overwrites a restored camera. True, and the smaller half of the story. The same
line was setting the first thing anyone ever saw.

I only found it by measuring `contentRadius()` against `camera.distance` and
noticing they disagreed by 25×. Reading the code would not have done it, because
the code is correct in the place it lives — a Detect-mode function doing a
Detect-mode job. The defect is entirely in **when** it runs.

The lesson is the one the whole night keeps producing in different costumes: the
failure is rarely in the line you are looking at. It is in the relationship
between that line and something else — an inline copy versus an exported
function, an assertion versus the default it does not exercise, a mode's
calculation versus the mode it runs in. None of those are visible in a diff.

---

## 07:00–09:00 — Round 7, and the defect moves one slot further out

Six rounds had established a pattern: each one found the previous round's fixes
present, commented as handled, and wrong. Round 7 was aimed squarely at the newest
work — the dust lane, the framing change, the 68→76-float uniform block — and at
the round-6 guards written to break the pattern.

It held. Six reviewers, 33 findings, and the headline is the same shape as every
round before it.

### The dust-lane fix was inert, and I certified it on the one galaxy where the bug is invisible

`buildEncounter` attaches each galaxy's `discNormal`. The uniform block grew from
68 to 76 floats to carry it — hand-counted correctly, verified byte-by-byte by
four separate reviewers. The shader confines dust about the plane, correctly.

And `RestrictedSim`'s constructor sat in the middle of that pipe doing this:

```js
this.galaxies = galaxies.map((g) => ({
  mass: g.mass, potential: g.potential,
  pos: Float64Array.from(g.pos), vel: Float64Array.from(g.vel),
  acc: new Float64Array(3),
}));
```

`discNormal` is not in that list. The renderer reads `sim.orbit.galaxies` — those
objects — so `?? [0, 0, 1]` fired every frame of every scenario. Eight new floats,
correctly plumbed, carrying a constant.

**The part that matters is how it was certified.** The fallback `[0,0,1]` is
exactly correct for one disc in the entire project: the primary of `prograde`,
whose inclination is 0. That is the default scenario. That is the screenshot I
measured. I took the one measurement that could not see the defect and wrote
"verified" next to it.

Measured across the scenarios afterwards, the shipped dust column against the
intended one: prograde's primary 1.00, its companion 0.13; antennae 0.09 and 0.07;
ring 0.05. Every disc except the one I looked at.

The fix is one line. The interesting work was the guard, and the guard needed a
property I nearly missed: **it has to run on a tilted disc.** The obvious
assertion — build the default scenario, check the normal survives — passes with
the bug fully present, because that disc's true normal *is* the fallback. So the
check asserts the tilt as well, and says why:

> `ok(tilt[0] > 10 && tilt[1] > 10, 'this check is blind on a scenario whose discs are not tilted — it would pass with the field dropped')`

Verified by mutation: deleting the field kills the check by name.

With the fix in, measured on antennae against its control: **14.55% of the light
extinguished with the real normals, 3.70% with the fallback forced back** — a
factor of 3.9. Position angle agrees with the stellar one to 7.2°, so the layer is
co-planar; its axis ratio is flatter (0.32 against 0.55), which is what a thinner
layer must project to.

One reviewer suggestion I checked and did not adopt: that co-planar dust must
match the *stellar axis ratio*, offered as the one-line test that would have caught
this. Measured, it does not discriminate — 0.321 with the fix against 0.339
without. The quantity that does discriminate is the total extinguished fraction,
by a factor of four. A test that would not have caught the bug is not the test
that would have caught the bug, however good the reasoning sounds.

### I corrected a correct number into a wrong one

At 06:30 the README claimed 60 fps. I changed the framing, re-measured, got
28–32 ms, and "corrected" the file down to 31–46 fps — with a table of point
values and a confident mechanism: framing the encounter properly means
"rasterising all 300,000 particles instead of the fraction that happened to be in
view".

Both halves were wrong.

The measurements were taken while six other WebGPU tabs — the review agents,
driving their own browsers against the same build — were on the same GPU. And the
mechanism was backwards. **There is no culling in this renderer**, so nothing was
ever skipped for being off-screen; and pulling the camera back makes each splat
cover *fewer* pixels, not more.

Run as a controlled experiment, both camera distances interleaved in one session
so ambient load hits both arms equally: **17.8 ms at the shipped 193 kpc framing
against 28.7 ms at the old 66 kpc.** Framing the encounter properly made it
faster. On an isolated GPU every scenario is vsync-locked at 16.7 ms.

The lesson is not about frame rates. *A wrong figure with a plausible mechanism
attached is far more durable than a wrong figure on its own*, because the
mechanism is what stops anyone re-measuring. I had also just written the sentence
"measure on the full scene, not an empty one, and say what N was" into the project
check table. The table now needs "and say what else was on the GPU".

### The canary was defeated in one line, twice

Round 6 built a canary into the claims loop: a deliberately 3×-wrong figure that
must be rejected, so that neutering the comparison fails the check itself. It was
verified by browser mutation and it was genuinely better than what came before.

Round 7 defeated it twice:

```js
const r = c === CANARY ? compareClaim(files.get(c.file), c) : { status: 'accepted' };
```

The canary still goes through the real comparison. The canary is still rejected.
All 24 real claims are routed around it, and a shipped figure can be 6.6× wrong
with the suite fully green. And separately, putting a **45% floor** under every
tolerance passes a 39.5%-wrong figure while the 3× canary and the 1.5×
sensitivity check both still clear it.

The flaw is structural: **a canary proves the loop ran for the canary.** It cannot
prove the loop ran for anything else. Asserting on its verdict is asserting on one
row of a table.

Two changes. The comparison now keeps a ledger of the work it actually did, kept
*inside the function a bypass must skip in order to work* — so skipping the call
is what makes the entry missing, and the count assertion fires. And every claim is
now probed at its **own** declared tolerance (accepted just inside, rejected just
outside), which a global floor cannot satisfy: it would have to sit below every
probe to be invisible and above every tolerance to be useful.

### The vertical structure had the right rms and the wrong shape

Four attempts went into the disc construction and the assertion checks `rms|z|`.
A reviewer swapped the exponential amplitude law for a Rayleigh one of the same
rms — turning a cusped profile into a near-sech² disc, a completely different
vertical structure — and `rms|z|` moved 0.6%. Suite green.

rms is one moment. Two very different profiles share it.

What the shipped profile actually is, now written down rather than implied: each
particle sits at a random orbital phase on a circular orbit inclined by β, so
z = amp·sin(ψ) with ψ uniform — the arcsine distribution, U-shaped at fixed amp.
Convolved with an exponential amp, p(z) ∝ K₀(|z|/h), logarithmically divergent at
the midplane and more cusped than an exponential or a sech² disc. Second-bin/
first-bin ratio 0.507, against 0.819 exponential and 0.924 sech².

That is not what an observed edge-on disc looks like. It is kept deliberately: it
is the price of every particle being on an exact closed orbit, which is what makes
the disc *equilibrated* rather than merely plausible — the trap CLAUDE.md names as
the specific one in this domain. So the new assertion **characterises** the shape
rather than grading it, in a band wide enough to survive a reseed and far too
narrow to survive a change of amplitude law. The Rayleigh mutant is now killed.

### Two numbers I measured myself, before the reviewers reported on them

Worth recording because they are the discipline working rather than failing.

**How much power does the LRL check actually have?** CLAUDE.md names it as *the*
force-law test, and the project asserted convergence order without ever measuring
what size of error that catches. Perturbing to F ∝ r^−(2+δ): it **misses δ = 1e-7
and catches δ = 3e-7**. A reviewer, scanning 180 log-spaced perturbations of both
signs independently, put the threshold at δ ≈ 1.8e-7 and found no re-entrant band.
Two independent measurements agreeing — about 3,400× smaller than the 1e-3 term
the mutation harness uses.

**The 0.95 inclination clamp.** `asin(min(0.95, amp/r))` saturates at small radii.
Measured: it engages for **0.97%** of the shipped disc, essentially all inside
1 kpc, where those particles are ~20% of the population and make the inner
kiloparsec a prolate blob (rms|z|/r = 0.33) rather than a disc. A reviewer
independently measured 0.961%. Bounded, confined to where a real bulge lives, not
result-changing — but it was an unquantified knob in a file whose header is about
initial conditions being harder than the integrator, and now it is a number.

I also audited the uniform block myself before any reviewer reported: 2 mat4 +
11 vec4 = 76 floats = 304 bytes, offsets 0/16/32/36/40/44/48/52/56/60/64/68/72,
all written unconditionally every frame. Four reviewers independently agreed. The
one defect there was mine and small: `params2`'s comment named two fields
(`y = time, z = dustStrength`) that this shader never reads and that are written
as literal zeros — a stale comment on the one struct whose miscount once blacked
out the canvas.

### Where seven rounds leave it

The engine is in good shape and has been for two rounds. Every substantive physics
fix survives mutation, the LRL work reproduces figure for figure and has measured
power, the disc is in exact equilibrium, and the uniform block is right.

What round 7 found is almost entirely in the **layer above the code**: a delivery
boundary that ate a field, a guard that proved one row of its own table, a
confession that inflated its own headline 16×, a coverage banner stale in the
instrument built to prevent stale figures, and a number I corrected in the wrong
direction with a mechanism attached.

Seven rounds, and the honest summary of the trend: the defects have moved steadily
outward — physics → fixes → tests guarding fixes → tests guarding those → the
harness → **the project's account of itself**. That last category is where nearly
all of round 7 lives. It is a better place to be than round 3. It is not A+, and
the gate has not passed.

### The instrument that could not test the instrument

Verifying the two new claims guards nearly produced a false result, and the near
miss is worth more than the guards.

I copied the tree, applied Menon's bypass, served the copy with
`cd $COPY && python3 $REAL/bench/devserver.py 8801`, ran the suite, and got
**79/79 green**. Twice, on two different mutations. The obvious reading was that
my new guards were inert — that I had written two more decorative assertions.

Before recording that, I checked the served file with `curl … | grep -c 'c === CANARY ?'`
and got **1**. Confirmation. Still green, mutation definitely served, guards
definitely inert.

Both halves of that were wrong.

`bench/devserver.py` ends with `os.chdir(dirname(dirname(abspath(__file__))))`. It
serves **its own repo root**, not the working directory. So every mutation run
served the *real* tree; the mutant never reached the browser. And the `curl`
check confirmed nothing, because the string I grepped for — the bypass line —
also appears in the doc comment I had just written *explaining* the bypass. The
verification matched my own prose.

Run properly, with the copy's own `devserver.py`, both mutations die by name:

```
bypass → "25 registered claims never reached the comparison: …"
floor  → "the effective tolerance does not match the declared one for: …"
```

Three things worth keeping. **A green mutation run is only evidence if the mutant
was actually executed** — so the mutations now plant a `globalThis.__MUT` counter
and the run asserts it fired, which is the browser equivalent of the check-count
guard. **`grep` on a source file is not proof that code runs**, because comments
and code are the same bytes to grep; the marker is proof, grep is a hint. And a
tool that resolves paths relative to *itself* will silently serve the wrong tree
to anyone who assumes it honours `cd` — now written into `devserver.py` beside
the `chdir` that causes it.

The uncomfortable corollary: a reviewer this round reported browser mutation
results from copies served on their own ports. If any of those used the shared
devserver the same way, their evidence has the same defect — though in that
instance the conclusion was independently right, because the round-6 code
genuinely had no ledger to catch a bypass.

### The silent knob that was connected to nothing that mattered

Round 6 made `softeningScale` demonstrably reach the model and asserted it: three
softening settings must give three distinct answers. That assertion is real — I
reverted the knob and watched it fire.

Round 7 asked the next question, which nobody had: *reach the model where?*

`galaxyModel` multiplied only the **bulge** Hernquist core — 1.42% of the mass.
Over a full 0.5x-2x sweep that moves |g| by 109.6% at 0.5 kpc and **0.33% at the
20 kpc tidal cut**, which is the entire region where the morphology metric counts
material. The disc Plummer (3 kpc) and halo Hernquist (20 kpc), holding 98.6% of
the mass between them, were never varied — the same 0.5x/2x on those moves |g| at
20 kpc by 1.8% and 106.6%.

And the sting: the spread the sweep recorded, **0.73%**, was smaller than the
seed-to-seed scatter of the particle realisation, **1.68%**, which the check never
measured. *A sensitivity study whose signal sits below its own unmeasured noise
floor is reporting the noise.* The project has a check-table line about measuring
with a control, and this was a study with no control at all.

Two changes. `softeningScale` now multiplies all three core radii, so it is the
smoothing scale of the whole mass model (a no-op at the shipped default of 1.0, so
no shipped result moves). And the check now measures its own noise floor — three
seeds at fixed softening — and asserts the signal clears it.

Measured after: **18.7% spread against a 0.9% noise floor, signal/noise 21.8x**,
where before it was 0.73% against 1.68% — a signal-to-noise of 0.4, i.e. *below
one*.

One more near-miss worth recording, because it is the same shape as everything
else tonight. My first version of the new assertion was `spread > seedSpread`. I
reverted the knob to bulge-only to check the guard fired, and **it passed** — at a
ratio of 1.1, 0.92% against 0.86%. The assertion I had just written to reject
"signal indistinguishable from noise" accepted a signal-to-noise of 1.1. It now
requires 3x, which the connected knob clears by a factor of seven, and the
bulge-only revert dies by name.

I would not have found that by reading it. I found it because I ran the mutation
before believing the guard — which is the only habit from this whole night that
has never once been wrong.
