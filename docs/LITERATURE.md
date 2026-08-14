# Literature

Publishable standard: every claim traces to a source actually read, and the three registers
stay visibly separate.

- **Verified** — I read the source myself and the claim is what it says.
- **Reported** — stated in an abstract, summary or secondary source I have read, but I have
  not read the primary text. Not to be built on without upgrading.
- **Inferred** — my conclusion from the above. Never presented as the source's claim.

Last updated 2026-08-14.

---

## The spine

### Toomre, A. & Toomre, J. 1972, ApJ 178, 623 — "Galactic Bridges and Tails"

**Status: reported.** Not read in full. The foundational result is that bridges and tails are
tidal in origin, demonstrated with massless test particles orbiting rigid point-mass
potentials, over a small number of hand-matched encounters.

**What this project has and has not done.** The prograde/retrograde asymmetry — the same
orbit, pericentre and epoch producing spectacular tails one way and almost none the other — is
reproduced here from first principles, and that is a real result about our physics. It is
**not** a reproduction of their paper: their parameters, their figures and their specific
systems have not been checked against ours.

**Action**: read in full before claiming reproduction. Reproducing a result requires knowing
what the result actually was, including the parameters used.

### Barnes, J. E. & Hibbard, J. E. 2009, AJ 137, 3071 — "Identikit 1"

**Status: reported (abstract read, paper body not).** A modelling tool for interacting disc
galaxies combining test-particle and self-consistent techniques through an interactive
graphics program, to find encounter parameters reproducing observed morphology and kinematics.
Reported test: 36 artificial parabolic encounters between equal-mass disc galaxies, roughly 30
reconstructed, encounter geometry and viewing direction recovered with median errors under 15
degrees.

**Action**: confirm both numbers from the paper body before using either as a baseline. A
benchmark taken from an abstract is a benchmark taken on trust.

### Mortazavi, S. A. et al. 2016, MNRAS 455, 3058

**Status: verified** (fetched and read 2026-08-14).

- Automated routine built on Identikit 2 to search parameter space, but **human expert
  judgement still required** for box selection on tidal features; a semi-automated
  box-selection routine was added to reduce subjectivity.
- Tested against **15 configurations** from GADGET SPH simulations of equal-mass mergers, not
  observed systems. Covered prograde-prograde, retrograde, polar, face-on and edge-on viewing,
  and different merger stages.
- Convergence by Kolmogorov-Smirnov test: **7 good, 4 fair, 4 poor**.
- Eccentricity within 1σ for parabolic orbits; underestimated by 0.1–0.2 for elliptical.
- **Pericentric distance overestimated by an average of about 30 per cent in face-on systems.**
- Merger stage within 10 per cent. Viewing angle scattered **−30 to +10 degrees** face-on.
- Output is **point estimates with asymmetric error bars, not posteriors**.
- Stated limits: cannot model retrograde or polar systems effectively; weak with weak tidal
  features; different mass models between GADGET and Identikit introduce systematic bias.

**This is the incumbent.** Any claim of improvement is measured against these numbers on
comparable synthetic ground truth. Note the comparison is only like-for-like if our test set
is built the same way — theirs came from a *different* code (GADGET) than the one being
fitted, which is the point, and ours must too.

### Holincheck, A. J. et al. 2016, MNRAS 459, 720 — "Galaxy Zoo: Mergers"

**Status: reported.** JSPAM restricted three-body with a dynamical friction approximation,
delivered as a Java applet to citizen scientists. 10^5 parameter-space points sampled per
system, **62 pairs**, more than 3 million simulations reviewed by visual match to a target.

**The 62-vs-56 discrepancy, RESOLVED 2026-08-14, and it was mine.** I had recorded that the
data page offered 56 target files against the paper's 62. Checked against the actual files:
`table1.txt` has 62 targets, `table4.txt` has 62 rows of best-fit parameters, and the page
links 62 parameter files. The count is 62 and the paper is consistent. The "56" came from an
LLM summary of the page, not the page; `target_info.txt` has 55 rows plus a header and is a
different subset, most likely what the summary saw. **A fetch summary is a report, not an
observation.**

**Table 4 schema**, the benchmark ground truth: `Target`, `Best MR` (mass ratio), `r_min (kpc)`
(pericentre), `t_min (Myr)` (time since pericentre), `ecc`, `beta`, each with a `±` and a
`Min`/`Max` pair. **The Min/Max columns are search bounds, not credible intervals** — Max mass
ratio reaches 889.8, Max eccentricity 677.7. Only the `±` is a spread. Conflating them would
flatter any comparison enormously.

**Open question, not yet answered**: the 3M human-scored parameter sets are sometimes
described here as a labelled training corpus for amortised inference. Labelled with *what*,
exactly, and with what selection bias, has not been established. Do not build on that framing
until the score semantics are read from the paper.

### Wallin, J. F., Holincheck, A. J. & Harvey, A. 2016, A&C 16, 26 — "JSPAM"

**Status: reported.** Restricted three-body code for interacting galaxies, descended from SPAM
(1990), ported to Java. Adds an alternate potential and a dynamical friction treatment to
better mimic tree-code results. Academic Free License 3.0, ASCL entry ascl:1511.002.

**Use**: reference implementation to cross-validate our restricted engine against. Not to be
copied; to be disagreed with and the disagreement explained. **Not yet done.**

### Odisseo, 2025, arXiv:2511.22468 — differentiable N-body for galactic dynamics

**Status: verified** (abstract page fetched and read 2026-08-14).

Differentiable N-body in JAX with JIT, automatic differentiation, GPU/TPU acceleration and
near-linear multi-GPU scaling. Demonstrated on **stellar streams only**: a mock GD-1 stream,
optimising four parameters (accretion time, progenitor mass, NFW halo mass, Miyamoto-Nagai
disc mass) to constrain the Milky Way potential.

**Not addressed**: interacting disc galaxies, encounter parameters. Integrator type, adjoint
versus direct backpropagation, and particle counts are not stated in the abstract.

**Action**: read the full paper before any novelty claim that depends on what Odisseo did.

---

## The gap, stated carefully

**Inferred**, from the above: nobody has applied gradient-based differentiable simulation to
recovering encounter geometry for individual observed interacting galaxy pairs, and nobody has
produced posteriors rather than point estimates for that problem.

This is a claim about **absence**, which is the hardest kind to support, and it currently rests
on **one search session**. Before it appears in anything outward-facing it needs a systematic
search: ADS full-text, arXiv listings for differentiable simulation in astronomy, and the
citation lists of both Identikit papers and of Odisseo. Until then it is a working hypothesis
that shapes the build, not a finding.

---

## Named scenarios are not published fits

`src/engine/encounter.js` contains scenarios called "Mice-like" and "Antennae-like". These are
configurations chosen to produce the right qualitative morphology. They are **not** the
published parameters of NGC 4676 or NGC 4038/4039, and no comparison against those systems'
literature values has been made. The naming is hedged in the code and in the UI blurb; if that
hedging ever weakens, this note is the reason it must not.

---

## To read

1. Toomre & Toomre 1972 in full — parameters to reproduce.
2. Barnes & Hibbard 2009 body — to confirm the baseline numbers.
3. Odisseo full text — novelty claim and adjoint detail.
4. Holincheck 2016 body — what the volunteer scores actually mean.
5. Barnes & Hernquist 1992 on merger remnants — validation rung 4.
6. Privon et al. 2013, Identikit on observed systems — closest prior art to detective mode.
