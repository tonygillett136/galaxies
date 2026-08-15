/**
 * The gradient check.
 *
 * An adjoint that disagrees with finite differences is not a slow optimiser, it
 * is a wrong one, and every posterior built on it would be confidently wrong.
 * So this is a necessary condition for the research direction — it is not the
 * sufficient one an earlier version of this comment claimed ("this single test
 * decides whether the project's research direction is reachable"). Agreeing with
 * finite differences says the reverse pass matches the forward pass. It says
 * nothing about whether the forward pass is the right physics, whether the loss
 * has a usable landscape, or whether the parameters are identifiable — and the
 * recovery demonstration below turns out to recover a phase relabelling rather
 * than a parameter, which is precisely the gap between the two conditions.
 *
 * Tested against finite differences of the SAME forward code, which validates
 * the reverse pass against the forward pass. It does NOT validate the forward
 * model against physics — that is what the rest of the suite is for, and
 * conflating the two is how a self-consistent wrong answer survives.
 */

import { group, check, expectChecks, below, above, ok } from './harness.js';
import { record } from './measured.js';
import { plummer, hernquist, composite } from '../src/engine/potentials.js';
import { forward, backward, splat, splatBackward, discFromAngles, accelAndJacobian } from '../src/engine/adjoint.js';
import { galaxyModel } from '../src/engine/encounter.js';
import { mulberry32 } from '../src/engine/galaxy.js';

