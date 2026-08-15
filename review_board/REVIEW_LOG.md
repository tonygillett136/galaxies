# Review log

One entry per round: findings, verification verdicts, what was applied, what was refuted and
why, and per-reviewer counts. Refutations are recorded deliberately, so the same false finding
is not re-raised next round.

---

## Round 1 — 2026-08-14, ~22:45

Six reviewers in parallel, then one independent verifier per reviewer briefed to refute.

**70 findings. 48 confirmed, 19 partial, 3 refuted.**

| Reviewer | Findings | Self-verdict |
|---|---|---|
| Numerical physicist | 9 | serious problems |
| Observational astronomer | 12 | not yet |
| Inference statistician | 13 | not yet |
| Art director | 9 | not yet |
| Interaction designer | 14 | not yet |
| Referee | 13 | not yet |

No reviewer returned zero findings, so no reviewer needed investigating on that ground.

### Refuted — do not re-raise

| Claim | Why it did not survive |
|---|---|
| Scenario buttons do not update the sliders | `syncSpecControls()` was added in the Stage 3 rewrite before the verifier looked |
| Resolution study changes the random realisation with the particle count | Not substantiated against the code |
| No absorption anywhere, zero dust lanes | Two-slab dust was added before the verifier looked; the reviewer had seen only the pre-dust screenshots 01–06 |

Two of the three were **stale, not wrong** — real at the moment they were written and fixed
before verification. That is the verification pass earning its cost: without it I would have
re-done work already done.

### Applied

| Finding | Severity | What changed |
|---|---|---|
| Newton's third law violated for unequal masses | critical | Pair force computed once, applied equal and opposite. 34% asymmetry → 1.2e-16. **The existing conservation test used identical Plummer scales so it could not detect this**; it now uses mismatched scales, and a dedicated third-law check sweeps mass ratios |
| Mass and epoch an exactly flat direction | critical | Verified (invariant to 3.8e-8, control 45%). Gauge declared in `docs/IDENTIFIABILITY.md` |
| Ring scenario coplanar, produces no ring | critical | Disc now perpendicular to the orbit |
| Per-disc spin control absent | critical | Two controls; the one-prograde-one-retrograde case is now reachable |
| Units suite does not test the units | high | Independent check via Kepler's third law on the Earth's orbit, closing to 3.8e-5 |
| Shipped disc not in equilibrium; assertion ran on a generator nothing ships | high | `exponentialDisc` now takes v_circ at the spherical radius; asserted on the shipped generator |
| Galaxies are dwarfs with a falling rotation curve and no halo | high | 7.0e11 Msun, v_circ flat 208–220 km/s from 3–25 kpc, asserted |
| Pericentre is not the pericentre executed (21–91% high) | high | Solved numerically: request 25 → Kepler 15.6 → executes 25.0 |
| Science view neither linear nor unclipped | high | Linear against a fixed full scale, exact sRGB encode, mapping on screen, clipping painted magenta |
| No dynamical friction; the pair cannot merge | high | Chandrasekhar with per-component densities; apocentre decays 296.7 → 29.1 kpc |
| float32 figure measured on the wrong system | high | Re-measured on the shipped GPU path: median 2.0e-5, p99 8.4e-4, worst 3.9e-3 kpc |
| Bloom has no bright-pass | high | Soft-knee threshold on the first downsample |
| AgX missing its look stage | high | Look stage added, mild |
| Benchmark harness does not exist | medium | Restored; two runs recorded with machine state, differing up to 56% under load |
| Colour carries meaning with no legend | medium | Legend, with the population ramp labelled "indicative" |
| Starfield screen-space, uniform, single-coloured | medium | Hashed on world-space view direction; size, brightness, colour and twinkle all vary |
| Pericentre absent from the timeline | medium | Marked and labelled |
| UI contrast fails WCAG AA | medium | `--faint` 2.6:1 → 5.2:1 |

Assertions went **31 → 46**, all passing with the check-count guard satisfied.

### The synthesis's criticism of the round itself

Worth recording, because it is the most useful thing the round produced:

