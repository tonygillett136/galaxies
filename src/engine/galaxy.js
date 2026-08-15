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
/**
 * Inverse of the exponential-disc enclosed-mass fraction, as a lookup table.
 *
 * Bisecting 60 times per particle made rebuilding 300k particles take up to 2
 * seconds, which froze the interface on every slider release with no feedback.
 * One table, built once, then a linear interpolation per particle.
 */
const ENCL_TABLE = (() => {
  const N = 4096, XMAX = 8;
  const xs = new Float64Array(N + 1), fs = new Float64Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * XMAX;
    xs[i] = x; fs[i] = 1 - (1 + x) * Math.exp(-x);
  }
  return { xs, fs, N, XMAX };
})();

function inverseEnclosed(target) {
  const { xs, fs, N } = ENCL_TABLE;
  let lo = 0, hi = N;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (fs[m] < target) lo = m; else hi = m; }
  const f0 = fs[lo], f1 = fs[hi];
  const t = f1 > f0 ? (target - f0) / (f1 - f0) : 0;
  return xs[lo] + t * (xs[hi] - xs[lo]);
}

/**
 * @param {number} [opts.thickness] disc scale height as a fraction of the scale
 *   length. DEFAULTS TO ZERO — razor thin.
 *
 *   A thin disc of test particles in a spherical potential, given purely
 *   tangential velocities, is in RADIAL equilibrium but not VERTICAL
 *   equilibrium: the ensemble breathes, its rms height oscillating, and three
 *   reviewers caught it. Real vertical equilibrium needs a velocity dispersion
 *   this restricted model does not carry. A razor-thin disc is exactly in
 *   equilibrium, is what Toomre & Toomre used, and is honest. Non-zero
 *   thickness remains available and is documented as NOT in equilibrium.
 *
 * @param {number} [opts.node] longitude of ascending node — the disc's tilt
 *   axis relative to the orbit. THIS is the second physically meaningful angle.
 *   `argPeri` rotates an axisymmetric disc within its own plane and is inert for
 *   a smooth disc; it survives only because a finite particle set is not smooth,
 *   which is a discretisation artefact and not a parameter.
 */
export function exponentialDisc({
  potential, count, scaleLength, rMax = 4.5, thickness = 0.1,
  dispersion = 0,
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
    const r = inverseEnclosed(rng() * maxF) * scaleLength;
    const th = 2 * Math.PI * rng();
    const z = -thickness * scaleLength * Math.log(1 - rng()) * (rng() < 0.5 ? -1 : 1);

    // Circular speed from the SPHERICAL radius, not the cylindrical one.
    //
    // The velocity (-v sin th, v cos th, 0) is perpendicular to the position
    // vector even when z is non-zero, so each particle is on an exactly circular
    // orbit — but only if its speed matches the potential at its actual distance
    // from the centre. Using the cylindrical radius left every off-plane particle
    // slightly off its circular orbit, so the shipped disc was not in equilibrium
    // and would slowly breathe on its own. Small (z/R ~ 0.03 here) and precisely
    // the kind of small that is indistinguishable from a weak tidal response.
    const rs = Math.hypot(r, z);
    let vc = potential.vcirc(rs) * spin;

    // VELOCITY DISPERSION, with the asymmetric drift that makes it an
    // equilibrium rather than an expansion.
    //
    // Adding random motion to particles on exactly circular orbits does not give
    // a warmer disc, it gives a disc with too much kinetic energy, which expands.
    // Pressure support has to come out of rotation: for an exponential disc of
    // roughly constant dispersion,
    //     v_phi^2 = v_c^2 - sigma^2 (R / R_d)
    // which is the standard asymmetric-drift relation with d ln(rho)/d ln R =
    // -R/R_d. Clamped at zero so a large sigma at large R cannot invert the spin.
    //
    // Default 0, because the ring result depends on it and shipping a change to
    // that quietly would be exactly the sort of silent knob this project keeps
    // finding. The sweep is RECORDED in morphology.test.js instead.
    let sr = 0, sp = 0, sz = 0;
    if (dispersion > 0) {
      const v2 = vc * vc - dispersion * dispersion * (r / scaleLength);
      vc = Math.sign(vc) * Math.sqrt(Math.max(0, v2));
      // Box-Muller, isotropic-ish with the vertical component colder as observed
      const g = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
      sr = dispersion * g();
      sp = dispersion * 0.7 * g();
      sz = dispersion * 0.5 * g();
    }

    const ct = Math.cos(th), st = Math.sin(th);
    const p = rotateToOrbitFrame([r * ct, r * st, z], inclination, argPeri, node);
    // radial unit vector (ct, st, 0); azimuthal (-st, ct, 0)
    const w = rotateToOrbitFrame([
      -vc * st + sr * ct - sp * st,
      vc * ct + sr * st + sp * ct,
      sz,
    ], inclination, argPeri, node);
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
