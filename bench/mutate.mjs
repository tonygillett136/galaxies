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
 * Runs the node-executable suites (physics + adjoint, 60 checks). GPU, morphology
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
  { name: 'friction/gate-off',
    why: 'round 5: setting the validity weight to 1 removes the entire gate',
    file: 'src/engine/cpu.js',
    find: '          const w = frictionWeight(other.potential, P);',
    to:   '          const w = 1;' },

  { name: 'friction/gate-inline-copy',
    why: 'round 5: the integrator inlined a copy, so the test exercised a function nothing called',
    file: 'src/engine/cpu.js',
    find: '  const t = Math.max(0, Math.min(1, (x - 1) / 2));\n  return 1 - t * t * (3 - 2 * t);',
    to:   '  return 1;   // gate widened to admit everything' },

  { name: 'friction/cap-removed',
    why: 'round 4: the drag impulse cap prevents an explicit integrator overshooting',
    file: 'src/engine/cpu.js',
    find: '        if (worst > maxK) F *= maxK / worst;',
    to:   '        if (false) F *= maxK / worst;' },

  { name: 'disc/thickness-zero',
    why: 'round 5: reverting the thickness default gave byte-identical output',
    file: 'src/engine/galaxy.js',
    find: '  potential, count, scaleLength, rMax = 4.5, thickness = 0.1,',
    to:   '  potential, count, scaleLength, rMax = 4.5, thickness = 0,' },

  { name: 'disc/folded-sheet',
    why: 'round 5: one shared node line makes a folded sheet, not a disc',
    file: 'src/engine/galaxy.js',
    find: '    const nodeAng = 2 * Math.PI * rng();',
    to:   '    const nodeAng = 0;' },

  { name: 'disc/in-phase',
    why: 'round 4: every particle at its vertical extremum collapses rms|z| 40% in 19 Myr',
    file: 'src/engine/galaxy.js',
    find: '    const amp = -thickness * scaleLength * Math.log(1 - rng());',
    to:   '    const amp = thickness * scaleLength;   // constant amplitude: no vertical distribution' },

  { name: 'orbit/point-mass-kepler',
    why: 'round 3: a point-mass orbit setup executes bound requests as unbound',
    file: 'src/engine/encounter.js',
    find: '  const bound = ecc < 1 ? boundOrbitState(P1, P2, M1, M2, rPeri, ecc) : null;',
    to:   '  const bound = null;' },

  { name: 'orbit/rewind-uncapped',
    why: 'round 4: an uncapped rewind wraps past apocentre and starts the pair outbound',
    file: 'src/engine/encounter.js',
    find: '    if (s < prev) break;                 // reached apocentre going backwards',
    to:   '    if (false) break;' },

  { name: 'pairforce/old-closed-form',
    why: 'round 3: the superseded kernel is up to 3.09x too strong',
    file: 'src/engine/cpu.js',
    find: '        const k = d > 1e-12 ? tab.force(d) / d : 0;',
    to:   '        let k = 0; { const ci = gs[i].potential.kind === "composite" ? gs[i].potential.parts : [gs[i].potential];\n          const cj = gs[j].potential.kind === "composite" ? gs[j].potential.parts : [gs[j].potential];\n          for (const pi of ci) for (const pj of cj) { const S = d2 + pi.scale*pi.scale + pj.scale*pj.scale; k += pi.mass*pj.mass/(S*Math.sqrt(S)); } }' },

  { name: 'pairforce/hermite-broken',
    why: 'round 3: linear interpolation makes F inconsistent with W and energy drifts',
    file: 'src/engine/pairforce.js',
    find: '  for (let i = 0; i < N; i++) dWdu[i] = F[i] * Math.exp(lo + i * step);',
    to:   '  for (let i = 0; i < N; i++) dWdu[i] = 0;' },

  { name: 'adjoint/unknown-kind-silent',
    why: 'round 4: falling through to a point mass gives a self-consistent wrong gradient',
    file: 'src/engine/adjoint.js',
    find: "    throw new Error(`adjoint: no force law for potential kind \"${part.kind}\". `\n      + 'Falling back to a point mass would produce a self-consistent wrong gradient.');",
    to:   '    f = M / (r2 * r); fp = -3 * M / (r2 * r2);' },

  { name: 'units/wrong-G',
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
  failing: r.results.filter((x) => !x.pass).map((x) => x.name).slice(0, 4) }));
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

const survived = [], killed = [], broken = [];
for (const m of chosen) {
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

  const noticed = r.crashed || r.threw || r.failed > 0 || r.complete === false;
  if (noticed) {
    killed.push(m);
    const how = r.threw ? `threw: ${r.threw}` : r.crashed ? 'crashed' : `${r.failed} failed: ${(r.failing || []).join(', ')}`;
    console.log(`  killed    ${m.name.padEnd(30)} ${how}`);
  } else {
    survived.push(m);
    console.log(`  SURVIVED  ${m.name.padEnd(30)} suite still green — THIS FIX IS UNGUARDED`);
    console.log(`            ${m.why}`);
  }
}

console.log(`\n${killed.length} killed, ${survived.length} SURVIVED, ${broken.length} stale`);
if (survived.length) {
  console.log('\nEvery surviving mutation is a fix the suite would not notice being reverted:');
  for (const m of survived) console.log(`  - ${m.name}: ${m.why}`);
}
process.exit(survived.length || broken.length ? 1 : 0);
