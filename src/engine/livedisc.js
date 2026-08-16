/**
 * Initial conditions for a SELF-GRAVITATING exponential disc.
 *
 * This is the hard part of the live tier, and CLAUDE.md already names why: a
 * badly equilibrated disc evolves spuriously and looks completely plausible
 * while doing it. Everything here exists to be checked rather than trusted.
 *
 * THE THREE THINGS THAT MUST BE RIGHT
 *
 * 1. The disc's mass must be removed from the rigid potential and supplied by
 *    the particles instead. `galaxyModel` returns bulge + Plummer disc + halo;
 *    the caller must pass a rigid potential of bulge + halo ONLY. Leave the
 *    Plummer term in and the disc sits in twice its own gravity, contracts, and
 *    still looks like a perfectly nice compact galaxy. `rigidWithoutDisc()`
 *    below does the removal so it is not done by hand at three call sites.
 *
 * 2. The circular speed must include the disc's own contribution, which is
 *    Freeman's (1970) Bessel expression and NOT the Plummer term it replaced.
 *    A spherical Plummer and a flattened exponential disc of equal mass do not
 *    produce the same rotation curve.
 *
 * 3. The disc must be pressure-supported consistently. Three pieces:
 *      - sigma_R set from the target Toomre Q,
 *      - sigma_phi tied to sigma_R by the epicyclic ratio kappa/2Omega,
 *      - the mean azimuthal speed reduced below v_circ by ASYMMETRIC DRIFT.
 *    Skip the third and the disc is born rotating too fast for its own pressure,
 *    expands, and the expansion looks like a beautifully growing spiral.
 *
 * Q is the dial the whole exercise turns on. Q < 1 fragments, Q ~ 1.2-1.5 grows
 * flocculent arms, Q > 2 stays featureless. It must be SWEPT: observing arms at
 * one value proves only that Q was below about 2.
 */

import { mulberry32 } from './galaxy.js';
import { composite } from './potentials.js';
import { vcircDiscFreeman } from './freeman.js';

/**
 * Strip the Plummer disc component out of a composite galaxy model, returning
 * the rigid remainder and the disc mass that must now be carried by particles.
 * Throws rather than guessing if the model is not the shape it expects.
 */
export function rigidWithoutDisc(model) {
  const parts = model.parts;
  if (!Array.isArray(parts)) throw new Error('rigidWithoutDisc: expected a composite model');
  const disc = parts.filter((p) => p.kind === 'plummer');
  if (disc.length !== 1) {
    throw new Error(`rigidWithoutDisc: expected exactly one plummer disc component, found ${disc.length}`);
  }
  const rest = parts.filter((p) => p !== disc[0]);
  if (!rest.length) throw new Error('rigidWithoutDisc: nothing left after removing the disc');
  return { rigid: composite(rest), discMass: disc[0].mass, discScale: disc[0].scale };
}

/** Circular speed from rigid components plus the live disc's own Freeman term. */
export function vcircLive(R, rigid, discMass, Rd, G = 1) {
  const vr = rigid.vcirc(R);
  const vd = vcircDiscFreeman(R, discMass, Rd, G);
  return Math.sqrt(vr * vr + vd * vd);
}

/**
 * Epicyclic frequency, by numerical differentiation of the rotation curve.
 *   kappa^2 = (2 Omega / R) d(R^2 Omega)/dR
 * Differentiated numerically rather than analytically because v_circ is a sum of
 * a Bessel expression and whatever rigid components the caller passed, and an
 * analytic derivative of that is a second place for the model to disagree with
 * itself.
 */
export function epicyclic(R, vc, h = 1e-3) {
  const Om = (r) => vc(r) / r;
  const f = (r) => r * r * Om(r);
  const d = (f(R + h) - f(R - h)) / (2 * h);
  const om = Om(R);
  return { Omega: om, kappa: Math.sqrt(Math.max(0, (2 * om / R) * d)) };
}

/**
 * @param {Object} o
 * @param {number} o.count          particle count
 * @param {number} o.discMass       total live disc mass (internal units)
 * @param {number} o.scaleLength    Rd, kpc
 * @param {number} o.rMax           truncation, in scale lengths
 * @param {number} o.thickness      vertical scale height, in scale lengths
 * @param {Object} o.rigid          rigid potential (bulge + halo, NO disc term)
 * @param {number} o.toomreQ        target Q
 * @param {number} o.seed
 * @param {number[]} o.centre
 * @param {number[]} o.velocity
 * @param {number} o.origin         tag written to vel[i].w
 * @param {boolean} o.retrograde
 */
