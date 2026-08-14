/**
 * The gradient check.
 *
 * This single test decides whether the project's research direction is reachable.
 * An adjoint that disagrees with finite differences is not a slow optimiser, it
 * is a wrong one, and every posterior built on it would be confidently wrong.
 *
 * Tested against finite differences of the SAME forward code, which validates
 * the reverse pass against the forward pass. It does NOT validate the forward
 * model against physics — that is what the rest of the suite is for, and
 * conflating the two is how a self-consistent wrong answer survives.
 */

import { group, check, expectChecks, below, above, ok } from './harness.js';
import { plummer, hernquist, composite } from '../src/engine/potentials.js';
import { forward, backward, splat, splatBackward, discFromAngles } from '../src/engine/adjoint.js';
import { galaxyModel } from '../src/engine/encounter.js';
import { mulberry32 } from '../src/engine/galaxy.js';

/** A small, real-ish scene: one galaxy moving past another, both fixed in advance. */
function scene(nSteps = 60, nPart = 40) {
  const P1 = galaxyModel(1.0), P2 = galaxyModel(0.5, Math.cbrt(0.5));
  const comps = [];
  for (const p of (P1.kind === 'composite' ? P1.parts : [P1])) comps.push({ parent: 0, part: p });
  for (const p of (P2.kind === 'composite' ? P2.parts : [P2])) comps.push({ parent: 1, part: p });

  // pre-computed galaxy trajectory: a straight-line fly-past is enough to
  // exercise a time-varying field without entangling the orbit's own gradient
  const traj = [];
  for (let s = 0; s <= nSteps; s++) {
    const t = s / nSteps;
    traj.push([[0, 0, 0], [-40 + 90 * t, 26, 4]]);
  }

  const rng = mulberry32(9);
  const radii = [], phases = [], vc = [];
  for (let i = 0; i < nPart; i++) {
    const r = 4 + 9 * rng();
    radii.push(r); phases.push(2 * Math.PI * rng()); vc.push(P1.vcirc(r));
  }
  return { comps, traj, radii, phases, vc, P1 };
}

const W = 24, H = 24, EXTENT = 40, SIGMA = 1.6;

function lossOf(x0, v0, s, dt, target, gridBuf) {
  const { xs } = forward(x0, v0, s.traj, dt, s.comps);
  const xEnd = xs[xs.length - 1];
  splat(xEnd, gridBuf, W, H, EXTENT, SIGMA);
  let L = 0;
  for (let i = 0; i < gridBuf.length; i++) { const d = gridBuf[i] - target[i]; L += d * d; }
  return { L, xEnd, xs };
}

