export const meta = {
  name: 'galaxy-review-board-r2',
  description: 'Round 2: the same six reviewers re-attack after the round-1 fixes, checking the fixes are CORRECT rather than merely present, with verification required to be complete',
  phases: [
    { title: 'Review', detail: 'six reviewers, told what changed, capped at 8 findings each' },
    { title: 'Verify', detail: 'every finding checked; skipped ones must be declared' },
    { title: 'Synthesise', detail: 'surviving findings, regressions, and per-reviewer satisfaction' },
  ],
}

const ROOT = '/Volumes/SSD1/code/research/galaxy_collisions'
const SHOTS = '/Volumes/SSD1/code/research/review'

const CONTEXT = `
PROJECT: interactive galaxy-collision simulator and visualiser, plus foundations for a
research instrument that recovers encounter parameters from observed interacting galaxies.

Root: ${ROOT}   Live: https://galaxy-collisions.pages.dev
Screenshots (Read them; they render): ${SHOTS}/
  12-mw-scale.png       prograde, Milky Way-scale model
  13-tuned.png          same, retuned render defaults
  14-mixed-spin.png     ONE disc prograde, ONE retrograde
  15-merger.png         merger with dynamical friction, at max separation
  16-science-view-r2.png the rewritten science view
  (01-11 are PRE-FIX and show the OLD dwarf model — do not review those as current)

THIS IS ROUND 2. Round 1 produced 70 findings; the significant ones were acted on. Your job
is NOT to re-list them. It is to check whether each fix is actually CORRECT, and to find what
round 1 missed. A fix that is present but wrong is worse than the original defect, because it
now carries a comment asserting it is handled.

WHAT CHANGED SINCE ROUND 1 (verify these, do not take them on trust):

1. Newton's third law. Galaxy-galaxy force was evaluated one-sidedly and broke the third law
   for unequal masses (measured 34% asymmetry at q=0.1). Now computed once and applied equal
   and opposite in cpu.js. Asserted symmetric to 1.2e-16, momentum drift exactly 0.
   The old conservation test used the SAME Plummer scale for both galaxies, so it could not
   detect the defect; it now uses mismatched scales.
2. Units. Added an independent check: Kepler's third law for the Earth's orbit via the AU,
   solar mass and Julian year, closing to 3.8e-5. The old checks cancelled the velocity unit.
3. Mass model. Was a 1e10 Msun dwarf, vcirc peak 118 km/s, no halo. Now bulge+disc+halo,
   7.0e11 Msun, vcirc 208-220 km/s flat from 3-25 kpc (asserted). Scenario pericentres moved
   from a few kpc to 14-55 kpc. galaxyModel() in encounter.js.
4. Pericentre. The Kepler setup did not execute the requested pericentre (38.6% high). Now
   solved numerically: request 25 -> Kepler 15.6 -> executes 25.0. Asserted.
5. Shipped disc equilibrium. exponentialDisc took vcirc at the CYLINDRICAL radius while
   placing particles at height z. Now spherical radius; asserted on the SHIPPED generator.
6. Ring scenario. Was coplanar (produced no ring); now perpendicular.
7. Science view. Was pow(clamp(h*exposure,0,1),1/2.2) under a "linear readout" comment. Now
   linear against one fixed full-scale constant, exact sRGB encode, mapping stated on screen,
   and CLIPPING PAINTED MAGENTA. See 16-science-view-r2.png.
8. Identifiability. Mass and epoch proven an exactly flat direction (invariant to 3.8e-8,
   control differs 45%). Gauge declared in docs/IDENTIFIABILITY.md.
9. Dynamical friction. Chandrasekhar, per-component densities, force-symmetrised. Momentum
   conserved to 2.85e-15, apocentre decays 296.7 -> 29.1 kpc. OFF by default because it breaks
   exact time reversal. First implementation GAINED energy 250x (stiff drag); stabilised by
   flooring the density separation and capping the per-step impulse.
10. float32 reversal re-measured on the SHIPPED GPU path: median 2.0e-5, p99 8.4e-4, worst
    3.9e-3 kpc over 3000+3000 steps.
11. Per-disc retrograde controls, pericentre marker on the timeline, bloom bright-pass,
    shareable URL state, science-view HUD.
12. Benchmark harness restored; bench/RESULTS.md now records TWO runs with machine state,
    because they differ by up to 56% in the bandwidth-bound regime.

CURRENT STATE: 46 assertions, expected 46, complete. The harness FAILS on a check-count
mismatch, not just on a failed check.

NOT BUILT, and not claimed to be: the differentiable inverse problem, amortised posteriors,
the 62-system Galaxy Zoo benchmark, viewing-angle parameters, gas, star formation.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['reviewer', 'verdict', 'summary', 'findings'],
  properties: {
    reviewer: { type: 'string' },
    verdict: { type: 'string', enum: ['A+', 'close', 'not yet', 'serious problems'] },
    summary: { type: 'string' },
    fixes_checked: {
      type: 'array',
      description: 'For each round-1 fix you checked: which, and whether it is correct',
      items: {
        type: 'object',
        required: ['fix', 'status'],
        properties: {
          fix: { type: 'string' },
          status: { type: 'string', enum: ['correct', 'partial', 'wrong', 'not checked'] },
          note: { type: 'string' },
        },
      },
    },
    findings: {
      type: 'array',
      maxItems: 8,
      description: 'AT MOST 8, ranked most severe first. Quality over quantity: verification must be able to keep up.',
      items: {
        type: 'object',
        required: ['title', 'severity', 'file', 'claim', 'why_it_matters', 'suggested_fix'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string' },
          claim: { type: 'string' },
          why_it_matters: { type: 'string' },
          suggested_fix: { type: 'string' },
          is_regression: { type: 'boolean', description: 'true if a round-1 fix caused this' },
        },
      },
    },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  required: ['results', 'all_checked'],
  properties: {
    all_checked: { type: 'boolean', description: 'true only if you checked EVERY finding given to you' },
    not_checked: { type: 'array', items: { type: 'string' }, description: 'titles you could not check, and why' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'verdict', 'reasoning'],
        properties: {
          title: { type: 'string' },
          verdict: { type: 'string', enum: ['CONFIRMED', 'REFUTED', 'PARTIAL'] },
          reasoning: { type: 'string' },
          corrected_claim: { type: 'string' },
        },
      },
    },
  },
}

const REVIEWERS = [
  { key: 'numerical-physicist', name: 'Dr Miriam Osei, numerical physicist',
    brief: `You look at conserved quantities and convergence, never at pictures. Round 1 you
