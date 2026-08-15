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

---

## Round 4 — 2026-08-15 01:38 to 02:57, on a FROZEN tree

Half the board re-attacked the new code; half was aimed at what the *process* had
never examined, from round 3's own list of blind spots. Two new lenses replaced
two returning ones: a **regression auditor** (round-1 fixes had never been
re-verified) and a **GPU/performance engineer** (the interactive tier is what
ships and had the least adversarial attention of anything).

**36 findings. 30 confirmed, 6 partial, 0 refuted. 8 critical, 6 regressions.**
Verdicts: five "not yet", one **"serious problems"**.

This was the strongest round by a distance, and most of its criticals are defects
I introduced in round 3.

### The pattern got worse, not better

Round 3's headline was "four round-2 fixes are present, commented as handled, and
wrong". Round 4 found at least six of the same kind, and sharpened the diagnosis:
**a fix, present, commented as handled, validated by an assertion that cannot
fail, in a regime the application never enters.**

The demonstration is the one that should be remembered. A reviewer proved the
friction-gate test inert by **deleting the gate from `cpu.js` entirely** and
running the suite: it passed with byte-identical output, because the test
re-implemented the gate locally instead of calling it.

### My friction gate was wrong in both directions

| | criterion | failure |
|---|---|---|
| Round 2 | min-over-perturber ÷ max-over-field | inert, w = 1.0000 always |
| Round 3 (mine) | R_perturber / separation | **both** directions |
| Round 4 | R_perturber / R_field, outer scale both sides | — |

Mine failed to suppress where the pathology is **20.4x** the physical term
(beyond ~100 kpc both weights are 1), and suppressed *everything* below ~33 kpc,
where friction physically dominates. **58.7% of the shipped merger's dissipation
came from the term the file itself calls "the formula being used outside its
domain."**

I found the too-strict half myself, by measuring the merger. I did **not** find
the too-loose half. And the too-strict half had destroyed round 1's "a scenario
blurbed as a merger must merge" and defeated round 2's `tSpan` fix — one bad
criterion undoing two earlier rounds' work.

### Everything else it found in my round-3 work

- **`periConverged: true` was a hardcoded literal** on the bound branch. With
  friction, r_p = 60 executed **0.012 kpc** — a full plunge — and reported
  converged. That is exactly the silent non-solution the flag exists to prevent.
- **`executedApo` was computed from the request**, so the eccentricity assertion
  reduced algebraically to "requested equals requested" and could not fail on the
  quantity in its own name.
- **The disc was out of vertical equilibrium.** Setting `thickness = 0.1` put
  every particle at ψ = 0, in phase; rms|z| collapsed 40% in 19 Myr. The guard
  measures the SPHERICAL radius, conserved by construction, and passes at
  thickness 0, 0.1, 0.5 and 2.0.
- **The claims guard's sensitivity check asserted that 0.5 > 0.05**, never
  touching CLAIMS, a regex, or the comparison loop. And a NaN capture passed
  silently, because `NaN > tol` is false.
- **The drag impulse cap was dimensionally inconsistent** — `0.25/dt` compared
  against an acceleration, equal only when v = 1.
- **`IDENTIFIABILITY.md` was stale again**, every figure moved by my pair-force
  fix, in the file headed "Verified, not argued" — one round after round 2 caught
  the same table, and directly under a sentence I had added telling the reader to
  regenerate it.

### And the two findings that change what the project may claim

**The identifiability conclusion is contradicted by the shipped objective.** An
exhaustive 37×73 grid — the control nobody had run — puts the global minimum
nowhere near the truth at any N including 2400, and Adam's own endpoint beats the
truth at every N. Retracted.

**A second exact degeneracy, stronger than the one I documented.**
(i, ω, Ω) → (−i, ω+π, Ω+π) is bit-identical at **every** geometry, because
R_z(π) R_x(−i) R_z(π) = R_x(i). I verified it independently at 5.0e-16. My
"the two findings corroborate each other" was **false corroboration** — the
reflection flips inclination, and inclination keeps its sign in the N=40 fit.

### What round 4 verified as CORRECT

Worth as much as the findings, because it tells the project what to stop
re-litigating. Three reviewers attacked the pair force with three independently
written quadratures and could not break it: **5.5e-5** against independent 2-D
integration, F = dW/dd to **1.7e-7** through the Hermite table, turning points to
**4e-14** at every corner of the slider, Newton's third law exact by construction.
The bound-orbit closed form, the units, the deployed bundle, the absence of
`layout: 'auto'`, no buffer or texture leaks, science view's linearity, WCAG AA,
and all four round-3 UI fixes were confirmed by measurement.

### Applied

