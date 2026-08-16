/**
 * Standing assertions for the LIVE tier — particles that feel each other.
 *
 * The governing risk here is not the integrator. It is the initial conditions: a
 * self-gravitating disc that is not in equilibrium evolves spuriously and looks
 * completely plausible while doing it, and the spurious evolution takes the form
 * of growing non-axisymmetric structure — which is precisely the signal this
 * tier exists to produce. A disc that is quietly expanding will show "spiral
 * arms". So the equilibrium checks come first and the structure check is only
 * meaningful given them.
 */

import { group, checkAsync, expectChecks, above, below, ok } from './harness.js';
import { galaxyModel } from '../src/engine/encounter.js';
import { rigidWithoutDisc, liveExponentialDisc, vcircLive, epicyclic } from '../src/engine/livedisc.js';
import { LiveSim } from '../src/engine/live.js';
import { plummer } from '../src/engine/potentials.js';
import { composite } from '../src/engine/potentials.js';
import { record } from './measured.js';
import { shapeKinematics } from '../src/engine/shape.js';
import { decomposeDiscVelocities } from '../src/engine/kinematics.js';
import { mulberry32 } from '../src/engine/galaxy.js';
import { liveHernquistHalo, hernquistSigma2, hernquistSigma2Jeans, hernquistMassFrac, hernquistDF } from '../src/engine/livehalo.js';
import { eddingtonDF } from '../src/engine/eddington.js';

const Rd = 3.0;
const EPS = 0.2;
const DT = 0.05;

/** m=2 Fourier amplitude in a narrow annulus, and the shot-noise floor it must beat. */
function fourierA2(pos, mass, n, r0, r1, stride = 4) {
  let re = 0, im = 0, w = 0, cnt = 0;
  for (let i = 0; i < n; i++) {
    const x = pos[i * stride], y = pos[i * stride + 1];
    const r = Math.hypot(x, y);
    if (r < r0 || r >= r1) continue;
    const phi = Math.atan2(y, x), mi = mass[i];
    re += mi * Math.cos(2 * phi); im += mi * Math.sin(2 * phi); w += mi; cnt++;
  }
  if (w <= 0 || cnt < 20) return { A: 0, floor: 1, n: cnt };
  return { A: Math.hypot(re, im) / w, floor: 1 / Math.sqrt(cnt), n: cnt };
}

function bestA2(pos, mass, n, stride = 4) {
  let best = { A: 0, floor: 1, n: 0, ratio: 0 };
  for (let a = 0.8; a < 4.0; a += 0.4) {
    const f = fourierA2(pos, mass, n, a * Rd, (a + 0.4) * Rd, stride);
    const ratio = f.A / f.floor;
    if (ratio > best.ratio) best = { ...f, ratio, R: (a + 0.2) * Rd };
  }
  return best;
}

/** The GPU buffers are stride 4; the IC arrays are stride 3. Pass the stride
 *  rather than repacking at each call site, which is where an off-by-one hides. */
function meanRadius(pos, n, stride = 4, rMax = 6 * Rd) {
  let s = 0, z = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.hypot(pos[i * stride], pos[i * stride + 1]);
    if (r < rMax) { s += r; z += pos[i * stride + 2] ** 2; c++; }
  }
  return { meanR: s / c, rmsZ: Math.sqrt(z / c), n: c };
}

async function evolve(device, ic, rigid, steps, eps = EPS) {
  const sim = await LiveSim.create(device, [{ pos: [0, 0, 0], potential: rigid }], ic, eps);
  sim.run(DT, steps);
  await device.queue.onSubmittedWorkDone();
  const pos = await sim.readPositions();
  const mass = await sim.readMasses();
  sim.destroy();
  return { pos, mass };
}

