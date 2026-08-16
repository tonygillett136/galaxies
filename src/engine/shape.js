// Shape and kinematics of a particle system, and a self-test.
//
// The first version of this got v/sigma wrong in two ways at once and it was the
// CONTROL that exposed it: a cold rotating disc read v/sigma = 0.01, identical to
// the merger remnant. Both bugs produce a plausible number rather than an error.
//
//  1. The inertia eigenvalues were sorted but the eigenVECTORS were not reordered
//     with them, so the "minor axis" was whichever axis Jacobi happened to leave
//     in slot 2 rather than the shortest one.
//  2. The system's bulk velocity was never subtracted, so a galaxy travelling
//     along its orbit had that motion mixed into its internal kinematics.
//
// Hence the self-test at the bottom: a cold disc MUST read v/sigma well above 1,
// and an isotropic non-rotating blob MUST read well below it. An instrument that
// has not been seen to distinguish the two cannot be used to claim that a merger
// destroyed rotation.

/** Symmetric 3x3 eigen-decomposition by cyclic Jacobi. Returns sorted desc. */
export function eigenSym3(Min) {
  let A = Min.map((r) => r.slice());
  let V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 100; sweep++) {
    let p = 0, q = 1, mx = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
      if (Math.abs(A[i][j]) > mx) { mx = Math.abs(A[i][j]); p = i; q = j; }
    }
    if (mx < 1e-14) break;
    const theta = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]);
    const c = Math.cos(theta), s = Math.sin(theta);
    const G = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    G[p][p] = c; G[q][q] = c; G[p][q] = s; G[q][p] = -s;
    const mul = (X, Y) => X.map((r, i) => Y[0].map((_, j) => r.reduce((a, v, k) => a + v * Y[k][j], 0)));
    const Gt = G[0].map((_, j) => G.map((r) => r[j]));
    A = mul(mul(Gt, A), G);
    V = mul(V, G);
  }
  const idx = [0, 1, 2].sort((a, b) => A[b][b] - A[a][a]);
  return {
    values: idx.map((i) => A[i][i]),
    // COLUMN i of V is the eigenvector for A[i][i]; reorder them WITH the values
    vectors: idx.map((i) => [V[0][i], V[1][i], V[2][i]]),
  };
}

/**
 * @param get  (i) => ({x,y,z,vx,vy,vz,m}) for particle i
 * @param idx  indices to include
 * @param centre  spatial centre
 * @param rMax  only particles within this radius
 */
export function shapeKinematics(get, idx, centre, rMax = Infinity) {
  const sel = [];
  let M = 0, vx = 0, vy = 0, vz = 0;
  for (const i of idx) {
    const p = get(i);
    const d = [p.x - centre[0], p.y - centre[1], p.z - centre[2]];
    if (Math.hypot(...d) > rMax) continue;
    sel.push({ d, v: [p.vx, p.vy, p.vz], m: p.m });
    M += p.m; vx += p.m * p.vx; vy += p.m * p.vy; vz += p.m * p.vz;
  }
  if (M <= 0 || sel.length < 50) return null;
  // BULK VELOCITY REMOVED. Internal kinematics only.
  const vbulk = [vx / M, vy / M, vz / M];
  for (const s of sel) s.v = [s.v[0] - vbulk[0], s.v[1] - vbulk[1], s.v[2] - vbulk[2]];

  const I = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const s of sel) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) I[a][b] += s.m * s.d[a] * s.d[b];
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) I[a][b] /= M;
  const e = eigenSym3(I);
  const axes = e.values.map((v) => Math.sqrt(Math.max(v, 0)));

  // Rotation axis is the ANGULAR MOMENTUM direction, not an inertia eigenvector:
  // a non-rotating triaxial system has no preferred spin axis, and asking for
  // rotation about its shortest axis invents one.
  let L = [0, 0, 0];
  for (const s of sel) {
    L[0] += s.m * (s.d[1] * s.v[2] - s.d[2] * s.v[1]);
    L[1] += s.m * (s.d[2] * s.v[0] - s.d[0] * s.v[2]);
    L[2] += s.m * (s.d[0] * s.v[1] - s.d[1] * s.v[0]);
  }
  const Lmag = Math.hypot(...L) || 1;
  const n = L.map((c) => c / Lmag);

  let vrot = 0, v2 = 0;
  for (const s of sel) {
    // azimuthal direction about n
    const rxn = [n[1] * s.d[2] - n[2] * s.d[1], n[2] * s.d[0] - n[0] * s.d[2], n[0] * s.d[1] - n[1] * s.d[0]];
    const len = Math.hypot(...rxn);
    if (len > 1e-9) {
      const vphi = -(s.v[0] * rxn[0] + s.v[1] * rxn[1] + s.v[2] * rxn[2]) / len;
      vrot += s.m * vphi;
    }
    v2 += s.m * (s.v[0] ** 2 + s.v[1] ** 2 + s.v[2] ** 2);
  }
  vrot = Math.abs(vrot / M);
  const sigma = Math.sqrt(Math.max(v2 / M - vrot * vrot, 0) / 3);
  return {
    b_a: axes[1] / axes[0], c_a: axes[2] / axes[0],
    vrot, sigma, vOverSigma: vrot / Math.max(sigma, 1e-9), n: sel.length,
  };
}