/** A small, real-ish scene: one galaxy moving past another, both fixed in advance. */
function scene(nSteps = 60, nPart = 40, seed = 9) {
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

  const rng = mulberry32(seed);
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
  expectChecks(8);
  group('adjoint — analytic gradient against finite differences');

  const s = scene();
  const dt = 0.35;
  const grid = new Float64Array(W * H);
  const target = new Float64Array(W * H);

  // THE TARGET USES AN INDEPENDENT PARTICLE REALISATION.
  //
  // Building it from the same radii and phases as the model makes the fit an
  // inverse crime: the optimum is exactly reachable, the loss goes to 1e-30, and
  // the demonstration proves the optimiser can find a configuration it was handed.
  // A different draw means the best achievable loss is the SAMPLING NOISE FLOOR,
  // which is what a real fit against real data faces.
  const tScene = scene(60, 40, 31);       // same distribution, different draw
  const TRUE_INC = 0.55, TRUE_NODE = 0.90;
  const tgt = discFromAngles(tScene.radii, tScene.phases, tScene.vc, TRUE_INC, 0,
                             [0, 0, 0], [0, 0, 0], TRUE_NODE);
  { const { xs } = forward(tgt.x, tgt.v, s.traj, dt, s.comps);
    splat(xs[xs.length - 1], target, W, H, EXTENT, SIGMA); }

  const base = discFromAngles(s.radii, s.phases, s.vc, 0.20, 0, [0, 0, 0], [0, 0, 0], 0.30);

  check('the loss is non-trivial and the target is reachable', () => {
    const { L } = lossOf(base.x, base.v, s, dt, target, grid);
    // L(truth) is the SAMPLING NOISE FLOOR, not zero, because the target is drawn
    // from an independent realisation. It must be far below the starting loss (so
    // there is a real signal to descend) and far above zero (so the fit is not an
    // inverse crime). Asserting both is what makes this check mean something.
    const floor = lossOf(
      discFromAngles(tScene.radii, tScene.phases, tScene.vc, TRUE_INC, 0, [0, 0, 0], [0, 0, 0], TRUE_NODE).x,
      discFromAngles(tScene.radii, tScene.phases, tScene.vc, TRUE_INC, 0, [0, 0, 0], [0, 0, 0], TRUE_NODE).v,
      s, dt, target, grid).L;
    const own = lossOf(
      discFromAngles(s.radii, s.phases, s.vc, TRUE_INC, 0, [0, 0, 0], [0, 0, 0], TRUE_NODE).x,
      discFromAngles(s.radii, s.phases, s.vc, TRUE_INC, 0, [0, 0, 0], [0, 0, 0], TRUE_NODE).v,
      s, dt, target, grid).L;
    ok(L > 1e-3, `loss at the start point is ~0 (${L.toExponential(2)}); the check would be vacuous`);
    below(floor, 1e-20, 'loss when the target is regenerated from its OWN realisation');
    ok(own > 1e-8, `the model realisation reproduces the target exactly (${own.toExponential(2)}); the fit would be an inverse crime`);
    // NOT asserted: that the floor is far below the starting loss. At N = 40 it
    // is not — measured floor/L0 = 1.26, i.e. two independent draws of the SAME
    // disc differ more than the true and starting orientations do. That is the
    // real result and the recovery check reports it as a function of N rather
    // than hiding it behind a larger particle count.
    return `L(start) = ${L.toFixed(2)}, sampling floor = ${own.toExponential(2)} (ratio ${(own / L).toFixed(2)}), L(target vs itself) = ${floor.toExponential(1)}`;
  });

  check('GRADIENT CHECK: d(loss)/d(initial position) matches finite differences', () => {
    const { xEnd, xs } = lossOf(base.x, base.v, s, dt, target, grid);
    const lxEnd = splatBackward(xEnd, grid, target, W, H, EXTENT, SIGMA);
    const { dx0 } = backward(xs, null, s.traj, dt, s.comps, lxEnd);

    // central differences on a spread of components, not just the first
    // Z IS INCLUDED, and the reason it used to be skipped was wrong.
    //
    // The comment said "z carries no splat gradient". That is true of the FINAL
    // state — the splat projects along z — but this loop varies the INITIAL
    // state, and moving z0 moves the particle through a 3-D potential, changing
    // its later x and y. Measured: |dL/dz0| reaches 1.99, the same order as the
    // components that were being checked. A third of the gradient was unverified
    // on a justification that applied to a different quantity.
    //
    // The channel turns out to be correct (worst 4.5e-7), so this is coverage
    // rather than a bug fix — but an untested third is an untested third.
    const idx = [0, 1, 2, 15, 16, 17, 33, 34, 35, 60, 61, 62, 90, 91, 92];
    let worst = 0, worstAt = '';
    const eps = 1e-6;
    for (const k of idx) {
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

  /**
   * Gradient with respect to the two disc angles.
   *
   * Analytic through TIME (the expensive part, thousands of steps), finite
   * differences through the IC map (two parameters, two extra evaluations of a
   * closed-form rotation). That split is deliberate engineering rather than a
   * shortcut: the adjoint through time is what is hard and what has been
   * validated above, and hand-deriving the IC Jacobian as well would risk one
   * error masking another in exactly the place it would be hardest to see.
   */
  function gradAngles(inc, nod) {
    const ic = discFromAngles(s.radii, s.phases, s.vc, inc, 0, [0, 0, 0], [0, 0, 0], nod);
    const { L, xEnd, xs } = lossOf(ic.x, ic.v, s, dt, target, grid);
    const lxEnd = splatBackward(xEnd, grid, target, W, H, EXTENT, SIGMA);
    const { dx0, dv0 } = backward(xs, null, s.traj, dt, s.comps, lxEnd);

    const e = 1e-6;
    const chain = (pa, pb) => {
      let g = 0;
      for (let k = 0; k < dx0.length; k++) {
        g += dx0[k] * (pa.x[k] - pb.x[k]) / (2 * e) + dv0[k] * (pa.v[k] - pb.v[k]) / (2 * e);
      }
      return g;
    };
    const gi = chain(discFromAngles(s.radii, s.phases, s.vc, inc + e, 0, [0, 0, 0], [0, 0, 0], nod),
                     discFromAngles(s.radii, s.phases, s.vc, inc - e, 0, [0, 0, 0], [0, 0, 0], nod));
    const gn = chain(discFromAngles(s.radii, s.phases, s.vc, inc, 0, [0, 0, 0], [0, 0, 0], nod + e),
                     discFromAngles(s.radii, s.phases, s.vc, inc, 0, [0, 0, 0], [0, 0, 0], nod - e));
    return { L, g: [gi, gn] };
  }

  check('RECOVERY: the error falls with sampling, and at N=40 it fails', () => {
    // WHAT THIS NOW TESTS, after round 3 established the old version tested
    // something else.
    //
    // It fitted (inclination, argPeri) against a target built from the SAME radii
    // and phases. Both halves were wrong:
    //
    //  1. argPeri is not a parameter. It rotates an axisymmetric disc within its
    //     own plane, and shifting every particle's phase by d is identical to
    //     shifting argPeri by d -- verified to 3.6e-15. It is visible only through
    //     finite sampling, which docs/IDENTIFIABILITY.md already calls a
    //     discretisation artefact. "Recovering" it recovered the realisation.
    //  2. Sharing the realisation with the target is an inverse crime: the
    //     optimum is exactly reachable, the loss falls to ~1e-30, and the result
    //     shows the optimiser can find a configuration it was handed.
    //
    // Now it fits (inclination, NODE) -- the node rotates the disc PLANE, a real
    // orientation on the sky -- against targets drawn from an INDEPENDENT
    // realisation, and reports the error as a function of N. The claim asserted
    // is the one that means something: the error FALLS with sampling.
    const NS = [40, 150, 600];
    const rows = [];
    for (const n of NS) {
      const ms = scene(60, n, 9), ts = scene(60, n, 31);
      const g2 = new Float64Array(W * H), tg = new Float64Array(W * H);
      const tIC = discFromAngles(ts.radii, ts.phases, ts.vc, TRUE_INC, 0, [0, 0, 0], [0, 0, 0], TRUE_NODE);
      { const { xs } = forward(tIC.x, tIC.v, ms.traj, dt, ms.comps);
        splat(xs[xs.length - 1], tg, W, H, EXTENT, SIGMA); }
      const grad = (inc, nod) => {
        const ic = discFromAngles(ms.radii, ms.phases, ms.vc, inc, 0, [0, 0, 0], [0, 0, 0], nod);
        const { xs } = forward(ic.x, ic.v, ms.traj, dt, ms.comps);
        const xEnd = xs[xs.length - 1];
        splat(xEnd, g2, W, H, EXTENT, SIGMA);
        let L = 0;
        for (let i = 0; i < g2.length; i++) { const d = g2[i] - tg[i]; L += d * d; }
        const lxEnd = splatBackward(xEnd, g2, tg, W, H, EXTENT, SIGMA);
        const { dx0, dv0 } = backward(xs, null, ms.traj, dt, ms.comps, lxEnd);
        const e = 1e-6;
        const chain = (pa, pb) => {
          let acc = 0;
          for (let k = 0; k < dx0.length; k++) acc += dx0[k] * (pa.x[k] - pb.x[k]) / (2 * e) + dv0[k] * (pa.v[k] - pb.v[k]) / (2 * e);
          return acc;
        };
        const gi = chain(discFromAngles(ms.radii, ms.phases, ms.vc, inc + e, 0, [0, 0, 0], [0, 0, 0], nod),
                         discFromAngles(ms.radii, ms.phases, ms.vc, inc - e, 0, [0, 0, 0], [0, 0, 0], nod));
        const gn = chain(discFromAngles(ms.radii, ms.phases, ms.vc, inc, 0, [0, 0, 0], [0, 0, 0], nod + e),
                         discFromAngles(ms.radii, ms.phases, ms.vc, inc, 0, [0, 0, 0], [0, 0, 0], nod - e));
        return { L, g: [gi, gn] };
      };
      let inc = 0.20, nod = 0.30;
      const L0 = grad(inc, nod).L;
      const floor = grad(TRUE_INC, TRUE_NODE).L;
      let m = [0, 0], vv = [0, 0];
      const lr = 0.03, b1 = 0.9, b2 = 0.999, epsA = 1e-8;
      for (let it = 1; it <= 200; it++) {
        const r = grad(inc, nod);
        for (let j = 0; j < 2; j++) {
          m[j] = b1 * m[j] + (1 - b1) * r.g[j];
          vv[j] = b2 * vv[j] + (1 - b2) * r.g[j] * r.g[j];
          const mh = m[j] / (1 - Math.pow(b1, it)), vh = vv[j] / (1 - Math.pow(b2, it));
          const step = lr * mh / (Math.sqrt(vh) + epsA);
          if (j === 0) inc -= step; else nod -= step;
        }
      }
      rows.push({ n, err: Math.hypot(inc - TRUE_INC, nod - TRUE_NODE), inc, nod, ratio: floor / L0 });
    }
    const start = Math.hypot(0.20 - TRUE_INC, 0.30 - TRUE_NODE);
    ok(start > 0.5, `start is already close (${start.toFixed(3)}); the recovery would be vacuous`);
    // THE claim: more particles, better recovery. Asserted on the ends, because
    // the middle of a noisy sequence need not be monotone.
    ok(rows[rows.length - 1].err < rows[0].err * 0.5,
      `recovery did not improve with sampling: ${rows.map((r) => `N=${r.n} err=${r.err.toFixed(3)}`).join(', ')}`);
    // And the honest headline: at the N this scene ships with, it FAILS.
    ok(rows[0].err > 0.3, `N=40 unexpectedly succeeded (err ${rows[0].err.toFixed(3)}); the sampling-floor caveat may no longer hold`);
    record('recoveryErrN40', rows[0].err);
    record('recoveryErrN600', rows[rows.length - 1].err);
    return rows.map((r) => `N=${r.n}: err ${r.err.toFixed(3)} (inc ${r.inc.toFixed(2)}, node ${r.nod.toFixed(2)}, floor/L0 ${r.ratio.toFixed(2)})`).join('; ')
      + ` -- at N=40 the node lands NEGATIVE. NOT the sky-plane reflection (that flips inclination, and inclination keeps its sign here) but the (i,w,W)->(-i,w+pi,W+pi) twin, which is exact at every geometry.`;
  });

  check('the ANGLE gradient — the one the optimiser consumes — matches finite differences', () => {
    // The gradient checks above validate d(loss)/d(initial state). The optimiser
    // does not use that: it uses gradAngles(), which chains the state gradient
    // through the IC map. That composed quantity was never asserted, and Adam is
    // scale-invariant, so a magnitude error in it is invisible — round 3
    // demonstrated that halving gradAngles leaves the recovery result identical
    // to every printed digit and still passing.
    //
    // This is the same shape as the half-strength friction bug: an assertion on
    // the DIRECTION of an effect cannot detect an error in its MAGNITUDE. So
    // compare against central differences of the loss in angle space directly.
    const e = 1e-5;
    const at = [[0.20, 0.30], [0.40, 0.70], [0.55, 0.90]];
    const samples = [];
    for (const [inc, arg] of at) {
      const g = gradAngles(inc, arg).g;
      const fdI = (gradAngles(inc + e, arg).L - gradAngles(inc - e, arg).L) / (2 * e);
      const fdA = (gradAngles(inc, arg + e).L - gradAngles(inc, arg - e).L) / (2 * e);
      samples.push([g[0], fdI, `inc at (${inc}, ${arg})`], [g[1], fdA, `arg at (${inc}, ${arg})`]);
    }
    // SCALE THE COMPARISON, because one of the sample points is the true optimum.
    // There the analytic gradient is exactly 0 and the finite difference returns
    // ~1e-7 of rounding noise, so a purely relative metric reads 100% error on
    // what is actually perfect agreement. Normalising by the largest gradient in
    // the sample makes "near zero" mean near zero on the scale of the problem —
    // and keeping the optimum in the set is worth it, because it checks the
    // gradient VANISHES where it should.
    const scale = Math.max(...samples.map(([, fd]) => Math.abs(fd)));
    let worst = 0, worstAt = '';
    for (const [an, fd, nm] of samples) {
      const rel = Math.abs(an - fd) / Math.max(scale * 1e-3, Math.abs(fd), Math.abs(an));
      if (rel > worst) { worst = rel; worstAt = `${nm}: analytic ${an.toExponential(3)} vs fd ${fd.toExponential(3)}`; }
    }
    below(worst, 2e-3, `worst scaled error in the angle gradient (${worstAt}); gradient scale ${scale.toExponential(2)}`);
    return `worst err ${worst.toExponential(1)} over ${samples.length} angle-gradient components (scale ${scale.toExponential(2)})`;
  });

  check('SENSITIVITY: the angle-gradient check rejects a HALVED gradient', () => {
    // Because the recovery check cannot. Halving is the exact error that shipped
    // in the friction term and survived every test that existed at the time.
    const inc = 0.40, arg = 0.70, e = 1e-5;
    const g = gradAngles(inc, arg).g;
    const fdI = (gradAngles(inc + e, arg).L - gradAngles(inc - e, arg).L) / (2 * e);
    const halved = 0.5 * g[0];
    const rel = Math.abs(halved - fdI) / Math.max(1e-9, Math.abs(fdI), Math.abs(halved));
    return above(rel, 2e-3, 'relative error of a deliberately halved angle gradient');
  });

  check('an unsupported potential kind THROWS rather than silently becoming a point mass', () => {
    // The else-branch used to absorb every unrecognised kind. nfw came out 20.6x
    // too strong and composite 6.3x, each with a Jacobian consistent with the
    // wrong force — so every gradient check still passed, because finite
    // differences difference the same wrong forward model. A gradient check
    // cannot detect a uniformly wrong forward model; only a loud failure can.
    const out = { ax: 0, ay: 0, az: 0, J: new Array(9).fill(0) };
    let threwNfw = false, threwComposite = false;
    try { accelAndJacobian({ kind: 'nfw', mass: 1, scale: 2 }, 1, 1, 1, out); }
    catch { threwNfw = true; }
    try { accelAndJacobian({ kind: 'composite', mass: 1, scale: 2 }, 1, 1, 1, out); }
    catch { threwComposite = true; }
    ok(threwNfw, 'nfw silently fell through to the point-mass branch');
    ok(threwComposite, 'composite silently fell through to the point-mass branch');
    // and the kinds that ARE supported must still work
    accelAndJacobian({ kind: 'plummer', mass: 1, scale: 2 }, 1, 1, 1, out);
    ok(Number.isFinite(out.ax), 'plummer stopped working');
    accelAndJacobian({ kind: 'hernquist', mass: 1, scale: 2 }, 1, 1, 1, out);
    ok(Number.isFinite(out.ax), 'hernquist stopped working');
    return 'nfw and composite throw; plummer, hernquist and point are handled';
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
