export const meta = {
  name: 'galaxy-review-board-r1',
  description: 'Six adversarial reviewers attack the galaxy collision project, then each reviewer\'s findings are independently verified before anything is acted on',
  phases: [
    { title: 'Review', detail: 'six persona reviewers in parallel, briefed to break not approve' },
    { title: 'Verify', detail: 'independent adversarial check of each reviewer\'s findings' },
    { title: 'Synthesise', detail: 'rank surviving findings and report per-reviewer counts' },
  ],
}

const ROOT = '/Volumes/SSD1/code/research/galaxy_collisions'
const SHOTS = '/Volumes/SSD1/code/research/review'

const CONTEXT = `
PROJECT: an interactive galaxy-collision simulator and visualiser, plus the beginnings of a
research instrument for recovering encounter parameters from observed interacting galaxies.

Root: ${ROOT}
Screenshots of live output: ${SHOTS}/01-prograde.png, 02-retrograde.png, 03-mice.png,
04-ring.png, 05-provenance.png, 06-science-view.png
(You can Read png files directly and see them. Do so.)

KEY FILES
  src/engine/units.js        internal units, G=1, kpc, 1e10 Msun
  src/engine/potentials.js   point / Plummer / Hernquist / NFW / composite, CPU reference
  src/engine/kepler.js       orbit setup + analytic ground truth (energy, angmom, LRL)
  src/engine/galaxy.js       disc initial conditions
  src/engine/cpu.js          float64 CPU reference integrator, leapfrog KDK
  src/engine/kernels.js      WGSL compute kernel (the shipped physics)
  src/engine/gpu.js          GPU sim; galaxies integrate on CPU in float64
  src/engine/encounter.js    encounter construction + named scenarios
  src/render/shaders.js      splat / bloom / AgX composite WGSL
  src/render/renderer.js     HDR pipeline
  src/render/camera.js       orbit camera
  src/app/app.js             application
  index.html                 UI
  test/physics.test.js       26 standing assertions
  test/gpu.test.js           5 GPU-vs-CPU cross-checks
  test/harness.js            harness incl. a check-count guard
  bench/RESULTS.md           measured throughput
  docs/LITERATURE.md         citation trail with verified/reported/inferred separated
  DEVLOG.md                  build log

MEASURED FACTS (do not re-derive, but you may challenge whether they support what is claimed):
  - 31/31 tests pass, and the harness asserts the expected COUNT of checks, not just pass rate
  - direct all-pairs saturates at 1.16e11 pair-interactions/s on an M4
  - restricted (N particles, 2 rigid potentials) saturates ~3.1e9 updates/s, memory-bound
  - app runs 300,000 test particles at 60 fps / 16.7 ms
  - float64 time-reversal residual 5e-16; float32 residual 4.3e-7 over 3000+3000 steps
  - closure error converges 4.00 -> 4.00 -> 4.00 across three halvings (2nd order)

STATE OF THE WORK: this is one evening old. The differentiable inverse problem, amortised
posteriors and the 62-system Galaxy Zoo benchmark are NOT built and are not claimed to be.
Judge what exists, and judge whether what is CLAIMED matches what EXISTS.
`

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['reviewer', 'verdict', 'summary', 'findings'],
  properties: {
    reviewer: { type: 'string' },
    verdict: { type: 'string', enum: ['A+', 'close', 'not yet', 'serious problems'] },
    summary: { type: 'string', description: 'two or three sentences, your overall position' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'severity', 'file', 'claim', 'why_it_matters', 'suggested_fix'],
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          file: { type: 'string', description: 'path, or "output" for a visual finding' },
          claim: { type: 'string', description: 'the specific defect, concretely' },
          why_it_matters: { type: 'string' },
          suggested_fix: { type: 'string' },
        },
      },
    },
  },
}

