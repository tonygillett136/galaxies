/**
 * MUTATION TESTING: does the suite notice when the code is broken?
 *
 * WHY THIS EXISTS
 *
 * Five review rounds each found the previous round's fixes wrong. Rounds 1-4
 * found them by READING. Round 5 stopped reading and started breaking: it took
 * copies of the tree, deleted or reverted a shipped fix, and ran the suite.
 * Thirteen mutations, thirteen greens — including setting the friction validity
 * weight to 1 (the entire gate), reverting the disc thickness default to 0 (the
 * entire feature, byte-identical output), and emptying the whole CLAIMS table.
 *
 * Fourteen assertions were decorative. Four rounds of careful reading had not
 * found one of them, and one round of mutation found all fourteen.
 *
 * So the technique belongs in the project rather than in a review. Each entry
 * below reverts a fix that a specific round argued for. If the suite still
 * passes, that fix is unguarded and the entry prints SURVIVED.
 *
 *   node bench/mutate.mjs            run every mutation
 *   node bench/mutate.mjs friction   run those whose name matches
 *
 * WHAT IT CANNOT DO. It tests the mutations it is given. A defect nobody thought
 * to mutate is still unguarded, and a mutation that happens to be equivalent to
 * the original will always survive for a good reason. It converts "I believe this
 * test is meaningful" into "this test has been seen to fail", which is the
 * distinction five rounds kept losing.
 *
 * Runs the node-executable suites (physics + adjoint). The exact count is printed
 * by the run rather than stated here, because it moves. GPU, morphology
 * and claims need a browser and are not covered here — noted rather than hidden.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Each mutation REVERTS a fix some round argued for. `find` must match exactly
 * once — a mutation that no longer applies is itself a finding, because it means
 * the code moved and nobody updated the mutation.
 */
