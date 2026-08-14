/**
 * Render shaders.
 *
 * The design principle throughout: do not fake brightness. Stars are emitters,
 * so splats are blended additively into a float16 HDR target, and the enormous
 * dynamic range of a galaxy emerges from the DENSITY of overlapping splats
 * rather than from a per-particle brightness curve. The tone mapper then does
 * what a camera does. That is why the core saturates and the tails stay faint
 * without either being authored.
 */

export const SPLAT_WGSL = /* wgsl */ `
struct Uniforms {
  viewProj    : mat4x4f,
  view        : mat4x4f,
  right       : vec4f,     // camera right in world space
  up          : vec4f,     // camera up in world space
  eye         : vec4f,
  params      : vec4f,     // x = splat world size, y = intensity, z = minPixels, w = wpp/unit
  params2     : vec4f,     // x = colourMode, y = time, z = dustStrength, w = aspect
  forward     : vec4f,     // camera forward, for view-depth without the view matrix
  g0          : vec4f,     // galaxy 0 centre (xyz)
  g1          : vec4f,     // galaxy 1 centre (xyz)
  dust        : vec4f,     // x = inner hole scale, y = outer scale, z = strength, w = slab softness
};

@group(0) @binding(0) var<uniform> U : Uniforms;
@group(0) @binding(1) var<storage, read> pos : array<vec4f>;
@group(0) @binding(2) var<storage, read> vel : array<vec4f>;

struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) uv     : vec2f,
  @location(1) colour : vec3f,
  @location(2) weight : f32,
  @location(3) nearSide : f32,   // 1 if in front of its own galaxy's centre
  @location(4) dustW    : f32,   // dust column contribution
};

/**
 * Blackbody-ish stellar colour. Not a calibrated SED: a smooth ramp through the
 * region of colour space real stellar populations occupy, from an old red
 * population near 3500 K, through solar white, to young blue-white near 10000 K.
 * Physically motivated rather than physically exact, and labelled as such.
 */
fn stellarColour(t : f32) -> vec3f {
  let k = clamp(t, 0.0, 1.0);
  let cool = vec3f(1.00, 0.42, 0.18);   // old, metal-rich, bulge-like
  let mid  = vec3f(1.00, 0.86, 0.68);   // solar
  let hot  = vec3f(0.62, 0.76, 1.00);   // young OB association
  if (k < 0.5) { return mix(cool, mid, k * 2.0); }
  return mix(mid, hot, (k - 0.5) * 2.0);
}

@vertex
fn vs(@builtin(vertex_index) vi : u32, @builtin(instance_index) ii : u32) -> VSOut {
  // two triangles as a strip-free quad
  var CORNERS = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0,  1.0), vec2f(1.0, -1.0), vec2f( 1.0, 1.0));
  let corner = CORNERS[vi];

  let p        = pos[ii];
  let birthR   = p.w;
  let originId = vel[ii].w;
  let speed    = length(vel[ii].xyz);

  // Billboard in world space using the camera basis, so splats always face the
  // viewer without a per-particle matrix.
  var size = U.params.x;

  // Enforce a minimum apparent size. Without this, zooming out makes particles
  // fall below a pixel and the galaxy visibly dissolves into noise rather than
  // receding — the single ugliest failure mode in particle rendering.
  let toEye = length(U.eye.xyz - p.xyz);
  let worldPerPixel = toEye * U.params.w;         // precomputed 2*tan(fov/2)/height
  size = max(size, U.params.z * worldPerPixel);

  let world = p.xyz + (U.right.xyz * corner.x + U.up.xyz * corner.y) * size;

  var out : VSOut;
  out.clip = U.viewProj * vec4f(world, 1.0);
  out.uv = corner;

  let mode = u32(U.params2.x);
  var c : vec3f;
  if (mode == 1u) {
    // provenance: which galaxy did this material start in
    c = select(vec3f(0.45, 0.72, 1.00), vec3f(1.00, 0.55, 0.30), originId > 0.5);
  } else if (mode == 2u) {
    // kinematics: speed, for reading the dynamics rather than the picture
    c = stellarColour(clamp(speed * 0.55, 0.0, 1.0));
  } else {
    // stellar population by birth radius. Real discs have negative colour
    // gradients: redder, older populations inside, bluer outside.
    c = stellarColour(clamp(birthR * 0.13 + 0.12, 0.0, 1.0));
  }
  out.colour = c;

  // Splats keep constant total flux as they grow, so the minimum-size clamp
  // brightens rather than dims a receding galaxy. Without this the clamp would
  // add light and a distant galaxy would glow brighter than a near one.
  // 'ref' is a RESERVED KEYWORD in WGSL and naming a variable that produces a
  // shader compile error, an invalid pipeline, and then hundreds of downstream
  // "invalid command buffer" warnings that say nothing about the cause.
  let refSize = U.params.x;
  out.weight = U.params.y * (refSize * refSize) / (size * size);

  // --- two-slab dust ---
  //
  // Real dust lanes are the near side of a disc silhouetted against the far
  // side of the same disc. Reproducing that exactly needs back-to-front sorting
  // of every particle every frame. Instead each particle is classified against
  // ITS OWN galaxy's centre depth: material in front absorbs, material behind
  // is absorbed. It is a two-slab approximation of radiative transfer, it costs
  // one comparison, and it puts the dark lanes where they actually belong.
  //
  // Approximate, and labelled as such: the science view disables it entirely.
  let centre = select(U.g0.xyz, U.g1.xyz, originId > 0.5);
  let depthP = dot(p.xyz - U.eye.xyz, U.forward.xyz);
  let depthC = dot(centre  - U.eye.xyz, U.forward.xyz);
  // Smooth, not binary. A hard classification puts a visible edge through the
  // picture wherever a diffuse sheet crosses its own galaxy's centre depth, and
  // it is also worse physics: material near the mid-depth genuinely both
  // absorbs and is absorbed. The transition width is a few kpc, the scale over
  // which a disc actually has depth.
  out.nearSide = 1.0 - smoothstep(-U.dust.w, U.dust.w, depthP - depthC);

  // Dust traces the cold disc: suppressed in the centre, falling off outside.
  // Uses birth radius, so dust travels with the material it was born among,
  // which is the right behaviour when a tail is drawn out of the disc.
  let rb = birthR;
  let hole = 1.0 - exp(-rb / max(U.dust.x, 1e-3));
  out.dustW = U.dust.z * hole * exp(-rb / max(U.dust.y, 1e-3));
  return out;
}

struct FragOut {
  @location(0) far  : vec4f,   // emission behind its galaxy's centre
  @location(1) near : vec4f,   // emission in front, unattenuated
  @location(2) tau  : vec4f,   // near-side dust optical depth (r16float, .x used)
};

@fragment
fn fs(in : VSOut) -> FragOut {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 1.0) { discard; }
  // Gaussian profile, not a hard disc. This is what makes overlapping splats
  // read as continuous light instead of as a pile of circles.
  let g = exp(-3.2 * r2) - exp(-3.2);
  let e = vec4f(in.colour * (g * in.weight), g * in.weight);

  var o : FragOut;
  o.far  = e * (1.0 - in.nearSide);
  o.near = e * in.nearSide;
  o.tau  = vec4f(g * in.dustW * in.nearSide, 0.0, 0.0, 0.0);
  return o;
}
`;

