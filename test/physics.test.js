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
import { RestrictedSim, erf, frictionWeight, frictionWeightX } from '../src/engine/cpu.js';
import { discOfRings, exponentialDisc } from '../src/engine/galaxy.js';
import { galaxyModel, buildEncounter, SCENARIOS } from '../src/engine/encounter.js';
import { pairTable } from '../src/engine/pairforce.js';
import { record } from './measured.js';

const acc = [0, 0, 0];

export function runPhysicsTests() {
  expectChecks(51);

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

  check('a BOUND request executes as a bound orbit, with the requested shape', () => {
    // The single worst defect found in three rounds. buildEncounter set the
    // orbit from a POINT-MASS Kepler solution while the galaxies are extended,
    // so the pair launched above escape speed in the potential it actually
    // inhabits: at the published Arp 244 fit the total energy went -1.007e3
    // (point mass) to +1.289e3 (real), and the galaxies ran to 559 kpc against a
    // Kepler apocentre of 4.6. 24 of the 36 bound published fits were affected.
    //
    // Nothing checked eccentricity at all — only pericentre was solved for — so
    // the sandbox slider was untrue too: 0.95 requested, 0.908 executed.
    const bad = [];
    for (const [rp, e, mr] of [[1.572, 0.493, 0.758], [3, 0.493, 0.758], [5, 0.493, 0.758],
                               [8, 0.44, 0.71], [12, 0.4, 0.5], [25, 0.9, 1.0]]) {
      const enc = buildEncounter({ massRatio: mr, rPeri: rp, ecc: e, tStart: -50, particles: 8,
        disc1: { active: false }, disc2: { active: false } });
      if (!(enc.spec.orbitEnergy < 0)) bad.push(`rp=${rp} e=${e}: E=${enc.spec.orbitEnergy?.toExponential(2)} not bound`);
      const rpErr = Math.abs(enc.spec.executedPeri / rp - 1);
      if (rpErr > 2e-3) bad.push(`rp=${rp}: executed ${enc.spec.executedPeri.toFixed(3)}`);
      const eOut = (enc.spec.executedApo - enc.spec.executedPeri) / (enc.spec.executedApo + enc.spec.executedPeri);
      if (Math.abs(eOut / e - 1) > 2e-3) bad.push(`e=${e}: executed ${eOut.toFixed(4)}`);
    }
    ok(bad.length === 0, bad.join('; '));
    return '6 bound configurations execute bound, with r_peri and eccentricity to 0.2%';
  });

  check('SENSITIVITY: a point-mass orbit setup WOULD fail the bound check', () => {
    // The superseded behaviour, computed directly: Kepler energy for a point mass
    // of the same total, evaluated against the real extended potential. If this
    // does not come out positive the check above has nothing to catch.
    const P1 = galaxyModel(1.0), P2 = galaxyModel(0.758, Math.cbrt(0.758));
    const M1 = P1.mass, M2 = P2.mass, mu = M1 + M2, muRed = M1 * M2 / mu;
    const rp = 1.572, e = 0.493;
    // Kepler state at pericentre for a point mass mu
    const vPeri = Math.sqrt(mu * (1 + e) / rp);
    const Ereal = 0.5 * muRed * vPeri * vPeri + pairTable(P1, P2).potential(rp);
    return above(Ereal, 0, 'energy of the point-mass setup measured in the REAL potential');
  });

  check('every scenario reaches a real pericentre, not the edge of the search', () => {
    // Round 3 found closest approach being reported at t = 0 (already receding)
    // and at the last step of the search budget, both with converged: true.
    // A silent non-solution is worse than a failure, which is the whole reason
    // convergence is reported at all.
    const bad = [], notes = [];
    for (const [key, sc] of Object.entries(SCENARIOS)) {
      const enc = buildEncounter({ ...sc.spec, particles: 8, disc1: { active: false }, disc2: { active: false } });
      const rel = Math.abs(enc.spec.executedPeri / sc.spec.rPeri - 1);
      const hasFriction = (sc.spec.friction ?? 0) > 0;

      // The pericentre must be a real turn-around in every case.
      if (enc.spec.executedPeri <= 0 || !Number.isFinite(enc.spec.executedPeri)) {
        bad.push(`${key}: executed pericentre is ${enc.spec.executedPeri}`);
      }

      if (hasFriction) {
        // A DISSIPATIVE encounter does not have a pericentre you can dial in:
        // drag removes energy on the way in, so it closes inside the request.
        // What is asserted here is HONESTY, not accuracy — if the executed value
        // differs, the build must SAY so rather than print the request.
        if (rel > 0.02 && enc.spec.periConverged) {
          bad.push(`${key}: executed ${enc.spec.executedPeri.toFixed(2)} against a requested ${sc.spec.rPeri} and still reports converged`);
        }
        if (rel > 0.02 && !enc.spec.periWhy) bad.push(`${key}: differs from the request with no reason given`);
        notes.push(`${key}: requested ${sc.spec.rPeri}, executed ${enc.spec.executedPeri.toFixed(2)} (reported)`);
      } else {
        if (!enc.spec.periConverged) bad.push(`${key}: ${enc.spec.periWhy}`);
        if (rel > 5e-3) bad.push(`${key}: requested ${sc.spec.rPeri}, executed ${enc.spec.executedPeri.toFixed(2)}`);
        notes.push(`${key}: ${enc.spec.executedPeri.toFixed(2)}`);
      }
    }
    ok(bad.length === 0, bad.join('; '));
    return notes.join('; ');
  });

  check('THE MERGER SCENARIO ACTUALLY MERGES, and does so within its own timeline', () => {
    // Round 1 added friction because "a scenario blurbed as a merger could not
    // merge". Round 3's friction gate silently undid that — the pair decayed to a
    // permanent radial oscillation in the 30-38 kpc band and never coalesced —
    // and round 4 caught it, along with the fact that the second passage sat
    // PAST the end of the scrubber even when it did happen.
    //
    // So this asserts both halves: it merges, and you can scrub to it.
    const sc = SCENARIOS.merger;
    const enc = buildEncounter({ ...sc.spec, particles: 8,
      disc1: { active: false }, disc2: { active: false } });
    const sim = new RestrictedSim({ friction: enc.friction, galaxies: enc.galaxies,
      particles: { count: 0, pos: new Float64Array(0), vel: new Float64Array(0) } });
    const sep = () => sim.diagnostics().separation;

    const tEnd = enc.t0 + (sc.spec.tSpan ?? 200);
    const dt = 0.02;
    let t = enc.t0, mergedAt = null, maxSep = 0;
    while (t < tEnd) {
      sim.step(dt); t += dt;
      const s = sep();
      if (s > maxSep) maxSep = s;
      if (s < 2.0 && mergedAt === null) mergedAt = t;
    }
    ok(maxSep > 40, `the pair never separates (max ${maxSep.toFixed(1)} kpc); there is no encounter to decay`);
    ok(mergedAt !== null,
      `the pair never comes within 2 kpc inside tSpan (closest tracked; max separation ${maxSep.toFixed(1)} kpc). `
      + 'Round 1 added friction precisely so a scenario called "merger" merges.');
    ok(mergedAt < tEnd, 'the merger happens after the end of the scrubbable timeline');
    record('mergerMyr', mergedAt * 4.714920);
    // the MEASURED executed pericentre, not the literal from the blurb — a
    // registry entry that hardcodes the documented value would make the claims
    // guard compare a number against itself
    record('mergerPeriKpc', enc.spec.executedPeri);
    return `merges at t = ${mergedAt.toFixed(0)} (${(mergedAt * 4.714920).toFixed(0)} Myr), `
         + `inside a tSpan reaching ${(tEnd * 4.714920).toFixed(0)} Myr; max separation ${maxSep.toFixed(1)} kpc`;
  });

  check('every scenario lies inside the ranges the interface offers', () => {
    // The two halves drifted apart once already: detective mode clamped
    // pericentre at 20 kpc and eccentricity at 2.0 — dwarf-era constants — while
    // the engine shipped a 55 kpc scenario. 35 of 59 targets were loaded as
    // something other than the published fit for no reason the engine required.
    const RP = [0.5, 90], ECC = [0.4, 5.0], MR = [0.05, 1.0];
    const bad = [];
    for (const [key, sc] of Object.entries(SCENARIOS)) {
      const s = sc.spec;
      if (s.rPeri < RP[0] || s.rPeri > RP[1]) bad.push(`${key}: rPeri ${s.rPeri}`);
      if (s.ecc < ECC[0] || s.ecc > ECC[1]) bad.push(`${key}: ecc ${s.ecc}`);
      const mr = s.massRatio ?? 1;
      if (mr < MR[0] || mr > MR[1]) bad.push(`${key}: massRatio ${mr}`);
    }
    ok(bad.length === 0, `outside the interface ranges: ${bad.join('; ')}`);
    return `${Object.keys(SCENARIOS).length} scenarios all inside rPeri ${RP.join('-')}, ecc ${ECC.join('-')}, q ${MR.join('-')}`;
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

  check('IDENTIFIABILITY: mass and epoch are an exactly flat direction', () => {
    // Not a defect to fix — a property of Newtonian gravity, and one that would
    // silently wreck the inverse problem. Scaling every mass by L and every time
    // by 1/sqrt(L) with lengths fixed leaves the trajectory identical, so
    // morphology alone cannot separate total mass from epoch.
    //
    // Asserting the invariance HOLDS, with a control that must fail, so the
    // gauge in docs/IDENTIFIABILITY.md rests on a measurement rather than an
    // argument.
    const moments = (L, rescale) => {
      const f = rescale ? Math.sqrt(L) : 1;
      const { galaxies, particles } = buildEncounter({
        m1: L, massRatio: 0.7, rPeri: 25, ecc: 1.0, tStart: -45 / f,
        particles: 1500, seed: 5,
        disc1: { inclination: 0.3, argPeri: 0 }, disc2: { inclination: -0.4, argPeri: 1.0 } });
      const sim = new RestrictedSim({ galaxies, particles });
      sim.run(0.02 / f, 3000);
      let r1 = 0, r2 = 0, mx = 0;
      for (let i = 0; i < particles.count; i++) {
        const r = Math.hypot(sim.pos[i * 3], sim.pos[i * 3 + 1], sim.pos[i * 3 + 2]);
        r1 += r; r2 += r * r; mx = Math.max(mx, r);
      }
      return [r1 / particles.count, Math.sqrt(r2 / particles.count), mx,
              sim.diagnostics().separation];
    };
    const a = moments(1, true), b = moments(4, true), c = moments(4, false);
    const worst = (p, q) => Math.max(...p.map((v, i) => Math.abs(v - q[i]) / Math.abs(v)));
    const scaled = worst(a, b), control = worst(a, c);
    above(control, 0.2, 'control (mass scaled, time NOT) must differ');
    below(scaled, 1e-6, 'worst moment difference under the mass-time rescaling');
    // RECORDED so docs/IDENTIFIABILITY.md's table is checked rather than
    // transcribed. Round 2 caught that table listing five moments where this
    // computes four; round 4 caught every one of its numbers stale again, moved
    // by the pair-force fix, in the file headed "Verified, not argued". The
    // claims guard now reads them back.
    record('meanR', a[0]); record('rmsR', a[1]); record('maxR', a[2]); record('sepR', a[3]);
    record('massEpochInvariance', scaled);
    record('massEpochControlPct', control * 100);
    return `invariant to ${scaled.toExponential(1)}; control differs by ${(control * 100).toFixed(0)}%; `
         + `moments ${a.map((v) => v.toFixed(3)).join(' | ')}`;
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

  check('bound orbits WRAP instead of saturating at apocentre', () => {
    // The bisection searched [0, pi] — half a period — so any larger |t| pinned
    // at apocentre and returned it as an ordinary answer. A reviewer found this
    // affecting a third of the detective targets, whose published t_min exceeds
    // half an orbit.
    const mu = 1.0, e = 0.5, rp = 1.0, P = K.period(mu, e, rp);
    // one full period later must be the same place
    const a = K.trueAnomalyAtTime(mu, e, rp, 0.3 * P);
    const b = K.trueAnomalyAtTime(mu, e, rp, 1.3 * P);
    close(K.stateAtTrueAnomaly(mu, e, rp, a).radius,
          K.stateAtTrueAnomaly(mu, e, rp, b).radius, 1e-9, 'radius after one extra period');
    // and a time past apocentre must NOT pin there
    const late = K.trueAnomalyAtTime(mu, e, rp, 0.72 * P);
    ok(Math.abs(Math.abs(late) - Math.PI * 0.999) > 1e-3,
      `t = 0.72 P still saturates at apocentre (nu = ${late.toFixed(6)})`);
    return `nu(0.3P) = ${a.toFixed(4)}, radius matches at 1.3P; nu(0.72P) = ${late.toFixed(4)} (not pinned)`;
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

  check('the pair force matches the SHELL THEOREM, which has an exact answer', () => {
    // This check replaces one that compared the code against the same closed
    // form the code implemented — a tautology that passed for two rounds while
    // the force law was up to 3.09x wrong.
    //
    // The mutual force between two extended spheres has no elementary closed
    // form, so there is nothing to be smug about comparing against. But ONE case
    // is exactly known: a point mass at distance d from a spherical distribution
    // feels M_point * M_enclosed-law(d), by the shell theorem. For Hernquist that
    // is M_p M_h / (d + a)^2, exactly, at every d. Approximate the point mass by
    // a Plummer sphere of negligible scale and the pair kernel must reproduce it.
    let worst = 0, at = '';
    for (const [Mh, a] of [[66, 20], [1, 0.5], [12, 3.3]]) {
      for (const d of [0.7, 3, 12, 40, 150]) {
        const sim = new RestrictedSim({
          galaxies: [
            { mass: Mh, potential: hernquist(Mh, a), pos: [0, 0, 0], vel: [0, 0, 0] },
            { mass: 1e-3, potential: plummer(1e-3, 1e-4), pos: [d, 0, 0], vel: [0, 0, 0] },
          ],
          particles: { count: 0, pos: new Float64Array(0), vel: new Float64Array(0) },
        });
        const F = Math.abs(sim.galaxies[0].acc[0]) * Mh;
        const want = 1e-3 * Mh / ((d + a) * (d + a));
        const rel = Math.abs(F - want) / want;
        if (rel > worst) { worst = rel; at = `M_h=${Mh} a=${a} d=${d}`; }
      }
    }
    return below(worst, 2e-3, `worst relative error vs the shell theorem (${at})`);
  });

  check('the pair force and the pair POTENTIAL are mutually consistent', () => {
    // The force drives the integrator; the potential is what diagnostics() calls
    // energy. They come from two separately derived integrals, so if |F| = dW/dd
    // holds, a sign or factor slip in either would have to be mirrored exactly in
    // the other to survive. This is what makes the conservation test meaningful
    // rather than self-referential — and it is the check that caught my own sign
    // error in the Hermite derivative, which showed up as 4.9e-4 energy drift.
    const P1 = galaxyModel(1.0), P2 = galaxyModel(0.6, Math.cbrt(0.6));
    const tab = pairTable(P1, P2);
    let worst = 0, at = '';
    for (const d of [1, 3, 8, 16, 25, 40, 80, 150, 300]) {
      const h = d * 1e-6;
      const num = (tab.potential(d + h) - tab.potential(d - h)) / (2 * h);
      const rel = Math.abs(tab.force(d) - num) / Math.abs(num);
      if (rel > worst) { worst = rel; at = `d=${d}`; }
    }
    return below(worst, 1e-6, `worst |F| vs dW/dd (${at})`);
  });

  check('SENSITIVITY: the shell-theorem check rejects the old closed form', () => {
    // The law that shipped for two rounds, measured against the exact answer the
    // check above uses. If this does not fail loudly the check has no power.
    let worst = 0;
    for (const [Mh, a] of [[66, 20], [1, 0.5]]) {
      for (const d of [0.7, 3, 12, 40]) {
        const S = d * d + a * a + 1e-8;
        const old = 1e-3 * Mh * d / (S * Math.sqrt(S));
        const want = 1e-3 * Mh / ((d + a) * (d + a));
        worst = Math.max(worst, Math.abs(old - want) / want);
      }
    }
    return above(worst, 0.5, 'worst error of the SUPERSEDED closed form vs the shell theorem');
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

  // ------------------------------------------------------------- friction
  group('dynamical friction — dissipative, and momentum-conserving anyway');

  const frictionPair = (lnL) => {
    const m1 = 1.0, q = 0.6;
    const P1 = galaxyModel(m1), P2 = galaxyModel(m1 * q, Math.cbrt(q));
    const M1 = P1.mass, M2 = P2.mass, mu = M1 + M2;
    const s = K.stateAtTrueAnomaly(mu, 0.7, 20, -1.2);
    const f1 = M2 / mu, f2 = -M1 / mu;
    return new RestrictedSim({
      friction: lnL,
      galaxies: [
        { mass: M1, potential: P1, pos: s.r.map((x) => x * f1), vel: s.v.map((x) => x * f1) },
        { mass: M2, potential: P2, pos: s.r.map((x) => x * f2), vel: s.v.map((x) => x * f2) },
      ],
      particles: { count: 0, pos: new Float64Array(0), vel: new Float64Array(0) },
    });
  };

  check('erf matches known values', () => {
    // Added because a wrong erf shipped and no test could see it: the friction
    // checks assert that energy FALLS and the orbit DECAYS, and an erf wrong by
    // 15% of full scale still does both. An assertion on the sign of an effect
    // cannot detect an error in its magnitude.
    const REF = [[0.5, 0.5204998778], [1, 0.8427007929], [2, 0.9953222650], [3, 0.9999779095]];
    let worst = 0;
    for (const [x, want] of REF) worst = Math.max(worst, Math.abs(erf(x) - want));
    ok(Math.abs(erf(-1) + erf(1)) < 1e-15, 'erf is not odd');
    return below(worst, 2e-7, 'worst absolute error vs known values of erf');
  });

  check('friction MAGNITUDE matches the analytic Chandrasekhar formula', () => {
    // The check that was missing, and its absence let the drag ship at exactly
    // half strength: the existing tests asserted energy falls and the orbit
    // decays, and half the correct drag does both. The reference below is
    // written out from the formula rather than taken from the implementation,
    // so this is a comparison and not a tautology.
    //
    //   a_df = 4 pi lnL M_sat rho f(X) / v^2,  X = v / (sqrt(2) sigma)
    //   f(X) = erf(X) - (2X/sqrt(pi)) exp(-X^2)
    //
    // A LIGHT satellite in a heavy halo, so the reciprocal drag on the primary
    // is negligible and the total is the satellite's own term.
    const lnL = 3.0;
    const heavy = hernquist(60, 18);
    const light = plummer(0.02, 0.3);            // 0.03% of the primary
    const d = 22, v = 0.8;
    const sim = new RestrictedSim({
      friction: lnL,
      galaxies: [
        { mass: 60, potential: heavy, pos: [0, 0, 0], vel: [0, 0, 0] },
        { mass: 0.02, potential: light, pos: [d, 0, 0], vel: [0, v, 0] },
      ],
      particles: { count: 0, pos: new Float64Array(0), vel: new Float64Array(0) },
    });
    // measured: total acceleration on the satellite, minus the gravitational part
    const withF = Array.from(sim.galaxies[1].acc);
    const noF = new RestrictedSim({
      friction: 0,
      galaxies: [
        { mass: 60, potential: heavy, pos: [0, 0, 0], vel: [0, 0, 0] },
        { mass: 0.02, potential: light, pos: [d, 0, 0], vel: [0, v, 0] },
      ],
      particles: { count: 0, pos: new Float64Array(0), vel: new Float64Array(0) },
    });
    const g = Array.from(noF.galaxies[1].acc);
    const measured = Math.hypot(withF[0] - g[0], withF[1] - g[1], withF[2] - g[2]);

    const rho = heavy.density(d);
    const sigma = heavy.vcirc(d) / Math.SQRT2;
    const X = v / (Math.SQRT2 * sigma);
    const f = erf(X) - (2 * X / Math.sqrt(Math.PI)) * Math.exp(-X * X);
    const expected = 4 * Math.PI * lnL * 0.02 * rho * f / (v * v);

    return close(measured, expected, 0.02, 'satellite drag vs analytic Chandrasekhar');
  });

  check('the friction validity gate fires on the galaxies the APP builds', () => {
    // THIS CHECK CALLS THE SHIPPED GATE. Round 3's version re-implemented it
    // locally, and a reviewer proved that inert by DELETING the gate from
    // cpu.js entirely and running the suite: it passed with byte-identical
    // output. A guard that does not call the thing it guards is decorative.
    //
    // Round 2's gate was inert (w = 1.0000 everywhere) because it compared the
    // perturber's MIN component scale against the field's MAX. Round 3's was
    // wrong in both directions because it keyed on separation. The criterion is
    // the size ASYMMETRY, which is what round 2's comment always claimed.
    const P1 = galaxyModel(1.0);
    const rows = [];
    let worstBig = 0, worstSmall = 1;
    for (const q of [0.05, 0.1, 0.6, 1.0]) {
      const P2 = galaxyModel(q, Math.cbrt(q));
      const wBig = frictionWeight(P1, P2);     // BIG galaxy as a point inside the small one
      const wSmall = frictionWeight(P2, P1);   // the legitimate direction
      worstBig = Math.max(worstBig, q <= 0.1 ? wBig : 0);
      worstSmall = Math.min(worstSmall, wSmall);
      rows.push(`q=${q}: big->small ${wBig.toFixed(3)}, small->big ${wSmall.toFixed(3)}`);
    }
    ok(worstBig < 0.4, `the M^2 pathology is not suppressed at q <= 0.1 (worst w = ${worstBig.toFixed(3)}); ${rows.join('; ')}`);
    ok(worstSmall > 0.95, `the LEGITIMATE drag direction is being suppressed (worst w = ${worstSmall.toFixed(3)}); ${rows.join('; ')}`);
    // and it must NOT depend on separation — that was round 3's error, and it
    // switched friction off through the whole close-approach phase
    const P2 = galaxyModel(0.6, Math.cbrt(0.6));
    ok(frictionWeight(P1, P2) === frictionWeight(P1, P2),
      'the gate is not a pure function of the two potentials');
    return rows.join('; ');
  });

  check('friction conserves linear momentum exactly', () => {
    // Dissipative but internal: it moves energy out of the orbit, never
    // momentum out of the system. Force-symmetrised for exactly this reason.
    const sim = frictionPair(3.0);
    const mom = () => {
      const p = [0, 0, 0];
      for (const g of sim.galaxies) for (let k = 0; k < 3; k++) p[k] += g.mass * g.vel[k];
      return p;
    };
    const p0 = mom();
    const scale = Math.max(1e-12, sim.galaxies[0].mass * norm(Array.from(sim.galaxies[0].vel)));
    sim.run(0.02, 6000);
    return below(dist(p0, mom()) / scale, 1e-12, 'momentum drift with friction on');
  });

  check('friction removes orbital energy and decays the orbit', () => {
    const withF = frictionPair(3.0), noF = frictionPair(0);
    const e0 = withF.diagnostics().energy;
    let apoWith = 0, apoNo = 0;
    for (let i = 0; i < 9000; i++) {
      withF.step(0.02); noF.step(0.02);
      apoWith = Math.max(apoWith, withF.diagnostics().separation);
      apoNo = Math.max(apoNo, noF.diagnostics().separation);
    }
    const e1 = withF.diagnostics().energy;
    ok(e1 < e0, `energy did not decrease (${e0.toFixed(3)} -> ${e1.toFixed(3)})`);
    ok(apoWith < apoNo * 0.98,
      `apocentre did not shrink: ${apoWith.toFixed(1)} with friction vs ${apoNo.toFixed(1)} without`);
    return `apocentre ${apoNo.toFixed(1)} -> ${apoWith.toFixed(1)} kpc, energy ${((e1 / e0 - 1) * 100).toFixed(1)}% deeper`;
  });

  check('SENSITIVITY: with friction OFF the orbit does not decay', () => {
    // Proves the decay above is friction and not some other drift. Without this
    // a leaky integrator would read as physics.
    const sim = frictionPair(0);
    const e0 = sim.diagnostics().energy;
    sim.run(0.02, 9000);
    const drift = Math.abs((sim.diagnostics().energy - e0) / e0);
    return below(drift, 1e-6, 'energy drift with friction off');
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

  check('THE SHIPPED DISC holds its rms HEIGHT and its cylindrical radius too', () => {
    // The spherical-radius check above is structurally blind to the defect that
    // actually shipped. For purely tangential orbits in a spherical potential
    // the spherical radius is conserved BY CONSTRUCTION, so that check returns
    // ~4e-5 at thickness 0, 0.1, 0.5 AND 2.0 — it passes at every thickness and
    // could never see a vertical problem.
    //
    // The defect: giving each particle a height and no vertical velocity puts
    // them all at psi = 0, in phase, and they fall through the midplane together.
    // Measured before the fix: rms|z| collapsed 40-41% in ~19 Myr, phase-mixing
    // to 1/sqrt(2) — a coherent breathing mode indistinguishable by eye from a
    // tidal response. Two reviewers found it.
    //
    // So this measures the two coordinates that CAN move: rms|z| and the
    // cylindrical radius. It joins the check above rather than replacing it.
    const P = composite([plummer(0.35, 0.5), hernquist(0.65, 2.2)]);
    const d = exponentialDisc({ potential: P, count: 4000, scaleLength: 1.6, rMax: 3.2,
      thickness: 0.1, seed: 3 });
    const sim = new RestrictedSim({
      galaxies: [{ mass: 1.0, potential: P, pos: [0, 0, 0], vel: [0, 0, 0] }], particles: d });

    const rmsZ = (pos, n) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += pos[i * 3 + 2] * pos[i * 3 + 2];
      return Math.sqrt(s / n);
    };
    const rmsCyl = (pos, n) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += pos[i * 3] ** 2 + pos[i * 3 + 1] ** 2;
      return Math.sqrt(s / n);
    };
    const z0 = rmsZ(d.pos, d.count), c0 = rmsCyl(d.pos, d.count);
    ok(z0 > 1e-3, `the disc has no vertical extent (rms|z| = ${z0.toExponential(2)}); the check is vacuous`);

    // sample through the run, because a collapse-and-remix returns near the
    // start value and an endpoint-only check would miss it
    let worstZ = 0, worstC = 0;
    for (let k = 0; k < 12; k++) {
      sim.run(0.01, 400);
      worstZ = Math.max(worstZ, Math.abs(rmsZ(sim.pos, d.count) / z0 - 1));
      worstC = Math.max(worstC, Math.abs(rmsCyl(sim.pos, d.count) / c0 - 1));
    }
    below(worstZ, 0.12, 'worst fractional rms|z| excursion over ~48 time units');
    below(worstC, 0.02, 'worst fractional rms cylindrical-radius excursion');
    return `rms|z| ${z0.toFixed(4)} kpc, worst excursion ${(worstZ * 100).toFixed(1)}%; `
         + `cylindrical radius worst ${(worstC * 100).toFixed(2)}%`;
  });

  check('SENSITIVITY: the height check DOES fail on the in-phase initial condition', () => {
    // The superseded construction: every particle at its vertical extremum with
    // no vertical velocity. If this does not collapse, the check above has
    // nothing to catch and the fix was unnecessary.
    const P = composite([plummer(0.35, 0.5), hernquist(0.65, 2.2)]);
    const d = exponentialDisc({ potential: P, count: 4000, scaleLength: 1.6, rMax: 3.2,
      thickness: 0.1, seed: 3 });
    // rebuild the OLD in-phase state: put every particle at |z| = its amplitude
    // with zero vertical velocity, preserving x, y and the in-plane velocity
    const pos = Float64Array.from(d.pos), vel = Float64Array.from(d.vel);
    for (let i = 0; i < d.count; i++) {
      const zi = pos[i * 3 + 2], vzi = vel[i * 3 + 2];
      const r = Math.hypot(pos[i * 3], pos[i * 3 + 1]);
      const om = r > 1e-9 ? P.vcirc(r) / r : 1;
      const amp = Math.hypot(zi, vzi / Math.max(om, 1e-9));
      pos[i * 3 + 2] = amp * (zi >= 0 ? 1 : -1);
      vel[i * 3 + 2] = 0;
    }
    const sim = new RestrictedSim({
      galaxies: [{ mass: 1.0, potential: P, pos: [0, 0, 0], vel: [0, 0, 0] }],
      particles: { count: d.count, pos, vel, radius: d.radius, origin: d.origin } });
    const rmsZ = (p, n) => { let s = 0; for (let i = 0; i < n; i++) s += p[i * 3 + 2] ** 2; return Math.sqrt(s / n); };
    const z0 = rmsZ(pos, d.count);
    let worst = 0;
    for (let k = 0; k < 12; k++) {
      sim.run(0.01, 400);
      worst = Math.max(worst, Math.abs(rmsZ(sim.pos, d.count) / z0 - 1));
    }
    return above(worst, 0.12, 'rms|z| excursion of the SUPERSEDED in-phase disc');
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