export async function runLiveTests(device) {
  group('live tier — self-gravity, where the initial conditions are the risk');
  expectChecks(12);

  const model = galaxyModel(1.0);
  const { rigid, discMass } = rigidWithoutDisc(model);

  await checkAsync('SELF-TEST: the shape instrument tells rotation from dispersion', async () => {
    // This exists because the first version of shapeKinematics reported v/sigma
    // = 0.01 for a COLD ROTATING DISC — identical to what it reported for the
    // merger remnant. Two bugs at once: eigenvalues sorted without reordering
    // their eigenvectors, so the "minor axis" was arbitrary; and the system's
    // bulk velocity never subtracted. Both produce a plausible number rather
    // than an error, and only the control exposed them. An instrument that has
    // not been seen to separate these two cases cannot be used to claim a merger
    // destroyed rotation.
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const gauss = () => { let u, v, q; do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; q = u * u + v * v; } while (!q || q >= 1); return u * Math.sqrt(-2 * Math.log(q) / q); };
    const N = 8000;
    const disc = [], blob = [];
    for (let i = 0; i < N; i++) {
      const R = 9 * Math.sqrt(rnd()), ph = rnd() * 2 * Math.PI;
      // deliberately given a large bulk velocity: if that is not removed, the
      // internal kinematics are contaminated by the galaxy's orbital motion
      disc.push({ x: R * Math.cos(ph) + 50, y: R * Math.sin(ph) - 20, z: 0.3 * gauss(),
        vx: -Math.sin(ph) + 0.05 * gauss() + 1.4, vy: Math.cos(ph) + 0.05 * gauss() - 0.7,
        vz: 0.05 * gauss(), m: 1 });
      blob.push({ x: 4 * gauss(), y: 4 * gauss(), z: 4 * gauss(),
        vx: gauss(), vy: gauss(), vz: gauss(), m: 1 });
    }
    const idx = Array.from({ length: N }, (_, i) => i);
    const com = (a) => [0, 1, 2].map((k) => a.reduce((s2, p) => s2 + [p.x, p.y, p.z][k], 0) / a.length);
    const d = shapeKinematics((i) => disc[i], idx, com(disc));
    const b = shapeKinematics((i) => blob[i], idx, com(blob));
    above(d.vOverSigma, 3.0, 'v/sigma of a cold rotating disc');
    below(b.vOverSigma, 0.5, 'v/sigma of an isotropic non-rotating blob');
    below(d.c_a, 0.30, 'c/a of a thin disc');
    above(b.c_a, 0.85, 'c/a of a round blob');
    return `cold disc v/sigma ${d.vOverSigma.toFixed(1)} (c/a ${d.c_a.toFixed(3)}) against `
         + `isotropic blob v/sigma ${b.vOverSigma.toFixed(2)} (c/a ${b.c_a.toFixed(3)}) — `
         + `separated by ${(d.vOverSigma / b.vOverSigma).toFixed(0)}x, with a bulk velocity present in the disc case`;
  });

  await checkAsync('the disc mass is REMOVED from the rigid potential, and accounted for', async () => {
    // Trap 1, checked at the level of bookkeeping before it is checked dynamically.
    const before = model.mass, after = rigid.mass;
    ok(Math.abs((before - after) - discMass) < 1e-9,
      `removed mass ${(before - after).toFixed(6)} does not equal the disc mass ${discMass.toFixed(6)}`);
    ok(!rigid.parts.some((p) => p.kind === 'plummer'),
      'a plummer component survived into the rigid remainder; the disc would be double-counted');
    const ic = liveExponentialDisc({ count: 4000, discMass, scaleLength: Rd, rigid, toomreQ: 1.2, seed: 5 });
    const summed = ic.mass.reduce((a, b) => a + b, 0);
    ok(Math.abs(summed - discMass) / discMass < 1e-5,
      `particles sum to ${summed.toFixed(6)} against a disc mass of ${discMass.toFixed(6)}`);
    // and the circular speed now includes the disc's own contribution
    const withDisc = vcircLive(2.15 * Rd, rigid, discMass, Rd);
    const rigidOnly = rigid.vcirc(2.15 * Rd);
    above(withDisc / rigidOnly, 1.05, 'v_circ ratio with the live disc included vs rigid alone');
    record('liveDiscMass', discMass);
    return `disc ${discMass.toFixed(4)} removed from the rigid model (${before.toFixed(3)} -> ${after.toFixed(3)}); `
         + `particles sum to it within 1e-5; v_circ at 2.15 Rd rises ${((withDisc / rigidOnly - 1) * 100).toFixed(1)}% `
         + `when the disc's own gravity is included`;
  });

  await checkAsync('an isolated live disc HOLDS its radius and thickness', async () => {
    // The equilibrium check. If this fails, every structure measurement below it
    // is measuring the disc falling apart rather than the disc forming arms.
    const N = 20000, STEPS = 800;    // 40 time units, ~1.2 rotations at the half-mass radius
    const ic = liveExponentialDisc({ count: N, discMass, scaleLength: Rd, rigid, toomreQ: 1.2, seed: 11 });
    ok(ic.diagnostics.clampedDrift === 0,
      `${ic.diagnostics.clampedDrift} particles had no real asymmetric-drift solution; the disc is not in equilibrium by construction`);
    const before = meanRadius(ic.pos, N, 3);
    const { pos } = await evolve(device, ic, rigid, STEPS);
    const after = meanRadius(pos, N);
    const dR = Math.abs(after.meanR - before.meanR) / before.meanR;
    below(dR, 0.05, 'fractional change in the disc mean radius over 40 time units');
    record('liveDiscRadiusDrift', dR);
    return `mean R ${before.meanR.toFixed(3)} -> ${after.meanR.toFixed(3)} kpc (${(dR * 100).toFixed(2)}%), `
         + `rms|z| ${before.rmsZ.toFixed(3)} -> ${after.rmsZ.toFixed(3)} kpc over ${STEPS} steps`;
  });

  await checkAsync('SENSITIVITY: a DOUBLE-COUNTED disc does not hold', async () => {
    // The failure Trap 1 describes, executed on purpose. The disc is built for
    // the correct potential and then evolved with the Plummer disc term left in,
    // so it sits in roughly twice its own gravity. If this passes the equilibrium
    // tolerance, the check above is not measuring anything.
    const N = 20000, STEPS = 800;
    const ic = liveExponentialDisc({ count: N, discMass, scaleLength: Rd, rigid, toomreQ: 1.2, seed: 11 });
    const doubled = composite([...rigid.parts, plummer(discMass, Rd)]);
    const before = meanRadius(ic.pos, N, 3);
    const { pos } = await evolve(device, ic, doubled, STEPS);
    const after = meanRadius(pos, N);
    const dR = Math.abs(after.meanR - before.meanR) / before.meanR;
    above(dR, 0.05, 'radius change when the disc gravity is double-counted');
    return `mean R ${before.meanR.toFixed(3)} -> ${after.meanR.toFixed(3)} kpc `
         + `(${(dR * 100).toFixed(1)}%, against a 5% tolerance the correct model passes) — the guard fires`;
  });

  await checkAsync('SELF-TEST: streaming and random motion are separated', async () => {
    // An rms of v_R about the centre cannot tell a spiral arm's ordered inflow
    // from thermal motion. This separates them by fitting a Fourier series in
    // azimuth per ring; the fit is streaming, the residual is random.
    //
    // Two earlier versions of this failed their own self-test, in both
    // directions, and the failures set the design: (R,phi) BINNING reported
    // sigma_random = 0.075 for a pure cos(2phi) field, because the field varies
    // across a 22.5 degree bin and no estimator inside the bin can remove a bias
    // that IS the bin width. A Fourier fit has no bin width. Separately, the
    // noise a p-parameter fit absorbs is exactly (p-1) sigma^2 / n, which is
    // subtracted rather than estimated.
    const rnd = mulberry32(987);
    const gauss = () => { let u, v, q; do { u = rnd() * 2 - 1; v = rnd() * 2 - 1; q = u * u + v * v; } while (!q || q >= 1); return u * Math.sqrt(-2 * Math.log(q) / q); };
    const build = (n, amp, sig, bulk) => {
      const P = [];
      for (let i = 0; i < n; i++) {
        const R = 3 + 9 * Math.sqrt(rnd()), ph = rnd() * 2 * Math.PI;
        const vR = amp * Math.cos(2 * ph) + sig * gauss();
        P.push({ x: R * Math.cos(ph), y: R * Math.sin(ph), z: 0.1 * gauss(),
          vx: vR * Math.cos(ph) - Math.sin(ph) + bulk, vy: vR * Math.sin(ph) + Math.cos(ph), vz: 0, m: 1 });
      }
      return P;
    };
    const run = (P) => decomposeDiscVelocities((i) => P[i],
      Array.from({ length: P.length }, (_, i) => i), [0, 0, 0], { nR: 8, mMax: 4 });
    const N = 30000, A = 0.5, S = 0.3, expS = A / Math.SQRT2;
    const pureStream = run(build(N, A, 0, 0));
    const pureRand = run(build(N, 0, S, 0));
    const both = run(build(N, A, S, 2.0));       // and a large bulk velocity

    below(pureStream.sigmaRandom, 0.04, 'random motion reported for a PURE streaming field');
    below(Math.abs(pureStream.sigmaStreaming - expS), 0.05, 'streaming recovered from a pure streaming field');
    below(pureRand.sigmaStreaming, 0.04, 'streaming reported for a PURE random field');
    below(Math.abs(pureRand.sigmaRandom - S), 0.03, 'random recovered from a pure random field');
    below(Math.abs(both.sigmaRandom - S), 0.03, 'random recovered when both are present, with a bulk velocity');
    below(Math.abs(both.sigmaStreaming - expS), 0.05, 'streaming recovered when both are present');
    // and the naive rms must genuinely conflate them, or there was nothing to fix
    let s2 = 0, c = 0;
    for (const P of [build(N, A, S, 0)]) for (const q of P) {
      const R = Math.hypot(q.x, q.y); const vR = (q.vx * q.x + q.vy * q.y) / R; s2 += vR * vR; c++;
    }
    const naive = Math.sqrt(s2 / c);
    above(naive / S, 1.3, 'the naive rms against the true random dispersion');
    return `pure streaming -> random ${pureStream.sigmaRandom.toFixed(4)}, streaming ${pureStream.sigmaStreaming.toFixed(4)} (exp ${expS.toFixed(4)}); `
         + `pure random -> random ${pureRand.sigmaRandom.toFixed(4)} (exp ${S}), streaming ${pureRand.sigmaStreaming.toFixed(4)}; `
         + `the naive rms reads ${naive.toFixed(3)} where the random part is ${S}`;
  });

  await checkAsync('SPLIT DISPATCHES give the same answer as one long one', async () => {
    // One O(N^2) dispatch at 175k particles runs ~278 ms and macOS resets the
    // GPU mid-run. The accumulation is now split across several shorter
    // dispatches, which is only safe if it is arithmetically the same sum.
    //
    // It will not be bit-identical: a single dispatch accumulates in a register
    // across every tile, while the split version stores a partial sum to `acc`
    // in float32 between chunks. The tile ORDER is unchanged, so the difference
    // is rounding and nothing else.
    const N = 20000, STEPS = 60;
    const ic = liveExponentialDisc({ count: N, discMass, scaleLength: Rd, rigid, toomreQ: 1.2, seed: 3 });
    const mk = (maxPairs) => LiveSim.create(device, [{ pos: [0, 0, 0], potential: rigid }],
      { count: N, pos: ic.pos, vel: ic.vel, mass: ic.mass }, EPS, { maxPairsPerDispatch: maxPairs });

    const one = await mk(1e12);
    const many = await mk(2e7);
    ok(one.chunks.length === 1, `the single-dispatch arm used ${one.chunks.length} chunks; the comparison is vacuous`);
    ok(many.chunks.length >= 4, `the split arm used only ${many.chunks.length} chunks; the comparison is vacuous`);

    one.run(DT, STEPS); many.run(DT, STEPS);
    await device.queue.onSubmittedWorkDone();
    const a = await one.readPositions(), b = await many.readPositions();
    let worst = 0, scale = 0;
    for (let i = 0; i < N; i++) {
      const d = Math.hypot(a[i * 4] - b[i * 4], a[i * 4 + 1] - b[i * 4 + 1], a[i * 4 + 2] - b[i * 4 + 2]);
      const r = Math.hypot(a[i * 4], a[i * 4 + 1], a[i * 4 + 2]);
      if (d > worst) worst = d;
      if (r > scale) scale = r;
    }
    one.destroy(); many.destroy();
    below(worst / scale, 1e-4, 'worst position disagreement between one dispatch and many, relative to the disc radius');
    record('dispatchSplitAgreement', worst / scale);
    return `${many.chunks.length} chunks against 1, after ${STEPS} steps: worst |dx| ${worst.toExponential(2)} kpc `
         + `over a ${scale.toFixed(1)} kpc disc (${(worst / scale).toExponential(2)} relative)`;
  });

  await checkAsync('the halo dispersion formula agrees with the Jeans equation', async () => {
    // Hernquist (1990) eq. 10 against a direct numerical integration of the
    // isotropic Jeans equation. The two share no algebra beyond the density.
    const M = 66.005, a = 20.0;
    let worst = 0, atR = 0;
    for (const x of [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8]) {
      const r = x * a;
      const s1 = Math.sqrt(hernquistSigma2(r, M, a));
      const s2 = Math.sqrt(hernquistSigma2Jeans(r, M, a, 1, 1e6, 40000));
      const rel = Math.abs(s1 - s2) / s2;
      if (rel > worst) { worst = rel; atR = r; }
    }
    below(worst, 1e-5, 'worst analytic-vs-Jeans dispersion disagreement');
    // the DF must be finite and non-negative everywhere it is sampled
    let bad = 0;
    for (let q = 0.001; q < 0.999; q += 0.002) { const f = hernquistDF(q); if (!(f >= 0) || !Number.isFinite(f)) bad++; }
    ok(bad === 0, `hernquistDF returned ${bad} non-finite or negative values`);
    return `worst ${worst.toExponential(2)} at r = ${atR} kpc over 8 radii; DF finite and non-negative at 499 points`;
  });

  await checkAsync('the SAMPLED halo reproduces the dispersion it was drawn from', async () => {
    // The sampler uses rejection against the exact distribution function. If the
    // envelope or the phase-space weight v^2 f(E) were wrong, the particles would
    // still look like a Hernquist sphere in DENSITY and be wrong in VELOCITY —
    // which is exactly the failure the Maxwellian version had.
    const M = 66.005, a = 20.0, N = 60000;
    const h = liveHernquistHalo({ count: N, mass: M, a, rMax: 15 * a, seed: 5 });
    let worst = 0, atR = 0;
    for (const [r0, r1] of [[1, 3], [5, 8], [15, 25], [40, 60], [90, 140]]) {
      let s2 = 0, c = 0;
      for (let i = 0; i < N; i++) {
        const r = h.radius[i];
        if (r < r0 || r >= r1) continue;
        s2 += h.vel[i * 3] ** 2 + h.vel[i * 3 + 1] ** 2 + h.vel[i * 3 + 2] ** 2; c++;
      }
      const sig = Math.sqrt(s2 / c / 3);
      const an = Math.sqrt(hernquistSigma2((r0 + r1) / 2, M, a));
      const rel = Math.abs(sig / an - 1);
      if (rel > worst) { worst = rel; atR = (r0 + r1) / 2; }
    }
    below(worst, 0.06, 'worst sampled-vs-analytic dispersion ratio');
    // and the particles must sum to the ENCLOSED mass, not the nominal total
    const summed = h.mass.reduce((x, y) => x + y, 0);
    const expected = M * hernquistMassFrac(15 * a, a);
    below(Math.abs(summed - expected) / expected, 1e-5, 'sampled halo total mass against the truncated analytic mass');
    return `worst dispersion ratio ${(worst * 100).toFixed(1)}% at r = ${atR} kpc; `
         + `mass ${summed.toFixed(3)} against the truncated analytic ${expected.toFixed(3)}`;
  });

  await checkAsync('Eddington inversion reproduces the analytic Hernquist DF', async () => {
    // The numerical inversion is a double differentiation of rho with respect to
    // Psi followed by a singular integral. It shares no algebra with the closed
    // form, so agreement is a real check on both. Compared up to normalisation
    // because hernquistDF returns an unnormalised shape.
    const M = 66.005, a = 20.0;
    const f = eddingtonDF((r) => M * a / (2 * Math.PI * r * Math.pow(r + a, 3)),
      (r) => M / (r + a), { rMin: 1e-4, rMax: 1e6, nR: 4000, nE: 600 });
    const vg2 = M / a;
    const ratios = [];
    for (const q of [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
      const fa = hernquistDF(q);
      if (fa > 0) ratios.push(f(q * q * vg2) / fa);
    }
    ok(ratios.length >= 6, `only ${ratios.length} usable comparison points`);
    const med = ratios.slice().sort((x, y) => x - y)[Math.floor(ratios.length / 2)];
    const dev = Math.max(...ratios.map((r) => Math.abs(r / med - 1)));
    below(dev, 0.02, 'worst deviation from a constant numeric/analytic ratio');
    return `${ratios.length} energies from q=0.2 to 0.9, worst deviation from a constant ratio ${(dev * 100).toFixed(2)}%`;
  });

  await checkAsync('a halo built in the TOTAL potential does not contract; an isolated one does', async () => {
    // The Stage 2 result. A halo sampled from the isolated-sphere DF is in
    // equilibrium with ITSELF, not with the galaxy it is part of: drop a disc
    // into it and it falls into the deeper combined potential, and the changing
    // potential heats the disc. Building the DF by Eddington inversion in the
    // total potential removes it.
    //
    // The isolated arm is the sensitivity control. Without it, "the halo held"
    // would be equally consistent with the test being unable to see contraction.
    const model = galaxyModel(1.0);
    const halo = rigid.parts.reduce((x, y) => (y.mass > x.mass ? y : x));
    const bulge = rigid.parts.find((x) => x !== halo);
    const ND = 15000, NH = 30000, STEPS = 600;
    const inner = (pos, stride, n0, n) => {
      const r = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const j = n0 + i;
        r[i] = Math.hypot(pos[j * stride], pos[j * stride + 1], pos[j * stride + 2]);
      }
      r.sort();
      return [0.01, 0.05, 0.25].map((q) => r[Math.floor(q * n)]);
    };
    const arm = async (useTotal) => {
      const disc = liveExponentialDisc({ count: ND, discMass, scaleLength: Rd, rigid, toomreQ: 1.2, seed: 11 });
      const h = liveHernquistHalo({ count: NH, mass: halo.mass, a: halo.scale, rMax: 15 * halo.scale,
        seed: 77, origin: 2, totalPotential: useTotal ? model : undefined });
      const n = ND + NH;
      const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), mass = new Float32Array(n);
      pos.set(disc.pos, 0); vel.set(disc.vel, 0); mass.set(disc.mass, 0);
      pos.set(h.pos, ND * 3); vel.set(h.vel, ND * 3); mass.set(h.mass, ND);
      const before = inner(pos, 3, ND, NH);
      const sim = await LiveSim.create(device, [{ pos: [0, 0, 0], potential: bulge }],
        { count: n, pos, vel, mass }, EPS);
      sim.run(DT, STEPS);
      await device.queue.onSubmittedWorkDone();
      const P = await sim.readPositions();
      sim.destroy();
      const after = inner(P, 4, ND, NH);
      return Math.max(...before.map((x, i) => Math.abs(after[i] / x - 1)));
    };
    const isolated = await arm(false);
    const total = await arm(true);
    above(isolated, 0.15, 'contraction of a halo built from the ISOLATED-sphere DF');
    below(total, 0.10, 'contraction of a halo built in the TOTAL potential');
    above(isolated / total, 2.0, 'ratio of isolated to total-potential contraction');
    record('haloContractionIsolated', isolated);
    record('haloContractionTotal', total);
    return `worst inner-shell drift: isolated DF ${(isolated * 100).toFixed(1)}%, `
         + `total-potential DF ${(total * 100).toFixed(1)}% — ${(isolated / total).toFixed(1)}x better, `
         + `and the isolated arm confirms the test can see contraction at all`;
  });

  await checkAsync('an isolated live halo HOLDS its Lagrangian radii', async () => {
    // The equilibrium test the Maxwellian version failed: sampled that way the
    // shells moved up to 6.5% in 566 Myr, inner expanding and middle
    // contracting, which is settling and not noise. Lagrangian radii are used
    // rather than a density fit because they cannot be rescued by rebinning.
    const M = 66.005, a = 20.0, N = 40000, STEPS = 1200;
    const h = liveHernquistHalo({ count: N, mass: M, a, rMax: 15 * a, seed: 77 });
    const lag = (pos, stride) => {
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < N; i++) { cx += pos[i * stride]; cy += pos[i * stride + 1]; cz += pos[i * stride + 2]; }
      cx /= N; cy /= N; cz /= N;
      const r = new Float64Array(N);
      for (let i = 0; i < N; i++) r[i] = Math.hypot(pos[i * stride] - cx, pos[i * stride + 1] - cy, pos[i * stride + 2] - cz);
      r.sort();
      return [0.05, 0.1, 0.25, 0.5, 0.75].map((f) => r[Math.floor(f * N)]);
    };
    const before = lag(h.pos, 3);
    // no rigid components at all: the halo must hold ITSELF
    const sim = await LiveSim.create(device, [], { count: N, pos: h.pos, vel: h.vel, mass: h.mass }, 0.5);
    sim.run(DT, STEPS);
    await device.queue.onSubmittedWorkDone();
    const pos = await sim.readPositions();
    sim.destroy();
    const after = lag(pos, 4);
    const worst = Math.max(...before.map((x, i) => Math.abs(after[i] / x - 1)));
    below(worst, 0.06, 'worst Lagrangian radius drift of an isolated live halo');
    record('liveHaloLagrangianDrift', worst);
    return `worst shell drift ${(worst * 100).toFixed(1)}% over ${STEPS} steps; `
         + before.map((x, i) => `${(x).toFixed(1)}->${after[i].toFixed(1)}`).join(', ') + ' kpc';
  });

  await checkAsync('structure GROWS, and grows more at lower Toomre Q', async () => {
    // Recorded, not graded. The claim the film makes is that the arms grow on
    // their own; the claim this check makes is narrower and testable — that the
    // m=2 amplitude rises above its own shot-noise floor, and that it does so
    // monotonically with Q. Observing arms at one Q would prove only that Q was
    // below the value where they stop.
    const N = 20000, STEPS = 3200;   // 160 time units: the peak measured in the Q sweep
    const out = [];
    for (const Q of [0.8, 2.0]) {
      const ic = liveExponentialDisc({ count: N, discMass, scaleLength: Rd, rigid, toomreQ: Q, seed: 11 });
      const start = bestA2(ic.pos, ic.mass, N, 3);
      const { pos, mass } = await evolve(device, ic, rigid, STEPS);
      const end = bestA2(pos, mass, N);
      out.push({ Q, start: start.ratio, end: end.ratio, R: end.R });
    }
    const [lowQ, highQ] = out;
    above(lowQ.end, 3.0, 'm=2 amplitude over its shot-noise floor at Q = 0.8');
    above(lowQ.end / highQ.end, 1.15, 'ratio of structure at Q=0.8 against Q=2.0');
    record('liveA2OverFloorQ08', lowQ.end);
    record('liveA2OverFloorQ20', highQ.end);
    return out.map((o) => `Q=${o.Q}: A2/floor ${o.start.toFixed(2)} -> ${o.end.toFixed(2)} at R=${o.R} kpc`).join('; ')
         + ` — ${(lowQ.end / highQ.end).toFixed(2)}x more structure at the lower Q`;
  });
}