> **this review round verified only a subset of the 70 findings.** Both critical
> Newton's-third-law reports went unchecked, as did all 14 interaction-design findings and all
> 8 rendering findings. The surviving list is not a picture of the project's worst problems; it
> is a picture of the subset someone bothered to reproduce. Treat unverified criticals as the
> top of the queue, tagged *reported*, not as absent.

I verified the third-law finding myself, numerically, before touching anything — which is
stronger than an agent's check. Round 2 caps findings per reviewer at eight and requires the
verifier to declare `all_checked` and list anything skipped.

### And one lesson about verification itself

My first test of the mass-epoch degeneracy **refuted** it. The test was wrong: I evolved both
runs for the same total time when the scaled run must evolve for t/√λ — the very rescaling
under test. Verification needs verifying too, and a refutation that agrees with what you
already believed deserves more suspicion than one that does not.

---

## Round 2 — 2026-08-14 23:22 to 2026-08-15 00:01

Same six reviewers, told what changed and asked to check whether the round-1 fixes are
**correct** rather than merely present. Findings capped at eight each; verifiers required to
declare completeness.

**47 findings, 41 confirmed, 7 partial, 0 refuted.** Verdicts: all six "not yet".

### Round 2 justified itself immediately

It was designed to catch fixes that were present, commented as handled, and wrong. It found two.

| Round-1 fix | What was actually wrong |
|---|---|
| `erf()` for dynamical friction | `exp(-x²)` multiplied **one of five** polynomial terms. erf(3) = 0.9494 against 0.99998 — wrong by 0.149 absolute — under a comment claiming 1.5e-7 accuracy. Every friction magnitude was wrong. |
| Symmetrised pair force | Exactly symmetric **and 2.83x too strong** at close separation. Both one-sided estimates use the other body's full mass at d, double-counting the softening each extended profile already supplies. Replaced with the analytic Plummer convolution, verified to 1e-12 against the closed form. |

Both were verified by me numerically before I acted on either.

**And the deeper lesson.** Neither was detectable by the tests that existed. The friction checks
assert that energy *falls* and the orbit *decays*; half-strength drag and a 15%-wrong erf both
do that. **An assertion on the sign of an effect cannot detect an error in its magnitude.** The
fix was not just the arithmetic but adding checks against analytic answers: erf against known
values, the pair force against the closed-form convolution, and Chandrasekhar drag against the
formula written out independently.

### Further physics corrected

- **Friction was half strength** even after the erf fix: I averaged the two drag terms, copying
  the gravity symmetrisation. Each drag is already its own equal-and-opposite pair, so the
  total is their sum. A reviewer measured the ratio at exactly 2.000 across 17,942 steps.
- **Friction was being applied outside its validity.** Writing the analytic assertion exposed
  that a heavy galaxy ploughing through a tiny satellite's halo out-drags the satellite 20-fold,
  because the force goes as M². Chandrasekhar assumes a *compact* perturber; each term is now
  weighted by that condition.
- **The ring scenario still produced no ring**, for two further reasons after the round-1
  coplanar fix: the orbit *precesses* in an extended potential so the companion crossed at 64.7°
  to the disc normal, and the companion was as diffuse as a spiral so almost none of its mass lay
  near the impact. Now oriented from the measured approach direction, with a compact intruder,
  and asserted: peak surface density moves to ~11 kpc and rises 4.1x.
- **The pericentre EPOCH was wrong** for the same precession reason — the round-1 distance fix
  made it worse. The clock is now anchored to executed closest approach.
- **Bound orbits saturated at apocentre** for a third of the detective targets, a direct
  consequence of the round-1 mass retune shortening periods eightfold.

### Where the remaining problems were concentrated

The synthesis's headline: *the engine is close to sound and the documents are not.*

- `docs/IDENTIFIABILITY.md` tabulated **five** moments where the check computes four, with
  numbers from a scratch script — in the file whose heading is "Verified, not argued". Three
  reviewers found it independently. Regenerated from the shipped code.
