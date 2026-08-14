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

**Verified, not argued.** `test/physics.test.js` runs the same encounter at
λ = 1 and λ = 4 with the epoch rescaled, and compares five morphological
moments (mean radius, rms radius, rms height, maximum radius, separation):

| | ⟨r⟩ | rms r | rms z | max r | separation |
|---|---|---|---|---|---|
| λ = 1 | 36.897 | 37.903 | 1.921 | 66.120 | 73.944 |
| λ = 4, t/√λ | 36.897 | 37.903 | 1.921 | 66.120 | 73.944 |
| λ = 4, control (time not rescaled) | 60.211 | 61.514 | 1.533 | 104.765 | 121.297 |

Agreement to 1e-8, which is float64 roundoff. The control differs by 63 per cent,
which is what proves the comparison can detect a difference at all.

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
- the disc orientation angles

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
