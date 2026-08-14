# Review board

Six reviewers with genuinely different concerns, briefed to break the work rather than approve
it, run as a gate at the end of each stage and looped until satisfied.

The operative briefs live in **`round1_workflow.js`**, which is the script that actually runs
them. They are deliberately not duplicated here: two copies of a brief drift, and the one that
drifts is always the one nobody executes. This file documents the *process*; that file is the
*source of truth* for what each reviewer is told.

## The six lenses

| Reviewer | Lens | The thing they exist to catch |
|---|---|---|
| **Dr Miriam Osei**, numerical physicist | Conserved quantities and convergence, never pictures | Energy drift hidden by rescaling; tests that manufacture their own precondition; softening and timestep treated as settings rather than as silent knobs |
| **Dr Ines Vasquez**, observational astronomer | Does this resemble the actual sky | Surface brightness that makes no sense; orientation and handedness; a projection match described as though 3D geometry were established |
| **Dr Ravi Menon**, inference statistician | Is the inverse problem well posed | Point estimates dressed as posteriors; multimodality swept under the rug; recovering your own forward model's parameters mistaken for the model being right |
| **Sofia Reinhardt**, art director | Is it actually stunning, to someone with no interest in the physics | Particles reading as dots rather than light; blown highlights; missing dust; compositions with no focal hierarchy |
| **Tomas Lindqvist**, interaction designer | Can someone use this to have an idea | Frame rates measured on scenes that are not the real one; no way back; state that cannot be shared, so a discovery cannot be returned to |
| **Prof Alan Whitcombe**, referee | Has this been done, and is each claim as wide as its check | Novelty asserted without a proper search; current state licensing claims about history or cause; results from the fast path quoted as if from the accurate one |

## The loop

1. Stage-relevant reviewers run **in parallel**, each returning structured findings with severity.
2. **Every finding is adversarially verified before being acted on**, by an independent agent
   whose job is to refute it. Reviewers produce false findings, and accepting a wrong
   correction is as damaging as missing a right one.
3. Confirmed findings are applied. **Refuted findings are logged with the reason they did not
   survive**, so the same false finding is not re-raised next round.
4. Re-review. A reviewer that returns nothing new for two consecutive rounds is satisfied.
5. **Per-reviewer finding counts are logged every round.** A reviewer scoring zero on round one
   is investigated, not trusted: a rule that never fires looks exactly like a rule with nothing
   to match.
6. The gate passes when all six are satisfied.

## Why build inline and only fan out the review

Reviewing six ways is embarrassingly parallel and a good use of concurrent agents. Writing the
engine is a single coherent act, and splitting it across agents fragments it. That is where the
line is drawn.

## Log

`REVIEW_LOG.md` holds each round: findings, verdicts, what was applied, what was refuted and
why, and per-reviewer counts.