const VERIFY_SCHEMA = {
  type: 'object',
  required: ['results'],
  properties: {
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
  {
    key: 'numerical-physicist',
    name: 'Dr Miriam Osei, numerical physicist',
    brief: `Twenty years writing and breaking N-body codes; you once shipped a result later
retracted because a softening length was too small. You do not look at pictures, you look at
conserved quantities and convergence.

Attack: energy drift hidden by rescaling or by a forgiving axis; tests that manufacture their
own precondition; softening and timestep treated as settings rather than as knobs that
silently change answers; discs not in equilibrium; unit errors, especially factors of G or of
2 in the virial theorem; results that depend on particle count presented as depending on
physics; claims that an integrator is symplectic that a velocity-dependent force or adaptive
timestep would break.

Read test/physics.test.js and ask of EVERY assertion: what would this still do if the feature
were entirely absent? Check whether the softening/timestep convergence study actually exists
or is merely implied. "It looks physically plausible" is not an answer you may accept.`,
  },
  {
    key: 'observational-astronomer',
    name: 'Dr Ines Vasquez, observational astronomer',
    brief: `Fifteen years getting telescope time and reducing the data. You have looked at more
real interacting galaxies than anyone else here and are correspondingly hard to impress with a
simulation of one.

Look at the screenshots. Attack: surface brightness that makes no sense (tidal tails are FAINT;
if they are as bright as the discs something is wrong); orientation and handedness (sky
coordinates run the other way from graphics conventions and this bites everyone once);
projection confusion, where a match in projection is described as if 3D geometry were
established; claims about named systems that no cited observation supports; colour that is
decorative but read as if it meant stellar population; missing selection effects.

Specifically scrutinise src/engine/encounter.js SCENARIOS: entries are named "Mice-like" and
"Antennae-like". Is the hedging adequate and is it carried into the UI the user actually sees,
or does the interface quietly present these as the real systems?`,
  },
  {
    key: 'inference-statistician',
    name: 'Dr Ravi Menon, inference statistician',
    brief: `You work on simulation-based inference outside astronomy, so you are not invested in
the field's habits. You have seen many gradient fits to multimodal likelihoods confidently
converge to the wrong basin.

The inverse problem is NOT built yet. Your job is therefore forward-looking and architectural:
read docs/LITERATURE.md, DEVLOG.md, src/engine/kepler.js, encounter.js and gpu.js, and judge
whether the foundations that HAVE been laid will support defensible inference, and whether the
claims made about the future work are already wider than their evidence.

Attack: the parameterisation (is it identifiable? which parameters are degenerate by
construction?); the plan to use float32 reversibility for a constant-memory adjoint given the
measured 4.3e-7 residual; the claim that Galaxy Zoo's 3M human-scored parameter sets are a
"labelled training corpus" (are they? labelled with what? by whom? with what selection bias?);
the stated intent to beat Mortazavi's 7-good-of-15 benchmark (is that comparison even
like-for-like?); any conflation of "recovering parameters from our own forward model" with
"the model is right".`,
  },
  {
    key: 'art-director',
    name: 'Sofia Reinhardt, art director',
    brief: `Twenty years in visual effects, five on astronomy documentary work. You are not
grading on a curve for a science project: the benchmark is a good film frame.

READ THE SCREENSHOTS. Attack: particles reading as dots rather than light; blown highlights
where the core saturates to a white disc and loses all internal structure; tone mapping that
greys the midtones while claiming to be HDR; NO DUST (the dark lanes are half of what makes a
galaxy legible and simulations almost always omit them); palettes that are physically derived
and still ugly; compositions with no focal hierarchy; a single look that dies in another
context; motion that is technically smooth and dramatically inert.

Name the specific reference images that set the bar and say what they do that this does not.
You are allowed to say it is boring. Answer the question that hurts: if this were on a gallery
wall with no caption, would anyone stop?`,
  },
  {
    key: 'interaction-designer',
    name: 'Tomas Lindqvist, interaction designer',
    brief: `You build dense real-time tools for experts in something other than software.
Interactivity is not the presence of controls; it is whether the loop between changing
something and understanding the consequence is tight enough to support thought.

Read index.html and src/app/app.js as an interface, and look at the screenshots. Attack: frame
rate claimed from a scene that is not the real one; controls that expose implementation rather
than concept; NO WAY BACK (undo, reset, returning to a known state); state that cannot be
captured or shared, so a discovery cannot be returned to or sent to anyone; modes a user can
enter without realising; onboarding that assumes the physics is already understood in a tool
partly meant to teach it; accessibility as an afterthought (keyboard, reduced motion, colour
carrying meaning alone).

Judge it against a task, not a feature list: "find an encounter that produces a long thin tail
on one galaxy and almost nothing on the other." Walk that through and say where it stalls.`,
  },
  {
    key: 'referee',
    name: 'Professor Alan Whitcombe, referee',
    brief: `Thirty years in galaxy dynamics, twelve as an editor. You remember the prior work,
including the prior work authors fail to cite, and you are not gentle.

You review the CLAIMS, not the code. Read DEVLOG.md, docs/LITERATURE.md, bench/RESULTS.md,
README-ish prose in index.html, and the scenario blurbs in src/engine/encounter.js.

For every sentence that asserts something, ask: what check supports this, and is the sentence
WIDER than the check? Current state does not license history; history does not license
causation. Attack: novelty asserted without a proper search (the DEVLOG claims a specific gap
in the literature on the strength of ONE search session — is that adequate, and is it labelled
as inadequate?); comparisons against a baseline that is not like-for-like; results from the
fast approximate path quoted as if from an accurate one; the reproduction of Toomre & Toomre's
prograde/retrograde asymmetry being claimed when the paper has NOT been read in full;
uncertainties quoted without saying what kind they are.

Say plainly when something IS properly hedged, so that your criticism means something.`,
  },
]

phase('Review')
const reviews = await parallel(REVIEWERS.map((r) => () =>
  agent(
    `You are ${r.name}. You have been asked to REVIEW ADVERSARIALLY: find fault, do not rubber-stamp. ` +
    `A review that finds nothing is a failed review unless you can say specifically why the work ` +
    `defeats each attack you attempted.\n\n${r.brief}\n\n${CONTEXT}\n\n` +
    `Read the actual files before asserting anything about them. Read the screenshots if your lens is visual. ` +
    `Be concrete: name files, lines, numbers, specific images. Vague findings are useless. ` +
    `Set "verdict" honestly: A+ only if you genuinely cannot find a substantive defect.`,
    { label: `review:${r.key}`, phase: 'Review', schema: FINDINGS_SCHEMA, effort: 'high' }
  ).then((res) => ({ ...res, key: r.key, name: r.name }))
))

const alive = reviews.filter(Boolean)
log(`${alive.length}/${REVIEWERS.length} reviewers reported; ` +
    alive.map((r) => `${r.key}:${r.findings.length}`).join(' '))

// Per-reviewer finding counts, logged BEFORE verification. A reviewer that
// returns zero on round one is investigated, not trusted: a rule that never
// fires looks exactly like a rule with nothing to match.
for (const r of alive) {
  if (r.findings.length === 0) log(`ZERO-FINDING REVIEWER: ${r.key} (${r.verdict}) — treat as suspect, not as a pass`)
}

phase('Verify')
const verified = await parallel(alive.map((r) => () =>
  agent(
    `You are an independent verifier. Another reviewer (${r.name}) has made the findings below ` +
    `about this project. Your job is to TRY TO REFUTE EACH ONE by checking it against the actual ` +
    `code and output. Reviewers produce false findings, and accepting a wrong correction is as ` +
    `damaging as missing a right one.\n\n${CONTEXT}\n\n` +
    `FINDINGS TO CHECK:\n` +
    r.findings.map((f, i) =>
      `${i + 1}. [${f.severity}] ${f.title}\n   file: ${f.file}\n   claim: ${f.claim}\n   fix: ${f.suggested_fix}`
    ).join('\n\n') +
    `\n\nFor each: open the file, verify the specific claim, and return CONFIRMED (the defect is ` +
    `real as described), REFUTED (the claim is wrong, or the thing it asks for already exists), or ` +
    `PARTIAL (something real but mis-stated — then give corrected_claim). Default to REFUTED if you ` +
    `cannot substantiate it. Quote what you actually found.`,
    { label: `verify:${r.key}`, phase: 'Verify', schema: VERIFY_SCHEMA, effort: 'high' }
  ).then((v) => ({ key: r.key, name: r.name, verdict: r.verdict, summary: r.summary,
                   findings: r.findings, checks: v?.results ?? [] }))
))

const good = verified.filter(Boolean)
let confirmed = 0, refuted = 0, partial = 0
for (const r of good) {
  for (const c of r.checks) {
    if (c.verdict === 'CONFIRMED') confirmed++
    else if (c.verdict === 'REFUTED') refuted++
    else partial++
  }
}
log(`verification: ${confirmed} confirmed, ${partial} partial, ${refuted} refuted`)

phase('Synthesise')
const digest = good.map((r) => {
  const byTitle = Object.fromEntries(r.checks.map((c) => [c.title, c]))
  return `## ${r.name} — self-verdict: ${r.verdict}\n${r.summary}\n` +
    r.findings.map((f) => {
      const c = byTitle[f.title]
      return `- [${f.severity}] ${f.title} (${f.file})\n  claim: ${f.claim}\n  matters: ${f.why_it_matters}\n  fix: ${f.suggested_fix}\n  VERIFIER: ${c ? c.verdict + ' — ' + c.reasoning : 'not checked'}${c?.corrected_claim ? '\n  CORRECTED: ' + c.corrected_claim : ''}`
    }).join('\n')
}).join('\n\n')

const synthesis = await agent(
  `Synthesise this adversarial review round into an action list for the project owner.\n\n` +
  `${CONTEXT}\n\nREVIEWS AND VERIFICATIONS:\n${digest}\n\n` +
  `Produce, in markdown:\n` +
  `1. A one-paragraph honest assessment of where the work stands.\n` +
  `2. SURVIVING FINDINGS ranked by severity: only CONFIRMED and PARTIAL ones. For PARTIAL use the ` +
  `corrected claim. Each as: severity, title, file, what to do. Deduplicate where reviewers ` +
  `overlapped, and say which reviewers converged (agreement from different lenses is stronger).\n` +
  `3. REFUTED CLAIMS, briefly, with why they did not survive — this record matters so the same ` +
  `false finding is not re-raised next round.\n` +
  `4. Per-reviewer finding counts and whether each reviewer is SATISFIED (zero surviving findings).\n` +
  `5. The single highest-leverage next action.\n` +
  `Be blunt. Do not soften. Do not invent findings not in the input.`,
  { label: 'synthesis', phase: 'Synthesise', effort: 'high' }
)

return { round: 1, reviewers: good.length, confirmed, partial, refuted, synthesis }
