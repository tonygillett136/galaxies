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
this project's own data.** Across the 59 Galaxy Zoo systems with a published fit, the median
r_min is 12.1 kpc and 81 per cent are under 20. Real pairs routinely pass inside the disc
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