/**
 * Combine the two emission slabs through the dust column:
 *   I = I_far * exp(-tau) + I_near
 * which is the two-slab solution of the radiative transfer equation with the
 * absorber in front of the far source. Written before bloom, so the dark lanes
 * are dark in the bloom too rather than glowing through it.
 */
export const COMBINE_WGSL = /* wgsl */ `
@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var farT : texture_2d<f32>;
@group(0) @binding(2) var nearT: texture_2d<f32>;
@group(0) @binding(3) var tauT : texture_2d<f32>;

struct VOut { @builtin(position) clip : vec4f, @location(0) uv : vec2f };

@vertex
fn vsFull(@builtin(vertex_index) vi : u32) -> VOut {
  var UV = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0));
  let uv = UV[vi];
  var o : VOut;
  o.clip = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  o.uv = uv;
  return o;
}

@fragment
fn fsCombine(in : VOut) -> @location(0) vec4f {
  let f = textureSample(farT,  samp, in.uv);
  let n = textureSample(nearT, samp, in.uv);
  let t = textureSample(tauT,  samp, in.uv).x;
  return vec4f(f.rgb * exp(-t) + n.rgb, f.a + n.a);
}
`;

/**
 * Bloom, post and tone mapping.
 *
 * Bloom is a progressive downsample with a 13-tap filter and an upsample with a
 * 3x3 tent, additively recombined. It is the standard modern approach because it
 * is stable under motion; a single wide Gaussian flickers as bright particles
 * cross pixel boundaries.
 */
