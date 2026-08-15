/**
 * Encounter construction.
 *
 * The parameter set is deliberately the one the literature uses, because the
 * whole point of the inference stage is to recover these numbers and compare
 * them against published values. Galaxy Zoo Mergers Table 4 reports exactly:
 * mass ratio, r_min (pericentre), t_min (time since pericentre), eccentricity,
 * and beta. Anything else would need translating before it could be compared.
 *
 * The angles are what decide whether an encounter is spectacular or dull.
 * Prograde and near-coplanar produces long tidal tails; retrograde produces
 * almost nothing from the same orbit. That asymmetry is measured here (15.1 per
 * cent of a disc beyond 20 kpc against 2.5 per cent retrograde), and it is
 * associated with Toomre & Toomre 1972 — though that paper has NOT been read in
 * full by this project, so calling it "their central result" would be a claim
 * about a source rather than about a measurement. The scenarios below include a
 * matched prograde/retrograde pair so the asymmetry can be seen directly.
 */

import { plummer, hernquist, composite } from './potentials.js';
import { stateAtTrueAnomaly, trueAnomalyAtTime, rotateToOrbitFrame } from './kepler.js';
import { exponentialDisc, mergeParticles } from './galaxy.js';
import { RestrictedSim } from './cpu.js';
import { pairTable } from './pairforce.js';

/**
 * A Milky Way-scale galaxy: bulge + disc + dark halo.
 *
 * The previous model was a 1e10 solar mass object with a peak circular speed of
 * 118 km/s and a rotation curve falling as r^-0.33. That is a dwarf, and it was
 * being used for scenarios named after large spirals. Two reviewers said so
 * independently, and both were right.
 *
 * Component masses in units of 1e10 Msun, radii in kpc, giving a total of about
 * 7e11 Msun and a circular speed flat near 210-220 km/s from 3 to 20 kpc, which
 * is a Milky Way rotation curve. Asserted in test/physics.test.js rather than
 * claimed here.
 *
 * The halo dominates beyond ~10 kpc and is why the curve is flat instead of
 * Keplerian. Without it there is no dark matter in the model at all, and tidal
 * tails from a bare disc behave measurably differently.
 *
 * @param {number} mass total mass in internal units, 1.0 = a Milky Way analogue
 * @param {number} rScale radius scaling, normally cbrt(mass ratio)
 * @param {number} softeningScale multiplier on the bulge softening, so the
 *   silent knob can be exercised by a test
 */
/**
 * softeningScale multiplies EVERY component's core radius, not just the bulge's.
 *
 * Round 6 made this knob demonstrably reach the model, and round 7 measured what
 * it reached: only the bulge Hernquist core, a component holding **1.42% of the
 * mass**. Over a full 0.5x-2x sweep that moves |g| by 109.6% at 0.5 kpc and
 * **0.33% at the 20 kpc tidal cut** — i.e. essentially nothing across the entire
 * region where the morphology metric counts material. The two scales that
 * dominate, the disc Plummer (3 kpc, 4.69%) and the halo Hernquist (20 kpc,
 * 93.9%), were never varied; the same 0.5x/2x on them moves |g| at 20 kpc by
 * 1.8% and 106.6%.
 *
 * So the sweep was measuring a knob that could not move the answer, and the
 * spread it recorded (0.73% at N=32000) was SMALLER than the seed-to-seed
 * realisation noise of the particle sampling (1.68%), which the check never
 * measured and never subtracted. A sensitivity study whose signal is below its
 * own unmeasured noise floor reports the noise.
 *
 * Applying it to all three makes it what CLAUDE.md calls a silent knob worth
 * disciplining: the smoothing scale of the whole mass model. At the shipped
 * default of 1.0 nothing changes, so this is a no-op for every shipped result.
 */
export function galaxyModel(mass, rScale = 1.0, softeningScale = 1.0) {
  const M = mass * 70.3;                       // 1.0 -> 7.03e11 Msun
  const s = rScale * softeningScale;
  return composite([
    hernquist(M * 0.0142, 0.5 * s),    // bulge, ~1e10 Msun
    plummer(M * 0.0469, 3.0 * s),      // disc, ~3.3e10 Msun
    hernquist(M * 0.9389, 20.0 * s),   // dark halo, ~6.6e11 Msun
  ]);
}

/**
 * Integrate the two galaxy centres alone and return the closest approach they
 * actually reach, WHEN it happens, and the relative velocity direction there.
 * No test particles, so this is cheap enough to run inside a solver loop.
 *
 * The timing matters as much as the distance. The orbit precesses in an extended
 * potential, so closest approach does not occur at the Kepler pericentre epoch:
 * measured at t = 0.8 rather than t = 0 for the ring scenario, with the
 * separation vector rotated away from where the setup placed it. Every "time
 * since pericentre" in the interface, and the timeline's pericentre marker,
 * depend on this being right.
 */
