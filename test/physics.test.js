/**
 * Standing assertions for the physics. These run on every build.
 *
 * The governing question for each one, taken from the ways-of-working: what would
 * this check still do if the feature were entirely absent? If the answer is
 * "pass", it is testing the setup rather than the physics and does not belong.
 *
 * Three checks are deliberately paired with a SENSITIVITY check that must fail
 * under a broken configuration, because a test that has never been seen to fail
 * is indistinguishable from a test that cannot fail.
 */

import { group, check, expectChecks, close, below, above, ok, dist, norm } from './harness.js';
import * as U from '../src/engine/units.js';
import { pointMass, plummer, hernquist, composite } from '../src/engine/potentials.js';
import * as K from '../src/engine/kepler.js';
import { RestrictedSim } from '../src/engine/cpu.js';
import { discOfRings, exponentialDisc } from '../src/engine/galaxy.js';
import { galaxyModel, buildEncounter } from '../src/engine/encounter.js';

const acc = [0, 0, 0];

export function runPhysicsTests() {
  expectChecks(33);

  // ---------------------------------------------------------------- units
  group('units — asserted against physical constants, not against the doc');

  check('velocity unit derives to 207.386530 km/s', () =>
    close(U.VELOCITY_KMS, 207.386530, 1e-8, 'v_unit'));

  check('time unit derives to 4.714920 Myr', () =>
    close(U.TIME_MYR, 4.714920, 1e-6, 't_unit'));

  check('one velocity unit crosses one kpc in one time unit', () => {
    const kmPerTimeUnit = U.VELOCITY_KMS * (U.TIME_MYR * U.S_PER_MYR);
    return close(kmPerTimeUnit / U.KM_PER_KPC, 1.0, 1e-12, 'kpc crossed');
  });

  check('round trip through every conversion is the identity', () => {
    const worst = Math.max(
      Math.abs(U.timeFromMyr(U.timeToMyr(3.7)) - 3.7),
      Math.abs(U.speedFromKms(U.speedToKms(1.3)) - 1.3),
      Math.abs(U.massFromMsun(U.massToMsun(0.4)) - 0.4));
    return below(worst, 1e-12, 'worst round-trip error');
  });

  check('a physical case: Sun-like orbit period is ~220 Myr', () => {
    const r = 8.2, v = U.speedFromKms(232);
    const periodMyr = U.timeToMyr(2 * Math.PI * r / v);
    ok(periodMyr > 200 && periodMyr < 240, `period ${periodMyr.toFixed(1)} Myr outside 200-240`);
    return `${periodMyr.toFixed(1)} Myr`;
  });

  check('INDEPENDENT: G is verified against the Earth’s orbit, not against my arithmetic', () => {
    // The checks above are weaker than they look, and a reviewer was right to
    // say so. The two constant comparisons check the code against numbers I
    // typed from the same derivation, so a consistently mistyped G passes both.
    // And the two "physical" checks cancel the velocity unit algebraically:
    // period = 2*pi*r/v then converted by TIME_MYR leaves V cancelled, so they
    // pass with G wrong by ANY factor.
    //
    // This one cannot. It uses the astronomical unit, the solar mass and the
    // Julian year — three quantities with nothing to do with the kpc /
    // 1e10-Msun / G derivation — and asserts Kepler's third law closes in
    // INTERNAL units. Wrong G, wrong kpc or wrong solar mass all break it.
    const AU_KPC = 4.84813681e-9;          // 1 AU in kpc (1 pc = 206264.806 AU)
    const SUN = 1e-10;                     // 1 solar mass in units of 1e10 Msun
    const a = AU_KPC;
    const periodInternal = 2 * Math.PI * Math.sqrt((a * a * a) / SUN);   // G = 1
    const periodYears = U.timeToMyr(periodInternal) * 1e6;
    return close(periodYears, 1.0, 2e-3, 'Earth orbital period in years, from internal units');
  });

  // ----------------------------------------------------------- potentials
  group('potentials — internal consistency and sign');

  for (const [name, P] of Object.entries({
    point: pointMass(2.0),
    plummer: plummer(2.0, 0.3),
    hernquist: hernquist(2.0, 0.7),
  })) {
    check(`${name}: v_circ^2 equals r*|accel|`, () => {
      let worst = 0;
      for (const r of [0.5, 1, 2, 5, 10]) {
        P.accel(r, 0, 0, acc);
        worst = Math.max(worst, Math.abs(P.vcirc(r) ** 2 - r * norm(acc)) / (r * norm(acc)));
      }
      return below(worst, 1e-12, 'worst relative mismatch');
    });

    check(`${name}: acceleration points inward`, () => {
      // Guards a sign error, which produces a galaxy that expands smoothly and
      // reads as a plausible tidal response.
      let worst = -Infinity;
      for (const r of [0.5, 2, 8]) { P.accel(r, 0, 0, acc); worst = Math.max(worst, acc[0]); }
      return below(worst, 0, 'most positive radial accel at +x');
    });
  }

  check('THE SHIPPED GALAXY has a flat, Milky Way-like rotation curve', () => {
    // The previous model peaked at 118 km/s and fell as r^-0.33 — a dwarf with
    // no halo, used for scenarios named after large spirals. Two reviewers
    // caught it independently. A flat curve is the observational signature of a
    // dark halo, and its absence changes tidal-tail behaviour measurably.
    const P = galaxyModel(1.0);
    const radii = [3, 5, 8, 12, 16, 20, 25];
    const v = radii.map((r) => U.speedToKms(P.vcirc(r)));
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const spread = (Math.max(...v) - Math.min(...v)) / mean;
    ok(mean > 190 && mean < 245, `mean v_circ ${mean.toFixed(0)} km/s outside 190-245`);
    below(spread, 0.14, 'peak-to-trough spread of v_circ over 3-25 kpc');
    return `${v.map((x) => x.toFixed(0)).join('/')} km/s at ${radii.join('/')} kpc, mean ${mean.toFixed(0)}`;
  });

  check('THE SHIPPED GALAXY has a sensible total mass', () => {
    const P = galaxyModel(1.0);
    const msun = U.massToMsun(P.mass);
    ok(msun > 3e11 && msun < 1.5e12, `total mass ${msun.toExponential(2)} Msun is not galaxy-scale`);
    return `${(msun / 1e11).toFixed(1)}e11 Msun total`;
  });

  check('the encounter orbit uses the model mass, not the nominal spec mass', () => {
    // Scaling the model to Milky Way mass exposed this: mu came from the spec's
    // nominal m1 + m2 while the actual gravitating mass was 70x larger, which
    // would put the galaxies on a trajectory they do not follow and make every
    // pericentre and epoch in the interface a number about a different problem.
    const { galaxies, spec } = buildEncounter({
      massRatio: 1.0, rPeri: 25, ecc: 1.0, tStart: -45, particles: 64 });
    const total = galaxies[0].mass + galaxies[1].mass;
    close(spec.mu, total, 1e-12, 'orbit mu vs summed galaxy masses');
    // and the separation at t=0 must actually be the requested pericentre
    const sim = new RestrictedSim({ galaxies, particles: { count: 0, pos: new Float64Array(0), vel: new Float64Array(0) } });
    let minSep = Infinity;
    for (let i = 0; i < 9000; i++) { sim.step(0.01); minSep = Math.min(minSep, sim.diagnostics().separation); }
    const err = Math.abs(minSep - 25) / 25;
    below(err, 0.12, 'executed pericentre vs requested 25 kpc');
    return `mu = ${spec.mu.toFixed(1)}, executed pericentre ${minSep.toFixed(1)} kpc vs requested 25`;
  });

  check('plummer converges to point mass as a -> 0', () => {
    const a = [0, 0, 0], b = [0, 0, 0];
    pointMass(2.0).accel(3, 1, 0, a);
    plummer(2.0, 1e-6).accel(3, 1, 0, b);
    return below(dist(a, b) / norm(a), 1e-11, 'relative difference');
  });

  check('composite equals the sum of its parts', () => {
    const parts = [plummer(1.0, 0.4), hernquist(3.0, 1.2)];
    const s = [0, 0, 0], t = [0, 0, 0];
    composite(parts).accel(2, -1, 0.5, s);
    for (const p of parts) { p.accel(2, -1, 0.5, acc); t[0] += acc[0]; t[1] += acc[1]; t[2] += acc[2]; }
    return below(dist(s, t) / norm(t), 1e-14, 'relative difference');
  });

  // --------------------------------------------------------------- kepler
  group('kepler — analytic self-consistency');

  check('state at true anomaly has the analytic radius', () => {
    let worst = 0;
    for (const e of [0.0, 0.5, 0.9, 1.0, 1.5]) {
      for (const nu of [0, 0.5, 1.2, -0.8]) {
        const s = K.stateAtTrueAnomaly(1.5, e, 2.0, nu);
        const p = 2.0 * (1 + e);
        worst = Math.max(worst, Math.abs(norm(s.r) - p / (1 + e * Math.cos(nu))) / s.radius);
      }
    }
    return below(worst, 1e-13, 'worst radius error');
  });

  check('time <-> true anomaly round trips on all three conics', () => {
    let worst = 0;
    for (const e of [0.3, 0.99, 1.0, 1.4]) {
      for (const nu of [0.3, 0.9, 1.4]) {
        const t = K.timeSincePericentre(1.0, e, 1.0, nu);
        worst = Math.max(worst, Math.abs(K.trueAnomalyAtTime(1.0, e, 1.0, t) - nu));
      }
    }
    return below(worst, 1e-8, 'worst true-anomaly round-trip error');
  });

  check('energy sign matches the conic type', () => {
    for (const [e, want] of [[0.5, -1], [1.0, 0], [1.6, +1]]) {
      const s = K.stateAtTrueAnomaly(1.0, e, 1.0, 0.7);
      const E = K.specificEnergy(1.0, s.r, s.v);
      if (want < 0) ok(E < -1e-12, `e=${e} should be bound, E=${E}`);
      if (want === 0) ok(Math.abs(E) < 1e-12, `e=1 should be marginal, E=${E}`);
      if (want > 0) ok(E > 1e-12, `e=${e} should be unbound, E=${E}`);
    }
    return 'bound / marginal / unbound all correct';
  });

  // ----------------------------------------------------------- integrator
  group('integrator — against the closed-form two-body solution');

  /** One fixed point mass, one test particle on a known ellipse. */
  function keplerSim(e, rp, mu, softening = 0) {
    const P = softening > 0 ? plummer(mu, softening) : pointMass(mu);
    const s = K.stateAtTrueAnomaly(mu, e, rp, 0);          // start at pericentre
    return new RestrictedSim({
      galaxies: [{ mass: mu, potential: P, pos: [0, 0, 0], vel: [0, 0, 0] }],
      // Float64 initial state. Handing the float64 reference a float32 initial
      // condition quantises the start to ~6e-8 and puts a floor near 1e-5 on the
      // one-period closure error, which showed up as the convergence ratio
      // DEGRADING with resolution (3.50 -> 2.66 -> 1.71) instead of reaching 4.
      particles: { count: 1, pos: Float64Array.from(s.r), vel: Float64Array.from(s.v) },
    });
  }

  // The next two assert a CONVERGENCE RATE, not an absolute tolerance. An
  // absolute tolerance on a discretisation error is a number pulled out of the
  // air: it passes or fails on how many steps you happened to choose. The rate
  // is the actual claim the method makes and cannot be satisfied by tuning n.

  check('position closure error converges at second order', () => {
    const e = 0.5, rp = 1.0, mu = 1.0, T = K.period(mu, e, rp);
    const closure = (n) => {
      const sim = keplerSim(e, rp, mu);
      const start = Array.from(sim.pos);
      sim.run(T / n, n);
      return dist(Array.from(sim.pos), start) / rp;
    };
    const c = [5000, 10000, 20000, 40000].map(closure);
    const ratios = [c[0] / c[1], c[1] / c[2], c[2] / c[3]];
    const finest = ratios[ratios.length - 1];
    ok(finest > 3.7 && finest < 4.3,
      `finest closure ratio ${finest.toFixed(3)} not ~4; trend ${ratios.map((r) => r.toFixed(2)).join(' -> ')}`);
    return `ratios ${ratios.map((r) => r.toFixed(2)).join(' -> ')}, |err| ${c[3].toExponential(2)} at 40k steps/orbit`;
  });

  check('energy error at fixed time converges at second order', () => {
    // Measured at a FIXED physical time, not as a max over samples. Sampling the
    // maximum changes what you catch as the sample rate changes, which made an
    // earlier version of this test report a bogus ratio of 2.13.
    const e = 0.5, rp = 1.0, mu = 1.0, tEnd = K.period(mu, e, rp) * 0.37;
    const err = (n) => {
      const sim = keplerSim(e, rp, mu);
      const E0 = K.specificEnergy(mu, Array.from(sim.pos), Array.from(sim.vel));
      sim.run(tEnd / n, n);
      const E1 = K.specificEnergy(mu, Array.from(sim.pos), Array.from(sim.vel));
      return Math.abs((E1 - E0) / E0);
    };
    const a = err(4000), b = err(8000), ratio = a / b;
    ok(ratio > 3.5 && ratio < 4.5,
      `energy convergence ratio ${ratio.toFixed(3)} not ~4 (${a.toExponential(2)} -> ${b.toExponential(2)})`);
    return `ratio ${ratio.toFixed(2)}, |dE/E| ${b.toExponential(2)}`;
  });

  check('time reversal returns to the start in float64', () => {
    const sim = keplerSim(0.6, 1.0, 1.0);
    const p0 = Array.from(sim.pos);
    const dt = 0.002, n = 3000;
    sim.run(dt, n);
    const wandered = dist(Array.from(sim.pos), p0);
    sim.run(-dt, n);
    const back = dist(Array.from(sim.pos), p0);
    ok(wandered > 0.1, `orbit barely moved (${wandered.toExponential(2)}), the test is vacuous`);
    return below(back, 1e-11, `return error after ${n} forward + ${n} backward steps`);
  });

  check('CHARACTERISATION: float32 reversal residual, which bounds the adjoint', () => {
    // Not a pass/fail on the physics. KDK is algebraically exactly reversible;
    // in floating point it is not, and the residual is set by the precision the
    // state is stored in. The shipped engine and the gradient adjoint both run
    // in float32, and the adjoint recomputes states by reversing rather than
    // storing them, so whatever this number is, it is the floor on gradient
    // accuracy through a long rollout.
    const sim = keplerSim(0.6, 1.0, 1.0);
    const r32 = (a) => Array.from(Float32Array.from(a));
    const dt = 0.002, n = 3000;
    const p0 = Array.from(sim.pos);
    for (let i = 0; i < n; i++) { sim.step(dt); sim.pos.set(r32(sim.pos)); sim.vel.set(r32(sim.vel)); }
    for (let i = 0; i < n; i++) { sim.step(-dt); sim.pos.set(r32(sim.pos)); sim.vel.set(r32(sim.vel)); }
    const back = dist(Array.from(sim.pos), p0);
    below(back, 1e-2, 'float32 reversal residual');
    return `float32 residual ${back.toExponential(2)} after ${n}+${n} steps (float64: <1e-11)`;
  });

  check('Laplace-Runge-Lenz conserved for an exact 1/r^2 force', () => {
    // Sharper than energy or angular momentum: those are conserved by ANY
    // central force, so they cannot distinguish an inverse-square law from a
    // softened one. LRL can.
    const mu = 1.0, sim = keplerSim(0.5, 1.0, mu);
    const A0 = K.laplaceRungeLenz(mu, Array.from(sim.pos), Array.from(sim.vel));
    sim.run(K.period(mu, 0.5, 1.0) / 8000, 8000 * 3);
    const A1 = K.laplaceRungeLenz(mu, Array.from(sim.pos), Array.from(sim.vel));
    return below(dist(A0, A1) / norm(A0), 1e-5, 'LRL drift over 3 orbits');
  });

  check('SENSITIVITY: the LRL test does fail under heavy softening', () => {
    const mu = 1.0, sim = keplerSim(0.5, 1.0, mu, 0.5);   // softening = r_peri/2
    const A0 = K.laplaceRungeLenz(mu, Array.from(sim.pos), Array.from(sim.vel));
    sim.run(K.period(mu, 0.5, 1.0) / 8000, 8000 * 3);
    const A1 = K.laplaceRungeLenz(mu, Array.from(sim.pos), Array.from(sim.vel));
    return above(dist(A0, A1) / norm(A0), 0.05, 'LRL drift with softening = r_peri/2');
  });

  check('NEWTON III: the pair force is equal and opposite at every mass ratio', () => {
    // This check did not exist, and its absence let a real defect ship. Each
    // galaxy used to feel the other's extended potential evaluated independently,
    // which breaks the third law as soon as the two profiles differ: measured at
    // mass ratio 0.1 and separation 2, the force on the primary was 34 per cent
    // larger than the force on the secondary.
    //
    // The scales below are deliberately MISMATCHED, because the old conservation
    // test gave both galaxies the same Plummer scale and therefore could not
    // detect the asymmetry it was supposed to be guarding against.
    let worst = 0, worstAt = '';
    for (const q of [1.0, 0.5, 0.3, 0.1]) {
      for (const d of [1.5, 4, 12]) {
        const P1 = composite([plummer(0.35, 0.5), hernquist(0.65, 2.2)]);
        const P2 = composite([plummer(0.35 * q, 0.5 * Math.cbrt(q)), hernquist(0.65 * q, 2.2 * Math.cbrt(q))]);
        const sim = new RestrictedSim({
          galaxies: [
            { mass: 1.0, potential: P1, pos: [0, 0, 0], vel: [0, 0, 0] },
            { mass: q, potential: P2, pos: [d, 0, 0], vel: [0, 0, 0] },
          ],
          particles: { count: 0, pos: new Float64Array(0), vel: new Float64Array(0) },
        });
        const g = sim.galaxies;
        const F1 = Math.hypot(g[0].acc[0], g[0].acc[1], g[0].acc[2]) * g[0].mass;
        const F2 = Math.hypot(g[1].acc[0], g[1].acc[1], g[1].acc[2]) * g[1].mass;
        const rel = Math.abs(F1 - F2) / Math.max(F1, F2);
        if (rel > worst) { worst = rel; worstAt = `q=${q}, d=${d}`; }
      }
    }
    below(worst, 1e-12, `worst |F12-F21|/F (${worstAt})`);
    return `symmetric to ${worst.toExponential(1)} across q=1.0..0.1, d=1.5..12`;
  });

  check('linear momentum is conserved for an unequal-mass encounter', () => {
    // The direct consequence of the check above, integrated. Unequal masses AND
    // unequal scales, so it exercises the case the old test could not.
    const m1 = 1.0, m2 = 0.25, mu = m1 + m2, e = 0.6, rp = 2.0;
    const s = K.stateAtTrueAnomaly(mu, e, rp, -1.4);
    const f1 = m2 / mu, f2 = -m1 / mu;
    const sim = new RestrictedSim({
      galaxies: [
        { mass: m1, potential: composite([plummer(0.35, 0.5), hernquist(0.65, 2.2)]),
          pos: s.r.map((x) => x * f1), vel: s.v.map((x) => x * f1) },
        { mass: m2, potential: composite([plummer(0.0875, 0.315), hernquist(0.1625, 1.386)]),
          pos: s.r.map((x) => x * f2), vel: s.v.map((x) => x * f2) },
      ],
      particles: { count: 0, pos: new Float64Array(0), vel: new Float64Array(0) },
    });
    const mom = () => {
      let p = [0, 0, 0];
      for (const g of sim.galaxies) for (let k = 0; k < 3; k++) p[k] += g.mass * g.vel[k];
      return p;
    };
    const p0 = mom();
    const scale = Math.max(1e-12, Math.hypot(...sim.galaxies.map((g) => g.mass * norm(Array.from(g.vel)))));
    sim.run(0.002, 20000);
    const p1 = mom();
    return below(dist(p0, p1) / scale, 1e-12, 'momentum drift / typical |p| of one galaxy');
  });

  check('two mutually orbiting galaxies conserve energy and angular momentum', () => {
    const m1 = 1.0, m2 = 0.6, mu = m1 + m2, e = 0.4, rp = 2.0;
    const s = K.stateAtTrueAnomaly(mu, e, rp, Math.PI * 0.6);
    const f1 = m2 / mu, f2 = -m1 / mu;
    // scales deliberately DIFFERENT (0.05 vs 0.13): identical scales hid the
    // third-law defect from this test for its whole life
    const sim = new RestrictedSim({
      galaxies: [
        { mass: m1, potential: plummer(m1, 0.05), pos: s.r.map((x) => x * f1), vel: s.v.map((x) => x * f1) },
        { mass: m2, potential: plummer(m2, 0.13), pos: s.r.map((x) => x * f2), vel: s.v.map((x) => x * f2) },
      ],
      particles: { count: 0, pos: new Float64Array(0), vel: new Float64Array(0) },
    });
    const d0 = sim.diagnostics();
    sim.run(0.002, 20000);
    const d1 = sim.diagnostics();
    const dE = Math.abs((d1.energy - d0.energy) / d0.energy);
    const dL = Math.abs((d1.angularMomentumMag - d0.angularMomentumMag) / d0.angularMomentumMag);
    below(dE, 1e-6, 'energy drift');
    return below(dL, 1e-12, 'angular momentum drift') + `, energy drift ${dE.toExponential(2)}`;
  });

  // ------------------------------------------------------ disc equilibrium
  group('disc equilibrium — the failure mode that looks like physics');

  const radiiOf = (arr, n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(Math.hypot(arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]));
    return out;
  };

  check('an isolated ring disc holds its radii', () => {
    // A disc not in equilibrium spreads and warps on its own, and in an
    // encounter that motion is indistinguishable by eye from a tidal response.
    const P = plummer(4.0, 0.4);
    const d = discOfRings({ potential: P, rings: [1, 2, 3, 4, 5] });
    const sim = new RestrictedSim({
      galaxies: [{ mass: 4.0, potential: P, pos: [0, 0, 0], vel: [0, 0, 0] }], particles: d });
    const r0 = radiiOf(d.pos, d.count);
    sim.run(0.01, 5000);   // ~50 time units, several orbits at every radius
    const r1 = radiiOf(sim.pos, d.count);
    let worst = 0;
    for (let i = 0; i < d.count; i++) worst = Math.max(worst, Math.abs(r1[i] - r0[i]) / r0[i]);
    return below(worst, 1e-4, 'worst fractional radius change over ~50 time units');
  });

  check('SENSITIVITY: a disc given the wrong circular speed does NOT hold', () => {
    const P = plummer(4.0, 0.4);
    const d = discOfRings({ potential: P, rings: [1, 2, 3, 4, 5] });
    for (let i = 0; i < d.count * 3; i++) d.vel[i] *= 0.9;
    const sim = new RestrictedSim({
      galaxies: [{ mass: 4.0, potential: P, pos: [0, 0, 0], vel: [0, 0, 0] }], particles: d });
    const r0 = radiiOf(d.pos, d.count);
    sim.run(0.01, 5000);
    const r1 = radiiOf(sim.pos, d.count);
    let worst = 0;
    for (let i = 0; i < d.count; i++) worst = Math.max(worst, Math.abs(r1[i] - r0[i]) / r0[i]);
    return above(worst, 0.05, 'radius change with v_circ 10% low');
  });

  check('THE SHIPPED DISC holds its radii — exponentialDisc, not just the ring generator', () => {
    // The equilibrium check above uses discOfRings, which NOTHING SHIPS.
    // buildEncounter uses exponentialDisc, so the disc that actually appears on
    // screen had no equilibrium assertion at all. It also had a real defect:
    // circular speed was taken at the cylindrical radius while the particle sat
    // at height z, leaving every off-plane particle slightly off its orbit.
    const P = composite([plummer(0.35, 0.5), hernquist(0.65, 2.2)]);
    const d = exponentialDisc({ potential: P, count: 4000, scaleLength: 1.6, rMax: 3.2, seed: 3 });
    const sim = new RestrictedSim({
      galaxies: [{ mass: 1.0, potential: P, pos: [0, 0, 0], vel: [0, 0, 0] }], particles: d });
    const r0 = radiiOf(d.pos, d.count);
    sim.run(0.01, 4000);
    const r1 = radiiOf(sim.pos, d.count);
    let worst = 0;
    for (let i = 0; i < d.count; i++) worst = Math.max(worst, Math.abs(r1[i] - r0[i]) / r0[i]);
    return below(worst, 5e-3, 'worst fractional spherical-radius change over ~40 time units');
  });

  check('exponential disc realises the analytic surface density profile', () => {
    const P = hernquist(10.0, 1.0), Rd = 2.0, N = 40000;
    const d = exponentialDisc({ potential: P, count: N, scaleLength: Rd, rMax: 4.5, seed: 7 });
    let worst = 0;
    for (const x of [0.5, 1.0, 2.0, 3.0]) {
      let inside = 0;
      for (let i = 0; i < N; i++) if (d.radius[i] < x * Rd) inside++;
      const analytic = (1 - (1 + x) * Math.exp(-x)) / (1 - (1 + 4.5) * Math.exp(-4.5));
      worst = Math.max(worst, Math.abs(inside / N - analytic));
    }
    return below(worst, 0.01, 'worst enclosed-fraction deviation');
  });
}
