/**
 * Analytic spherical potentials, CPU reference implementations.
 *
 * These are the ground truth the WGSL kernels are asserted against. Keeping a
 * second independent implementation is worth more than types: two implementations
 * agreeing is evidence, one implementation agreeing with itself is not.
 *
 * All in internal units (G = 1). Every one exposes the same three functions so
 * they are interchangeable and so a test can sweep across all of them.
 *
 *   accel(dx, dy, dz, out)  acceleration at displacement d FROM the centre
 *   vcirc(r)                circular speed of a test particle at radius r
 *   potential(r)            specific potential energy, for energy bookkeeping
 *
 * Sign convention: accel is what the particle experiences, so it points back
 * towards the centre. Getting this backwards produces a galaxy that expands
 * smoothly and looks almost plausible for about fifty steps, which is why there
 * is a test for it.
 */

/** Point mass. Toomre & Toomre 1972 used these. Singular at r = 0. */
export function pointMass(mass) {
  return {
    kind: 'point', mass, scale: 0,
    accel(dx, dy, dz, out) {
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 === 0) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
      const inv = 1 / Math.sqrt(r2);
      const f = -mass * inv * inv * inv;
      out[0] = f * dx; out[1] = f * dy; out[2] = f * dz;
      return out;
    },
    vcirc: (r) => Math.sqrt(mass / r),
    potential: (r) => -mass / r,
  };
}

/**
 * Plummer sphere. Phi = -GM / sqrt(r^2 + a^2).
 * The softened stand-in for a point mass, and what we use where Toomre & Toomre
 * used a point mass, because a is then both the softening and a real model scale.
 */
export function plummer(mass, a) {
  const a2 = a * a;
  return {
    kind: 'plummer', mass, scale: a,
    accel(dx, dy, dz, out) {
      const r2 = dx * dx + dy * dy + dz * dz + a2;
      const inv = 1 / Math.sqrt(r2);
      const f = -mass * inv * inv * inv;
      out[0] = f * dx; out[1] = f * dy; out[2] = f * dz;
      return out;
    },
    // v_c^2 = r|g| = GM r^2 / (r^2+a^2)^{3/2}
    vcirc: (r) => Math.sqrt(mass * r * r / Math.pow(r * r + a2, 1.5)),
    potential: (r) => -mass / Math.sqrt(r * r + a2),
  };
}

/**
 * Hernquist 1990. Phi = -GM / (r + a).
 * Finite total mass with an r^-1 inner cusp, so it is the analytically
 * convenient stand-in for an NFW halo and the standard choice for a bulge.
 */
export function hernquist(mass, a) {
  return {
    kind: 'hernquist', mass, scale: a,
    accel(dx, dy, dz, out) {
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 === 0) {              // force magnitude GM/a^2 is finite; zero by symmetry
        out[0] = 0; out[1] = 0; out[2] = 0; return out;
      }
      // No epsilon added to r. An epsilon here is not a safety net, it is a
      // systematic error: 1e-12 added to r showed up as a 3.7e-12 relative
      // mismatch against v_circ and failed the consistency assertion.
      const r = Math.sqrt(r2);
      const ra = r + a;
      const f = -mass / (ra * ra * r);
      out[0] = f * dx; out[1] = f * dy; out[2] = f * dz;
      return out;
    },
    vcirc: (r) => Math.sqrt(mass * r) / (r + a),
    potential: (r) => -mass / (r + a),
  };
}

/**
 * Navarro-Frenk-White, truncated at a concentration.
 * rho ~ 1/(r/rs (1+r/rs)^2). Enclosed mass diverges logarithmically, so `mass`
 * is the mass within rs*c and the normalisation follows from it.
 */
export function nfw(massWithinC, rs, c = 10) {
  const mu = (x) => Math.log(1 + x) - x / (1 + x);
  const norm = massWithinC / mu(c);
  return {
    kind: 'nfw', mass: massWithinC, scale: rs, concentration: c,
    accel(dx, dy, dz, out) {
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 === 0) { out[0] = 0; out[1] = 0; out[2] = 0; return out; }
      const r = Math.sqrt(r2);
      const menc = norm * mu(r / rs);
      const f = -menc / (r * r * r);
      out[0] = f * dx; out[1] = f * dy; out[2] = f * dz;
      return out;
    },
    vcirc: (r) => Math.sqrt(norm * mu(r / rs) / r),
    potential: (r) => -norm * Math.log(1 + r / rs) / r,
  };
}

/** Sum of components sharing a centre. A galaxy is normally disc + bulge + halo. */
export function composite(parts) {
  const tmp = [0, 0, 0];
  return {
    kind: 'composite', parts,
    get mass() { return parts.reduce((s, p) => s + p.mass, 0); },
    scale: Math.max(...parts.map((p) => p.scale)),
    accel(dx, dy, dz, out) {
      out[0] = 0; out[1] = 0; out[2] = 0;
      for (const p of parts) {
        p.accel(dx, dy, dz, tmp);
        out[0] += tmp[0]; out[1] += tmp[1]; out[2] += tmp[2];
      }
      return out;
    },
    vcirc(r) {
      let v2 = 0;
      for (const p of parts) { const v = p.vcirc(r); v2 += v * v; }
      return Math.sqrt(v2);
    },
    potential: (r) => parts.reduce((s, p) => s + p.potential(r), 0),
  };
}

export const POTENTIALS = { pointMass, plummer, hernquist, nfw, composite };