const MUTATIONS = [
  // `kills` names the check(s) that SHOULD catch this mutation. A failure
  // anywhere else is collateral and does not count — round 6 showed the harness
  // scoring a mutation as killed after its own guard had been destroyed, and
  // scoring an UNPARSEABLE mutant as a kill, which is the strongest possible
  // result from the weakest possible evidence.
  { name: 'friction/gate-off', kills: ['friction MAGNITUDE', 'validity gate'],
    why: 'round 5: setting the validity weight to 1 removes the entire gate',
    file: 'src/engine/cpu.js',
    find: '          const w = frictionWeight(other.potential, P);',
    to:   '          const w = 1;' },

  { name: 'friction/gate-inline-copy', kills: ['validity gate'],
    why: 'round 5: the integrator inlined a copy, so the test exercised a function nothing called',
    file: 'src/engine/cpu.js',
    find: '  const t = Math.max(0, Math.min(1, (x - 1) / 2));\n  return 1 - t * t * (3 - 2 * t);',
    to:   '  return 1;   // gate widened to admit everything' },

  { name: 'friction/cap-removed', kills: ['impulse cap'],
    why: 'round 4: the drag impulse cap prevents an explicit integrator overshooting',
    file: 'src/engine/cpu.js',
    find: '        if (worst > maxK) F *= maxK / worst;',
    to:   '        if (false) F *= maxK / worst;' },

  { name: 'disc/thickness-zero', kills: ['is a DISC'],
    why: 'round 5: reverting the thickness default gave byte-identical output',
    file: 'src/engine/galaxy.js',
    find: '  potential, count, scaleLength, rMax = 4.5, thickness = 0.1,',
    to:   '  potential, count, scaleLength, rMax = 4.5, thickness = 0,' },

  { name: 'disc/folded-sheet', kills: ['is a DISC'],
    why: 'round 5: one shared node line makes a folded sheet, not a disc',
    file: 'src/engine/galaxy.js',
    find: '    const nodeAng = 2 * Math.PI * rng();',
    to:   '    const nodeAng = 0;' },

  { name: 'disc/in-phase', kills: ['is a DISC'],
    why: 'round 4: every particle at its vertical extremum collapses rms|z| 40% in 19 Myr',
    file: 'src/engine/galaxy.js',
    find: '    const amp = -thickness * scaleLength * Math.log(1 - rng());',
    to:   '    const amp = thickness * scaleLength;   // constant amplitude: no vertical distribution' },

  { name: 'orbit/point-mass-kepler', kills: ['BOUND request'],
    why: 'round 3: a point-mass orbit setup executes bound requests as unbound',
    file: 'src/engine/encounter.js',
    find: '  const bound = ecc < 1 ? boundOrbitState(P1, P2, M1, M2, rPeri, ecc) : null;',
    to:   '  const bound = null;' },

  { name: 'orbit/rewind-uncapped', kills: ['BOUND request'],
    why: 'round 4: an uncapped rewind wraps past apocentre and starts the pair outbound',
    file: 'src/engine/encounter.js',
    find: '    if (s < prev) break;                 // reached apocentre going backwards',
    to:   '    if (false) break;' },

  { name: 'pairforce/old-closed-form', kills: ['SHELL THEOREM', 'conserve energy'],
    why: 'round 3: the superseded kernel is up to 3.09x too strong',
    file: 'src/engine/cpu.js',
    find: '        const k = d > 1e-12 ? tab.force(d) / d : 0;',
    to:   '        let k = 0; { const ci = gs[i].potential.kind === "composite" ? gs[i].potential.parts : [gs[i].potential];\n          const cj = gs[j].potential.kind === "composite" ? gs[j].potential.parts : [gs[j].potential];\n          for (const pi of ci) for (const pj of cj) { const S = d2 + pi.scale*pi.scale + pj.scale*pj.scale; k += pi.mass*pj.mass/(S*Math.sqrt(S)); } }' },

  { name: 'pairforce/hermite-broken', kills: ['SHELL THEOREM', 'conserve energy', 'mutually consistent'],
    why: 'round 3: linear interpolation makes F inconsistent with W and energy drifts',
    file: 'src/engine/pairforce.js',
    find: '  for (let i = 0; i < N; i++) dWdu[i] = F[i] * Math.exp(lo + i * step);',
    to:   '  for (let i = 0; i < N; i++) dWdu[i] = 0;' },

  { name: 'adjoint/unknown-kind-silent', kills: ['unsupported potential kind'],
    why: 'round 4: falling through to a point mass gives a self-consistent wrong gradient',
    file: 'src/engine/adjoint.js',
    find: "    throw new Error(`adjoint: no force law for potential kind \"${part.kind}\". `\n      + 'Falling back to a point mass would produce a self-consistent wrong gradient.');",
    to:   '    f = M / (r2 * r); fp = -3 * M / (r2 * r2);' },

  { name: 'claims/loop-neutered', kills: ['registered figure'], browserOnly: true,
    why: 'round 6: replacing the comparison with {status:accepted} let every document be arbitrarily wrong',
    file: 'test/claims.test.js',
    find: '      const r = compareClaim(files.get(c.file), c);',
    to:   "      const r = { status: 'accepted' };" },

  // ROUND 7's two defeats of the round-6 canary. Both spare the canary — it goes
  // through the real comparison and is still rejected — so asserting on the
  // canary's verdict alone passes while the shipped prose is arbitrarily wrong.
  // Both are now killed: the first by the ledger of work actually done, the
  // second by probing each claim at its OWN declared tolerance.
  //
  // RUN THESE BY HAND against a COPY served by the COPY'S OWN devserver — see
  // the note in bench/devserver.py, which chdirs to its own repo root and will
  // otherwise serve the unmutated tree and report a false survival.
  { name: 'claims/bypass-sparing-canary', kills: ['registered figure'], browserOnly: true,
    why: 'round 7: routing every real claim around the comparison while the canary still goes '
       + 'through it kept 78/78 green with a shipped figure 6.6x wrong',
    file: 'test/claims.test.js',
    find: '      const r = compareClaim(files.get(c.file), c);',
    to:   "      const r = c === CANARY ? compareClaim(files.get(c.file), c) : { status: 'accepted' };" },

  // ROUND 8's four defeats of the round-7 ledger. All four kept the suite at
  // 79/79 green while shipping a wrong figure, each proved with a runtime marker
  // read back over CDP. All four are now killed. Run by hand — see the
  // devserver.py note; these need a copy served by the COPY'S OWN devserver.
  { name: 'claims/widen-one-tolerance', kills: ['registered figure'], browserOnly: true,
    why: 'round 8: the per-claim probe derived its bounds from the same tol it audited, so it '
       + 'tested each tolerance against itself and agreed by construction. Widening ONE entry '
       + '0.05 -> 0.60 shipped a 53%-wrong figure green. Needs no adversary: it is what anyone '
       + 'does to turn a red build green.',
    file: 'test/claims.test.js',
    find: "    key: 'tidalProgradePct', tol: 0.05, what: 'tour step 3, prograde tidal fraction' },",
    to:   "    key: 'tidalProgradePct', tol: 0.60, what: 'tour step 3, prograde tidal fraction' }," },

  { name: 'claims/preseed-ledger', kills: ['registered figure'], browserOnly: true,
    why: 'round 8: the ledger was a module array derivable from CLAIMS, so preseeding it from '
       + 'CLAIMS satisfied both ledger assertions before a single comparison ran',
    file: 'test/claims.test.js',
    find: 'export const evaluated = [];',
    to:   "export const evaluated = CLAIMS.map((c) => ({ file: c.file, key: c.key, status: 'accepted', matched: '' }));" },

  { name: 'claims/launder-verdict', kills: ['registered figure'], browserOnly: true,
    why: 'round 8: the ledger recorded each verdict and nothing asserted on it, so compareClaim '
       + 'could push the honest status and return a laundered one',
    file: 'test/claims.test.js',
    find: '  const out = compareClaimInner(text, claim);',
    to:   `  const out0 = compareClaimInner(text, claim);
  const out = (out0.status === 'rejected' && claim.file !== '__canary__') ? { ...out0, status: 'accepted' } : out0;` },

  { name: 'claims/tolerance-floor', kills: ['registered figure'], browserOnly: true,
    why: 'round 7: a 45% floor under every tolerance passes a 39.5%-wrong figure — both the 3x '
       + 'canary and the 1.5x sensitivity check sit above it and never notice',
    file: 'test/claims.test.js',
    find: "  return { status: rel > claim.tol ? 'rejected' : 'accepted', written, truth, rel };",
    to:   "  return { status: rel > Math.max(claim.tol, 0.45) ? 'rejected' : 'accepted', written, truth, rel };" },

  { name: 'disc/float32-at-birth', kills: ['is a DISC'],
    why: 'round 6: quantising the generator to float32 raises birth error 2.2e-16 -> 1.7e-8',
    file: 'src/engine/galaxy.js',
    find: '  const pos = new Float64Array(count * 3);\n  const vel = new Float64Array(count * 3);\n  const radius = new Float32Array(count);\n  const originArr = new Float32Array(count).fill(origin);\n  const spin = retrograde ? -1 : 1;\n  const rng = mulberry32(seed);',
    to:   '  const pos = new Float32Array(count * 3);\n  const vel = new Float32Array(count * 3);\n  const radius = new Float32Array(count);\n  const originArr = new Float32Array(count).fill(origin);\n  const spin = retrograde ? -1 : 1;\n  const rng = mulberry32(seed);' },

  { name: 'friction/cap-asymmetric-half', kills: ['impulse cap'],
    why: 'round 6: Math.max -> Math.min leaves |dv|/v reaching 5.0 per step at q=0.05',
    file: 'src/engine/cpu.js',
    find: '        const worst = Math.max(F / gs[0].mass, F / gs[1].mass);',
    to:   '        const worst = Math.min(F / gs[0].mass, F / gs[1].mass);' },

  { name: 'physics/softened-test-particle-force', kills: ['LRL drift'],
    why: 'CLAUDE.md: energy and angular momentum are conserved by ANY central force; only LRL detects a wrong force law',
    file: 'src/engine/potentials.js',
    find: "      const inv = 1 / Math.sqrt(r2);\n      const f = -mass * inv * inv * inv;\n      out[0] = f * dx; out[1] = f * dy; out[2] = f * dz;\n      return out;\n    },\n    vcirc: (r) => Math.sqrt(mass / r),",
    to:   "      const inv = 1 / Math.sqrt(r2);\n      const f = -mass * inv * inv * inv * (1 + 1e-3 * inv);\n      out[0] = f * dx; out[1] = f * dy; out[2] = f * dz;\n      return out;\n    },\n    vcirc: (r) => Math.sqrt(mass / r)," },

  { name: 'physics/softening-bulge-only', kills: ['softening changes the answer'], browserOnly: true,
    why: 'round 7: softeningScale reached only the bulge Hernquist core (1.42% of the mass), so a '
       + 'full 0.5x-2x sweep moved |g| by 0.33% at the 20 kpc tidal cut and the spread it recorded '
       + '(0.73%) was SMALLER than the seed-to-seed realisation noise (1.68%) nobody measured',
    file: 'src/engine/encounter.js',
    find: '  const s = rScale * softeningScale;\n  return composite([\n    hernquist(M * 0.0142, 0.5 * s),    // bulge, ~1e10 Msun\n    plummer(M * 0.0469, 3.0 * s),      // disc, ~3.3e10 Msun\n    hernquist(M * 0.9389, 20.0 * s),   // dark halo, ~6.6e11 Msun',
    to:   '  const s = rScale * softeningScale;\n  return composite([\n    hernquist(M * 0.0142, 0.5 * s),    // bulge, ~1e10 Msun\n    plummer(M * 0.0469, 3.0 * rScale),      // disc — softening reverted to bulge-only\n    hernquist(M * 0.9389, 20.0 * rScale),   // halo — softening reverted to bulge-only' },

  { name: 'disc/rayleigh-amplitude', kills: ['is a DISC'],
    why: 'round 7: a Rayleigh amplitude law of the SAME rms turns the K_0 profile into a near-sech^2 '
       + 'disc — a completely different vertical structure — and rms|z| moves only 0.6%, so every '
       + 'assertion that looked at rms alone stayed green',
    file: 'src/engine/galaxy.js',
    find: '    const amp = -thickness * scaleLength * Math.log(1 - rng());',
    to:   '    const amp = thickness * scaleLength * Math.sqrt(-2 * Math.log(1 - rng()));' },

  { name: 'render/discnormal-dropped', kills: ['DISC NORMAL SURVIVES'],
    why: 'round 7: RestrictedSim rebuilt each galaxy without discNormal, so the dust-lane fix was '
       + 'inert in the shipped app for every tilted disc and the renderer silently substituted [0,0,1]',
    file: 'src/engine/cpu.js',
    find: '      discNormal: g.discNormal ? Array.from(g.discNormal) : undefined,\n',
    to:   '' },

  { name: 'units/wrong-G', kills: ['velocity unit', 'Earth'],
    why: 'round 1: the units check must be independent of the derivation it checks',
    file: 'src/engine/units.js',
    find: 'export const G_PHYS = 4.300917270e-6;',
    to:   'export const G_PHYS = 4.300917270e-6 * 1.03;   // G wrong by 3%' },
];