found the third-law violation and the equilibrium-assertion mismatch. CHECK THE FIXES: is the
symmetrised pair force actually correct physics or merely symmetric? Does flooring the
friction density hide a real instability rather than resolve it? Is capping the drag impulse a
silent modification of the equations of motion in a regime a user can reach? Does the
pericentre solver converge for every scenario, including hyperbolic ones? Attack the new
assertions the same way you attacked the old: what would each still do if the feature were
absent?` },
  { key: 'observational-astronomer', name: 'Dr Ines Vasquez, observational astronomer',
    brief: `Round 1 you found the dwarf galaxies, the coplanar ring, and the penetrating
pericentres. CHECK THE FIXES against real observations: is a flat 214 km/s curve to 25 kpc
actually right for the systems these scenarios are named after? Are the new pericentres
(14-55 kpc) consistent with observed pairs? Does the ring scenario now produce something a
referee would accept as Cartwheel-like? Look at 12-16. Attack surface brightness, orientation
conventions, and any claim about a named system.` },
  { key: 'inference-statistician', name: 'Dr Ravi Menon, inference statistician',
    brief: `Round 1 you found the mass-time flat direction and the mis-measured float32 figure.
CHECK: is docs/IDENTIFIABILITY.md's gauge actually sufficient, or does fixing m1 merely move
the degeneracy somewhere else? Are there NEAR-degeneracies (dangerous ones) the exact analysis
missed? Does the pericentre solver introduce a new non-identifiability by making rPeri a
derived rather than free quantity? Is the reported float32 percentile distribution adequate to
budget an adjoint checkpoint interval, or does it still measure the wrong thing?` },
  { key: 'art-director', name: 'Sofia Reinhardt, art director',
    brief: `Round 1 you found the missing bright-pass, the missing dust, and the AgX look-stage
