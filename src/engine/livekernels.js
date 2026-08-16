/**
 * WGSL kernels for the LIVE tier: particles that feel each other.
 *
 * The restricted tier (kernels.js) has massless test particles in rigid
 * potentials. Here the particles carry mass and attract each other directly,
 * O(N^2), tiled through workgroup memory. Rigid components (bulge, halo) are
 * still analytic and still come from accelFrom, because they are not what we are
 * trying to make live.
 *
 * WHY THE ACCELERATION IS CACHED. Leapfrog KDK needs the acceleration at both
 * ends of a step. The restricted kernel simply evaluates it twice, which costs
 * nothing when it is two analytic potentials. Here an evaluation is the entire
 * O(N^2) pass, so evaluating twice would double the cost of the night. The
 * standard rearrangement avoids it: the closing half-kick of one step and the
 * opening half-kick of the next use the SAME acceleration, so one pass per step
 * is enough as long as it is kept. That is what `acc` is for, and it is why the
 * measured 205 ms/step at N=150k is the real per-step cost and not half of it.
 *
 *   once:  computeAccel
 *   step:  v += a dt/2 ; x += v dt ; computeAccel ; v += a dt/2
 *
 * MASS LIVES IN ITS OWN BUFFER. The obvious trick is to pack it into pos[i].w,
 * which is what the bench kernel does. It is not available here: pos[i].w is the
 * particle's birth radius and vel[i].w is its origin galaxy, both of which the
 * renderer reads. Packing mass over either would silently recolour the film.
 */

export const LIVE_KERNELS = /* wgsl */ `
struct Galaxy {
  posMass : vec4f,   // xyz = centre, w = mass
  params  : vec4f,   // x = scale radius, y = kind, z = concentration, w = unused
};

struct Params {
  count     : u32,
  nGalaxies : u32,
  dt        : f32,
  eps       : f32,   // self-gravity softening, a SILENT KNOB: sweep it
  // Tile range for this dispatch. The O(N^2) sum is split across several
  // dispatches because a single one at 175k particles runs ~278 ms and macOS
  // resets the GPU mid-run ("A valid external Instance reference no longer
  // exists"). Splitting turns one long dispatch into several short ones and
  // removes the whole failure mode. tile0 == 0 is the FIRST chunk: it writes
  // acc and adds the rigid components; later chunks accumulate into it.
  tile0     : u32,
  tile1     : u32,
  _pad0     : u32,
  _pad1     : u32,
};

@group(0) @binding(0) var<storage, read>       gNow : array<Galaxy>;
@group(0) @binding(1) var<storage, read_write> pos  : array<vec4f>;
@group(0) @binding(2) var<storage, read_write> vel  : array<vec4f>;
@group(0) @binding(3) var<storage, read_write> acc  : array<vec4f>;
@group(0) @binding(4) var<storage, read>       mass : array<f32>;
@group(0) @binding(5) var<uniform>             P    : Params;

fn muNFW(x : f32) -> f32 { return log(1.0 + x) - x / (1.0 + x); }

// Identical to kernels.js accelFrom. Kept textually identical rather than shared,
// because the two tiers are asserted against each other and a divergence here
// must show up as a test failure, not be made impossible by construction.
fn accelFrom(g : Galaxy, p : vec3f) -> vec3f {
  let d  = g.posMass.xyz - p;
  let r2 = dot(d, d);
  let m  = g.posMass.w;
  let a  = g.params.x;
  let kind = u32(g.params.y);

  if (kind == 1u) {
    let s   = r2 + a * a;
    let inv = inverseSqrt(s);
    return d * (m * inv * inv * inv);
  }
  if (r2 == 0.0) { return vec3f(0.0, 0.0, 0.0); }
  if (kind == 2u) {
    let r  = sqrt(r2);
    let ra = r + a;
    return d * (m / (ra * ra * r));
  }
  if (kind == 3u) {
    let c   = g.params.z;
    let r   = sqrt(r2);
    let nrm = m / muNFW(c);
    return d * (nrm * muNFW(r / a) / (r2 * r));
  }
  let inv = inverseSqrt(r2);
  return d * (m * inv * inv * inv);
}

const TILE : u32 = 256u;
var<workgroup> sPos  : array<vec3f, TILE>;
var<workgroup> sMass : array<f32,   TILE>;

@compute @workgroup_size(256)
fn computeAccel(@builtin(global_invocation_id) gid : vec3u,
                @builtin(local_invocation_id)  lid : vec3u) {
  let i = gid.x;
  let n = P.count;
  var p = vec3f(0.0);
  if (i < n) { p = pos[i].xyz; }

  var a = vec3f(0.0);
  let eps2 = P.eps * P.eps;

  // --- self-gravity, tiled over THIS DISPATCH'S RANGE ------------------------
  // tile0/tile1 come from a uniform, so the loop bounds and the barriers inside
  // it are uniform across the workgroup, which is what workgroupBarrier requires.
  for (var t : u32 = P.tile0; t < P.tile1; t = t + 1u) {
    let src = t * TILE + lid.x;
    if (src < n) { sPos[lid.x] = pos[src].xyz; sMass[lid.x] = mass[src]; }
    else         { sPos[lid.x] = vec3f(0.0);   sMass[lid.x] = 0.0; }
    workgroupBarrier();
    for (var j : u32 = 0u; j < TILE; j = j + 1u) {
      let d   = sPos[j] - p;
      // The self term has d = 0, so inverseSqrt(eps2) is finite and d * ... is
      // exactly zero. Padding carries mass 0 and contributes nothing. Neither
      // needs a branch, which is the point of doing it this way.
      let inv = inverseSqrt(dot(d, d) + eps2);
      a = a + d * (sMass[j] * inv * inv * inv);
    }
    workgroupBarrier();
  }

  // --- rigid components, added exactly ONCE, on the first chunk ---------------
  if (P.tile0 == 0u) {
    for (var k : u32 = 0u; k < P.nGalaxies; k = k + 1u) {
      a = a + accelFrom(gNow[k], p);
    }
    if (i < n) { acc[i] = vec4f(a, 0.0); }
  } else {
    if (i < n) { acc[i] = acc[i] + vec4f(a, 0.0); }
  }
}

@compute @workgroup_size(256)
fn kickDrift(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= P.count) { return; }
  let v = vel[i].xyz + acc[i].xyz * (0.5 * P.dt);
  vel[i] = vec4f(v, vel[i].w);
  pos[i] = vec4f(pos[i].xyz + v * P.dt, pos[i].w);
}

@compute @workgroup_size(256)
fn kick(@builtin(global_invocation_id) gid : vec3u) {
  let i = gid.x;
  if (i >= P.count) { return; }
  vel[i] = vec4f(vel[i].xyz + acc[i].xyz * (0.5 * P.dt), vel[i].w);
}
`;