export function runAdjointTests() {
  expectChecks(4);
  group('adjoint — analytic gradient against finite differences');

  const s = scene();
  const dt = 0.35;
  const grid = new Float64Array(W * H);
  const target = new Float64Array(W * H);

  // a target produced by a DIFFERENT disc orientation, so the loss is not zero
  const tgt = discFromAngles(s.radii, s.phases, s.vc, 0.55, 0.9, [0, 0, 0], [0, 0, 0]);
  { const { xs } = forward(tgt.x, tgt.v, s.traj, dt, s.comps);
    splat(xs[xs.length - 1], target, W, H, EXTENT, SIGMA); }

  const base = discFromAngles(s.radii, s.phases, s.vc, 0.20, 0.3, [0, 0, 0], [0, 0, 0]);

  check('the loss is non-trivial and the target is reachable', () => {
    const { L } = lossOf(base.x, base.v, s, dt, target, grid);
    const { L: L0 } = lossOf(tgt.x, tgt.v, s, dt, target, grid);
    ok(L > 1e-3, `loss at the start point is ~0 (${L.toExponential(2)}); the check would be vacuous`);
    below(L0, 1e-20, 'loss at the true parameters');
    return `L(start) = ${L.toFixed(3)}, L(truth) = ${L0.toExponential(1)}`;
  });

  check('GRADIENT CHECK: d(loss)/d(initial position) matches finite differences', () => {
    const { xEnd, xs } = lossOf(base.x, base.v, s, dt, target, grid);
    const lxEnd = splatBackward(xEnd, grid, target, W, H, EXTENT, SIGMA);
    const { dx0 } = backward(xs, null, s.traj, dt, s.comps, lxEnd);

    // central differences on a spread of components, not just the first
    const idx = [0, 1, 15, 16, 33, 34, 60, 61, 90, 91];
    let worst = 0, worstAt = '';
    const eps = 1e-6;
    for (const k of idx) {
      if (k % 3 === 2) continue;                       // z carries no splat gradient
      const xp = Float64Array.from(base.x), xm = Float64Array.from(base.x);
      xp[k] += eps; xm[k] -= eps;
      const Lp = lossOf(xp, base.v, s, dt, target, grid).L;
      const Lm = lossOf(xm, base.v, s, dt, target, grid).L;
      const fd = (Lp - Lm) / (2 * eps);
      const an = dx0[k];
      const rel = Math.abs(fd - an) / Math.max(1e-12, Math.abs(fd), Math.abs(an));
      if (rel > worst) { worst = rel; worstAt = `k=${k} fd=${fd.toExponential(3)} adj=${an.toExponential(3)}`; }
    }
    below(worst, 2e-5, `worst relative gradient error (${worstAt})`);
    return `worst rel err ${worst.toExponential(1)} over ${idx.length} components`;
  });

  check('GRADIENT CHECK: d(loss)/d(initial velocity) matches finite differences', () => {
    const { xEnd, xs } = lossOf(base.x, base.v, s, dt, target, grid);
    const lxEnd = splatBackward(xEnd, grid, target, W, H, EXTENT, SIGMA);
    const { dv0 } = backward(xs, null, s.traj, dt, s.comps, lxEnd);

    const idx = [0, 1, 15, 16, 45, 46];
    let worst = 0, worstAt = '';
    const eps = 1e-6;
    for (const k of idx) {
      const vp = Float64Array.from(base.v), vm = Float64Array.from(base.v);
      vp[k] += eps; vm[k] -= eps;
      const Lp = lossOf(base.x, vp, s, dt, target, grid).L;
      const Lm = lossOf(base.x, vm, s, dt, target, grid).L;
      const fd = (Lp - Lm) / (2 * eps);
      const an = dv0[k];
      const rel = Math.abs(fd - an) / Math.max(1e-12, Math.abs(fd), Math.abs(an));
      if (rel > worst) { worst = rel; worstAt = `k=${k} fd=${fd.toExponential(3)} adj=${an.toExponential(3)}`; }
    }
    below(worst, 2e-5, `worst relative gradient error (${worstAt})`);
    return `worst rel err ${worst.toExponential(1)} over ${idx.length} components`;
  });

  check('SENSITIVITY: a deliberately wrong adjoint fails this check', () => {
    // Rule 21 again. If the comparison passes with a corrupted gradient it is
    // measuring nothing. Scale the returned gradient by 1.01 and require the
    // check to notice — 1% is far smaller than any plausible sign or index error.
    const { xEnd, xs } = lossOf(base.x, base.v, s, dt, target, grid);
    const lxEnd = splatBackward(xEnd, grid, target, W, H, EXTENT, SIGMA);
    const { dx0 } = backward(xs, null, s.traj, dt, s.comps, lxEnd);

    const eps = 1e-6, k = 0;
    const xp = Float64Array.from(base.x), xm = Float64Array.from(base.x);
    xp[k] += eps; xm[k] -= eps;
    const fd = (lossOf(xp, base.v, s, dt, target, grid).L
              - lossOf(xm, base.v, s, dt, target, grid).L) / (2 * eps);
    const corrupted = dx0[k] * 1.01;
    const rel = Math.abs(fd - corrupted) / Math.max(1e-12, Math.abs(fd));
    return above(rel, 2e-5, 'relative error with a 1% corrupted gradient');
  });
}