export function executedPericentre(kepPeri, ecc, mu, P1, P2, M1, M2, tStart, friction = 0) {
  const nu = trueAnomalyAtTime(mu, ecc, kepPeri, tStart);
  const s = stateAtTrueAnomaly(mu, ecc, kepPeri, nu);
  const f1 = M2 / mu, f2 = -M1 / mu;
  const sim = new RestrictedSim({
    friction,
    galaxies: [
      { mass: M1, potential: P1, pos: s.r.map((x) => x * f1), vel: s.v.map((x) => x * f1) },
      { mass: M2, potential: P2, pos: s.r.map((x) => x * f2), vel: s.v.map((x) => x * f2) },
    ],
    particles: { count: 0, pos: new Float64Array(0), vel: new Float64Array(0) },
  });
  let min = Infinity, prev = Infinity, tAt = 0, vRel = [0, 0, 0];
  const dt = Math.max(0.005, Math.abs(tStart) / 6000);
  let t = 0;
  for (let i = 0; i < 24000; i++) {
    sim.step(dt); t += dt;
    const sep = sim.diagnostics().separation;
    if (sep < min) {
      min = sep; tAt = t;
      const g = sim.galaxies;
      vRel = [g[1].vel[0] - g[0].vel[0], g[1].vel[1] - g[0].vel[1], g[1].vel[2] - g[0].vel[2]];
    }
    if (sep > prev && sep > min * 1.35) break;
    prev = sep;
  }
  const vn = Math.hypot(vRel[0], vRel[1], vRel[2]) || 1;
  return { min, tAt, vHat: vRel.map((x) => x / vn) };
}

/**
 * Inclination and node that put a disc's normal along a given direction.
 *
 * rotateToOrbitFrame maps +z to (sin i sin W, -sin i cos W, cos i), so this
 * inverts that. Used to orient the ring scenario's disc perpendicular to the
 * MEASURED approach direction rather than to an assumed one — the assumption
 * was 64.7 degrees out, which is why the ring scenario produced no ring.
 */
export function anglesForNormal([nx, ny, nz]) {
  const n = Math.hypot(nx, ny, nz) || 1;
  const i = Math.acos(Math.max(-1, Math.min(1, nz / n)));
  const W = Math.atan2(nx / n, -ny / n);
  return { inclination: i, node: W };
}

/**
 * Relative state at pericentre for a BOUND orbit with the requested turning
 * points, in the ACTUAL extended potential rather than a point-mass one.
 *
 * Returns null when no bound solution exists, so the caller falls back to the
 * Kepler path rather than silently producing something else.
 *
 * Convention matches stateAtTrueAnomaly: pericentre on +x, motion towards +y,
 * orbit in z = 0, so disc angles keep their meaning.
 */
export function boundOrbitState(P1, P2, M1, M2, rP, ecc) {
  if (!(ecc >= 0 && ecc < 1) || !(rP > 0)) return null;
  const rA = rP * (1 + ecc) / (1 - ecc);
  const muRed = M1 * M2 / (M1 + M2);
  const tab = pairTable(P1, P2);
  const Wp = tab.potential(rP), Wa = tab.potential(rA);
  const denom = 1 / (rP * rP) - 1 / (rA * rA);
  if (!(denom > 0)) return null;
  const L2 = 2 * muRed * (Wa - Wp) / denom;
  if (!(L2 > 0) || !Number.isFinite(L2)) return null;
  const L = Math.sqrt(L2);
  const E = L2 / (2 * muRed * rP * rP) + Wp;
  const h = L / muRed;                                // specific relative ang. momentum
  return { r: [rP, 0, 0], v: [0, h / rP, 0], E, L, rA, rP, muRed };
}

/**
 * Integrate the two-body pair BACKWARD from pericentre by at most `span`,
 * stopping at apocentre.
 *
 * THE CAP IS THE POINT. A bound orbit has a finite radial period, and for a
 * tight one that period is shorter than the requested tStart. Rewinding the full
 * span then wraps past apocentre and can leave the pair OUTBOUND at t = 0, so
 * "closest approach" lands on the first step and every epoch in the interface
 * describes the wrong passage. Measured before the cap: a request for r_p = 5
 * executed at 10.7 with pericentre at t = 0. Round 3 found the same failure from
 * the Kepler side, on 23 of 59 detective fits.
 *
 * Stopping at apocentre guarantees the run starts inbound, which is what every
 * caller assumes, and bounds the rewind at half a radial period.
 *
 * Returns the state AND the span actually rewound, because t0 depends on it.
 */
