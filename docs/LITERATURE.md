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

## Act III of the film — the origin of the galaxy classes

Added 2026-08-16 for the three-act restructure. **None of this has been read in full.** It is
recorded at the register it was actually obtained at, which is mostly *reported*, so that the
narration can be written against sources rather than against recollection. Round 9 is the
reason this section exists before a word of Act III is drafted.

### Major mergers and the origin of ellipticals

**Status: reported.** The proposal that mergers of comparable-mass spirals produce ellipticals
originates with Toomre & Toomre (1972) and Toomre (1977). Simulations of low-velocity
encounters between similar-mass spirals produce remnants described as in good agreement with
the observed shapes, density profiles and velocity distributions of giant ellipticals, and the
outcome is reported to be largely independent of whether the progenitors were spirals or
ellipticals. Observationally, shells, tidal features and stellar trails around ellipticals are
cited in support.

**The nuance the film must not drop.** Both observations and simulations over the last two
decades show that **disc** galaxies can also result from a major merger (e.g. work on the
Illustris simulations), and whether the major-merger scenario accounts for the properties of
most real ellipticals is described as still open. "Major merger produces an elliptical" is
therefore a tendency and not a rule, and the narration must not state it as one.

- https://arxiv.org/pdf/astro-ph/0301385 — Major Mergers and the Origin of Elliptical Galaxies
- https://arxiv.org/pdf/1909.01033 — Disc galaxies formed from major mergers in Illustris
- https://arxiv.org/pdf/1309.4096 — Mergers in Galaxy Groups I: structure of elliptical remnants

### The Milky Way and Andromeda — NOT a certainty

**Status: reported, and it overturns the popular account.** The familiar "the Milky Way and
Andromeda will merge in about 4 billion years" is no longer the current position. Sawala et al.
(2025, *Nature Astronomy*, "No certainty of a Milky Way–Andromeda collision") run 100,000
simulations using Gaia and Hubble astrometry, **including observational uncertainties for the
first time**, and report roughly a **50/50 chance of a merger within the next 10 billion
years**. Including M33 raises the merger probability; the Large Magellanic Cloud, whose orbit
runs perpendicular to the Milky Way–Andromeda orbit, lowers it. Where a merger does occur, the
timing is nearer 5 Gyr than the earlier ~3.9 Gyr.

**This is a better ending than the one it replaces**, and it is the one that is true: the
confident version of this story was a consequence of ignoring the error bars. It should be told
that way.

- https://www.nature.com/articles/s41550-025-02563-1 — Sawala et al. 2025, Nature Astronomy
- https://arxiv.org/abs/2408.00064 — preprint, "Apocalypse When?"
- https://esahubble.org/news/heic2508/ — ESA/Hubble summary

**Action**: read the Nature Astronomy paper before this goes in the narration. A probability
quoted from a summary is exactly the kind of number this project has been wrong about before.

### S0 galaxies and the morphology–density relation

**Status: reported.** The morphology–density relation is attributed to Dressler (1980):
spirals dominate low-density field environments, S0s come to dominate in groups and in the
relaxed cores of clusters. Proposed transformation channels include ram-pressure stripping of
the disc gas, starvation, thermal evaporation, turbulent stripping, tidal interaction and
galaxy harassment. S0s in clusters are reported to be more rotationally supported (consistent
with gas removal) while field S0s are more pressure supported (consistent with minor mergers
shaping the kinematics).

**Relevance and limit.** None of these mechanisms are in this model. There is no gas, so
ram-pressure stripping and starvation cannot be shown at all. If Act III mentions S0s it is
citing the field, not demonstrating anything, and it must say so.

- https://academic.oup.com/mnras/article/441/1/333/981029 — origin of S0s in clusters
- https://arxiv.org/pdf/1110.4384 — revised parallel-sequence classification
- https://academic.oup.com/mnras/article/525/4/5359/7258838 — ram-pressure morphological transformation

## To read

1. Toomre & Toomre 1972 in full — parameters to reproduce.
2. Barnes & Hibbard 2009 body — to confirm the baseline numbers.
3. Odisseo full text — novelty claim and adjoint detail.
4. Holincheck 2016 body — what the volunteer scores actually mean.
5. Barnes & Hernquist 1992 on merger remnants — validation rung 4.
6. Privon et al. 2013, Identikit on observed systems — closest prior art to detective mode.
