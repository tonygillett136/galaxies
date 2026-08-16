/**
 * Initial conditions for a SELF-GRAVITATING Hernquist halo.
 *
 * Stage 2. The halo carries 93.9% of the mass, so making it live is what turns
 * dynamical friction from an analytic term on the galaxy centres into a real
 * wake, and it is the only way to test whether the merger remnant's profile is
 * being held back by a rigid backdrop.
 *
 * IT IS ALSO THE RISK. Direct N^2 cannot afford equal-mass particles here: the
 * halo is 20x the disc mass, so equal masses would need 20x the disc's particle
 * count, and 500k halo particles is 2.5 s per step. Unequal masses are therefore
 * forced, and heavy neighbours heat a cold disc by two-body relaxation — which
 * would destroy exactly the spiral structure Stage 1 was built to produce. The
 * heating is measured against a rigid-halo control before anything is claimed.
 *
 * Hernquist (1990):
 *   rho(r)  = M a / (2 pi r (r+a)^3)
 *   M(<r)   = M r^2 / (r+a)^2
 *   Phi(r)  = -G M / (r + a)
 *
 * Truncating the halo at a finite radius is harmless for the dynamics inside it:
 * by the shell theorem the exterior mass exerts no force within, so the disc's
 * circular speed is unchanged. Only the potential zero point moves, and nothing
 * here depends on it.
 */

import { mulberry32 } from './galaxy.js';
import { eddingtonDF, makeSpeedSampler } from './eddington.js';

/** Enclosed mass fraction of a Hernquist sphere inside r. */
export function hernquistMassFrac(r, a) {
  const x = r / a;
  return (x * x) / ((1 + x) * (1 + x));
}

/**
 * Analytic isotropic radial velocity dispersion of a Hernquist sphere,
 * Hernquist (1990) eq. 10. Verified against a numerical solution of the Jeans
 * equation in the test suite rather than trusted from the paper.
 */
export function hernquistSigma2(r, M, a, G = 1) {
  const s = r / a;
  if (s <= 0) return 0;
  const t1 = 12 * s * Math.pow(1 + s, 3) * Math.log((1 + s) / s);
  const t2 = (s / (1 + s)) * (25 + 52 * s + 42 * s * s + 12 * s * s * s);
  return Math.max(0, (G * M / (12 * a)) * (t1 - t2));
}

/**
 * The same quantity by direct integration of the isotropic Jeans equation,
 *   rho sigma_r^2 (r) = INT_r^inf rho(r') G M(<r') / r'^2 dr'
 * This shares no algebra with the closed form above, which is the point.
 */
export function hernquistSigma2Jeans(r, M, a, G = 1, rMax = 1e6, n = 200000) {
  const rho = (x) => (M * a) / (2 * Math.PI * x * Math.pow(x + a, 3));
  const Menc = (x) => M * hernquistMassFrac(x, a);
  // integrate in log space: the integrand spans many decades
  const lo = Math.log(r), hi = Math.log(rMax), h = (hi - lo) / n;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const x0 = Math.exp(lo + i * h), x1 = Math.exp(lo + (i + 1) * h);
    const f = (x) => rho(x) * G * Menc(x) / (x * x) * x;   // *x for d(ln x)
    acc += 0.5 * (f(x0) + f(x1)) * h;
  }
  return acc / rho(r);
}

/**
 * The EXACT isotropic distribution function of the Hernquist model, Hernquist
 * (1990) eq. 17, up to a constant. Returned unnormalised because every use here
 * is rejection sampling, which only needs relative probabilities.
 *
 *   q = sqrt(E / v_g^2),  v_g^2 = G M / a,  E = Psi(r) - v^2/2,  Psi = G M/(r+a)
 *
 * WHY THIS REPLACED A MAXWELLIAN. The first version drew speeds from an
 * isotropic Maxwellian at the local Jeans dispersion. That is a standard
 * shortcut and it is wrong enough to matter: sampled that way the halo is not in
 * equilibrium, and measured in isolation its Lagrangian radii moved by up to
 * 6.5% in 566 Myr — inner shells expanding, middle contracting — which is a
 * settling signature, not noise. The settling then stirred the disc, and it was
 * being misread as two-body relaxation.
 *
 * Numerical note: at small q the bracket is a near-exact cancellation of two
 * terms of order 0.3 that leaves ~2e-4, so it is clamped at zero. Those are the
 * least bound particles and the phase-space volume there is negligible.
 */
export function hernquistDF(q) {
  if (!(q > 0) || q >= 1) return 0;
  const q2 = q * q, s = Math.sqrt(1 - q2);
  const bracket = 3 * Math.asin(q)
    + q * s * (1 - 2 * q2) * (8 * q2 * q2 - 8 * q2 - 3);
  return Math.max(0, bracket) / Math.pow(1 - q2, 2.5);
}

/**
 * @param {Object} o
 * @param {number} o.count
 * @param {number} o.mass       total halo mass (before truncation)
 * @param {number} o.a          Hernquist scale radius
 * @param {number} o.rMax       truncation radius, kpc
 * @param {number[]} o.centre
 * @param {number[]} o.velocity
 * @param {number} o.origin
 * @param {number} o.seed
 * @param {Object} [o.totalPotential]  the potential the halo will ACTUALLY sit
 *   in — bulge + disc + halo. When given, the velocities are drawn from a DF
 *   built by Eddington inversion in THAT potential instead of the analytic
 *   isolated-sphere DF. Without it the halo is in equilibrium with itself and
 *   not with the galaxy it is part of, and it contracts: measured, the inner
 *   shells fell 23-38% in 141 Myr and heated the disc from 29 to 47 km/s.
 */
