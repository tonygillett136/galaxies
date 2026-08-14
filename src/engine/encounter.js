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
 * almost nothing from the same orbit. That asymmetry is the central result of
 * Toomre & Toomre 1972 and it is worth seeing directly, so the scenarios below
 * include a matched prograde/retrograde pair.
 */

import { plummer, hernquist, composite } from './potentials.js';
import { stateAtTrueAnomaly, trueAnomalyAtTime } from './kepler.js';
import { exponentialDisc, discOfRings, mergeParticles } from './galaxy.js';

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
    disc1 = {}, disc2 = {},
  } = spec;

  const m2 = m1 * massRatio;
  const mu = m1 + m2;

  // Extended mass models. A Plummer core plus a Hernquist halo is the cheapest
  // model that has both a sensible rotation curve and a finite total mass.
  const P1 = composite([plummer(m1 * 0.35, 0.5), hernquist(m1 * 0.65, 2.2)]);
  const P2 = composite([plummer(m2 * 0.35, 0.5 * Math.cbrt(massRatio)),
                        hernquist(m2 * 0.65, 2.2 * Math.cbrt(massRatio))]);

  const nu = trueAnomalyAtTime(mu, ecc, rPeri, tStart);
  const s = stateAtTrueAnomaly(mu, ecc, rPeri, nu);
  const f1 = m2 / mu, f2 = -m1 / mu;         // split about the barycentre

  const c1 = s.r.map((x) => x * f1), v1 = s.v.map((x) => x * f1);
  const c2 = s.r.map((x) => x * f2), v2 = s.v.map((x) => x * f2);

  const galaxies = [
    { mass: m1, potential: P1, pos: c1, vel: v1 },
    { mass: m2, potential: P2, pos: c2, vel: v2 },
  ];

  const d1on = disc1.active !== false, d2on = disc2.active !== false;
  const share = d1on && d2on ? 0.5 : 1.0;
  const sets = [];
  if (d1on) {
    sets.push(exponentialDisc({
      potential: P1, count: Math.round(particles * share),
      scaleLength: disc1.scaleLength ?? 1.6, rMax: disc1.rMax ?? 3.2,
      thickness: disc1.thickness ?? 0.06,
      inclination: disc1.inclination ?? 0, argPeri: disc1.argPeri ?? 0,
      retrograde: !!disc1.retrograde, origin: 0,
      centre: c1, velocity: v1, seed,
    }));
  }
  if (d2on) {
    sets.push(exponentialDisc({
      potential: P2, count: Math.round(particles * share),
      scaleLength: (disc2.scaleLength ?? 1.6) * Math.cbrt(massRatio),
      rMax: disc2.rMax ?? 3.2, thickness: disc2.thickness ?? 0.06,
      inclination: disc2.inclination ?? 0, argPeri: disc2.argPeri ?? 0,
      retrograde: !!disc2.retrograde, origin: 1,
      centre: c2, velocity: v2, seed: seed + 977,
    }));
  }

  return { galaxies, particles: mergeParticles(sets), spec: { ...spec, m2, mu, nu } };
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
export const SCENARIOS = {
  prograde: {
    label: 'Prograde passage',
    blurb: 'Discs spinning the same way as the orbit. The classic case: long, thin tidal tails from both galaxies.',
    spec: { massRatio: 1.0, rPeri: 4.0, ecc: 1.0, tStart: -22, particles: 300000,
            disc1: { inclination: 0.0, argPeri: 0 },
            disc2: { inclination: 0.35, argPeri: 1.1 } },
  },
  retrograde: {
    label: 'Retrograde passage',
    blurb: 'The same orbit, both discs spinning against it. Almost no tails. This contrast, not the closeness of the passage, is the central result of Toomre & Toomre 1972.',
    spec: { massRatio: 1.0, rPeri: 4.0, ecc: 1.0, tStart: -22, particles: 300000,
            disc1: { inclination: 0.0, argPeri: 0, retrograde: true },
            disc2: { inclination: 0.35, argPeri: 1.1, retrograde: true } },
  },
  mice: {
    label: 'Mice-like',
    blurb: 'Near-equal masses, prograde, close passage: two long straight tails. Resembles NGC 4676. Not the published fit.',
    spec: { massRatio: 0.9, rPeri: 3.2, ecc: 1.0, tStart: -20, particles: 320000,
            disc1: { inclination: 0.15, argPeri: 0.2 },
            disc2: { inclination: -0.2, argPeri: 2.4 } },
  },
  antennae: {
    label: 'Antennae-like',
    blurb: 'Equal masses well past pericentre, inclined discs: two enormous curving antennae. Resembles NGC 4038/4039. Not the published fit.',
    spec: { massRatio: 1.0, rPeri: 2.6, ecc: 0.95, tStart: -26, particles: 350000,
            disc1: { inclination: 0.5, argPeri: 0.6 },
            disc2: { inclination: -0.7, argPeri: 2.0 } },
  },
  minorMerger: {
    label: 'Minor merger',
    blurb: 'A ten-to-one companion on a close orbit. The small galaxy is destroyed; the large one is barely disturbed but grows a warp.',
    spec: { massRatio: 0.1, rPeri: 2.2, ecc: 0.85, tStart: -24, particles: 300000,
            disc1: { inclination: 0.1, argPeri: 0, scaleLength: 1.8 },
            disc2: { inclination: 0.9, argPeri: 1.6, scaleLength: 0.7 } },
  },
  flyby: {
    label: 'Distant fly-by',
    blurb: 'A wide hyperbolic pass. Bridges and warps but no merger: the two go their separate ways.',
    spec: { massRatio: 0.6, rPeri: 9.0, ecc: 1.6, tStart: -26, particles: 280000,
            disc1: { inclination: 0.2, argPeri: 0.4 },
            disc2: { inclination: 0.6, argPeri: 1.9 } },
  },
  ring: {
    label: 'Ring galaxy',
    blurb: 'A small companion fired through the centre of a large disc, almost perpendicular. Produces an expanding density ring, as in the Cartwheel.',
    spec: { massRatio: 0.18, rPeri: 0.35, ecc: 1.1, tStart: -16, particles: 320000,
            disc1: { inclination: 0.0, argPeri: 0, scaleLength: 2.0, rMax: 3.0 },
            disc2: { active: false } },
  },
};
