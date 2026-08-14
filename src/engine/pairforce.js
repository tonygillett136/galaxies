/**
 * The EXACT mutual force and potential energy between two extended galaxies.
 *
 * WHY THIS FILE EXISTS
 *
 * The mutual attraction of two spherical mass distributions is not
 * M1 M2 d / (d^2 + a1^2 + a2^2)^{3/2}. That expression is a Plummer-style
 * softening, and round 2 adopted it under a comment claiming it was "the
 * analytic Plummer convolution, exact for the Plummer components". Both halves
 * of that claim are false, and round 3 measured the damage against numerical
 * quadrature:
 *
 *   halo-halo (Hernquist a=20, which carries 94% of the model's mass)
 *     d =   5 kpc   1.96x too strong
 *     d =  10 kpc   2.51x
 *     d =  20 kpc   3.09x   <- worst, and squarely in the encounter range
 *     d =  40 kpc   2.92x
 *     d =  80 kpc   2.14x
 *     d = 150 kpc   1.60x
 *   disc-disc (Plummer a=3) 1.29x at d=5, 1.07x at d=10 — so it is not exact
 *     for Plummer-Plummer either. The convolution of two Plummer DENSITIES is
 *     not a Plummer density; only the potential of a single Plummer sphere has
 *     the softened point-mass form.
 *
 * The pericentre solver hid this: it retunes the Kepler pericentre until the
 * executed r_min matches the request, so the DISTANCE of closest approach was
 * protected while the SPEED there was not.
 *
 * WHAT IT COMPUTES
 *
 * For components 1 and 2 separated by d, with galaxy 1 at the origin:
 *
 *   F(d) = \int rho2(s) g1(|d + s|) (d + s cos th)/|d + s| d^3 s
 *   W(d) = \int rho2(s) Phi1(|d + s|) d^3 s
 *
 * Substituting R = |d + s| turns the angular integral into a radial one:
 *   R^2 = d^2 + s^2 + 2 d s cos th,  R dR = d s d(cos th),
 *   d + s cos th = (R^2 + d^2 - s^2) / (2d)
 * so
 *   F: (1/(2 d^2 s)) \int_{|d-s|}^{d+s} g1(R) (R^2 + d^2 - s^2) dR
 *   W: (1/(d s))     \int_{|d-s|}^{d+s} Phi1(R) R dR
 *
 * and BOTH inner integrals are elementary for Hernquist and Plummer. So the
 * exact answer costs one well-behaved radial quadrature, not a 2-D one.
 *
 * Verified three ways: against a brute-force 2-D quadrature to 2e-5; that
 * quadrature against the shell theorem (point mass vs Hernquist) to 7e-5; and
 * the two integrals against each other, |F| = dW/dd, to 1.00000.
 *
 * SIGN CONVENTION, because I got it wrong once and it cost a debugging round:
 * W(d) is negative and rises toward zero with separation, so dW/dd = +|F| and
 * dW/du = |F| d with u = ln d. The attractive force is the -dW/dd COMPONENT of
 * a vector; |F| returned here is its MAGNITUDE.
 *
 * G = 1 throughout, per docs/UNITS.md.
 */

const TWO_PI = 2 * Math.PI;

const partsOf = (P) => (P && P.kind === 'composite' ? P.parts : [P]);

function rhoOf(p, r) {
  if (p.kind === 'hernquist') return p.mass * p.scale / (TWO_PI * r * Math.pow(r + p.scale, 3));
  if (p.kind === 'plummer') {
    const a2 = p.scale * p.scale;
    return 3 * p.mass * a2 / (4 * Math.PI * Math.pow(r * r + a2, 2.5));
  }
  throw new Error(`pairforce: no density for kind "${p.kind}"`);
}

/** Antiderivative in R of g1(R)(R^2 + K), where K = d^2 - s^2. */
function forceAnti(p, K, R) {
  const a = p.scale, M = p.mass;
  if (p.kind === 'hernquist') {
    const u = R + a;
    return M * (u - 2 * a * Math.log(u) - (a * a + K) / u);
  }
  if (p.kind === 'plummer') {
    const q = Math.sqrt(R * R + a * a);
    return M * (q + (a * a - K) / q);
  }
  throw new Error(`pairforce: no force law for kind "${p.kind}"`);
}

/** Antiderivative in R of Phi1(R) R. */
function potAnti(p, R) {
  const a = p.scale, M = p.mass;
  if (p.kind === 'hernquist') return -M * (R - a * Math.log(R + a));
  if (p.kind === 'plummer') return -M * Math.sqrt(R * R + a * a);
  throw new Error(`pairforce: no potential for kind "${p.kind}"`);
}

/**
 * Radial quadrature shared by both integrals. Log-spaced in s because the
 * density falls steeply; midpoint rule, which is second-order and adequate at
 * this resolution (checked against nS = 2000: agrees to 3e-5).
 */
function radialIntegral(p2, fn, nS) {
  const lo = Math.log(1e-6 * p2.scale), hi = Math.log(3000 * p2.scale);
  let acc = 0;
  for (let i = 0; i < nS; i++) {
    const u0 = lo + (hi - lo) * i / nS, u1 = lo + (hi - lo) * (i + 1) / nS;
    const s = Math.exp(0.5 * (u0 + u1));
    const ds = Math.exp(u1) - Math.exp(u0);
    const rho = rhoOf(p2, s);
    if (rho > 0) acc += rho * fn(s) * ds;
  }
  return acc;
}

/** Exact |F| between two single components at separation d. */
export function exactPairForce(p1, p2, d, nS = 600) {
  if (!(d > 0)) return 0;
  return radialIntegral(p2, (s) => {
    const K = d * d - s * s;
    const inner = forceAnti(p1, K, d + s) - forceAnti(p1, K, Math.abs(d - s));
    return TWO_PI * s * s * inner / (2 * d * d * s);
  }, nS);
}

