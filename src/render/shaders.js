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

/**
 * THE STELLAR-POPULATION RAMP, defined once.
 *
 * The legend used to hand-write its gradient stops while the shader computed a
 * different mapping, so the two drifted: the shader's t maxes out at 0.80 on a
 * 13.5 kpc disc, and the legend advertised the t = 1.0 colour at its blue end —
 * a colour no particle ever has. Both ends of the key were wrong.
 *
 * So the stops and the birth-radius mapping live here, the WGSL is built from
 * them by interpolation, and the legend samples the JS twin. A drift between the
 * picture and its key is now impossible rather than merely unlikely, and
 * `rampRange()` reports the span actually reached.
 */
export const RAMP_STOPS = {
  cool: [1.00, 0.42, 0.18],   // old, metal-rich, bulge-like
  mid:  [1.00, 0.86, 0.68],   // solar
  hot:  [0.62, 0.76, 1.00],   // young OB association
};
export const RAMP_SLOPE = 0.055, RAMP_OFFSET = 0.06;

/** The JS twin of the WGSL stellarColour(), same arithmetic. */
export function stellarColourJS(t) {
  const k = Math.min(1, Math.max(0, t));
  const { cool, mid, hot } = RAMP_STOPS;
  const mix = (a, b, u) => a.map((x, i) => x + (b[i] - x) * u);
  const c = k < 0.5 ? mix(cool, mid, k * 2) : mix(mid, hot, (k - 0.5) * 2);
  return c.map((x) => Math.round(255 * Math.min(1, Math.max(0, x))));
}

/** t at the inner and outer edge of a disc of the given extent. */
export function rampRange(discRadiusKpc = 13.5) {
  return [Math.min(1, RAMP_OFFSET), Math.min(1, discRadiusKpc * RAMP_SLOPE + RAMP_OFFSET)];
}

const V3 = (c) => `vec3f(${c.map((x) => x.toFixed(2)).join(', ')})`;

