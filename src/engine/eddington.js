/**
 * Isotropic distribution function by Eddington inversion.
 *
 * WHY THIS EXISTS. `livehalo.js` samples a halo from the analytic Hernquist
 * distribution function, which is the equilibrium DF of a Hernquist sphere
 * ALONE. Dropping a disc and a bulge into the middle of it makes that DF wrong:
 * the halo is no longer in equilibrium with the potential it actually sits in,
 * and it contracts. Measured, this contracted the inner halo by 23-38% within
 * 141 Myr and heated the disc from 29 to 47 km/s — an effect that survived six
 * hypotheses because every one of them was tested by measuring the DISC.
 *
 * The remedy is standard: build the halo's DF in the TOTAL potential.
 *
 *   f(E) = 1/(sqrt(8) pi^2) * INT_0^E  d^2rho/dPsi^2  dPsi / sqrt(E - Psi)
 *
 * with Psi = -Phi the relative potential of EVERYTHING (halo + disc + bulge) and
 * rho the density of the component being sampled (the halo alone).
 *
 * SPHERICAL APPROXIMATION, STATED. Eddington's formula assumes spherical
 * symmetry, and a disc is not spherical. The disc's contribution is taken as its
 * monopole — which in this model is exactly the Plummer sphere `galaxyModel`
 * already uses to carry the disc mass, so no new approximation is introduced
 * beyond the one the mass model already makes. The halo is far more extended
 * than the disc, so its DF is insensitive to the disc's flattening.
 *
 * The singularity at Psi = E is removed by substituting Psi = E - u^2, which
 * turns dPsi/sqrt(E-Psi) into 2 du. Nothing is left to special-case.
 */

/**
 * @param {(r:number)=>number} rho   density of the component being sampled
 * @param {(r:number)=>number} psi   TOTAL relative potential, -Phi, positive and decreasing
 * @param {Object} o
 * @param {number} o.rMin, o.rMax    radial range of the tabulation
 * @param {number} o.nR              grid points (log spaced)
 * @param {number} o.nE              energies tabulated
 */
export function eddingtonDF(rho, psi, o = {}) {
  const { rMin = 1e-4, rMax = 1e5, nR = 4000, nE = 600 } = o;

  // log-spaced radial grid, then everything expressed against Psi
  const r = new Float64Array(nR), Ps = new Float64Array(nR), Rh = new Float64Array(nR);
  for (let i = 0; i < nR; i++) {
    r[i] = rMin * Math.pow(rMax / rMin, i / (nR - 1));
    Ps[i] = psi(r[i]);
    Rh[i] = rho(r[i]);
  }
  // Psi decreases with r, so reversing gives Psi ascending, which is what the
  // interpolation below wants.
  const P = new Float64Array(nR), D = new Float64Array(nR);
  for (let i = 0; i < nR; i++) { P[i] = Ps[nR - 1 - i]; D[i] = Rh[nR - 1 - i]; }
  for (let i = 1; i < nR; i++) if (!(P[i] > P[i - 1])) P[i] = P[i - 1] * (1 + 1e-12);

  // drho/dPsi and d2rho/dPsi2 by finite differences on the (non-uniform) Psi grid
  const d1 = new Float64Array(nR), d2 = new Float64Array(nR);
  for (let i = 1; i < nR - 1; i++) {
    d1[i] = (D[i + 1] - D[i - 1]) / (P[i + 1] - P[i - 1]);
  }
  d1[0] = d1[1]; d1[nR - 1] = d1[nR - 2];
  for (let i = 1; i < nR - 1; i++) {
    d2[i] = (d1[i + 1] - d1[i - 1]) / (P[i + 1] - P[i - 1]);
  }
  d2[0] = d2[1]; d2[nR - 1] = d2[nR - 2];

  const interp = (arr, x) => {
    if (x <= P[0]) return arr[0];
    if (x >= P[nR - 1]) return arr[nR - 1];
    let lo = 0, hi = nR - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m] < x) lo = m; else hi = m; }
    const t = (x - P[lo]) / (P[hi] - P[lo]);
    return arr[lo] + t * (arr[hi] - arr[lo]);
  };

  // f(E) on a grid of E from 0 to Psi(0)
  const Emax = P[nR - 1];
  const Eg = new Float64Array(nE + 1), Fg = new Float64Array(nE + 1);
  const NU = 600;
  const C = 1 / (Math.sqrt(8) * Math.PI * Math.PI);
  for (let k = 0; k <= nE; k++) {
    // denser sampling near Emax, where f rises steeply
    const E = Emax * Math.pow(k / nE, 1.5);
    Eg[k] = E;
    if (E <= 0) { Fg[k] = 0; continue; }
    const uMax = Math.sqrt(E);
    let acc = 0;
    for (let j = 0; j < NU; j++) {
      const u0 = (j / NU) * uMax, u1 = ((j + 1) / NU) * uMax;
      const f0 = interp(d2, E - u0 * u0), f1 = interp(d2, E - u1 * u1);
      acc += 0.5 * (f0 + f1) * (u1 - u0);
    }
    Fg[k] = Math.max(0, C * 2 * acc);
  }

  const f = (E) => {
    if (!(E > 0) || E >= Emax) return 0;
    const t = Math.pow(E / Emax, 1 / 1.5) * nE;
    const i = Math.min(nE - 1, Math.max(0, Math.floor(t)));
    const w = t - i;
    return Fg[i] + w * (Fg[i + 1] - Fg[i]);
  };
  f.Emax = Emax;
  f.table = { E: Eg, F: Fg };
  return f;
}

/**
 * Sample speeds from an isotropic f(E) at radius r, by rejection against the
 * phase-space weight v^2 f(Psi - v^2/2). The envelope is tabulated per radius,
 * because scanning for the peak per particle would dominate the cost.
 */
export function makeSpeedSampler(f, psi, rMax, nR = 512) {
  const peaks = new Float64Array(nR + 1);
  const rOf = (k) => rMax * Math.pow(k / nR, 3);
  for (let k = 0; k <= nR; k++) {
    const rr = Math.max(rOf(k), 1e-4);
    const Ps = psi(rr), ve = Math.sqrt(2 * Ps);
    let mx = 0;
    for (let j = 1; j < 400; j++) {
      const v = (j / 400) * ve;
      mx = Math.max(mx, v * v * f(Ps - 0.5 * v * v));
    }
    peaks[k] = mx * 1.08;
  }
  return (r, rng) => {
    const Ps = psi(r), ve = Math.sqrt(2 * Ps);
    const k = Math.min(nR, Math.max(0, Math.round(nR * Math.cbrt(r / rMax))));
    const gmax = Math.max(peaks[k], 1e-300);
    for (let t = 0; t < 10000; t++) {
      const v = rng() * ve;
      if (rng() * gmax <= v * v * f(Ps - 0.5 * v * v)) return v;
    }
    return 0;
  };
}