export const POST_WGSL = /* wgsl */ `
struct PostU {
  texel   : vec2f,
  params  : vec2f,   // x = bloom strength / filter radius, y = exposure
};
@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var src  : texture_2d<f32>;
@group(0) @binding(2) var<uniform> P : PostU;

struct VOut { @builtin(position) clip : vec4f, @location(0) uv : vec2f };

@vertex
fn vsFull(@builtin(vertex_index) vi : u32) -> VOut {
  var UV = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0));
  let uv = UV[vi];
  var o : VOut;
  o.clip = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  o.uv = uv;
  return o;
}

@fragment
fn fsDown(in : VOut) -> @location(0) vec4f {
  let t = P.texel;
  let uv = in.uv;
  // 13-tap Sledgehammer/CoD downsample: stable, no pulsing on moving highlights
  let a = textureSample(src, samp, uv + vec2f(-2.0, 2.0) * t).rgb;
  let b = textureSample(src, samp, uv + vec2f( 0.0, 2.0) * t).rgb;
  let c = textureSample(src, samp, uv + vec2f( 2.0, 2.0) * t).rgb;
  let d = textureSample(src, samp, uv + vec2f(-2.0, 0.0) * t).rgb;
  let e = textureSample(src, samp, uv).rgb;
  let f = textureSample(src, samp, uv + vec2f( 2.0, 0.0) * t).rgb;
  let g = textureSample(src, samp, uv + vec2f(-2.0,-2.0) * t).rgb;
  let h = textureSample(src, samp, uv + vec2f( 0.0,-2.0) * t).rgb;
  let i = textureSample(src, samp, uv + vec2f( 2.0,-2.0) * t).rgb;
  let j = textureSample(src, samp, uv + vec2f(-1.0, 1.0) * t).rgb;
  let k = textureSample(src, samp, uv + vec2f( 1.0, 1.0) * t).rgb;
  let l = textureSample(src, samp, uv + vec2f(-1.0,-1.0) * t).rgb;
  let m = textureSample(src, samp, uv + vec2f( 1.0,-1.0) * t).rgb;
  var o = e * 0.125;
  o = o + (a + c + g + i) * 0.03125;
  o = o + (b + d + f + h) * 0.0625;
  o = o + (j + k + l + m) * 0.125;
  return vec4f(o, 1.0);
}

@fragment
fn fsUp(in : VOut) -> @location(0) vec4f {
  let t = P.texel * P.params.x;
  let uv = in.uv;
  let a = textureSample(src, samp, uv + vec2f(-1.0,  1.0) * t).rgb;
  let b = textureSample(src, samp, uv + vec2f( 0.0,  1.0) * t).rgb;
  let c = textureSample(src, samp, uv + vec2f( 1.0,  1.0) * t).rgb;
  let d = textureSample(src, samp, uv + vec2f(-1.0,  0.0) * t).rgb;
  let e = textureSample(src, samp, uv).rgb;
  let f = textureSample(src, samp, uv + vec2f( 1.0,  0.0) * t).rgb;
  let g = textureSample(src, samp, uv + vec2f(-1.0, -1.0) * t).rgb;
  let h = textureSample(src, samp, uv + vec2f( 0.0, -1.0) * t).rgb;
  let i = textureSample(src, samp, uv + vec2f( 1.0, -1.0) * t).rgb;
  let o = (e * 4.0 + (b + d + f + h) * 2.0 + (a + c + g + i)) * (1.0 / 16.0);
  return vec4f(o, 1.0);
}
`;

