/**
 * Separating STREAMING from RANDOM motion in a disc.
 *
 * Why this exists. The obvious way to measure a disc's radial velocity
 * dispersion is the rms of v_R about the disc centre. That is what was done, and
 * it says a live halo heats the disc from 29 to 47.5 km/s in 52 Myr — a result
 * that survived five separate attempts to explain it and is contradicted by its
 * own side effect, because the same runs show MORE non-axisymmetric structure,
 * and genuine heating raises Toomre Q which suppresses structure.
 *
 * A spiral arm or a bar carries large ORDERED radial motions: material streams
 * inward on one side and outward on the other. An rms about the centre counts
 * that as random, because all it knows about is departure from a circular orbit.
 *
 * WHY A FOURIER FIT AND NOT BINS. The first version binned in (R, phi) and took
 * the scatter within a bin as random and the scatter of the bin means as
 * streaming. Its self-test failed in both directions and the failures were
 * instructive:
 *
 *   - a PURE cos(2phi) streaming field with no random motion reported
 *     sigma_random = 0.075, because cos(2phi) varies ACROSS a 22.5 degree bin and
 *     that variation is within-bin scatter. The bias is the bin width, so no
 *     amount of care with the estimator inside the bin removes it.
 *   - a PURE random field reported sigma_streaming = 0.084, because 16 free bin
 *     means will always absorb some noise.
 *
 * Fitting a smooth Fourier series in phi has no bin width to be biased by, and
 * the noise the fit absorbs is exactly (p-1) sigma^2 / n for p parameters, which
 * can be subtracted rather than estimated. Both leaks close.
 */

/** Solve A x = b for small symmetric A by Gaussian elimination with partial pivoting. */
function solve(A, b, p) {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= p; k++) M[r][k] -= f * M[c][k];
    }
  }
  // row is M[i]; the diagonal element is row[i] and the RHS is row[p].
  return M.map((row, i) => row[p] / row[i]);
}

/**
 * @param {(i:number)=>{x,y,z,vx,vy,vz,m}} get
 * @param {number[]} idx
 * @param {number[]} centre
 * @param {Object} o
 * @param {number} o.nR    radial rings
 * @param {number} o.mMax  highest azimuthal harmonic treated as streaming
 */
export function decomposeDiscVelocities(get, idx, centre, o = {}) {
  const { rMin = 0, rMax = Infinity, nR = 10, mMax = 4 } = o;
  const p = 2 * mMax + 1;

  // bulk motion removed first, for the same reason it is removed in shape.js:
  // a disc drifting bodily reads as radial dispersion around the ring
  let M = 0, bx = 0, by = 0;
  const P = [];
  for (const i of idx) {
    const q = get(i);
    const dx = q.x - centre[0], dy = q.y - centre[1];
    const R = Math.hypot(dx, dy);
    if (R < rMin || R >= rMax || R < 1e-9) continue;
    P.push({ R, phi: Math.atan2(dy, dx), dx, dy, vx: q.vx, vy: q.vy, m: q.m });
    M += q.m; bx += q.m * q.vx; by += q.m * q.vy;
  }
  if (P.length < nR * p * 8) return null;
  bx /= M; by /= M;

  const lo = Math.min(...P.map((q) => q.R)), hi = Math.max(...P.map((q) => q.R));
  const ringOf = (R) => Math.min(nR - 1, Math.floor(((R - lo) / (hi - lo)) * nR));
  const rings = Array.from({ length: nR }, () => []);
  for (const q of P) {
    q.vR = ((q.vx - bx) * q.dx + (q.vy - by) * q.dy) / q.R;
    rings[ringOf(q.R)].push(q);
  }

  let randSS = 0, streamSS = 0, totW = 0, usedRings = 0, minN = Infinity;
  for (const ring of rings) {
    const n = ring.length;
    if (n < 8 * p) continue;
    const basis = (phi) => {
      const b2 = [1];
      for (let m = 1; m <= mMax; m++) { b2.push(Math.cos(m * phi), Math.sin(m * phi)); }
      return b2;
    };
    const A = Array.from({ length: p }, () => new Float64Array(p));
    const rhs = new Float64Array(p);
    let W = 0, sy = 0, syy = 0;
    for (const q of ring) {
      const f = basis(q.phi), w = q.m;
      for (let a = 0; a < p; a++) {
        rhs[a] += w * f[a] * q.vR;
        for (let b2 = 0; b2 < p; b2++) A[a][b2] += w * f[a] * f[b2];
      }
      W += w; sy += w * q.vR; syy += w * q.vR * q.vR;
    }
    const coef = solve(A.map((r) => Array.from(r)), Array.from(rhs), p);
    if (!coef) continue;
    let ssres = 0;
    for (const q of ring) {
      const f = basis(q.phi);
      let fit = 0;
      for (let a = 0; a < p; a++) fit += coef[a] * f[a];
      ssres += q.m * (q.vR - fit) ** 2;
    }
    const mean = sy / W;
    const sstot = syy - W * mean * mean;         // variance about the ring mean
    // Unbiased random variance: p parameters were fitted, so n-p degrees of
    // freedom remain. Without this the random term is biased low and fine
    // harmonics would manufacture the answer this function exists to test.
    const varRandom = (ssres / W) * (n / (n - p));
    // The explained variance contains the noise the fit absorbed, which for p
    // parameters (one of them the mean) is (p-1) sigma^2 / n. Subtract it, or a
    // perfectly smooth disc reports spurious streaming.
    const varStream = Math.max(0, (sstot - ssres) / W - (p - 1) * varRandom / n);
    randSS += W * varRandom; streamSS += W * varStream; totW += W;
    usedRings++; minN = Math.min(minN, n);
  }
  if (totW <= 0) return null;

  const sigmaRandom = Math.sqrt(randSS / totW);
  const sigmaStreaming = Math.sqrt(streamSS / totW);
  return {
    sigmaRandom, sigmaStreaming,
    sigmaTotal: Math.sqrt(sigmaRandom ** 2 + sigmaStreaming ** 2),
    usedRings, minPerRing: minN === Infinity ? 0 : minN, nParticles: P.length, mMax,
  };
}