Friction gate rewritten on size asymmetry, with the test now calling the shipped
function. Disc thickness reimplemented as **orbital inclination** (a circular
orbit tilted by β has |x| = r and |v| = v_c(r) exactly, so it is thick *and* in
equilibrium), with new rms|z| and cylindrical-radius assertions and a sensitivity
check that the superseded construction fails them. Impulse cap corrected.
`periConverged` derived; `executedApo` measured. Merger retuned (lnΛ 0.6 → 0.2)
and `tSpan` extended so the coalescence at 1944 Myr is actually reachable, with
an assertion that it merges **and** merges inside its own timeline. Claims guard
made able to fail, and `IDENTIFIABILITY.md`'s six figures registered in it. The
Table 1/Table 4 join fixed — three fits recovered, all below the median r_min —
and every catalogue statistic re-derived on 62. Seek chunked and the atlas pad
coalesced (worst main-thread block 2,200 → 100 ms) with a busy indicator.
`device.lost` and `uncapturederror` handled, and the fps readout no longer reads
60 against a destroyed device.

Assertions **71 → 75**.

### Not done, and why

Batching the GPU submits — the real fix for the 1.6 s scrub — needs a
bind-group-layout change with per-dispatch dynamic offsets. Every one of this
project's worst bugs has come from bind-group layouts, and it was 3am. Logged
rather than rushed. The dust lane (S-13), the Detect residual instrument (S-14),
the multi-seed N-scaling (S-17) and the LRL check remain open.

---

## Round 5 — 2026-08-15 03:25 to 04:13, on a FROZEN tree

Aimed squarely at round 4's fixes, three of which were third attempts at the same
defect. The brief said: assume the pattern has repeated until you have measured
otherwise, and set a flag when you have *proved* an assertion cannot fail.

**36 findings. 32 confirmed, 4 partial, 0 refuted. Fourteen guards proved inert.**
Verdicts: three "serious problems", three "not yet".

**Six of round 4's eleven fixes were present, commented as handled, and wrong.**

### The technique that made this round

Mutation testing. Reviewers took `git archive HEAD` copies, deleted or reverted a
shipped fix, and ran the suite. Thirteen mutations, thirteen greens — including
setting the friction weight to `1` outright, reverting the disc thickness default
to `0`, and emptying the entire CLAIMS table.

That is a stronger instrument than reading, and it is the one this project should
have been using from round 1. A test that passes when you delete the code it
guards is not evidence of anything.

### The two that hurt most

**The friction gate, fourth attempt.** Round 4 exported `frictionWeight()` "so the
test calls the shipped function" — and left the integrator with an inline copy of
the same smoothstep, sharing only `frictionWeightX`. The comment above the export
reads *"`frictionWeight` below is the same function the integrator uses"*, and it
was false the moment it was written. Five mutations of the inline copy, five
byte-identical outputs.

So round 4's fix for "a guard that does not call the thing it guards is not a
guard" produced a guard that does not call the thing it guards.

**The claims guard, third attempt.** Round 4's sensitivity check declared a
private seven-line copy of the comparison under a comment claiming it drove the
real one. Round 5 neutered the live loop *and* drifted `index.html`'s headline
physics figure from 15.1% to 99.9% — a 580% error in a sentence users read — and
the suite reported **75/75, all green**, sensitivity check passing.

### And one where I was wrong twice in opposite directions

The drag impulse cap. Round 4 reported it dimensionally inconsistent; I changed it
without checking how the force is applied. `acc -= F * vx / mass` uses the
velocity **vector**, so the acceleration is F|v|/m and |v| cancels exactly —
`0.25/dt` was right and my "fix" made the cap |v| times too permissive. My own
ways-of-working says a report is the hypothesis to test, not the premise to act
on, and I did not follow it.

Round 5 then over-attributed in the other direction, claiming no lnΛ merges "under
the correct cap". **I measured: the cap fires on 0.0% of steps at every lnΛ from
0.2 to 6.** It is not the cap that limits the merger; the drag law is asymptotic.
Verifying the reviewers remains as necessary as verifying the code.

### The disc, fourth construction

Round 4's "thickness is orbital inclination" is correct per particle — |x| = r and
|v| = v_c(r) to float32 epsilon — and structurally a **folded sheet**: every orbit
tilted by the same β about the same node line, so ⟨z⟩ tracked azimuth with an m=1
moment 0.64 of rms|z|. The round-4 assertions were azimuthal **averages**, which
is exactly the operation that cannot see an azimuthal defect.

Each orbit now tilts about its own random node axis (Rodrigues, exact, so
equilibrium is untouched). Fold ratio **0.6405 → 0.0135**.

### Applied

`chandra()` calls `frictionWeight()`. Impulse cap reverted with the derivation
written out. Disc nodes randomised, with a check testing vertical extent, scaling
with thickness, the m=1 fold moment and per-particle |x| and |v| — plus a
sensitivity check that rejects *both* mutations round 5 used. One `compareClaim()`
called by the guard and its own sensitivity check. A length floor on CLAIMS.
Merger threshold given a stated definition (5 kpc, inside both discs, reached at
1685 Myr) rather than a picked one.

**75/75, all complete, zero failures.**

### What this round establishes about the loop

Five rounds, and every one has found the previous round's fixes wrong. The
defects have moved steadily *upward* — from the physics, to the fixes, to the
tests guarding the fixes, to the documents describing them — which is progress of
a kind, but the gate has not passed and the honest reading is that it will not
until the guards themselves are routinely mutation-tested.