const RUNNER = `
const R = process.argv[2];
globalThis.__catalogue = JSON.parse(await (await import('node:fs/promises')).readFile(R + '/data/targets/targets.json','utf8'));
const h = await import(R + '/test/harness.js');
const p = await import(R + '/test/physics.test.js');
const a = await import(R + '/test/adjoint.test.js');
try { p.runPhysicsTests(); a.runAdjointTests(); } catch (e) {
  console.log(JSON.stringify({ threw: String(e.message).slice(0,200) })); process.exit(0);
}
h.report(null);
const r = globalThis.__testResults;
console.log(JSON.stringify({ total: r.total, expected: r.expected, failed: r.failed, complete: r.complete,
  // NOT truncated. Slicing this to 4 made the harness report MISATTRIB for a
  // mutation its named guard DID catch, purely because the guard was fifth in the
  // list — the instrument's own reporting hiding the result it was measuring.
  failing: r.results.filter((x) => !x.pass).map((x) => x.name) }));
`;

function runIn(dir) {
  const runner = join(dir, '__mutrun.mjs');
  writeFileSync(runner, RUNNER);
  try {
    const out = execFileSync('node', [runner, dir], { encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] });
    return JSON.parse(out.trim().split('\n').pop());
  } catch (e) {
    const s = (e.stdout || '') + (e.stderr || '');
    const line = s.trim().split('\n').filter((l) => l.startsWith('{')).pop();
    if (line) return JSON.parse(line);
    return { crashed: true, detail: s.slice(0, 300) };
  }
}

