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
 *   length. Default 0.1.
 *
 *   THICKNESS IS ORBITAL INCLINATION, not displacement. In a spherical potential
 *   every orbit is planar and a circular orbit stays circular, so a disc of
 *   circular orbits with a spread of small inclinations is thick AND exactly in
 *   equilibrium — |x| = r and |v| = v_c(r) hold per particle, with no
 *   approximation and nothing to breathe.
 *
 *   Two wrong versions preceded it, both mine, and both are worth keeping:
 *
 *   (a) A height with a purely tangential velocity. Every particle then sits at
 *       psi = 0, its own vertical extremum, at rest in z, IN PHASE — so they fall
 *       through the midplane together. Measured: rms|z| collapsed 40% in 19 Myr
 *       and phase-mixed to 1/sqrt(2). A coherent breathing mode, indistinguishable
 *       by eye from a tidal response, which is exactly the failure this file's
 *       opening paragraph warns about. It arrived when I changed this default from
 *       0 to 0.1 without reading the note directly above saying non-zero thickness
 *       was not in equilibrium.
 *   (b) A height plus a harmonic vertical velocity at random phase. Phase-mixed,
 *       and still wrong: the vertical kinetic energy is ADDED on top of a
 *       tangential speed already chosen for the spherical radius, so every
 *       particle carries too much energy. Measured: radii moved by a factor 160.
 *
 *   The remaining approximation is that the disc carries no RADIAL dispersion
 *   unless `dispersion` is set, so it is cold in the plane. Thickness and
 *   dispersion are separate knobs and only the first is on by default.
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

    // THICKNESS AS ORBITAL INCLINATION, which is the only construction that is
    // both thick and exactly in equilibrium in a spherical potential.
    //
    // Two wrong versions preceded this one.
    //   (a) height with no vertical velocity: every particle at psi = 0, its own
    //       vertical extremum, IN PHASE. They fall through the midplane together
    //       — rms|z| collapsed 40% in 19 Myr, a coherent breathing mode.
    //   (b) height plus a harmonic vertical velocity at random phase: phase-mixed,
    //       but the vertical kinetic energy is ADDED on top of a tangential speed
    //       already set for the spherical radius, so every particle carries too
    //       much energy and the disc flies apart. Measured: radii moved by 1.6e2.
    //
    // In a spherical potential every orbit is planar and a circular orbit stays
    // circular. So give each particle a circular orbit of radius r INCLINED by a
    // small angle beta about the disc's own axis, at a random orbital phase. The
    // position has |x| = r exactly and the speed is v_c(r) exactly, so it is an
    // exact circular orbit — no approximation, no breathing — and the ensemble of
    // random beta and random phase IS a thickened, phase-mixed disc.
    //
    // beta is set per particle so the vertical amplitude is `amp` regardless of
    // radius, giving a constant scale height rather than a flared one.
    const amp = -thickness * scaleLength * Math.log(1 - rng());
    const beta = r > 1e-9 ? Math.asin(Math.min(0.95, amp / r)) : 0;
    const cb = Math.cos(beta), sb = Math.sin(beta);

    // Circular speed at the orbit's radius. (The old comment here worried about
    // spherical vs cylindrical radius; with an inclined circular orbit the two
    // questions collapse — the orbital radius IS r.)
    let vc = potential.vcirc(r) * spin;

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
    // Circle of radius r tilted by beta about the x axis: the y and z components
    // of both position and velocity rotate together, so |pos| = r and |vel| = vc.
    const p = rotateToOrbitFrame(
      [r * ct, r * st * cb, r * st * sb], inclination, argPeri, node);
    const w = rotateToOrbitFrame([
      -vc * st + sr * ct - sp * st,
      (vc * ct + sr * st + sp * ct) * cb,
      (vc * ct) * sb + sz,
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