/** Exact mutual potential ENERGY of two single components at separation d. */
export function exactPairPotential(p1, p2, d, nS = 600) {
  if (!(d > 0)) d = 1e-9;
  return radialIntegral(p2, (s) => {
    const inner = potAnti(p1, d + s) - potAnti(p1, Math.abs(d - s));
    return TWO_PI * s * s * inner / (d * s);
  }, nS);
}

/** Sum over every component pair of two (possibly composite) galaxies. */
export function totalForce(P1, P2, d, nS) {
  let F = 0;
  for (const a of partsOf(P1)) for (const b of partsOf(P2)) F += exactPairForce(a, b, d, nS);
  return F;
}
export function totalPotential(P1, P2, d, nS) {
  let W = 0;
  for (const a of partsOf(P1)) for (const b of partsOf(P2)) W += exactPairPotential(a, b, d, nS);
  return W;
}

/**
 * Tabulate F(d) and W(d) on a log grid and return O(1) interpolators.
 *
 * The quadrature is exact but far too slow to run per step, so it runs once per
 * galaxy pair and the integrator reads a table. Log-log interpolation, because
 * both quantities are close to power laws over most of the range.
 *
 * Memoised on the potential objects: `executedPericentre` builds many throwaway
 * sims from the same pair while solving, and rebuilding the table each time
 * would dominate the cost.
 */
const TABLE_CACHE = new WeakMap();

export function pairTable(P1, P2, opts = {}) {
  let inner = TABLE_CACHE.get(P1);
  if (!inner) { inner = new WeakMap(); TABLE_CACHE.set(P1, inner); }
  const hit = inner.get(P2);
  if (hit) return hit;

  const N = opts.n ?? 320;
  const nS = opts.nS ?? 600;
  const scales = [...partsOf(P1), ...partsOf(P2)].map((p) => p.scale).filter((s) => s > 0);
  const dMin = opts.dMin ?? Math.min(...scales) * 1e-3;
  const dMax = opts.dMax ?? Math.max(...scales) * 4e3;
  const lo = Math.log(dMin), hi = Math.log(dMax), step = (hi - lo) / (N - 1);

  const F = new Float64Array(N), W = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const d = Math.exp(lo + i * step);
    F[i] = totalForce(P1, P2, d, nS);
    W[i] = totalPotential(P1, P2, d, nS);
  }

  // CUBIC HERMITE, not linear, and this is not about accuracy — it is about
  // CONSISTENCY. The integrator takes its force from F and the diagnostics take
  // their energy from W. If the two interpolants are independent, F is no longer
  // exactly -dW/dd between nodes, and the leapfrog silently stops conserving the
  // energy being reported: measured 4.9e-4 relative drift over 3000 steps with
  // linear interpolation, against 1e-12 for a closed form.
  //
  // So W is the primary table and F supplies its EXACT nodal derivative
  // (dW/du = |F| d, with u = ln d). A cubic Hermite through (W_i, dW/du_i) is
  // C1, and differentiating that same polynomial gives the force. F and W are
  // then consistent by construction at every d, not merely at the nodes.
  // Measured after the change: drift 1.5e-7 over the same 3000 steps, and the
  // table tracks direct quadrature to 0.006%.
  // dW/du where u = ln d. W is negative and rises toward 0 with separation, so
  // dW/dd = +|F| and dW/du = |F| d. (The attractive force is the -dW/dd
  // component of a vector; |F| here is its magnitude, which is +dW/dd.)
  const dWdu = new Float64Array(N);
  for (let i = 0; i < N; i++) dWdu[i] = F[i] * Math.exp(lo + i * step);

  const locate = (d) => {
    const t = (Math.log(d) - lo) / step;
    const i = Math.min(N - 2, Math.max(0, Math.floor(t)));
    return { i, f: t - i };
  };
  // Hermite basis on the unit interval and its derivative.
  const h00 = (s) => (1 + 2 * s) * (1 - s) * (1 - s);
  const h10 = (s) => s * (1 - s) * (1 - s);
  const h01 = (s) => s * s * (3 - 2 * s);
  const h11 = (s) => s * s * (s - 1);
  const g00 = (s) => 6 * s * (s - 1);
  const g10 = (s) => (1 - s) * (1 - 3 * s);
  const g01 = (s) => 6 * s * (1 - s);
  const g11 = (s) => s * (3 * s - 2);

  // Below dMin the force is linear in d (it must vanish at coincidence by
  // symmetry) and the potential is flat — the cores overlap completely.
  const table = {
    N, lo, hi, step, dMin, dMax, F, W, dWdu,
    potential(d) {
      if (!(d > 0)) return W[0];
      if (d <= dMin) return W[0];
      if (d >= dMax) return W[N - 1] * (dMax / d);
      const { i, f } = locate(d);
      return W[i] * h00(f) + dWdu[i] * step * h10(f)
           + W[i + 1] * h01(f) + dWdu[i + 1] * step * h11(f);
    },
    force(d) {
      if (!(d > 0)) return 0;
      if (d <= dMin) return F[0] * (d / dMin);
      if (d >= dMax) return F[N - 1] * (dMax / d) * (dMax / d);
      const { i, f } = locate(d);
      // dW/du from the derivative of the SAME polynomial, then |F| = (dW/du)/d
      const dwdu = (W[i] * g00(f) + W[i + 1] * g01(f)) / step
                 + dWdu[i] * g10(f) + dWdu[i + 1] * g11(f);
      return dwdu / d;
    },
  };
  inner.set(P2, table);
  return table;
}