const filter = process.argv[2];
const chosen = MUTATIONS.filter((m) => !filter || m.name.includes(filter));

console.log(`mutation testing: ${chosen.length} mutations against the node-runnable suites\n`);

// baseline
const base = mkdtempSync(join(tmpdir(), 'mut-base-'));
cpSync(ROOT, base, { recursive: true, filter: (s) => !/node_modules|\.git|dist|galaxy_zoo_mergers/.test(s) });
const b = runIn(base);
console.log(`baseline: ${JSON.stringify(b)}\n`);
if (b.failed !== 0 || !b.complete) {
  console.log('BASELINE IS NOT GREEN — fix that before trusting any mutation result');
  rmSync(base, { recursive: true, force: true });
  process.exit(1);
}
rmSync(base, { recursive: true, force: true });

const survived = [], killed = [], broken = [], skipped = [];
for (const m of chosen) {
  if (m.browserOnly) {
    skipped.push(m);
    console.log(`  NOT COVERED ${m.name.padEnd(28)} needs the browser suite; this harness cannot run it`);
    console.log(`            ${m.why}`);
    continue;
  }
  const dir = mkdtempSync(join(tmpdir(), 'mut-'));
  cpSync(ROOT, dir, { recursive: true, filter: (s) => !/node_modules|\.git|dist|galaxy_zoo_mergers/.test(s) });
  const path = join(dir, m.file);
  const src = readFileSync(path, 'utf8');
  const n = src.split(m.find).length - 1;
  if (n !== 1) {
    broken.push({ ...m, n });
    console.log(`  STALE     ${m.name.padEnd(30)} pattern matched ${n} times, not 1 — the code moved and the mutation was not updated`);
    rmSync(dir, { recursive: true, force: true });
    continue;
  }
  writeFileSync(path, src.replace(m.find, m.to));
  const r = runIn(dir);
  rmSync(dir, { recursive: true, force: true });

  // A CRASH IS NOT A KILL. An unparseable or throwing mutant proves only that the
  // edit was malformed — it is the strongest-looking result from the weakest
  // evidence, and round 6 caught this harness reporting exactly that.
  if (r.crashed || r.threw) {
    broken.push({ ...m, n: 1 });
    console.log(`  BROKEN    ${m.name.padEnd(30)} the mutant did not run (${r.threw || 'crashed'}) — a malformed edit, not a kill`);
    continue;
  }

  const failing = r.failing || [];
  const relevant = failing.filter((f) => (m.kills || []).some((k) => f.includes(k)));
  const collateral = failing.filter((f) => !relevant.includes(f));

  if (relevant.length > 0) {
    killed.push(m);
    console.log(`  killed    ${m.name.padEnd(30)} by ${relevant.map((x) => `"${x.slice(0, 44)}"`).join(', ')}`);
  } else if (failing.length > 0) {
    // Something noticed, but not the guard that is supposed to. That is a
    // MISATTRIBUTED kill: the fix's own assertion is still decorative.
    survived.push({ ...m, collateral });
    console.log(`  MISATTRIB ${m.name.padEnd(30)} only collateral checks failed: ${collateral.map((x) => `"${x.slice(0, 40)}"`).join(', ')}`);
    console.log(`            the guard named for this fix did NOT fire — ${m.why}`);
  } else {
    survived.push(m);
    console.log(`  SURVIVED  ${m.name.padEnd(30)} suite still green — THIS FIX IS UNGUARDED`);
    console.log(`            ${m.why}`);
  }
}

