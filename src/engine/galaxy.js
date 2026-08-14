/**
 * Initial conditions for a disc of massless test particles.
 *
 * In the restricted problem the disc has no self-gravity, so "equilibrium" means
 * exactly one thing: every particle is on a circular orbit in its host's
 * potential. That is cheap to get right and it is asserted in the tests, because
 * a disc that is not in equilibrium spreads and warps on its own and the result
 * is indistinguishable by eye from a tidal response.
 *
 * Arrays are Float64 at generation. These are initial conditions for a float64
 * reference as well as for the float32 GPU path, and quantising at birth
 * contaminates the reference: it put a ~1e-5 floor on the one-period closure
 * error and made the convergence ratio degrade with resolution instead of
 * approaching 4. Conversion to float32 happens once, at GPU upload.
 */

import { rotateToOrbitFrame } from './kepler.js';

/**
 * @param {object} opts
 * @param {object} opts.potential     host potential
 * @param {number[]} opts.rings       radii to populate
 * @param {number[]} [opts.counts]    particles per ring
 * @param {number} [opts.inclination] disc tilt vs the orbital plane, radians
 * @param {number} [opts.argPeri]     rotation of the disc within its own plane
 * @param {number} [opts.node]        longitude of ascending node
 * @param {boolean} [opts.retrograde] reverse the spin
 * @param {number} [opts.origin]      tag written into every particle, for provenance
 */
export function discOfRings({
  potential, rings, counts,
  inclination = 0, argPeri = 0, node = 0,
  retrograde = false, origin = 0,
  centre = [0, 0, 0], velocity = [0, 0, 0],
}) {
  const n = counts ?? rings.map((r) => Math.max(6, Math.round(12 * r / rings[0])));
  const total = n.reduce((a, b) => a + b, 0);
  const pos = new Float64Array(total * 3);
  const vel = new Float64Array(total * 3);
  const radius = new Float32Array(total);
  const originArr = new Float32Array(total).fill(origin);
  const spin = retrograde ? -1 : 1;

  let k = 0;
  for (let ri = 0; ri < rings.length; ri++) {
    const r = rings[ri];
    const vc = potential.vcirc(r) * spin;
    for (let j = 0; j < n[ri]; j++) {
      // golden-ratio phase offset per ring, so rings do not line up into spokes
      const th = 2 * Math.PI * j / n[ri] + 0.618034 * ri;
      const p = rotateToOrbitFrame([r * Math.cos(th), r * Math.sin(th), 0], inclination, argPeri, node);
      const w = rotateToOrbitFrame([-vc * Math.sin(th), vc * Math.cos(th), 0], inclination, argPeri, node);
      pos[k * 3] = p[0] + centre[0]; pos[k * 3 + 1] = p[1] + centre[1]; pos[k * 3 + 2] = p[2] + centre[2];
      vel[k * 3] = w[0] + velocity[0]; vel[k * 3 + 1] = w[1] + velocity[1]; vel[k * 3 + 2] = w[2] + velocity[2];
      radius[k] = r;
      k++;
    }
  }
  return { count: total, pos, vel, radius, origin: originArr };
}

/**
 * Exponential disc, which is what real discs actually are, sampled by inverse
 * transform so the surface density is right rather than approximately right.
 *
 * Sigma(R) ~ exp(-R/Rd), so the enclosed fraction is 1 - (1 + R/Rd)exp(-R/Rd).
 * No closed-form inverse, so this bisects: fast enough at setup time, and exact
 * enough that the test comparing realised against analytic profile passes.
 */
export function exponentialDisc({
  potential, count, scaleLength, rMax = 4.5, thickness = 0.05,
  inclination = 0, argPeri = 0, node = 0,
  retrograde = false, origin = 0,
  centre = [0, 0, 0], velocity = [0, 0, 0], seed = 1,
}) {
  const pos = new Float64Array(count * 3);
  const vel = new Float64Array(count * 3);
  const radius = new Float32Array(count);
  const originArr = new Float32Array(count).fill(origin);
  const spin = retrograde ? -1 : 1;
  const rng = mulberry32(seed);

  const Rmax = rMax * scaleLength;
  const encl = (x) => 1 - (1 + x) * Math.exp(-x);
  const maxF = encl(Rmax / scaleLength);

  for (let i = 0; i < count; i++) {
    const target = rng() * maxF;
    let lo = 0, hi = Rmax / scaleLength;
    for (let it = 0; it < 60; it++) {
      const mid = 0.5 * (lo + hi);
      if (encl(mid) < target) lo = mid; else hi = mid;
    }
    const r = 0.5 * (lo + hi) * scaleLength;
    const th = 2 * Math.PI * rng();
    const z = -thickness * scaleLength * Math.log(1 - rng()) * (rng() < 0.5 ? -1 : 1);
    const vc = potential.vcirc(r) * spin;

    const p = rotateToOrbitFrame([r * Math.cos(th), r * Math.sin(th), z], inclination, argPeri, node);
    const w = rotateToOrbitFrame([-vc * Math.sin(th), vc * Math.cos(th), 0], inclination, argPeri, node);
    pos[i * 3] = p[0] + centre[0]; pos[i * 3 + 1] = p[1] + centre[1]; pos[i * 3 + 2] = p[2] + centre[2];
    vel[i * 3] = w[0] + velocity[0]; vel[i * 3 + 1] = w[1] + velocity[1]; vel[i * 3 + 2] = w[2] + velocity[2];
    radius[i] = r;
  }
  return { count, pos, vel, radius, origin: originArr };
}

/** Deterministic PRNG. Reproducibility is not optional in a fitting pipeline. */
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Concatenate several particle sets into one buffer, preserving provenance tags. */
export function mergeParticles(sets) {
  const count = sets.reduce((s, d) => s + d.count, 0);
  const pos = new Float64Array(count * 3);
  const vel = new Float64Array(count * 3);
  const radius = new Float32Array(count);
  const origin = new Float32Array(count);
  let o = 0;
  for (const d of sets) {
    pos.set(d.pos, o * 3); vel.set(d.vel, o * 3);
    radius.set(d.radius, o); origin.set(d.origin, o);
    o += d.count;
  }
  return { count, pos, vel, radius, origin };
}