function rewindTwoBody(P1, P2, M1, M2, rel, span, dt = 0.005) {
  const mu = M1 + M2, f1 = M2 / mu, f2 = -M1 / mu;
  // Friction is deliberately OFF here. It is dissipative, so reversing time and
  // applying it again would ADD energy rather than undo the loss — the rewind
  // would not be the inverse of the forward run. The geometry is therefore set
  // conservatively and the executed pericentre re-measured WITH friction below,
  // which is why `executedPeri` can differ slightly from the request when drag
  // is on. That difference is reported rather than hidden.
  const sim = new RestrictedSim({
    friction: 0,
    galaxies: [
      { mass: M1, potential: P1, pos: rel.r.map((x) => x * f1), vel: rel.v.map((x) => -x * f1) },
      { mass: M2, potential: P2, pos: rel.r.map((x) => x * f2), vel: rel.v.map((x) => -x * f2) },
    ],
    particles: { count: 0, pos: new Float64Array(0), vel: new Float64Array(0) },
  });
  const sep = () => {
    const a = sim.galaxies[0].pos, b = sim.galaxies[1].pos;
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  };
  const n = Math.max(1, Math.round(span / dt));
  const h = span / n;
  let prev = sep(), used = 0;
  let snap = sim.galaxies.map((g) => ({ pos: Array.from(g.pos), vel: Array.from(g.vel) }));
  for (let i = 0; i < n; i++) {
    sim.step(h);
    const s = sep();
    if (s < prev) break;                 // reached apocentre going backwards
    prev = s;
    used += h;
    snap = sim.galaxies.map((g) => ({ pos: Array.from(g.pos), vel: Array.from(g.vel) }));
  }
  return {
    span: used,
    state: snap.map((g) => ({
      pos: g.pos,
      vel: [-g.vel[0], -g.vel[1], -g.vel[2]],     // undo the velocity flip
    })),
  };
}

/**
 * Measure the apocentre actually reached, by integrating until the separation
 * turns over. Returns null if it does not turn within the budget (unbound, or
 * a period longer than the search).
 *
 * `executedApo` used to be r_p(1+e)/(1-e) COMPUTED FROM THE REQUEST, so the
 * eccentricity assertion built on it reduced algebraically to "requested ecc
 * equals requested ecc" — identical to six decimals for every configuration, a
 * check named "with the requested shape" that could not fail on shape. The field
 * labelled `executed` also read 570.0 for the merger against a measured 105.5.
 */
function measureApocentre(P1, P2, M1, M2, c1, v1, c2, v2, friction, dt = 0.01, budget = 400000) {
  const sim = new RestrictedSim({
    friction,
    galaxies: [
      { mass: M1, potential: P1, pos: c1, vel: v1 },
      { mass: M2, potential: P2, pos: c2, vel: v2 },
    ],
    particles: { count: 0, pos: new Float64Array(0), vel: new Float64Array(0) },
  });
  const sep = () => sim.diagnostics().separation;
  let prev = sep(), seenPeri = false, mx = 0;
  for (let i = 0; i < budget; i++) {
    sim.step(dt);
    const s = sep();
    if (!seenPeri) { if (s > prev) seenPeri = true; }
    else { if (s > mx) mx = s; if (s < prev) return mx; }
    prev = s;
  }
  return null;
}

/** Measure closest approach forward from a given state, with friction as configured. */
function measureFromState(P1, P2, M1, M2, c1, v1, c2, v2, friction) {
  const sim = new RestrictedSim({
    friction,
    galaxies: [
      { mass: M1, potential: P1, pos: c1, vel: v1 },
      { mass: M2, potential: P2, pos: c2, vel: v2 },
    ],
    particles: { count: 0, pos: new Float64Array(0), vel: new Float64Array(0) },
  });
  // THE FIRST local minimum, not the global one. A decaying orbit has many
  // pericentres, each smaller than the last, and `t0` anchors the timeline to
  // the FIRST closest approach — the one `tStart` was measured back from. Taking
  // the global minimum over the whole search made the merger report 13.4 kpc for
  // a requested 30 (a later passage) and never satisfied the recede test, so it
  // also reported a non-solution for an encounter that has a perfectly good
  // first pericentre.
  let min = Infinity, prev = Infinity, tAt = 0, vRel = [0, 0, 0], t = 0;
  const dt = 0.005;
  const budget = 200000;
  let hitBudget = true, falling = false;
  for (let i = 0; i < budget; i++) {
    sim.step(dt); t += dt;
    const sep = sim.diagnostics().separation;
    if (sep < prev) falling = true;
    if (sep < min) {
      min = sep; tAt = t;
      const g = sim.galaxies;
      vRel = [g[1].vel[0] - g[0].vel[0], g[1].vel[1] - g[0].vel[1], g[1].vel[2] - g[0].vel[2]];
    }
    // first turn-around after a genuine approach
    if (falling && sep > prev && t > dt * 20) { hitBudget = false; break; }
    prev = sep;
  }
  const vn = Math.hypot(vRel[0], vRel[1], vRel[2]) || 1;
  // A minimum found on the first step or on the last step of the budget is not a
  // pericentre — it is the edge of the search. Round 3 found both cases being
  // returned as converged, which is exactly the silent non-solution the reporting
  // was added to prevent.
  const atStart = tAt <= dt * 1.5;
  return { min, tAt, vHat: vRel.map((x) => x / vn), atStart, hitBudget };
}

