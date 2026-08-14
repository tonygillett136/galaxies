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
| λ = 1 | 20.533 | 21.441 | 39.572 | 40.514 |
| λ = 4, with t/√λ | 20.533 | 21.441 | 39.572 | 40.514 |
| λ = 4, control (time NOT rescaled) | 31.804 | 32.848 | 56.498 | 62.675 |

Worst relative difference under the rescaling: **3.6e-9**, which is float64
roundoff over a 3000-step integration. The control differs by **55 per cent**,
which is what proves the comparison can detect a difference at all.

*These figures are reproducible from the shipped code, and were regenerated from
it.* An earlier version of this table listed five moments — including an rms
height that the check does not compute — with numbers from a scratch script that
used a different particle count. Three reviewers independently found that the
table could not be produced by the test it cited, in the file whose whole purpose
is to say what has been verified. Any future change to the check must regenerate
this table rather than leave it standing.

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
