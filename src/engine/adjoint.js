/**
 * Reverse-mode gradients through the restricted forward model.
 *
 * SPIKE, and labelled as one. This is the piece the whole research direction
 * rests on, so it is being built early and small, with the only question that
 * matters answered first: does the analytic gradient agree with finite
 * differences? Everything else — optimisers, posteriors, benchmarks — is worth
 * nothing if it does not.
 *
 * SCOPE, stated so it is not overstated:
 *   - the galaxy trajectory is treated as FIXED and given. Parameters here are
 *     the disc orientation angles, which is exactly the sub-problem Identikit
 *     makes a human solve by hand. Differentiating through the orbit as well is
 *     the same machinery over two more bodies and is not done yet.
 *   - float64 CPU. The float32 GPU path has a measured reversal residual —
 *     median 1.9e-5, p99 9.4e-4, worst 4.89e-3 kpc over 3000 forward and 3000
 *     reverse steps — that would dominate a gradient, so the reference must be
 *     float64 before the fast path can be trusted. Quoting the p99 alone
 *     understated it; the WORST case is what bounds a gradient.
 *   - loss is L2 between Gaussian-splatted density grids, the same KIND of
 *     operation the renderer performs. An earlier version of this comment said
 *     they "are one code path", which is not true and a reviewer was right to
 *     say so: different kernel, different projection, different weighting, no
 *     shared code. Making them one path is a goal, not a description.
 *
 * The adjoint of leapfrog KDK, for one step:
 *     v_mid = v_in  + a(x_in)  * h        (h = dt/2)
 *     x_out = x_in  + v_mid * dt
 *     v_out = v_mid + a(x_out) * h
 * reversed, with A(x) = da/dx the 3x3 Hessian of the potential:
 *     lv_mid = lv_out ;  lx_out += A(x_out)^T lv_out * h
 *     lx_in  = lx_out ;  lv_mid += lx_out * dt
 *     lv_in  = lv_mid ;  lx_in  += A(x_in)^T lv_mid * h
 */

import { rotateToOrbitFrame } from './kepler.js';

/**
 * Acceleration and its Jacobian for a spherical potential.
 *
 * For a = -f(r) d, the Jacobian is  da_i/dx_j = -f delta_ij - f'(r) d_i d_j / r.
 * Symmetric, so transposing it in the adjoint is a no-op — but the code says
 * "transpose" anyway, because that is only true for central forces and the next
 * person to add a non-central term needs the reminder.
 */
export function accelAndJacobian(part, dx, dy, dz, out) {
  const r2 = dx * dx + dy * dy + dz * dz;
  const r = Math.sqrt(r2);
  let f = 0, fp = 0;                       // f(r) and df/dr
  const M = part.mass, a = part.scale;

  if (part.kind === 'plummer') {
    const s = r2 + a * a;
    const s32 = Math.pow(s, 1.5);
    f = M / s32;
    fp = -3 * M * r / (s32 * s);           // -3 M r / (r^2+a^2)^{5/2}
  } else if (part.kind === 'hernquist') {
    if (r < 1e-9) { out.ax = out.ay = out.az = 0; out.J = [0, 0, 0, 0, 0, 0, 0, 0, 0]; return out; }
    const ra = r + a;
    f = M / (r * ra * ra);
    fp = -M * (3 * r + a) / (r2 * ra * ra * ra);
  } else {                                  // point mass
    if (r < 1e-9) { out.ax = out.ay = out.az = 0; out.J = [0, 0, 0, 0, 0, 0, 0, 0, 0]; return out; }
    f = M / (r2 * r);
    fp = -3 * M / (r2 * r2);
  }

  out.ax = -f * dx; out.ay = -f * dy; out.az = -f * dz;
  const g = r > 1e-12 ? fp / r : 0;
  const J = out.J;
  J[0] = -f - g * dx * dx; J[1] = -g * dx * dy;     J[2] = -g * dx * dz;
  J[3] = -g * dy * dx;     J[4] = -f - g * dy * dy; J[5] = -g * dy * dz;
  J[6] = -g * dz * dx;     J[7] = -g * dz * dy;     J[8] = -f - g * dz * dz;
  return out;
}

/** Flatten a composite into its spherical components. */
function components(potential) {
  return potential.kind === 'composite' ? potential.parts : [potential];
}

