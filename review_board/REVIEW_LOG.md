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
  project's own data**: median published r_min is 12.1 kpc and 81% are under 20.
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