export const SPLAT_WGSL = /* wgsl */ `
struct Uniforms {
  viewProj    : mat4x4f,
  view        : mat4x4f,
  right       : vec4f,     // camera right in world space
  up          : vec4f,     // camera up in world space
  eye         : vec4f,
  params      : vec4f,     // x = splat world size, y = intensity, z = minPixels, w = wpp/unit
  params2     : vec4f,     // x = colourMode, y/z UNUSED (written 0), w = aspect
                           // dust strength lives in dust.z, not here — the old
                           // comment named two fields this shader never reads,
                           // on the one struct in the project whose miscount
                           // once wrote the dust vec4 over g1
  forward     : vec4f,     // camera forward, for view-depth without the view matrix
  g0          : vec4f,     // galaxy 0 centre (xyz)
  g1          : vec4f,     // galaxy 1 centre (xyz)
  dust        : vec4f,     // x = inner hole scale, y = outer scale, z = strength, w = slab softness
  n0          : vec4f,     // galaxy 0 disc normal (xyz), w = dust scale height (kpc)
  n1          : vec4f,     // galaxy 1 disc normal (xyz), w = dust scale height (kpc)
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
  @location(5) areaComp : f32,   // min-pixel area compensation, shared by emission and dust
};

/**
 * Blackbody-ish stellar colour. Not a calibrated SED: a smooth ramp through the
 * region of colour space real stellar populations occupy, from an old red
 * population near 3500 K, through solar white, to young blue-white near 10000 K.
 * Physically motivated rather than physically exact, and labelled as such.
 */
fn stellarColour(t : f32) -> vec3f {
  let k = clamp(t, 0.0, 1.0);
  let cool = ${V3(RAMP_STOPS.cool)};   // old, metal-rich, bulge-like
  let mid  = ${V3(RAMP_STOPS.mid)};   // solar
  let hot  = ${V3(RAMP_STOPS.hot)};   // young OB association
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
    // Stellar population by birth radius. Real discs have negative colour
    // gradients: redder, older populations inside, bluer outside.
    //
    // The scaling saturated at 6.8 kpc, so with discs reaching 13.5 kpc the
    // entire outer half — and every tidal tail, which comes from exactly there —
    // was one flat colour, and the advertised warm end never appeared at all.
    // 0.055 puts the full ramp across a ~16 kpc disc.
    c = stellarColour(clamp(birthR * ${RAMP_SLOPE} + ${RAMP_OFFSET}, 0.0, 1.0));
  }
  out.colour = c;

  // Splats keep constant total flux as they grow, so the minimum-size clamp
  // brightens rather than dims a receding galaxy. Without this the clamp would
  // add light and a distant galaxy would glow brighter than a near one.
  // 'ref' is a RESERVED KEYWORD in WGSL and naming a variable that produces a
  // shader compile error, an invalid pipeline, and then hundreds of downstream
  // "invalid command buffer" warnings that say nothing about the cause.
  let refSize = U.params.x;
  // The pure geometric part of the flux compensation, kept separate because the
  // DUST needs it too. Optical depth is a column density: a fixed dust mass
  // smeared over a larger area gives a smaller tau, by exactly the same factor
  // the emission is dimmed. Omitting it meant emission dimmed correctly as the
  // clamp engaged while extinction did not, so dust grew disproportionately
  // strong the further out you zoomed.
  let areaComp = (refSize * refSize) / (size * size);
  out.weight = U.params.y * areaComp;
  out.areaComp = areaComp;

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
  let radial = U.dust.z * hole * exp(-rb / max(U.dust.y, 1e-3));

  // CONFINE THE DUST TO A THIN LAYER ABOUT THE DISC PLANE.
  //
  // dustW was a function of birth radius ALONE — no |z| term anywhere — so the
  // absorbing layer was exactly as thick as the stellar disc and could not
  // silhouette it. Round 4 measured the extinction's vertical extent as BROADER
  // than the emission (133 px against 105) with the mid-plane the LEAST
  // extinguished region: the brightest ridge ran precisely where the lane
  // should be. Three rounds asked for a lane; this is what was missing.
  //
  // Height is measured along the particle's OWN galaxy's disc normal, which the
  // shader now receives, because particles arrive as bare positions and nothing
  // else in the pipeline carries orientation.
  let nrm = select(U.n0.xyz, U.n1.xyz, originId > 0.5);
  let h = abs(dot(p.xyz - centre, nrm));
  // Take the scale height from the SAME vec4 as the normal. This read n0.w for
  // both galaxies, which is an equivalent mutant only for as long as the two
  // slots are written from one setting — the next person to want a per-galaxy
  // dust height would have got a silent no-op on the second disc.
  let hScale = max(select(U.n0.w, U.n1.w, originId > 0.5), 1e-3);
  out.dustW = radial * exp(-h / hScale);
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
  // areaComp, exactly as the emission carries it: tau is a column density,
  // so spreading the same dust over a clamped-larger splat must thin it.
  o.tau  = vec4f(g * in.dustW * in.nearSide * in.areaComp, 0.0, 0.0, 0.0);
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
  params  : vec2f,   // x = filter radius, y = bright-pass threshold (first pass only)
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

  // BRIGHT PASS, applied on the first downsample only (threshold > 0).
  //
  // Without it every pixel blooms, including faint ones, so glare is painted
  // across regions that contain almost no light — which is both wrong and the
  // reason the whole frame read as hazy. A soft knee rather than a hard cut, so
  // a region crossing the threshold does not pop.
  let thr = P.params.y;
  if (thr > 0.0) {
    let br = max(o.r, max(o.g, o.b));
    let knee = thr * 0.6;
    var soft = br - thr + knee;
    soft = clamp(soft, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    o = o * (max(soft, br - thr) / max(br, 1e-4));
  }
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
  params2 : vec4f,   // x = starfield density, y = time, z = aspect, w = science full scale
  right   : vec4f,   // camera basis, so the starfield sits on the SKY not the screen
  up      : vec4f,
  fwd     : vec4f,   // w = tan(fov/2)
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

/**
 * The AgX LOOK stage, which was missing.
 *
 * AgX is three parts: an inset matrix, a tonescale, and a look. I had the first
 * two. The inset matrix deliberately desaturates on the way in so the tonescale
 * behaves, and the look is what puts the chroma back on the way out. Without it
 * everything comes through pale and slightly grey — which an art-director
 * reviewer described exactly, before knowing why.
 *
 * Mild rather than the "punchy" preset: this is emission against black, and a
 * heavy look would exaggerate the faint tails into something the physics does
 * not support.
 */
fn agxLook(c : vec3f) -> vec3f {
  let slope = 1.0;
  let power = 1.12;
  let sat   = 1.28;
  let luma  = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  let v     = pow(max(c * slope, vec3f(0.0)), vec3f(power));
  return luma + sat * (v - luma);
}

fn agx(colour : vec3f) -> vec3f {
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var c = AGX_IN * max(colour, vec3f(0.0));
  c = clamp((log2(max(c, vec3f(1e-10))) - minEv) / (maxEv - minEv), vec3f(0.0), vec3f(1.0));
  c = agxDefaultContrast(c);
  c = agxLook(c);
  c = AGX_OUT * c;
  return clamp(c, vec3f(0.0), vec3f(1.0));
}

fn hash31(p : vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q = q + dot(q, q.zyx + 31.32);
  return fract((q.x + q.y) * q.z);
}

/**
 * Background starfield, anchored to the SKY.
 *
 * The first version hashed screen coordinates, so the stars were painted onto
 * the viewport and slid with the camera — the classic tell that a starfield is
 * wallpaper. This hashes the world-space view direction instead, so they sit
 * still while you orbit, which is what makes the scene feel like a place.
 *
 * Size, brightness, colour temperature and twinkle phase all vary per star from
 * independent hashes. Uniform stars read as noise; varied ones read as a sky.
 */
fn starfield(uv : vec2f, density : f32, t : f32) -> vec3f {
  if (density <= 0.0) { return vec3f(0.0); }
  let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let th = C.fwd.w;
  let dir = normalize(C.fwd.xyz + C.right.xyz * (ndc.x * th * C.params2.z) + C.up.xyz * (ndc.y * th));

  var col = vec3f(0.0);
  // two shells at different cell sizes: a few bright stars over many faint ones
  for (var layer : i32 = 0; layer < 2; layer = layer + 1) {
    let cells = select(340.0, 130.0, layer == 1);
    let amp   = select(0.055, 0.13, layer == 1);
    let dens  = select(density, density * 0.22, layer == 1);
    let g = dir * cells;
    let cell = floor(g);
    let h = hash31(cell);
    if (h > 1.0 - dens) {
      let h2 = hash31(cell + 17.7);
      let h3 = hash31(cell + 91.3);
      let jitter = vec3f(hash31(cell + 3.1), hash31(cell + 5.7), hash31(cell + 7.3)) - 0.5;
      let d = length(fract(g) - 0.5 - jitter * 0.6);
      let size = 0.16 + 0.30 * h2;                       // varied radii
      let tw = 0.72 + 0.28 * sin(t * (0.7 + h3 * 1.9) + h * 63.0);   // varied phase AND rate
      // colour temperature: cool orange dwarfs through to hot blue-white
      let warm = vec3f(1.00, 0.72, 0.50);
      let cold = vec3f(0.72, 0.82, 1.00);
      let tint = mix(warm, cold, h3);
      col = col + tint * smoothstep(size, 0.0, d) * amp * tw * (0.35 + 0.65 * h2);
    }
  }
  return col;
}

@fragment
fn fsComposite(in : VOut) -> @location(0) vec4f {
  let h = textureSample(hdr, samp, in.uv).rgb;
  let b = textureSample(bloom, samp, in.uv).rgb;

  // SCIENCE MODE.
  //
  // The previous version claimed to be linear and was not: it applied a 1/2.2
  // gamma, silently clamped, and scaled by the exposure slider, so its mapping
  // depended on three controls it never mentioned. Three reviewers said so.
  //
  // Now: accumulated density divided by ONE fixed full-scale constant, which the
  // interface displays, and which no slider touches. The sRGB encode at the end
  // is a display transfer function, not a tone curve, and it is invertible — the
  // relationship between pixel and density is exactly stated and recoverable.
  //
  // And clipping is MARKED rather than hidden. Anything at or above full scale
  // is painted magenta, a colour the stellar ramp cannot produce, so a saturated
  // nucleus announces itself instead of quietly reading as "bright".
  if (C.params.z > 0.5) {
    // The UNCOLOURED density, from the alpha channel, not the colour-weighted
    // RGB. The splat pass accumulates g*weight into alpha and colour*g*weight
    // into rgb, so reading rgb made the "density" readout depend on the stellar
    // colour ramp — a redder particle read as a different density than a bluer
    // one at identical density. Two reviewers caught it independently.
    let dens = textureSample(hdr, samp, in.uv).a;
    let v = vec3f(dens / C.params2.w);           // params2.w = fixed full scale
    if (v.r >= 1.0) {
      return vec4f(1.0, 0.0, 0.85, 0.0);         // CLIPPED — out of range, not just bright
    }
    // sRGB display encode (exact piecewise form, not the 2.2 approximation)
    let lo = v * 12.92;
    let hi = 1.055 * pow(max(v, vec3f(1e-8)), vec3f(1.0 / 2.4)) - 0.055;
    let srgb = select(hi, lo, v <= vec3f(0.0031308));
    return vec4f(srgb, 0.0);
  }

  var col = mix(h, h + b, C.params.y) * C.params.x;

  col = col + starfield(in.uv, C.params2.x, C.params2.y);

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