/**
 * Composite and tone map.
 *
 * AgX rather than Reinhard or plain ACES. The reason is specific to this
 * subject: a galaxy core is many stops brighter than its tidal tails, and
 * Reinhard desaturates bright regions to white while ACES pushes them towards
 * yellow. AgX keeps hue stable into the highlights, so a saturated core stays
 * the colour of the stars in it instead of becoming a white blob.
 */
export const COMPOSITE_WGSL = /* wgsl */ `
struct CompU {
  params  : vec4f,   // x = exposure, y = bloom mix, z = scienceMode, w = vignette
  params2 : vec4f,   // x = starfield density, y = time, z = aspect, w = unused
};
@group(0) @binding(0) var samp  : sampler;
@group(0) @binding(1) var hdr   : texture_2d<f32>;
@group(0) @binding(2) var bloom : texture_2d<f32>;
@group(0) @binding(3) var<uniform> C : CompU;

struct VOut { @builtin(position) clip : vec4f, @location(0) uv : vec2f };

@vertex
fn vsFull(@builtin(vertex_index) vi : u32) -> VOut {
  var UV = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0));
  let uv = UV[vi];
  var o : VOut;
  o.clip = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
  o.uv = uv;
  return o;
}

const AGX_IN = mat3x3f(
  0.8424790622, 0.0423282422, 0.0423756549,
  0.0784335999, 0.8784686364, 0.0784336000,
  0.0792237451, 0.0791661274, 0.8791429737);

const AGX_OUT = mat3x3f(
   1.1968790051, -0.0528968517, -0.0529716355,
  -0.0980208811,  1.1519031710, -0.0980434501,
  -0.0990297440, -0.0989611848,  1.1510736015);

fn agxDefaultContrast(x : vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2
       - 40.14 * x4 * x
       + 31.96 * x4
       - 6.868 * x2 * x
       + 0.4298 * x2
       + 0.1191 * x
       - 0.00232;
}

fn agx(colour : vec3f) -> vec3f {
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var c = AGX_IN * max(colour, vec3f(0.0));
  c = clamp((log2(max(c, vec3f(1e-10))) - minEv) / (maxEv - minEv), vec3f(0.0), vec3f(1.0));
  c = agxDefaultContrast(c);
  c = AGX_OUT * c;
  return clamp(c, vec3f(0.0), vec3f(1.0));
}

/** Hash-based background starfield. Cheap, static in world terms, adds depth. */
fn hash21(p : vec2f) -> f32 {
  var q = fract(p * vec2f(233.34, 851.73));
  q = q + dot(q, q + 23.45);
  return fract(q.x * q.y);
}

@fragment
fn fsComposite(in : VOut) -> @location(0) vec4f {
  let h = textureSample(hdr, samp, in.uv).rgb;
  let b = textureSample(bloom, samp, in.uv).rgb;

  // SCIENCE MODE: no bloom, no tone curve, no vignette. A linear readout with a
  // known mapping, because the beautiful image is not quantitatively readable
  // and pretending otherwise is how you fool yourself.
  if (C.params.z > 0.5) {
    let v = h * C.params.x;
    return vec4f(pow(clamp(v, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2)), 1.0);
  }

  var col = mix(h, h + b, C.params.y) * C.params.x;

  // faint starfield behind everything, so empty space is not dead flat
  let sp = in.uv * vec2f(C.params2.z, 1.0) * 420.0;
  let cell = floor(sp);
  let r = hash21(cell);
  if (r > 1.0 - C.params2.x) {
    let d = length(fract(sp) - 0.5);
    let tw = 0.65 + 0.35 * sin(C.params2.y * 1.7 + r * 90.0);
    col = col + vec3f(0.55, 0.62, 0.78) * smoothstep(0.34, 0.0, d) * 0.06 * tw;
  }

  col = agx(col);

  // gentle vignette. Kept subtle: it should be felt, not seen.
  let d = length(in.uv - vec2f(0.5)) * 1.414;
  col = col * (1.0 - C.params.w * d * d);

  // Alpha 0 with premultiplied compositing means the canvas ADDS its light to
  // whatever is behind it and never obscures it. In sandbox that is black, so
  // nothing changes; in detective mode it is a real SDSS frame, and the
  // simulation lays over the observation the way light actually would.
  return vec4f(col, 0.0);
}
`;