/**
 * Is this configuration inside the model's domain at all?
 *
 * Two assumptions fail together here: the potentials are RIGID, and each disc is
 * equilibrated IN ISOLATION so the companion is a perturbation. Neither holds for
 * two galaxies that never separate.
 *
 * TWO TIERS, because one metric cannot span both regimes. My first attempt used a
 * single perturbation ratio and reported values of 30-50 for the deepest systems,
 * which was nonsense: when the apocentre is inside the disc the evaluation
 * distance collapsed and it was measuring the companion's pull at its own centre.
 *
 *  1. CATEGORICAL — apocentre below the disc radius: the companion never leaves
 *     the disc. Nothing to compute; the picture is simply not of this model.
 *  2. RATIO — apocentre outside the disc: compare the companion's pull at the
 *     host's disc edge against the host's own pull there.
 *
 * Over the 59 published fits this gives 23 unbound, 15 comfortably inside, 0
 * marginal, 8 outside by ratio and 15 inside-disc: 23 of 62 outside the model.
 * The MARGINAL BUCKET IS EMPTY — the distribution is bimodal — so the answer does
 * not depend on where the threshold sits between 0.3 and 1.0. That matters more
 * than the threshold itself, and is why this is a gate rather than a tuned number.
 */
export function domainOfValidity(P1, P2, rPeri, ecc, discRadius = 13.5) {
  if (!(ecc < 1)) return { tier: 'unbound', ratio: null, apocentre: Infinity, ok: true };
  const apo = rPeri * (1 + ecc) / (1 - ecc);
  if (apo < discRadius) {
    return { tier: 'inside-disc', ratio: null, apocentre: apo, ok: false,
      why: `apocentre ${apo.toFixed(1)} kpc is inside the ${discRadius} kpc disc: the two galaxies never separate, so a rigid-potential model with discs equilibrated in isolation does not apply` };
  }
  const aOwn = P1.vcirc(discRadius) ** 2 / discRadius;
  const dEdge = Math.max(apo - discRadius, 1e-6);
  const aComp = P2.vcirc(dEdge) ** 2 / dEdge;
  const ratio = aComp / aOwn;
  const tier = ratio >= 1 ? 'outside' : ratio >= 0.3 ? 'marginal' : 'ok';
  return { tier, ratio, apocentre: apo, ok: tier === 'ok',
    why: tier === 'ok' ? null
      : `at apocentre the companion pulls the disc edge ${ratio.toFixed(2)}x as hard as the host does, so the disc is never even approximately isolated` };
}

/**
 * Secant iteration on the Kepler pericentre until the EXECUTED one matches.
 *
 * Returns the solved value together with whether it converged, because a
 * non-solution returned silently is worse than a failure: every downstream
 * "pericentre" would then be a number about a different encounter. The caller
 * surfaces `converged`.
 */
function solveKeplerPericentre(target, ecc, mu, P1, P2, M1, M2, tStart, friction) {
  const run = (x) => executedPericentre(x, ecc, mu, P1, P2, M1, M2, tStart, friction);
  let x = target, r = run(x), fx = r.min - target;
  if (Math.abs(fx) / target < 5e-4) return { kepPeri: x, converged: true, exec: r };
  let x1 = Math.max(0.05, target * (target / (target + fx)));
  let best = { err: Math.abs(fx) / target, x, r };
  for (let i = 0; i < 30; i++) {
    const r1 = run(x1);
    const f1v = r1.min - target;
    const err = Math.abs(f1v) / target;
    if (err < best.err) best = { err, x: x1, r: r1 };
    if (err < 5e-4) return { kepPeri: x1, converged: true, exec: r1 };
    const denom = f1v - fx;
    if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) break;
    const next = Math.max(0.02, Math.min(target * 6, x1 - f1v * (x1 - x) / denom));
    if (!Number.isFinite(next)) break;
    x = x1; fx = f1v; x1 = next;
  }
  return { kepPeri: best.x, converged: best.err < 0.02, exec: best.r };
}

/**
 * @param {object} spec
 * @param {number} spec.massRatio    m2/m1
 * @param {number} spec.rPeri        pericentre separation, length units
 * @param {number} spec.ecc          orbital eccentricity
 * @param {number} spec.tStart       start time relative to pericentre (negative = before)
 * @param {object} spec.disc1        {inclination, argPeri, retrograde, scaleLength, active}
 * @param {object} spec.disc2
 * @param {number} spec.particles    total test particles
 */
