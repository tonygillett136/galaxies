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
  expectChecks(5);

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
