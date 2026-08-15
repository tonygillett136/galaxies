# Identifiability: what this model can and cannot recover

Written before the inverse problem is built, because a flat direction found after
the optimiser exists is discovered as a mystery — chains that will not converge,
posteriors that will not close — rather than as a fact.

---

## The mass-time degeneracy is exact

**With G = 1 and all lengths held fixed, scaling every mass by λ and every time
by 1/√λ leaves the trajectory unchanged.**

Accelerations scale as λ, so velocities scale as √λ and times as 1/√λ. The path
through space is identical; only the rate along it changes. Nothing about the
*shape* of an encounter can therefore distinguish a heavy system seen early from
a light one seen late.

**Verified, not argued.** `test/physics.test.js` (check: "IDENTIFIABILITY: mass and
epoch are an exactly flat direction") runs the same encounter at λ = 1 and λ = 4
with the epoch rescaled, and compares **four** morphological moments:

| | ⟨r⟩ | rms r | max r | separation |
|---|---|---|---|---|
| λ = 1 | 13.788 | 14.622 | 26.932 | 30.202 |
| λ = 4, with t/√λ | 13.788 | 14.622 | 26.932 | 30.202 |

Worst relative difference under the rescaling: **9.2e-9**, which is float64
roundoff over a 3000-step integration. The control — mass scaled, time NOT
rescaled — differs by **28 per cent**, which is what proves the comparison can
detect a difference at all.

**These figures are now REGISTERED in `test/claims.test.js`** and read back out of
this file on every build, because leaving them to be transcribed by hand has
failed twice.

*These figures are reproducible from the shipped code, and were regenerated from
it.* The table has now been wrong twice, both times in the file whose whole
purpose is to say what has been verified.

- **Round 2** found it listing five moments — including an rms height the check
  does not compute — with numbers from a scratch script at a different particle
  count. Three reviewers found it independently.
- **Round 4** found every replacement number stale as well: the pair-force
  correction moved every trajectory, so the published ⟨r⟩ of 20.533 had become a
  computed 13.785, a 33 per cent error.

The round-2 fix added the sentence *"Any future change to the check must
regenerate this table rather than leave it standing."* A change to the check then
did exactly that, and the table stood. Which is the argument against relying on
the sentence: the figures are registered in the claims guard now, so the build
fails instead of the document lying.

## Consequence

A likelihood built on morphology alone has an **exactly flat one-parameter
curve** through it. On that curve every point fits equally well. Practically:

- gradient descent will drift freely along it and stop wherever roundoff leaves it;
- any sampler will report an unbounded credible interval in that direction, or a
  bounded one that is really just reporting its own prior;
- two fits of the same system can differ in total mass by any factor and in epoch
  by the matching factor, and be equally correct;
- a reported "recovered mass" would be an artefact of where the optimiser started.

## The gauge

**Hold m₁ = 1 and fit only dimensionless quantities.** The identifiable set is:

- mass ratio `m₂/m₁`
- pericentre in disc scale lengths, `r_peri / R_d`
- eccentricity
- epoch in dynamical times, `t / t_dyn`
- **one** orientation angle per disc, plus its node — *not two*. `argPeri` rotates
  an axisymmetric disc within its own plane and changes nothing physical; it
  survives a finite particle set only because a finite set is not smooth, which is
  a discretisation artefact rather than a parameter. The identifiable pair is
  inclination and longitude of ascending node.
- three viewing angles (azimuth, polar, roll) — see below

**A caveat on the gauge itself.** Fixing m₁ = 1 removes the mass-time freedom, but
the model's *lengths* are frozen too — every scale radius is hard-coded in
`galaxyModel`. So the gauge as it stands is not merely "hold the mass": it holds
the entire mass *profile*. That is a stronger assumption than the degeneracy
requires, and it means the fit cannot currently absorb a genuinely different
galaxy structure. Making the scale radii fittable will re-open questions this
analysis has not asked.

Physical mass and physical Myr are then recovered **afterwards**, from a separate
external constraint that morphology does not provide: an observed rotation curve,
a Tully-Fisher relation, or a photometric mass. JSPAM does the same thing, which
is why its published fits quote r_min in kpc and t_min in Myr rather than treating
them as free.

`src/app/detective.js` already pins `m1 = 1.0`. That was accidental. It is now the
declared gauge, and it is stated where it is set rather than left as a default
someone might helpfully "fix" later.

## An exact degeneracy at EVERY geometry: (i, ω, Ω) → (−i, ω+π, Ω+π)

Found in round 4, and it is stronger than the sky-plane reflection below in the
way that matters: that one is exact only for a coplanar encounter, this one is
exact **always**.

`rotateToOrbitFrame` applies R_z(Ω) R_x(i) R_z(ω). Since R_z(π) = diag(−1,−1,1),

    R_z(π) R_x(−i) R_z(π) = R_x(i)

identically, so R_z(Ω+π) R_x(−i) R_z(ω+π) **is the same matrix**. Verified
numerically over four orientations and four vectors: worst component difference
**5.0e-16**. The two parameter triples do not merely give the same image — they
give bit-identical states.

Consequences, and they are not small:

- **Every fitted orientation has an exact twin.** A posterior over (i, ω, Ω) is
  at least 2-to-1 everywhere, not just near special geometries. Reporting a
  single mode as "the" orientation is reporting one of a pair, arbitrarily.
- **The recovery metric used elsewhere in this project is wrong for it.**
  `hypot(inc − TRUE_inc, node − TRUE_node)` scores an exactly equivalent solution
  as a failure of order π, and it does not wrap the node angle. Recovery must be
  scored on the symmetry quotient, with angles wrapped.
- The identifiable set declared below must be read with this quotient applied.

The fix is a gauge, as with mass-epoch: restrict i to [0, π) and let ω and Ω run
over the full circle. That is a choice, not a discovery, and it must be declared
rather than assumed.

## A degeneracy exact only when coplanar: reflection through the sky plane

Found in review round 3, and worth recording as much for how long it went
unnoticed as for what it is. Three rounds of adversarial review searched for
degeneracies and none of them looked for a **discrete** one.

Flip the sign of a disc's inclination and you get its mirror image through the
plane of the sky. For an encounter whose orbit lies in that plane, the projected
density is identical:

| configuration | L(+inc) | L(−inc) |
|---|---|---|
| coplanar encounter (perturber at z = 0) | 0.000e+0 | **0.000e+0** |
| the shipped scene (perturber at z = 4 kpc) | 0.000e+0 | 5.249e+0 |

Measured on the shipped adjoint at the true parameters, so both numbers are
losses at a fitted optimum rather than estimates.

**Coplanar it is exact.** Not approximate, not nearly: the two orientations
produce the same image to floating point, so no amount of data at that geometry
can separate them.

Out of the plane it is broken but not resolved. At the shipped z = 4 kpc the
wrong basin sits at 5.249 while the barrier between the basins peaks at **6.170e+1**
— so an optimiser that starts on the wrong side must climb about **12x above its
own minimum** to escape it. Gradient descent will not do that. It will converge,
report a small residual, and be reflected.

### Why this is worse than the mass-epoch degeneracy

The mass-epoch direction is *continuous* and *flat*: it announces itself as an
unconstrained direction, and the honest response is to fix a gauge, which
[the section above](#the-gauge) does. A discrete degeneracy does the opposite. It
produces a **confident, tight, wrong** answer with a small residual and a
well-conditioned Hessian, and nothing in the fit looks unusual.

### What follows

- Any optimisation over inclination must be **multi-start across the sign**, and
  the two results reported together rather than the better one reported alone.
- A posterior over inclination is **bimodal**, and summarising it by a mean and a
  standard deviation would place the estimate in the barrier between the modes,
  where the loss is highest.
- The single start shipped in `test/adjoint.test.js` happens to sit in the right
  basin. That is luck, not method, and it is why the recovery demonstration there
  is labelled as a gradient check rather than as evidence of identifiability.

The physical resolution is that the mirror ambiguity is broken by **kinematics,
not morphology** — a radial-velocity field distinguishes a near side from a far
side, and an image does not. That is a statement about what data would be needed,
and this project does not yet use any.

## What the recovery demonstration does and does not show

Rewritten after round 3, because the previous version demonstrated less than it
appeared to.

It used to fit **(inclination, argPeri)** against a target built from the same
particle draw. Both halves were wrong.

**argPeri is not a parameter.** It rotates an axisymmetric disc within its own
plane. Shifting every particle's phase by δ and shifting argPeri by δ produce
identical states — measured at **3.6e-15**, i.e. exactly. So argPeri is a
relabelling of which particle sits where, visible only through finite sampling.
This document already called it a discretisation artefact in the section above;
the recovery check was fitting it anyway.

**Sharing the realisation is an inverse crime.** With the same radii and phases
the optimum is exactly reachable and the loss falls to ~1e-30. That shows an
optimiser can find a configuration it was handed, not one it had to infer.

It now fits **(inclination, node)** — the node rotates the disc *plane*, a real
orientation on the sky — against a target drawn from an **independent**
realisation, so the best achievable loss is the sampling floor. Measured:

| N | floor / L(start) | recovered inc | recovered node | \|error\| |
|---|---|---|---|---|
| 40 | **1.26** | 0.51 | **−0.95** | 1.853 |
| 150 | 0.62 | 0.76 | 1.15 | 0.329 |
| 600 | 0.32 | 0.61 | 1.17 | 0.274 |
| 2400 | 0.089 | 0.59 | 0.86 | 0.052 |

True values: inclination 0.55, node 0.90.

Three things follow, and only the first was previously claimed.

1. **The error falls with sampling** in the seed pair originally reported. That
   was published as "the parameters are identifiable in principle from morphology
   alone", and **that conclusion is retracted** — see the box below.
2. **At N = 40 it fails outright** — and the ratio says why: two independent
   draws of the *same* disc differ MORE than the true and starting orientations
   do (floor/L(start) = 1.26). There is no signal above the sampling noise. Any
   fit at that resolution is fitting the realisation.
3. **At N = 40 the node converges to −0.95 against a true +0.90.**

### RETRACTION, from round 4

Two claims made here on the strength of that table were wrong, and both were mine.

**"The parameters are identifiable in principle from morphology alone" is not
supported by the shipped objective.** An exhaustive 37×73 grid over (i, Ω) — the
control nobody had run — puts the global minimum nowhere near the truth at ANY N,
including N = 2400: distance 2.224 / 3.539 / 1.184 / 3.375, with L(argmin) =
1.23e4 against L(truth) = 1.92e4. **Adam's own endpoint beats the truth at every
N.** What the four-row table measures is where a fixed start stops after 200
iterations. Identifiability is a property of the *argmin*, and the argmin does not
approach the truth over a 60× range in N. The honest statement is that the
optimiser converges; whether the objective's minimum is the truth is **an open
question this project has not answered**, and the evidence currently points the
wrong way.

**"The two findings corroborate each other" is false corroboration.** The
sky-plane degeneracy flips the INCLINATION. The N = 40 fit returns inclination
**+0.506** against a true +0.55 — sign unchanged. It is the NODE that lands
negative, which is a different thing, and the wrong basin at large N belongs to
the (−i, ω+π, Ω+π) twin documented above rather than to the reflection. I wrote
a tidy story connecting two results because they were adjacent in time and both
involved a sign. Two findings agreeing is evidence; two findings I have
*narrated* into agreeing is not.

## What is NOT yet established

Honest gaps, so they are not mistaken for cleared ground:

- **Other degeneracies are not ruled out.** Only this one has been looked for and
  found. Near-degeneracies — directions that are nearly but not exactly flat — are
  more dangerous than exact ones, because they produce confident, wrong, tight
  posteriors instead of obviously unbounded ones. Nothing here has searched for
  them. A Fisher-information or SVD analysis of the parameter Jacobian is the
  standard tool and has not been run.
- **Viewing angle now EXISTS but is not yet fitted.** The camera supplies three
  angles — azimuth, polar and roll — and all three travel in the shareable URL,
  so a projection can be reproduced exactly. Roll matters specifically: it is the
  position angle on the sky, and without it a model can match a shape and still be
  wrong by an arbitrary rotation in the image plane.

  They are not yet part of any optimisation, and until they are, **a match is a
  match in projection** and must not be described as recovering three-dimensional
  geometry. Note also that adding three viewing angles enlarges the search space
  and will introduce its own near-degeneracies: an inclined disc seen face-on and
  a face-on disc seen inclined are not always distinguishable from morphology.
- **`beta`, in the Galaxy Zoo published fits, is unmapped**, so their parameter
  set and ours are not yet in correspondence.