export function liveExponentialDisc(o) {
  const {
    count, discMass, scaleLength: Rd, rigid, toomreQ: Q, seed = 1,
    rMax = 4.5, thickness = 0.1, centre = [0, 0, 0], velocity = [0, 0, 0],
    origin = 0, retrograde = false, G = 1,
  } = o;

  const rng = mulberry32(seed);
  const Rcut = rMax * Rd;
  const z0 = thickness * Rd;
  const mPart = discMass / count;

  const vc = (r) => vcircLive(r, rigid, discMass, Rd, G);
  // Sigma0 from the TRUNCATED mass, so the particles really do sum to discMass.
  const x = Rcut / Rd;
  const encFrac = 1 - (1 + x) * Math.exp(-x);
  const Sigma0 = discMass / (2 * Math.PI * Rd * Rd * encFrac);
  const Sigma = (r) => Sigma0 * Math.exp(-r / Rd);

  // Invert the cumulative M(<R) on a fine table: cheaper and more robust than
  // rejection sampling at the tail, and monotone by construction.
  const NT = 4096;
  const Rt = new Float64Array(NT + 1), Ct = new Float64Array(NT + 1);
  for (let i = 0; i <= NT; i++) {
    const r = (i / NT) * Rcut;
    Rt[i] = r;
    const u = r / Rd;
    Ct[i] = (1 - (1 + u) * Math.exp(-u)) / encFrac;
  }
  const sampleR = () => {
    const t = rng();
    let lo = 0, hi = NT;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (Ct[m] < t) lo = m; else hi = m; }
    const f = (t - Ct[lo]) / Math.max(Ct[hi] - Ct[lo], 1e-15);
    return Rt[lo] + f * (Rt[hi] - Rt[lo]);
  };

  // Gaussian pair, Box-Muller
  let spare = null;
  const gauss = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0, s = 0;
    do { u = rng() * 2 - 1; v = rng() * 2 - 1; s = u * u + v * v; } while (s === 0 || s >= 1);
    const f = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * f; return u * f;
  };

  // --- dispersions and the drift, tabulated in R -----------------------------
  // sigma_R from Q; sigma_phi from the epicyclic ratio; sigma_z from the thin
  // isothermal sheet. Asymmetric drift follows Binney & Tremaine (4.228),
  // differentiated numerically for the same reason kappa is.
  const NS = 512;
  const sR = new Float64Array(NS + 1), sP = new Float64Array(NS + 1),
        sZ = new Float64Array(NS + 1), vBar = new Float64Array(NS + 1);
  const Rmin = 0.02 * Rd;
  const idx = (r) => Math.min(NS, Math.max(0, Math.round(((r - Rmin) / (Rcut - Rmin)) * NS)));
  const sigR = (r) => {
    const { kappa } = epicyclic(Math.max(r, Rmin), vc);
    return kappa > 0 ? 3.36 * G * Sigma(r) * Q / kappa : 0;
  };
  for (let i = 0; i <= NS; i++) {
    const r = Rmin + (i / NS) * (Rcut - Rmin);
    const { Omega, kappa } = epicyclic(r, vc);
    const a = sigR(r);
    sR[i] = a;
    sP[i] = a * (Omega > 0 ? kappa / (2 * Omega) : 1);
    sZ[i] = Math.sqrt(Math.PI * G * Sigma(r) * z0);
    // d ln(Sigma sigma_R^2) / d ln R
    const h = Math.max(1e-3, 1e-3 * r);
    const g = (rr) => Math.log(Math.max(Sigma(rr) * sigR(rr) ** 2, 1e-300));
    const dln = r * (g(r + h) - g(r - h)) / (2 * h);
    const v2 = vc(r) ** 2 - a * a * ((sP[i] * sP[i]) / Math.max(a * a, 1e-30) - 1 - dln);
    vBar[i] = Math.sqrt(Math.max(0, v2));
  }

  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const mass = new Float32Array(count);
  const radius = new Float32Array(count);
  const originArr = new Float32Array(count);
  const sgn = retrograde ? -1 : 1;
  let clampedDrift = 0;

  for (let i = 0; i < count; i++) {
    const R = Math.max(sampleR(), Rmin);
    const phi = rng() * 2 * Math.PI;
    // exponential vertical profile, symmetric about the plane
    const z = -z0 * Math.log(Math.max(rng(), 1e-12)) * (rng() < 0.5 ? -1 : 1);
    const k = idx(R);
    if (vBar[k] <= 0) clampedDrift++;

    const cx = Math.cos(phi), sy = Math.sin(phi);
    pos[i * 3] = centre[0] + R * cx;
    pos[i * 3 + 1] = centre[1] + R * sy;
    pos[i * 3 + 2] = centre[2] + z;

    const vR = gauss() * sR[k];
    const vP = sgn * vBar[k] + gauss() * sP[k];
    const vZ = gauss() * sZ[k];
    // cylindrical -> cartesian
    vel[i * 3] = velocity[0] + vR * cx - vP * sy;
    vel[i * 3 + 1] = velocity[1] + vR * sy + vP * cx;
    vel[i * 3 + 2] = velocity[2] + vZ;

    mass[i] = mPart;
    radius[i] = R;
    originArr[i] = origin;
  }

  return {
    count, pos, vel, mass, radius, origin: originArr,
    // reported so the caller can assert rather than hope
    diagnostics: {
      Sigma0, mPart, Rcut, z0, encFrac, clampedDrift,
      sigmaR: (r) => sR[idx(r)], sigmaPhi: (r) => sP[idx(r)], sigmaZ: (r) => sZ[idx(r)],
      vBar: (r) => vBar[idx(r)], vcirc: vc, Sigma,
      epicyclic: (r) => epicyclic(r, vc),
    },
  };
}