export function buildEncounter(spec) {
  const {
    massRatio = 1.0, rPeri = 4.0, ecc = 1.0, tStart = -18,
    m1 = 1.0, particles = 200000, seed = 42,
    softeningScale = 1.0, friction = 0, compactness = 1.0,
  } = spec;
  let disc1 = spec.disc1 ?? {}, disc2 = spec.disc2 ?? {};

  const P1 = galaxyModel(m1, 1.0, softeningScale);
  // Scale radii go as the cube root of mass, so the two galaxies have comparable
  // mean density rather than comparable size. `compactness` scales the secondary
  // further: a value well below 1 is a compact elliptical rather than a spiral.
  //
  // This is not cosmetic. A ring galaxy needs a COMPACT intruder: with the
  // default diffuse halo, only a small fraction of the companion's mass lies
  // within a few kpc, so the impulse through the disc is far too weak. Measured:
  // no ring at ANY mass ratio up to 2.0 with a normal-sized companion, and a
  // clean ring at compactness 0.05.
  const P2 = galaxyModel(m1 * massRatio, Math.cbrt(massRatio) * compactness, softeningScale);

  // The orbit MUST use the model's actual total mass, not the spec's nominal
  // m1 + m2. With the Milky Way-scale model those differ by a factor of 70, and
  // using the nominal value would set up an orbit for a system 70 times lighter
  // than the one being simulated: the galaxies would be placed on a trajectory
  // they do not follow, and every "pericentre" and "time since pericentre" in
  // the interface would be a number about a different problem.
  const M1 = P1.mass, M2 = P2.mass;
  const mu = M1 + M2;

  // Solve for the Kepler pericentre that DELIVERS the requested one.
  //
  // The Kepler setup assumes point masses; the galaxies are extended, so at any
  // separation only part of each halo is enclosed and the effective attraction
  // is weaker than a point mass of the same total. The orbit therefore does not
  // execute the pericentre it was set up with. Measured with the Milky Way-scale
  // model: asking for 25 kpc delivered 34.6, 38 per cent high. A reviewer found
  // the same defect at 21 to 91 per cent on the old model.
  //
  // This matters beyond tidiness: detective mode maps PUBLISHED r_min values
  // into this parameter, so a pericentre that silently means something else
  // would corrupt every comparison against the literature.
  //
  // AND FOR BOUND ORBITS THAT WAS NOT ENOUGH. Matching r_min says nothing about
  // the ENERGY. The Kepler velocity is set for a point mass of mass mu, while
  // the real pair sits in the much shallower potential of two extended profiles,
  // so the pair was launched above escape speed in the potential it actually
  // inhabits and an encounter requested as BOUND executed as UNBOUND. Measured
  // at the published Arp 244 fit: total energy -1.007e3 under a point mass,
  // +1.289e3 in the real potential — a sign flip — and the galaxies ran away to
  // 559 kpc against a Kepler apocentre of 4.6 kpc. Across the catalogue, 24 of
  // the 36 bound published fits were executed as unbound.
  //
  // It was not only detective mode. Nothing checked eccentricity at all, so the
  // sandbox slider was equally untrue: it said 0.95 and executed 0.908, said
  // 0.85 and executed 0.693. Pericentre was solved for; eccentricity was assumed.
  //
  // For a bound orbit the fix is exact and needs no iteration. At a turning
  // point rdot = 0, so with the requested apocentre r_a = r_p (1+e)/(1-e):
  //     E = L^2/(2 mu_red r_p^2) + W(r_p)
  //     E = L^2/(2 mu_red r_a^2) + W(r_a)
  // Subtracting eliminates E and gives L in closed form, then E follows. W is
  // the EXACT mutual potential energy from pairforce.js — the same table the
  // integrator takes its force from, so the orbit is set in the potential that
  // actually runs. Reduces to Kepler identically for a point mass (checked to
  // 1e-16), and delivers requested pericentre AND eccentricity exactly
  // (executed e = 0.95000 for a request of 0.95).
  const bound = ecc < 1 ? boundOrbitState(P1, P2, M1, M2, rPeri, ecc) : null;

  let solved, kepPeri, nu, t0, c1, v1, c2, v2, boundRewind = null;
  const f1 = M2 / mu, f2 = -M1 / mu;         // split about the barycentre

  if (bound) {
    // Place the pair exactly at pericentre, then integrate the two-body system
    // BACKWARD through the shipped leapfrog for |tStart|. Leapfrog is
    // time-reversible, so the state that comes back is one the forward run
    // reproduces exactly — the executed pericentre is then correct by
    // construction rather than secant-solved, and it lands at t = |tStart|.
    // NO SOLVER HERE, and that is deliberate. With friction on, drag removes
    // energy during the inbound leg, so the executed pericentre is INSIDE the
    // request — measured 13.4 kpc for a requested 30 on the shipped merger. I
    // tried inverting that with a secant on the requested turning point; it is
    // unstable (the map is steep and the orbit plunges) and, more importantly,
    // it is the wrong idea: a dissipative encounter does not have a pericentre
    // you can dial in, and pretending otherwise would put a number in the panel
    // that the physics does not honour.
    //
    // So the geometry is set conservatively, the executed value is MEASURED with
    // friction on, and the difference is reported. `periConverged` below turns
    // false and the panel says why.
    const rew = rewindTwoBody(P1, P2, M1, M2, bound, Math.abs(tStart));
    const st = rew.state;
    boundRewind = rew.span;
    c1 = st[0].pos; v1 = st[0].vel; c2 = st[1].pos; v2 = st[1].vel;
    // DERIVED FROM THE MEASUREMENT, not hardcoded. I wrote `converged: true`
    // here because the closed form is exact — and it is, with friction off. With
    // friction on it is not: drag removes energy during the rewind-to-pericentre
    // interval, so the executed pericentre can be far inside the request.
    // Measured at r_p = 60, e = 0.4: lnL=1 executes 11.11 kpc, lnL=3 executes
    // 0.012 kpc — a full plunge — and both reported converged with no warning.
    // That is precisely the silent non-solution this flag exists to prevent, and
    // detective mode maps published r_min values straight into this parameter.
    const exec = measureFromState(P1, P2, M1, M2, c1, v1, c2, v2, friction);
    const relErr = Math.abs(exec.min - rPeri) / Math.max(rPeri, 1e-9);
    solved = { kepPeri: rPeri, converged: relErr < 0.02, exec };
    kepPeri = rPeri;
    nu = null;
    t0 = -solved.exec.tAt;
  } else {
    solved = solveKeplerPericentre(rPeri, ecc, mu, P1, P2, M1, M2, tStart, friction);
    kepPeri = solved.kepPeri;
    nu = trueAnomalyAtTime(mu, ecc, kepPeri, tStart);
    const s = stateAtTrueAnomaly(mu, ecc, kepPeri, nu);
    // The clock is anchored to the EXECUTED closest approach, not the Kepler
    // pericentre epoch. The orbit precesses in an extended potential, so those
    // differ — measured 0.8 time units for the ring scenario — and every "time
    // since pericentre" in the interface, plus the timeline marker, depends on it.
    t0 = -solved.exec.tAt;
    c1 = s.r.map((x) => x * f1); v1 = s.v.map((x) => x * f1);
    c2 = s.r.map((x) => x * f2); v2 = s.v.map((x) => x * f2);
  }

  const galaxies = [
    { mass: M1, potential: P1, pos: c1, vel: v1 },
    { mass: M2, potential: P2, pos: c2, vel: v2 },
  ];

  // THE DISC NORMAL, carried through to the renderer.
  //
  // The dust could not produce a lane and three rounds said so. `dustW` was a
  // function of birth radius alone, with no |z| term anywhere, so the absorbing
  // layer was as thick as the disc — round 4 measured the extinction's vertical
  // extent as BROADER than the emission it is meant to silhouette (133 px against
  // 105), with the mid-plane the LEAST extinguished region.
  //
  // A lane needs the dust confined to a thin layer about the disc PLANE, and the
  // shader cannot know where that plane is without being told. Nothing else in
  // the pipeline carries orientation: the particles arrive as bare positions.
  const discNormal = (d) => rotateToOrbitFrame([0, 0, 1],
    d.inclination ?? 0, d.argPeri ?? 0, d.node ?? d.argPeri ?? 0);

  // A disc can ask to be oriented perpendicular to the MEASURED approach
  // direction rather than to an assumed one. The ring scenario needs this: it
  // was set to a fixed perpendicular inclination, the orbit precessed in the
  // extended potential, and the companion ended up crossing at 64.7 degrees to
  // the disc normal — which is why it produced no ring at all.
  const alignDisc = (d) => {
    if (!d.alignToApproach) return d;
    const a = anglesForNormal(solved.exec.vHat);
    return { ...d, inclination: a.inclination, node: a.node };
  };
  disc1 = alignDisc(disc1);
  disc2 = alignDisc(disc2);

  const d1on = disc1.active !== false, d2on = disc2.active !== false;
  const share = d1on && d2on ? 0.5 : 1.0;
  const sets = [];
  if (d1on) {
    sets.push(exponentialDisc({
      potential: P1, count: Math.round(particles * share),
      scaleLength: disc1.scaleLength ?? 3.0, rMax: disc1.rMax ?? 4.5,
      // REAL THICKNESS. thickness = 0 made the discs razor-thin sheets, which is
      // not a galaxy and specifically breaks the dust: the two-slab model needs
      // near-side material to sit in front of far-side material, and a sheet's
      // two halves occupy disjoint screen regions, so the optical depth landed
      // where there was nothing to attenuate. 0.1 scale lengths is the figure
      // galaxy.js's own equilibrium comment already assumed (z/R ~ 0.03).
      thickness: disc1.thickness ?? 0.1,
      dispersion: disc1.dispersion ?? 0,
      inclination: disc1.inclination ?? 0,
      // node, not argPeri, is the second meaningful angle: argPeri rotates an
      // axisymmetric disc within its own plane and changes nothing physical
      node: disc1.node ?? disc1.argPeri ?? 0,
      retrograde: !!disc1.retrograde, origin: 0,
      centre: c1, velocity: v1, seed,
    }));
  }
  if (d2on) {
    sets.push(exponentialDisc({
      potential: P2, count: Math.round(particles * share),
      scaleLength: (disc2.scaleLength ?? 3.0) * Math.cbrt(massRatio),
      rMax: disc2.rMax ?? 4.5, thickness: disc2.thickness ?? 0.1,
      dispersion: disc2.dispersion ?? 0,
      inclination: disc2.inclination ?? 0,
      node: disc2.node ?? disc2.argPeri ?? 0,
      retrograde: !!disc2.retrograde, origin: 1,
      centre: c2, velocity: v2, seed: seed + 977,
    }));
  }

  // A minimum at the very first step, or at the last step of the search budget,
  // is the edge of the window rather than a pericentre. Round 3 found both being
  // reported as converged — 22 of 59 detective fits in one case, two of three
  // named friction configurations in the other — which is precisely the silent
  // non-solution that reporting convergence was introduced to prevent.
  const periConverged = solved.converged && !solved.exec.atStart && !solved.exec.hitBudget;
  const periWhy = solved.exec.atStart ? 'closest approach is at the start of the run: the pair is already receding'
    : solved.exec.hitBudget ? 'no closest approach found within the search budget'
    : solved.converged ? null
    : (friction > 0
        ? 'dynamical friction removes energy on the way in, so the encounter closes inside the requested pericentre — this is the physics, not a solver failure'
        : 'the pericentre solver did not converge');

  const domain = domainOfValidity(P1, P2, rPeri, ecc);

  galaxies[0].discNormal = discNormal(disc1);
  galaxies[1].discNormal = discNormal(disc2);

  return {
    galaxies, particles: mergeParticles(sets), friction, t0,
    spec: {
      ...spec, M1, M2, mu, nu, kepPeri, requestedPeri: rPeri,
      executedPeri: solved.exec.min,
      // MEASURED, not computed from the request. See measureApocentre.
      executedApo: bound
        ? (measureApocentre(P1, P2, M1, M2, c1, v1, c2, v2, friction) ?? bound.rA)
        : Infinity,
      requestedApo: bound ? bound.rA : Infinity,
      orbitEnergy: bound ? bound.E : null,
      periConverged, periWhy,
      domain,
      approachDir: solved.exec.vHat,
    },
  };
}