- `DEVLOG.md` still presented the abandoned dwarf model's 27.2% / 131.5x as the project's
  headline validation.
- `encounter.js` asserted "real interacting pairs pass at tens of kpc" — **refuted by this
  project's own data**: median published r_min is 11.6 kpc and 82% are under 20 (on the corrected 62-target catalogue; it read 12.1 and 81% while three fits were being lost to a name join).
- Detective mode clamped pericentre at 20 kpc and eccentricity at 2.0, dwarf-era constants that
  rewrote 35 of 59 targets. Tested directly: the engine is exact to e = 5.0 and 90 kpc.

### And a limitation of the round itself

The synthesis found that **no independent verifier result reached it** — all 47 findings arrived
marked `VERIFIER: NOT CHECKED`. It responded by re-checking every load-bearing finding against
the source itself, and by labelling anything it had not personally reproduced as *reported*.
It also noted the tree was being edited while the reviewers wrote, so a large fraction of its
own findings were already fixed by the time it ran. Both are real limits on the round, and both
are recorded rather than smoothed over.

Assertions went **46 → 57**.

---

## Round 3 — 2026-08-15 00:12 to 00:44, on a FROZEN tree

Same six reviewers, each given the round-2 change list and asked to check whether
those fixes are **correct** rather than present. Two changes to the method:

1. **The tree was frozen.** Round 2's synthesis reported that files were being
   edited while its reviewers wrote, so a large fraction of its findings were
   already fixed by the time it ran. Nothing was edited during round 3.
2. **Verification joined by INDEX, not title.** Round 2's join failed silently and
   all 47 findings reached the synthesis marked `NOT CHECKED`. With the index
   join, **0 of 36 were unchecked**.

**36 findings. 30 confirmed, 6 partial, 0 refuted outright.** All six verdicts
"not yet". Two findings were corrected by their verifiers in the **worse**
direction.

### The headline: round 3 found round 2's fixes were wrong

This is the pattern the round was designed to catch, recurring in the fixes the
previous round shipped. Four were present, commented as handled, and wrong.

| Round-2 fix | What was actually true |
|---|---|
| **Friction validity gate** | Identically **inert**. It divided the perturber's MIN component scale (bulge, 0.5·rScale) by the field's MAX (halo, 20·rScale) — a built-in factor of 40 against ever firing. Measured w = 1.0000 at every mass ratio the interface can reach. Its test passed because it used bare potentials where min and max coincide: **it validated a branch `galaxyModel()` cannot construct.** |
| **Pair force** | Adopted `M_i M_j d/(d²+a_i²+a_j²)^{3/2}` under a comment claiming it exact for Plummer and erring toward *more* softening. Against quadrature: **3.09x too strong at 20 kpc** for the halo carrying 94% of the mass, and 1.29x at d=5 for Plummer–Plummer, so not exact there either. |
| **Colour ramp** | Overshot into the opposite failure. Both ends of the legend showed colours no particle has. |
| **Share link colour mode** | Restores the mode without calling `updateLegend()`, so a shared `?cd=1` renders provenance colours under the population key. |

Two of these were mine from round 2, written confidently, with comments asserting
they were handled. **A comment claiming a thing is fixed is not evidence that it
is**, and the reviewers who caught these did so by re-deriving the arithmetic
rather than by reading the comment.

### What I found myself, while round 3 was in flight

The tree was frozen, so I could only verify. That turned out to be the most
productive constraint of the night — verification-only work found the single worst
defect in the project.

**Encounters requested as BOUND were executed as UNBOUND.** `buildEncounter` set
the orbit from a point-mass Kepler solution while the galaxies are extended;
`solveKeplerPericentre` corrected the *distance* of closest approach and nothing
corrected the *energy*. At the published Arp 244 fit the total energy went
−1.007e3 (point mass) to **+1.289e3** (real potential) — a sign flip — and a
4.6 kpc Kepler apocentre executed as a runaway to 559 kpc. **24 of the 36 bound
published fits.** And nothing anywhere checked eccentricity, so the sandbox
slider was equally untrue: 0.95 requested, 0.908 executed.

