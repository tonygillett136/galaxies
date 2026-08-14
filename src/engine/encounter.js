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
 * almost nothing from the same orbit. That asymmetry is measured here (4.7 per
 * cent of a disc beyond 20 kpc against zero of 60,000 particles), and it is
 * associated with Toomre & Toomre 1972 — though that paper has NOT been read in
 * full by this project, so calling it "their central result" would be a claim
 * about a source rather than about a measurement. The scenarios below include a
 * matched prograde/retrograde pair so the asymmetry can be seen directly.
 */

import { plummer, hernquist, composite } from './potentials.js';
import { stateAtTrueAnomaly, trueAnomalyAtTime } from './kepler.js';
import { exponentialDisc, mergeParticles } from './galaxy.js';
import { RestrictedSim } from './cpu.js';

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
export function galaxyModel(mass, rScale = 1.0, softeningScale = 1.0) {
  const M = mass * 70.3;                       // 1.0 -> 7.03e11 Msun
  return composite([
    hernquist(M * 0.0142, 0.5 * rScale * softeningScale),  // bulge, ~1e10 Msun
    plummer(M * 0.0469, 3.0 * rScale),                     // disc, ~3.3e10 Msun
    hernquist(M * 0.9389, 20.0 * rScale),                  // dark halo, ~6.6e11 Msun
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
  const solved = solveKeplerPericentre(rPeri, ecc, mu, P1, P2, M1, M2, tStart, friction);
  const kepPeri = solved.kepPeri;
  const nu = trueAnomalyAtTime(mu, ecc, kepPeri, tStart);
  const s = stateAtTrueAnomaly(mu, ecc, kepPeri, nu);
  // The clock is anchored to the EXECUTED closest approach, not the Kepler
  // pericentre epoch. The orbit precesses in an extended potential, so those
  // differ — measured 0.8 time units for the ring scenario — and every "time
  // since pericentre" in the interface, plus the timeline marker, depends on it.
  const t0 = -solved.exec.tAt;
  const f1 = M2 / mu, f2 = -M1 / mu;         // split about the barycentre

  const c1 = s.r.map((x) => x * f1), v1 = s.v.map((x) => x * f1);
  const c2 = s.r.map((x) => x * f2), v2 = s.v.map((x) => x * f2);

  const galaxies = [
    { mass: M1, potential: P1, pos: c1, vel: v1 },
    { mass: M2, potential: P2, pos: c2, vel: v2 },
  ];

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
      thickness: disc1.thickness ?? 0,
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
      rMax: disc2.rMax ?? 4.5, thickness: disc2.thickness ?? 0,
      inclination: disc2.inclination ?? 0,
      node: disc2.node ?? disc2.argPeri ?? 0,
      retrograde: !!disc2.retrograde, origin: 1,
      centre: c2, velocity: v2, seed: seed + 977,
    }));
  }

  return {
    galaxies, particles: mergeParticles(sets), friction, t0,
    spec: {
      ...spec, M1, M2, mu, nu, kepPeri, requestedPeri: rPeri,
      executedPeri: solved.exec.min,
      periConverged: solved.converged,
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
 * checked that against this project's OWN data and it is false: across the 59
 * Galaxy Zoo systems with a published fit, the median r_min is 12.1 kpc, the
 * quartiles are 6.4 / 12.1 / 18.6, and 81 per cent are under 20 kpc. Real pairs
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
    blurb: 'The same orbit, both discs spinning against it. Almost no tails. This contrast, not the closeness of the passage, is the dominant effect in a tidal encounter — measured here at 4.7 per cent of a disc thrown beyond 20 kpc prograde against zero of 60,000 particles retrograde.',
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
    blurb: 'A ten-to-one companion passing at 14 kpc. Its disc is torn apart while the large galaxy is barely disturbed except for a warp. Note the companion does NOT spiral in: this model has no dynamical friction, so there is no orbital decay and no merger.',
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
    blurb: 'A bound pair with dynamical friction switched on. Each passage transfers orbital energy to the halos, so the orbit decays and the two actually merge — which cannot happen with friction off, however close the passage. Note that time reversal stops being exact here: friction is dissipative.',
    // lnL tuned to a realistic decay: out to ~82 kpc after first passage, back
    // in and merged around 1.3 Gyr, which is the right timescale for a major
    // merger. lnL = 3 merged it inside 220 Myr, which is neither realistic nor
    // watchable.
    // tSpan 420: a fixed 200-unit timeline ended 133 units BEFORE this scenario
    // merges, so the one scenario whose point is the merger could not be
    // scrubbed to it.
    spec: { massRatio: 0.6, rPeri: 30, ecc: 0.9, tStart: -60, tSpan: 420, particles: 320000,
            friction: 0.6,
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