/**
 * Forward integrate test particles through a PRE-COMPUTED galaxy trajectory,
 * storing the per-step states needed by the reverse pass.
 *
 * States are stored rather than recomputed by reversal. Reversal would be
 * constant-memory and is the eventual plan, but its accuracy is bounded by the
 * measured reversal residual, and a gradient check must not be validating the
 * checkpointing scheme at the same time as the gradient.
 */
export function forward(x0, v0, traj, dt, comps) {
  const n = x0.length / 3;
  const steps = traj.length - 1;
  const xs = new Array(steps + 1), vs = new Array(steps + 1);
  let x = Float64Array.from(x0), v = Float64Array.from(v0);
  xs[0] = Float64Array.from(x); vs[0] = Float64Array.from(v);
  const tmp = { ax: 0, ay: 0, az: 0, J: new Array(9).fill(0) };
  const h = dt / 2;

  for (let s = 0; s < steps; s++) {
    const gNow = traj[s], gNext = traj[s + 1];
    for (let i = 0; i < n; i++) {
      let ax = 0, ay = 0, az = 0;
      for (let c = 0; c < comps.length; c++) {
        const g = gNow[comps[c].parent];
        accelAndJacobian(comps[c].part, x[i * 3] - g[0], x[i * 3 + 1] - g[1], x[i * 3 + 2] - g[2], tmp);
        ax += tmp.ax; ay += tmp.ay; az += tmp.az;
      }
      v[i * 3] += ax * h; v[i * 3 + 1] += ay * h; v[i * 3 + 2] += az * h;
      x[i * 3] += v[i * 3] * dt; x[i * 3 + 1] += v[i * 3 + 1] * dt; x[i * 3 + 2] += v[i * 3 + 2] * dt;
      ax = 0; ay = 0; az = 0;
      for (let c = 0; c < comps.length; c++) {
        const g = gNext[comps[c].parent];
        accelAndJacobian(comps[c].part, x[i * 3] - g[0], x[i * 3 + 1] - g[1], x[i * 3 + 2] - g[2], tmp);
        ax += tmp.ax; ay += tmp.ay; az += tmp.az;
      }
      v[i * 3] += ax * h; v[i * 3 + 1] += ay * h; v[i * 3 + 2] += az * h;
    }
    xs[s + 1] = Float64Array.from(x); vs[s + 1] = Float64Array.from(v);
  }
  return { xs, vs };
}

/**
 * Reverse pass: given dL/dx at the final state, return dL/dx0 and dL/dv0.
 */
export function backward(xs, vs, traj, dt, comps, lxEnd) {
  const steps = traj.length - 1;
  const n = xs[0].length / 3;
  const lx = Float64Array.from(lxEnd);
  const lv = new Float64Array(n * 3);
  const tmp = { ax: 0, ay: 0, az: 0, J: new Array(9).fill(0) };
  const h = dt / 2;

  const applyJT = (state, gState, i, src, dstScale, dst) => {
    // dst += J(state_i)^T * src * dstScale, summed over components
    let a0 = 0, a1 = 0, a2 = 0;
    for (let c = 0; c < comps.length; c++) {
      const g = gState[comps[c].parent];
      accelAndJacobian(comps[c].part,
        state[i * 3] - g[0], state[i * 3 + 1] - g[1], state[i * 3 + 2] - g[2], tmp);
      const J = tmp.J;
      a0 += J[0] * src[0] + J[3] * src[1] + J[6] * src[2];
      a1 += J[1] * src[0] + J[4] * src[1] + J[7] * src[2];
      a2 += J[2] * src[0] + J[5] * src[1] + J[8] * src[2];
    }
    dst[0] += a0 * dstScale; dst[1] += a1 * dstScale; dst[2] += a2 * dstScale;
  };

  const src = [0, 0, 0], acc3 = [0, 0, 0];
  for (let s = steps - 1; s >= 0; s--) {
    const xIn = xs[s], xOut = xs[s + 1];
    const gNow = traj[s], gNext = traj[s + 1];
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      // ---- reverse the second half-kick: v_out = v_mid + a(x_out) h
      src[0] = lv[o]; src[1] = lv[o + 1]; src[2] = lv[o + 2];
      acc3[0] = acc3[1] = acc3[2] = 0;
      applyJT(xOut, gNext, i, src, h, acc3);
      lx[o] += acc3[0]; lx[o + 1] += acc3[1]; lx[o + 2] += acc3[2];
      // lv_mid = lv_out  (unchanged)

      // ---- reverse the drift: x_out = x_in + v_mid dt
      lv[o] += lx[o] * dt; lv[o + 1] += lx[o + 1] * dt; lv[o + 2] += lx[o + 2] * dt;
      // lx_in = lx_out (unchanged)

      // ---- reverse the first half-kick: v_mid = v_in + a(x_in) h
      src[0] = lv[o]; src[1] = lv[o + 1]; src[2] = lv[o + 2];
      acc3[0] = acc3[1] = acc3[2] = 0;
      applyJT(xIn, gNow, i, src, h, acc3);
      lx[o] += acc3[0]; lx[o + 1] += acc3[1]; lx[o + 2] += acc3[2];
      // lv_in = lv_mid (unchanged)
    }
  }
  return { dx0: lx, dv0: lv };
}

