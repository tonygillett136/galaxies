/**
 * Two-body Kepler mechanics.
 *
 * Two jobs. It sets up the encounter orbit from the parameters the literature
 * quotes (eccentricity, pericentre distance, time since pericentre, which is
 * exactly Galaxy Zoo Table 4's schema). And it is the analytic ground truth the
 * integrator is asserted against, because a two-body problem is the only case in
 * this project with a closed-form answer.
 *
 * Internal units throughout, G = 1, so mu = total mass.
 */

/**
 * Position and velocity at a given true anomaly, in the orbital plane
 * (x towards pericentre, y in the direction of motion, z zero).
 *
 * @param {number} mu total mass (G=1)
 * @param {number} e  eccentricity: <1 ellipse, 1 parabola, >1 hyperbola
 * @param {number} rp pericentre distance
 * @param {number} nu true anomaly, radians. Negative = inbound.
 */
export function stateAtTrueAnomaly(mu, e, rp, nu) {
  const p = rp * (1 + e);                       // semi-latus rectum
  const r = p / (1 + e * Math.cos(nu));
  const h = Math.sqrt(mu * p);                  // specific angular momentum
  const vr = (mu / h) * e * Math.sin(nu);
  const vt = h / r;
  const c = Math.cos(nu), s = Math.sin(nu);
  return {
    r: [r * c, r * s, 0],
    v: [vr * c - vt * s, vr * s + vt * c, 0],
    trueAnomaly: nu, radius: r, angMom: h, semiLatus: p,
  };
}

/**
 * Time from pericentre to a true anomaly. Handles all three conic cases, because
 * encounters are often hyperbolic and Toomre & Toomre's canonical cases are
 * parabolic; a solver that only does ellipses fails silently on the interesting
 * ones by returning NaN.
 */
export function timeSincePericentre(mu, e, rp, nu) {
  if (Math.abs(e - 1) < 1e-9) {                 // Barker's equation
    const D = Math.tan(nu / 2);
    return Math.sqrt(2 * rp * rp * rp / mu) * (D + D * D * D / 3);
  }
  if (e < 1) {
    const a = rp / (1 - e);
    const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2),
                             Math.sqrt(1 + e) * Math.cos(nu / 2));
    return Math.sqrt(a * a * a / mu) * (E - e * Math.sin(E));
  }
  const a = rp / (e - 1);
  const H = 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
  return Math.sqrt(a * a * a / mu) * (e * Math.sinh(H) - H);
}

/**
 * Invert the above. Bisection rather than Newton: it cannot run away on
 * near-parabolic orbits, and at setup time the cost is irrelevant.
 */
export function trueAnomalyAtTime(mu, e, rp, t, tol = 1e-12) {
  if (t === 0) return 0;
  const sign = Math.sign(t), T = Math.abs(t);
  let lo = 0, hi = Math.PI * 0.999;
  if (e > 1) hi = Math.acos(-1 / e) * 0.999;    // asymptotic true anomaly
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (timeSincePericentre(mu, e, rp, mid) < T) lo = mid; else hi = mid;
    if (hi - lo < tol) break;
  }
  return sign * 0.5 * (lo + hi);
}

/** Orbital period. Only finite for e < 1. */
export function period(mu, e, rp) {
  if (e >= 1) return Infinity;
  const a = rp / (1 - e);
  return 2 * Math.PI * Math.sqrt(a * a * a / mu);
}

// --- conserved quantities, used as assertions rather than as physics ---

export const specificEnergy = (mu, r, v) => {
  const rr = Math.hypot(r[0], r[1], r[2]);
  const v2 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  return 0.5 * v2 - mu / rr;
};

export const angularMomentum = (r, v) => [
  r[1] * v[2] - r[2] * v[1],
  r[2] * v[0] - r[0] * v[2],
  r[0] * v[1] - r[1] * v[0],
];

/**
 * Laplace-Runge-Lenz vector, e_vec = (v x h)/mu - r_hat.
 *
 * The sharpest test in the file. Conserved ONLY for an exact inverse-square
 * force. Energy and angular momentum are conserved by any central force, so they
 * cannot tell a 1/r^2 law from a softened one. This can: under softening it
 * precesses, and the precession rate reads out how much the softening is
 * distorting the orbit.
 */
export function laplaceRungeLenz(mu, r, v) {
  const h = angularMomentum(r, v);
  const rr = Math.hypot(r[0], r[1], r[2]);
  return [
    (v[1] * h[2] - v[2] * h[1]) / mu - r[0] / rr,
    (v[2] * h[0] - v[0] * h[2]) / mu - r[1] / rr,
    (v[0] * h[1] - v[1] * h[0]) / mu - r[2] / rr,
  ];
}

/**
 * Rotate an in-plane state into 3D by the three orbital angles: inclination i,
 * argument of pericentre w, longitude of ascending node W. This is the parameter
 * group that decides whether an encounter makes a grand tidal tail or almost
 * nothing, which is most of what Toomre & Toomre 1972 is about.
 */
export function rotateToOrbitFrame([x, y, z], i, w, W) {
  const cw = Math.cos(w), sw = Math.sin(w);
  const ci = Math.cos(i), si = Math.sin(i);
  const cW = Math.cos(W), sW = Math.sin(W);
  const x1 = x * cw - y * sw, y1 = x * sw + y * cw, z1 = z;
  const x2 = x1, y2 = y1 * ci - z1 * si, z2 = y1 * si + z1 * ci;
  return [x2 * cW - y2 * sW, x2 * sW + y2 * cW, z2];
}
