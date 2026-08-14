/**
 * WGSL compute kernels.
 *
 * These must agree with src/engine/potentials.js and src/engine/cpu.js to
 * float32 tolerance. That agreement is asserted in test/gpu.test.js, and it is
 * the whole reason the CPU reference exists.
 *
 * Sign convention here differs cosmetically from the CPU file: d points FROM the
 * particle TO the galaxy, so the acceleration factor is positive. The CPU uses
 * the opposite displacement and a negative factor. Same physics, and the
 * cross-check test is what guarantees that claim rather than this comment.
 */

export const POTENTIAL_KIND = Object.freeze({ point: 0, plummer: 1, hernquist: 2, nfw: 3 });

export const KERNELS = /* wgsl */ `
struct Galaxy {
  posMass : vec4f,   // xyz = centre, w = mass
  params  : vec4f,   // x = scale radius, y = kind, z = concentration, w = unused
};

struct Params {
  count     : u32,
  nGalaxies : u32,
  dt        : f32,
  _pad      : f32,
};

@group(0) @binding(0) var<storage, read>       gNow  : array<Galaxy>;
@group(0) @binding(1) var<storage, read>       gNext : array<Galaxy>;
@group(0) @binding(2) var<storage, read_write> pos   : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> vel   : array<vec4f>;
@group(0) @binding(4) var<uniform>             P     : Params;

fn muNFW(x : f32) -> f32 { return log(1.0 + x) - x / (1.0 + x); }

fn accelFrom(g : Galaxy, p : vec3f) -> vec3f {
  let d  = g.posMass.xyz - p;          // particle -> galaxy
  let r2 = dot(d, d);
  let m  = g.posMass.w;
  let a  = g.params.x;
  let kind = u32(g.params.y);

  if (kind == 1u) {                    // Plummer: softened, never singular
    let s   = r2 + a * a;
    let inv = inverseSqrt(s);
    return d * (m * inv * inv * inv);
  }
  if (r2 == 0.0) { return vec3f(0.0, 0.0, 0.0); }
  if (kind == 2u) {                    // Hernquist
    let r  = sqrt(r2);
    let ra = r + a;
    return d * (m / (ra * ra * r));
  }
  if (kind == 3u) {                    // NFW truncated at concentration c
    let c    = g.params.z;
    let r    = sqrt(r2);
    let nrm  = m / muNFW(c);
    return d * (nrm * muNFW(r / a) / (r2 * r));
  }
  let inv = inverseSqrt(r2);           // point mass
  return d * (m * inv * inv * inv);
}

fn totalAccel(p : vec3f, useNext : bool) -> vec3f {
  var a = vec3f(0.0, 0.0, 0.0);
  for (var i : u32 = 0u; i < P.nGalaxies; i = i + 1u) {
    if (useNext) { a = a + accelFrom(gNext[i], p); }
    else         { a = a + accelFrom(gNow[i],  p); }
  }
  return a;
}

/**
 * One full leapfrog KDK step, matching RestrictedSim.step exactly:
 *   half kick with the acceleration at (x_t,    galaxies_t)
 *   full drift
 *   half kick with the acceleration at (x_t+dt, galaxies_t+dt)
 *
 * The galaxy states at both ends of the step come from the CPU, which integrates
 * the two-body orbit in float64. That costs nothing (two bodies) and keeps the
 * encounter geometry, which every fitted parameter depends on, out of float32.
 */
@compute @workgroup_size(256)
fn stepKDK(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= P.count) { return; }

  var p = pos[i].xyz;
  var v = vel[i].xyz;
  let dt = P.dt;

  v = v + totalAccel(p, false) * (0.5 * dt);
  p = p + v * dt;
  v = v + totalAccel(p, true)  * (0.5 * dt);

  pos[i] = vec4f(p, pos[i].w);   // w preserved: birth radius
  vel[i] = vec4f(v, vel[i].w);   // w preserved: origin galaxy tag
}
`;