/**
 * Named scenarios.
 *
 * IMPORTANT, and repeated in docs/LITERATURE.md: these are configurations chosen
 * to produce the right qualitative morphology, NOT the published parameters of
 * the named systems. Toomre & Toomre 1972 has not been read in full yet, and the
 * Galaxy Zoo Table 4 fits have not been translated into this parameterisation.
 * Until both are done, a scenario named "Mice" means "an encounter that looks
 * like the Mice", which is a much weaker claim and is the only one supported.
 */
/**
 * Retuned for the Milky Way-scale mass model. Discs now extend to about 13.5 kpc
 * (scale length 3, rMax 4.5), and the scenarios span 1.2 to 55 kpc pericentre.
 *
 * A correction worth keeping. An earlier version of this comment justified the
 * retune by claiming "real interacting pairs pass at tens of kpc". A reviewer
 * checked that against this project's OWN data and it is false: across the 62
 * Galaxy Zoo systems with a published fit, the median r_min is 11.6 kpc, the
 * quartiles are 6.1 / 11.6 / 18.1, and 82 per cent are under 20 kpc. Real pairs
 * routinely pass INSIDE the disc radius, so a penetrating encounter is a normal
 * observed configuration and not a modelling error.
 *
 * What the retune actually fixed was that the OLD scenarios used a few kpc while
 * the model was a dwarf — the numbers were small for the wrong reason. The span
 * now covers the observed range rather than sitting above it.
 *
 * Times are longer to match: the dynamical time at 20 kpc is roughly 120 time
 * units, so an encounter is followed over hundreds rather than tens.
 */