omission. READ 12-16. Dust and a bright-pass now exist. CHECK: does the bloom now read as
light rather than haze? Does the two-slab dust produce believable lanes or visible artefacts?
Is the Milky Way-scale retune (splat 0.22, intensity 0.022) actually right, or has the picture
become thin and grey? Is the science view legible AS A DESIGNED OBJECT, not just as honest
data? Answer the question that hurts: gallery wall, no caption — would anyone stop?` },
  { key: 'interaction-designer', name: 'Tomas Lindqvist, interaction designer',
    brief: `Round 1 you found the unreachable task, the lost clock on every parameter change,
the missing shareable state and the absent pericentre marker. Per-disc spin, URL state and the
pericentre marker now exist. Read index.html and src/app/app.js. CHECK them, then attack what
remains: does changing a parameter now preserve the epoch, or only sometimes? Is the friction
slider's irreversibility warning discoverable before someone scrubs backwards and gets a
different path? Walk a real task end to end: "find an encounter that merges within 1 Gyr" and
say exactly where it stalls. Contrast, keyboard access and reduced-motion remain fair game.` },
  { key: 'referee', name: 'Professor Alan Whitcombe, referee',
    brief: `You review CLAIMS. Round 1 you found that the claims were consistently wider than
their checks: the asserted disc was not the shipped disc, the benchmark harness did not exist,
the "linear readout" clipped. Read DEVLOG.md, docs/LITERATURE.md, docs/IDENTIFIABILITY.md,
bench/RESULTS.md and the scenario blurbs AS CURRENTLY WRITTEN.

For every sentence asserting something, ask: what check supports it, and is the sentence wider
than the check? Attack specifically: the DEVLOG now describes fixes in confident terms — are
those descriptions accurate? Is the novelty claim still properly hedged as a one-search
hypothesis? Does anything now claim to reproduce Toomre and Toomre when that paper still has
not been read? Say plainly where hedging IS adequate, so that your criticism carries weight.` },
]

phase('Review')
const reviews = await parallel(REVIEWERS.map((r) => () =>
  agent(
    `You are ${r.name}. ADVERSARIAL REVIEW, round 2. Find fault; do not rubber-stamp.\n\n${r.brief}\n\n${CONTEXT}\n\n` +
    `Read the actual files and screenshots before asserting anything. Populate fixes_checked ` +
    `for every round-1 fix in your area — that is as valuable as new findings. Cap findings at ` +
    `EIGHT and rank them, because every one must be independently verified and an unverified ` +
    `finding is worth little. Mark is_regression true if a round-1 fix caused the problem.`,
    { label: `r2:${r.key}`, phase: 'Review', schema: FINDINGS_SCHEMA, effort: 'high' }
  ).then((res) => (res ? { ...res, key: r.key, name: r.name } : null))
))

const alive = reviews.filter(Boolean)
log(`round 2: ${alive.length}/${REVIEWERS.length} reported; findings ` +
    alive.map((r) => `${r.key}:${r.findings.length}`).join(' '))
for (const r of alive) {
  const bad = (r.fixes_checked ?? []).filter((f) => f.status === 'wrong' || f.status === 'partial')
  if (bad.length) log(`${r.key} disputes ${bad.length} round-1 fix(es): ${bad.map((f) => f.fix).join('; ')}`)
  if (r.findings.length === 0) log(`ZERO-FINDING REVIEWER: ${r.key} (${r.verdict}) — investigate, do not trust`)
}

phase('Verify')
const verified = await parallel(alive.map((r) => () =>
  agent(
    `Independent verifier. ${r.name} made the findings below. TRY TO REFUTE EACH ONE against ` +
    `the actual code and output.\n\n${CONTEXT}\n\n` +
    `FINDINGS (${r.findings.length} — you must check ALL of them):\n` +
    r.findings.map((f, i) =>
      `${i + 1}. [${f.severity}] ${f.title}\n   file: ${f.file}\n   claim: ${f.claim}`).join('\n\n') +
    `\n\nCOMPLETENESS IS MANDATORY. Round 1's verification silently checked only a subset, which ` +
    `made its confirmed/refuted counts misleading. Check every finding. Set all_checked true ONLY ` +
    `if you did, and list any you could not in not_checked with the reason.\n\n` +
    `Return CONFIRMED (real as described), REFUTED (wrong, or already handled), or PARTIAL ` +
    `(real but mis-stated — give corrected_claim). Default to REFUTED if you cannot substantiate ` +
    `it. Quote what you actually found.`,
    { label: `r2verify:${r.key}`, phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'high' }
  ).then((v) => (v ? { key: r.key, name: r.name, verdict: r.verdict, summary: r.summary,
                       fixes: r.fixes_checked ?? [], findings: r.findings,
                       checks: v.results ?? [], allChecked: v.all_checked,
                       notChecked: v.not_checked ?? [] } : null))
))