Verified two independent ways (energy at the initial state; integration) before
any code changed.

**21 of 59 published fits are outside the model's domain entirely.** Ten have an
apocentre inside the disc radius, so the galaxies never separate; eleven more have
the companion dominating the disc edge at apocentre. My first attempt at a
criterion was wrong in an instructive way — a single perturbation ratio that
reported 30–50x for the deepest systems because the clamp made it measure the
companion's pull at its own centre. The correct structure is two tiers, and the
**"marginal" bucket comes out empty**, so the classification does not depend on
where the threshold sits.

### Applied

| Finding | What changed |
|---|---|
| Pair force 3.09x too strong | `src/engine/pairforce.js`: exact mutual force and potential by quadrature, the angular integral reduced to a radial one with an elementary inner step. Cubic Hermite tabulation where the force supplies the potential's nodal derivative, so F and W are consistent BY CONSTRUCTION — linear interpolation gave 4.9e-4 energy drift, Hermite gives 1.5e-7 |
| Friction gate inert | Gated on R_perturber/separation, which is what Chandrasekhar's point-mass assumption requires. Full weight below 0.2, zero by 0.6 |
| Bound orbits unbound | Closed-form (E, L) from the requested turning points in the REAL potential; state placed at pericentre and rewound through the shipped leapfrog. Rewind CAPPED AT APOCENTRE, because a tight orbit's radial period is shorter than tStart and wrapping left the pair outbound at t=0 |
| Outside the model | `domainOfValidity()`, surfaced in the UI. Loading the Antennae fit now says so instead of drawing something |
| Detect hid its own controls | Measured `offsetParent === null` for all eight orbit and disc controls. `data-mode` is now a list |
| Space stolen from controls | The round-1 shortcut fix overshot; the retrograde checkboxes had no keyboard route at all |
| Pan a no-op | `applyFollow()` wrote the same field `pan()` did. Separate offset |
| Ring shown after it had gone | Ring lives 24→71 Myr of a 1037 Myr timeline; the tour sat at 66 Myr, contrast 1.51. Moved to 28 Myr, contrast 219 |
| Recovery demo an inverse crime on a non-parameter | Now fits (inclination, **node**) against an INDEPENDENT realisation, reporting error against N |
| Mirror degeneracy unsearched | L(−inc) = L(+inc) = 0.000e+0 exactly, coplanar. Documented with a control |
| Adjoint guessed at unknown potentials | Throws instead — `nfw` was 20.6x too strong with a Jacobian consistent with the wrong force, so every gradient check still passed |
| Documents drifted from measurements | `test/claims.test.js` — see below |

Assertions **57 → 71**, all complete.

### The structural fix: the documents are now checked against the measurements

Every round has found the same defect somewhere new. Each was fixed by hand,
which restores the values and leaves the mechanism — and the mechanism is that
prose and measurement are not connected.

They are connected now. The suites record what they measured; `claims.test.js`
fetches the shipped text and fails the build when a registered figure has drifted.
Eleven figures across `index.html`, `tour.js`, `encounter.js` (blurb *and* file
header), `README.md`, `adjoint.js` and `DEVLOG.md`. It caught the drift
immediately, including two the reviewers had not listed, and it has since fired
three times on my own changes — which is the point.

It carries its own limits in its header: it checks the numbers it is told about,
and a wrong number registered against a wrong measurement still passes.

### And the limits of round 3

The synthesis named what three rounds have still never examined, and it is worth
recording because it is a criticism of the *process*, not the code:

> Round-1 fixes have not been re-verified since round 1. Only one reviewer checked
> any round-1 item — and one of the two he checked had regressed. The tree has
> changed twice since. Given that round 3's largest yield was "round-2 fixes that
> are wrong", the untested hypothesis is that round-1 fixes are wrong too.

Also unexamined across all three rounds: the GPU float32 path (the thing that
actually ships), any measured frame rate on a full scene by a reviewer, the
catalogue's provenance against its published source, and the units boundary. And
no reviewer represents a person without dev tools.