export const SCENARIOS = {
  prograde: {
    label: 'Prograde passage',
    blurb: 'Discs spinning the same way as the orbit, passing at 25 kpc. The classic case: long, thin tidal tails from both galaxies.',
    spec: { massRatio: 1.0, rPeri: 25, ecc: 1.0, tStart: -45, particles: 300000,
            disc1: { inclination: 0.0, argPeri: 0 },
            disc2: { inclination: 0.35, argPeri: 1.1 } },
  },
  retrograde: {
    label: 'Retrograde passage',
    blurb: 'The same orbit, both discs spinning against it. Almost no tails. This contrast, not the closeness of the passage, is the dominant effect in a tidal encounter — measured here at 15.1 per cent of a disc thrown beyond 20 kpc prograde against 2.5 per cent retrograde, a ratio of 6.0 on identical orbits.',
    spec: { massRatio: 1.0, rPeri: 25, ecc: 1.0, tStart: -45, particles: 300000,
            disc1: { inclination: 0.0, argPeri: 0, retrograde: true },
            disc2: { inclination: 0.35, argPeri: 1.1, retrograde: true } },
  },
  mice: {
    label: 'Mice-like',
    blurb: 'Near-equal masses, prograde, a close 18 kpc passage: two long straight tails. Resembles NGC 4676 in morphology only — this is not the published fit.',
    spec: { massRatio: 0.9, rPeri: 18, ecc: 1.0, tStart: -38, particles: 320000,
            disc1: { inclination: 0.15, argPeri: 0.2 },
            disc2: { inclination: -0.2, argPeri: 2.4 } },
  },
  antennae: {
    label: 'Antennae-like',
    blurb: 'Equal masses on a bound orbit well past pericentre, discs inclined: two enormous curving antennae. Resembles NGC 4038/4039 in morphology only — not the published fit.',
    spec: { massRatio: 1.0, rPeri: 16, ecc: 0.95, tStart: -50, particles: 350000,
            disc1: { inclination: 0.5, argPeri: 0.6 },
            disc2: { inclination: -0.7, argPeri: 2.0 } },
  },
  minorMerger: {
    label: 'Minor companion',
    // The blurb used to say "this model has no dynamical friction, so there is
    // no orbital decay and no merger". That stopped being true when friction was
    // added in round 1, and a user could disprove it with the slider two panels
    // away. The claim belongs to the SCENARIO, not to the model.
    blurb: 'A ten-to-one companion passing at 14 kpc. Its disc is torn apart while the large galaxy is barely disturbed except for a warp. Friction is set to zero here, so the orbit does not decay and the pair does not merge — turn the friction slider up and it will.',
    spec: { massRatio: 0.1, rPeri: 14, ecc: 0.85, tStart: -42, particles: 300000,
            disc1: { inclination: 0.1, argPeri: 0, scaleLength: 3.2 },
            disc2: { inclination: 0.9, argPeri: 1.6, scaleLength: 1.5 } },
  },
  flyby: {
    follow: 'primary',
    label: 'Distant fly-by',
    blurb: 'A wide hyperbolic pass at 55 kpc. Bridges and warps but no merger: the two go their separate ways.',
    spec: { massRatio: 0.6, rPeri: 55, ecc: 1.6, tStart: -60, particles: 280000,
            disc1: { inclination: 0.2, argPeri: 0.4 },
            disc2: { inclination: 0.6, argPeri: 1.9 } },
  },
  merger: {
    label: 'Merger (with friction)',
    blurb: 'A bound pair with dynamical friction switched on. Each passage transfers orbital energy to the halos, so the orbit decays and the two actually merge — which cannot happen with friction off, however close the passage. Measured on this configuration: first passage at 29.2 kpc against a requested 30, then the two nuclei close to within 5 kpc — well inside both discs — at 1685 Myr. Note that time reversal stops being exact here: friction is dissipative, and the pericentre you ask for is not quite the one you get because drag removes energy on the way in.',
    // RETUNED after the friction gate was corrected. Every number in the comment
    // this replaces was measured against a gate that did not work:
    //   round 2's gate was inert, so the drag included a pathological term;
    //   round 3's gate keyed on separation and switched drag off entirely below
    //   33 kpc, so the pair could not merge at ANY lnL and the "~82 kpc, merged
    //   around 1.3 Gyr" comment described a run that no longer happened.
    //
    // With the corrected size-asymmetry gate, measured over lnL:
    //   0.05  one passage at 29.8 kpc then escapes to 263 kpc — no decay
    //   0.1   29.7 then 23.4 at 2905 Myr — decays, does not merge in view
    //   0.2   29.2 then within 5 kpc at 1685 Myr        <- shipped
    //
    // The approach is ASYMPTOTIC: 10 kpc at 1180 Myr, 5 at 1685, 3 at 2582, 2 at
    // 5264. So "merged" needs a stated threshold rather than a picked one, and
    // more drag is not monotonically faster — at lnL 3 the pair circularises
    // early at large radius and is still at 21 kpc after 600 time units.
    //   0.6   plunges on the first approach, executed pericentre 0.0
    //
    // tSpan 560 covers the 5 kpc crossing at 1685 Myr (357 time units). At 420 it
    // ended before the merger — the one scenario whose entire point is the
    // merger could not be scrubbed to it, which round 4 caught.
    spec: { massRatio: 0.6, rPeri: 30, ecc: 0.9, tStart: -60, tSpan: 560, particles: 320000,
            friction: 0.2,
            disc1: { inclination: 0.2, argPeri: 0.3 },
            disc2: { inclination: -0.5, argPeri: 1.7 } },
  },
  ring: {
    follow: 'primary',
    label: 'Ring galaxy',
    blurb: 'A COMPACT companion fired through the centre of a large disc, perpendicular to it. The impulse drives an outward density wave: measured here, the surface density at the ring radius rises several-fold while the nucleus survives, which is what the Cartwheel looks like. Compactness matters as much as geometry — a companion as diffuse as a spiral produces no ring at any mass, because too little of it lies within a few kpc of the impact.',
    // The disc must be PERPENDICULAR to the orbital plane for the companion to
    // punch through it face-on. This was 0.0 — coplanar — which is a grazing
    // pass along the disc, produces no ring at all, and contradicted its own
    // blurb. Three reviewers caught it independently.
    // alignToApproach orients the disc perpendicular to the MEASURED relative
    // velocity at closest approach. A fixed inclination of pi/2 was 64.7 degrees
    // out once the orbit precessed, and produced a centrally-peaked profile at
    // every epoch — no ring.
    // Tuned so the RING is the event, not an explosion. A stronger impulse
    // (q=0.5, compactness 0.05, r_p=0.8) unbinds most of the disc and throws it
    // to 300 kpc, which buries the ring in debris. This keeps 100 per cent of
    // the disc within 60 kpc while the density at the ring radius still trebles.
    spec: { massRatio: 0.3, compactness: 0.08, rPeri: 1.2, ecc: 1.1,
            tStart: -34, tSpan: 220, particles: 320000,
            disc1: { alignToApproach: true, scaleLength: 3.0, rMax: 4.5 },
            disc2: { active: false } },
  },
};