const good = verified.filter(Boolean)
let confirmed = 0, refuted = 0, partial = 0, skipped = 0
for (const r of good) {
  for (const c of r.checks) {
    if (c.verdict === 'CONFIRMED') confirmed++
    else if (c.verdict === 'REFUTED') refuted++
    else partial++
  }
  skipped += r.notChecked.length
  if (!r.allChecked) log(`INCOMPLETE VERIFICATION for ${r.key}: skipped ${r.notChecked.join('; ')}`)
}
log(`round 2 verification: ${confirmed} confirmed, ${partial} partial, ${refuted} refuted, ${skipped} unchecked`)

phase('Synthesise')
const digest = good.map((r) => {
  const by = Object.fromEntries(r.checks.map((c) => [c.title, c]))
  return `## ${r.name} — verdict: ${r.verdict}\n${r.summary}\n\n` +
    `ROUND-1 FIXES CHECKED:\n` +
    (r.fixes.length ? r.fixes.map((f) => `- ${f.fix}: ${f.status}${f.note ? ' — ' + f.note : ''}`).join('\n')
                    : '- (none reported)') +
    `\n\nNEW FINDINGS:\n` +
    r.findings.map((f) => {
      const c = by[f.title]
      return `- [${f.severity}]${f.is_regression ? ' [REGRESSION]' : ''} ${f.title} (${f.file})\n` +
        `  claim: ${f.claim}\n  matters: ${f.why_it_matters}\n  fix: ${f.suggested_fix}\n` +
        `  VERIFIER: ${c ? c.verdict + ' — ' + c.reasoning : 'NOT CHECKED'}` +
        `${c?.corrected_claim ? '\n  CORRECTED: ' + c.corrected_claim : ''}`
    }).join('\n')
}).join('\n\n')

const synthesis = await agent(
  `Synthesise adversarial review round 2 into an action list.\n\n${CONTEXT}\n\n${digest}\n\n` +
  `Produce, in markdown:\n` +
  `1. Honest one-paragraph assessment of where the work stands after two rounds.\n` +
  `2. ROUND-1 FIXES THAT ARE WRONG OR PARTIAL — highest priority, since each carries a comment ` +
  `asserting it is handled. Include any REGRESSIONS.\n` +
  `3. SURVIVING NEW FINDINGS (CONFIRMED and PARTIAL only) ranked by severity, deduplicated, ` +
  `noting where reviewers from different lenses converged.\n` +
  `4. REFUTED claims, briefly, so they are not re-raised.\n` +
  `5. Per-reviewer: finding count, whether verification was complete, and whether that reviewer ` +
  `is SATISFIED (zero surviving findings).\n` +
  `6. Is the A+ gate passed? Answer yes or no and say exactly what blocks it.\n` +
  `Be blunt. Do not soften. Do not invent findings not in the input.`,
  { label: 'r2synthesis', phase: 'Synthesise', effort: 'high' }
)

return { round: 2, reviewers: good.length, confirmed, partial, refuted, skipped, synthesis }