export function liveHernquistHalo(o) {
  const { count, mass: M, a, rMax = 15 * o.a, centre = [0, 0, 0],
          velocity = [0, 0, 0], origin = 0, seed = 1, G = 1 } = o;

  const rng = mulberry32(seed);
  let spare = null;
  const gauss = () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u, v, q;
    do { u = rng() * 2 - 1; v = rng() * 2 - 1; q = u * u + v * v; } while (!q || q >= 1);
    const f = Math.sqrt(-2 * Math.log(q) / q);
    spare = v * f; return u * f;
  };

  // Invert M(<r)/M = (r/a)^2 / (1+r/a)^2  ->  r = a sqrt(u) / (1 - sqrt(u)),
  // rejecting anything past the truncation radius rather than squashing it,
  // which would pile mass onto the boundary.
  const fMax = hernquistMassFrac(rMax, a);
  const sampleR = () => {
    for (;;) {
      const u = rng() * fMax;
      const s = Math.sqrt(u);
      const r = a * s / (1 - s);
      if (r <= rMax) return r;
    }
  };

  // The particles carry the ENCLOSED mass, not the nominal total: the truncated
  // shells are simply absent, and pretending otherwise would put 14% more mass
  // in the halo than the profile it was sampled from.
  const mTot = M * fMax;
  const mPart = mTot / count;

  // If the caller supplied the potential the halo will really sit in, build the
  // DF by Eddington inversion in that potential. The isolated-sphere DF below is
  // only correct for a halo on its own.
  const totalPot = o.totalPotential;
  let sampleSpeed = null;
  if (totalPot) {
    const rhoH = (rr) => (M * a) / (2 * Math.PI * rr * Math.pow(rr + a, 3));
    const psiT = (rr) => -totalPot.potential(rr);
    const fE = eddingtonDF(rhoH, psiT, { rMin: 1e-4, rMax: Math.max(1e5, 50 * rMax), nR: 5000, nE: 700 });
    sampleSpeed = makeSpeedSampler(fE, psiT, rMax);
  }

  // Envelope for the rejection sampler: the maximum of v^2 f(E) at each radius,
  // tabulated once. Scanning for it per particle would be the dominant cost.
  const vg2 = G * M / a;
  const NR = 512;
  const peaks = new Float64Array(NR + 1);
  const rOf = (k) => rMax * Math.pow(k / NR, 3);          // dense at small r
  for (let k = 0; k <= NR; k++) {
    const rr = Math.max(rOf(k), 1e-4);
    const Psi = G * M / (rr + a), ve = Math.sqrt(2 * Psi);
    let mx = 0;
    for (let j = 1; j < 400; j++) {
      const vv = (j / 400) * ve;
      const E = Psi - 0.5 * vv * vv;
      mx = Math.max(mx, vv * vv * hernquistDF(Math.sqrt(Math.max(E, 0) / vg2)));
    }
    peaks[k] = mx * 1.08;                                  // headroom
  }
  const peakOf = (r) => {
    const k = Math.min(NR, Math.max(0, Math.round(NR * Math.cbrt(r / rMax))));
    return Math.max(peaks[k], 1e-300);
  };

  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const massArr = new Float32Array(count);
  const radius = new Float32Array(count);
  const originArr = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const r = sampleR();
    const ct = rng() * 2 - 1, st = Math.sqrt(1 - ct * ct), ph = rng() * 2 * Math.PI;
    pos[i * 3] = centre[0] + r * st * Math.cos(ph);
    pos[i * 3 + 1] = centre[1] + r * st * Math.sin(ph);
    pos[i * 3 + 2] = centre[2] + r * ct;

    // Speed by rejection against the phase-space weight v^2 f(E) — the volume
    // element, not f alone.
    let v = 0;
    if (sampleSpeed) {
      v = sampleSpeed(r, rng);
    } else {
      const Psi = G * M / (r + a);
      const vesc = Math.sqrt(2 * Psi);
      const gmax = peakOf(r);
      for (let tries = 0; ; tries++) {
        const vv = rng() * vesc;
        const E = Psi - 0.5 * vv * vv;
        const gq = vv * vv * hernquistDF(Math.sqrt(Math.max(E, 0) / vg2));
        if (rng() * gmax <= gq) { v = vv; break; }
        if (tries > 10000) { v = Math.sqrt(hernquistSigma2(r, M, a, G)) * 1.732; break; }
      }
    }
    // isotropic direction
    const cz = rng() * 2 - 1, sz = Math.sqrt(1 - cz * cz), pz = rng() * 2 * Math.PI;
    vel[i * 3] = velocity[0] + v * sz * Math.cos(pz);
    vel[i * 3 + 1] = velocity[1] + v * sz * Math.sin(pz);
    vel[i * 3 + 2] = velocity[2] + v * cz;

    massArr[i] = mPart;
    radius[i] = r;
    originArr[i] = origin;
  }

  return {
    count, pos, vel, mass: massArr, radius, origin: originArr,
    diagnostics: { mPart, mTot, fMax, rMax, a, inTotalPotential: !!totalPot, sigma: (r) => Math.sqrt(hernquistSigma2(r, M, a, G)) },
  };
}