/**
 * Gaussian-splat a particle set into a density grid, and the adjoint of that.
 * The same operation the renderer performs, which is the point: the picture and
 * the objective are one code path.
 */
export function splat(x, grid, W, H, extent, sigma) {
  grid.fill(0);
  const n = x.length / 3;
  const s2 = 2 * sigma * sigma;
  const rad = Math.ceil(3 * sigma);
  for (let i = 0; i < n; i++) {
    const px = (x[i * 3] / extent * 0.5 + 0.5) * W;
    const py = (x[i * 3 + 1] / extent * 0.5 + 0.5) * H;
    const i0 = Math.max(0, Math.floor(px - rad)), i1 = Math.min(W - 1, Math.ceil(px + rad));
    const j0 = Math.max(0, Math.floor(py - rad)), j1 = Math.min(H - 1, Math.ceil(py + rad));
    for (let j = j0; j <= j1; j++) {
      for (let k = i0; k <= i1; k++) {
        const dx = k + 0.5 - px, dy = j + 0.5 - py;
        grid[j * W + k] += Math.exp(-(dx * dx + dy * dy) / s2);
      }
    }
  }
  return grid;
}

/** dL/dx for L = sum((splat(x) - target)^2). Only x and y receive gradient. */
export function splatBackward(x, grid, target, W, H, extent, sigma) {
  const n = x.length / 3;
  const g = new Float64Array(n * 3);
  const s2 = 2 * sigma * sigma;
  const rad = Math.ceil(3 * sigma);
  const sx = W / (2 * extent), sy = H / (2 * extent);
  for (let i = 0; i < n; i++) {
    const px = (x[i * 3] / extent * 0.5 + 0.5) * W;
    const py = (x[i * 3 + 1] / extent * 0.5 + 0.5) * H;
    const i0 = Math.max(0, Math.floor(px - rad)), i1 = Math.min(W - 1, Math.ceil(px + rad));
    const j0 = Math.max(0, Math.floor(py - rad)), j1 = Math.min(H - 1, Math.ceil(py + rad));
    let gx = 0, gy = 0;
    for (let j = j0; j <= j1; j++) {
      for (let k = i0; k <= i1; k++) {
        const dx = k + 0.5 - px, dy = j + 0.5 - py;
        const w = Math.exp(-(dx * dx + dy * dy) / s2);
        const dL = 2 * (grid[j * W + k] - target[j * W + k]);
        // d w / d px = w * 2 dx / s2   (dx depends on px with a minus sign twice)
        gx += dL * w * (2 * dx / s2) * sx;
        gy += dL * w * (2 * dy / s2) * sy;
      }
    }
    g[i * 3] = gx; g[i * 3 + 1] = gy;
  }
  return g;
}

/**
 * Disc initial conditions as a differentiable function of two angles, with the
 * analytic derivative of the positions and velocities with respect to them.
 * Finite-differenced in the test rather than hand-derived: the point of this
 * spike is the ADJOINT through time, and hand-deriving the IC Jacobian too
 * would risk one error masking another.
 */
export function discFromAngles(radii, phases, vcirc, inclination, argPeri, centre, vel) {
  const n = radii.length;
  const x = new Float64Array(n * 3), v = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const r = radii[i], th = phases[i], vc = vcirc[i];
    const p = rotateToOrbitFrame([r * Math.cos(th), r * Math.sin(th), 0], inclination, argPeri, 0);
    const w = rotateToOrbitFrame([-vc * Math.sin(th), vc * Math.cos(th), 0], inclination, argPeri, 0);
    x[i * 3] = p[0] + centre[0]; x[i * 3 + 1] = p[1] + centre[1]; x[i * 3 + 2] = p[2] + centre[2];
    v[i * 3] = w[0] + vel[0]; v[i * 3 + 1] = w[1] + vel[1]; v[i * 3 + 2] = w[2] + vel[2];
  }
  return { x, v };
}