console.log(`\n${killed.length} killed, ${survived.length} SURVIVED/misattributed, ${broken.length} broken or stale, ${skipped.length} NOT COVERED (browser-only)`);
// DERIVED FROM THE RUN, not typed. Round 7 found this banner reading "61 of the
// 76 checks" while the baseline three lines above printed 63 and the browser
// suite ran 78 — a stale literal in the one block whose entire purpose is to
// stop the result being read as more than it is. A hand-typed coverage figure
// goes stale exactly like a hand-typed claim, and this instrument exists
// because hand-typed figures go stale.
console.log(`
COVERAGE, stated so this result is not read as more than it is:
  runs      test/physics.test.js + test/adjoint.test.js  (${b.total} checks here; the browser suite runs more)
  NOT run   GPU, morphology and claims — they need a browser
  NOT even reachable   src/app/** and src/render/**, which are 0% covered here.
Round 6 reverted setBusy, the science-view backdrop, onDeviceLost and the chunked
seek SIMULTANEOUSLY and this harness still reported every mutation killed. A green
run here means "the engine's node-runnable subset is guarded". It does not mean
the project is guarded, and reading it that way is how a harness becomes the thing
it was built to catch.`);
if (survived.length) {
  console.log('\nEvery surviving mutation is a fix the suite would not notice being reverted:');
  for (const m of survived) console.log(`  - ${m.name}: ${m.why}`);
}
process.exit(survived.length || broken.length ? 1 : 0);
