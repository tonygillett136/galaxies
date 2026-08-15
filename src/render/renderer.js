/**
 * HDR splat renderer.
 *
 * Stages:
 *   1. splats accumulate additively into THREE targets in one geometry pass:
 *      far-side emission, near-side emission, and near-side dust optical depth.
 *      No depth test: emission does not occlude emission, and sorting a million
 *      particles per frame to fake that would be both slow and wrong.
 *   2. combine: I = I_far * exp(-tau) + I_near, the two-slab radiative transfer
 *      solution, which is what puts dark lanes across the bright disc.
 *   3. bloom: progressive downsample, tent upsample, recombined.
 *   4. composite with AgX tone mapping to the swapchain.
 *
 * Measured physics cost at 1e6 particles is 0.67 ms of a 16.7 ms frame, so
 * essentially all of the budget belongs here.
 */

import { SPLAT_WGSL, POST_WGSL, COMPOSITE_WGSL, COMBINE_WGSL } from './shaders.js';
// basis vectors now come from the camera, which owns the roll

const HDR_FORMAT = 'rgba16float';
const TAU_FORMAT = 'r16float';
const BLOOM_LEVELS = 6;
// 2 mat4 (128 B) + 11 vec4 (176 B) = 304 B = 76 floats.
// COUNT THIS BY HAND EVERY TIME IT CHANGES. Getting it wrong once wrote `dust`
// over `g1` and produced a black canvas plus 198 unrelated warnings; it is this
// project's most expensive single mistake per character changed.
// Counted wrong once as 64, which silently wrote `dust` over `g1` and produced
// a "buffer too small" validation error buried under 199 cascade warnings.
const UNIFORM_FLOATS = 76;

// Science-view calibration. Fixed constants, not settings: the whole claim of
// that view is that pixel value maps to density by a stated, unchanging rule.
const SCIENCE_SPLAT = 0.22;
const SCIENCE_INTENSITY = 0.022;

/**
 * Create a shader module and SURFACE ITS COMPILATION ERRORS.
 *
 * WebGPU reports a bad shader once, at module creation, and then reports the
 * consequences forever: invalid pipeline, invalid bind group, invalid command
 * buffer, several per frame. The first message names the cause and is instantly
 * buried. One reserved-keyword typo produced 198 warnings, none of which
 * mentioned the shader. Every module goes through here, labelled.
 */
async function makeShader(device, code, label) {
  const module = device.createShaderModule({ code, label });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  for (const m of info.messages) {
    const where = `${label}:${m.lineNum}:${m.linePos}`;
    if (m.type === 'error') console.error(`shader ${where} ${m.message}`);
    else console.warn(`shader ${where} ${m.message}`);
  }
  if (errors.length) {
    throw new Error(`Shader "${label}" failed to compile: ${errors[0].message} (line ${errors[0].lineNum})`);
  }
  return module;
}

const ADD = {
  color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
};

export class Renderer {
  /** Async because shader compilation is checked before anything is built on it. */
  static async create(device, canvas, format) {
    const r = new Renderer(device, canvas, format);
    await r.init();
    return r;
  }

  constructor(device, canvas, format) {
    this.device = device;
    this.canvas = canvas;
    this.format = format;
    this.sampler = device.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });
    this.postUniforms = [];
    this.width = 0; this.height = 0;
    this.settings = {
      // Retuned for the Milky Way-scale model: discs are ~4x larger in kpc, so a
      // 0.055 kpc splat became sub-pixel and the galaxy read as speckle rather
      // than light — the art director's finding, and visible the moment the
      // glare is removed.
      splatSize: 0.22,
      intensity: 0.022,
      minPixels: 1.4,
      exposure: 1.0,
      bloomMix: 0.55,
      bloomRadius: 1.0,
      bloomThreshold: 0.35,  // soft-knee bright pass; 0 blooms everything
      vignette: 0.30,
      starfield: 0.012,     // now a per-cell probability on a much finer sky grid
      colourMode: 0,        // 0 population, 1 provenance, 2 speed
      scienceMode: false,
      dustStrength: 1.9,    // optical depth scale
      dustInner: 0.9,       // central hole scale length
      dustOuter: 3.4,       // outer falloff scale length
      dustSoftness: 2.5,    // kpc over which near/far blend, killing the hard edge
      // Dust SCALE HEIGHT, kpc. Real dust lies in a layer several times thinner
      // than the stellar disc, and that thinness is the whole reason a lane reads
      // as a lane rather than as general dimming.
      //
      // THE JUSTIFYING NUMBER WAS MEASURED ON THE WRONG DISC. This said "rms
      // height near 0.16 kpc at the shipped thickness", but 0.16 is the fixture
      // in physics.test.js, built at scaleLength 1.6 — half what buildEncounter
      // actually ships. Measured on the shipped disc (scaleLength 3.0): rms|z| =
      // 0.297 kpc, so the real ratio is 0.06/0.297 = 0.20, not the 0.375 the
      // comment implied. Three independent measurements agree on 0.296-0.297.
      //
      // 0.20 is still a defensible dust-to-star height ratio and the value is
      // kept, but note what is NOT true of it: this is an absolute kpc value
      // applied to both galaxies, while the two discs have different scale
      // lengths (prograde ships 3.2 and 1.5*cbrt(q)), so the RATIO differs
      // between them — about 0.19 for the primary and 0.4 for the secondary.
      // Making it a fraction of each disc's own thickness*scaleLength is the
      // right fix and is an open action, not a one-line change, because the
      // shader would need the value per galaxy (n0.w/n1.w now carry it, and
      // as of round 7 the shader reads each galaxy's own slot).
      dustHeight: 0.06,
      scienceFullScale: 2.0, // accumulated splat density mapped to display 1.0
    };
  }

  async init() {
    const device = this.device, format = this.format;

    // ---- splat pipeline: one geometry pass, three targets ----
    const splatModule = await makeShader(device, SPLAT_WGSL, 'splat');
    this.splatBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ]});
    this.splatPipeline = device.createRenderPipeline({
      label: 'splat',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.splatBGL] }),
      vertex: { module: splatModule, entryPoint: 'vs' },
      fragment: {
        module: splatModule, entryPoint: 'fs',
        targets: [
          { format: HDR_FORMAT, blend: ADD },
          { format: HDR_FORMAT, blend: ADD },
          { format: TAU_FORMAT, blend: ADD },
        ],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.splatUniform = device.createBuffer({
      size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.splatScratch = new Float32Array(UNIFORM_FLOATS);

    // ---- combine ----
    const combineModule = await makeShader(device, COMBINE_WGSL, 'combine');
    this.combineBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
    ]});
    this.combinePipeline = device.createRenderPipeline({
      label: 'combine',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.combineBGL] }),
      vertex: { module: combineModule, entryPoint: 'vsFull' },
      fragment: { module: combineModule, entryPoint: 'fsCombine', targets: [{ format: HDR_FORMAT }] },
    });

    // ---- bloom ----
    const postModule = await makeShader(device, POST_WGSL, 'post');
    this.postBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ]});
    const postLayout = device.createPipelineLayout({ bindGroupLayouts: [this.postBGL] });
    this.downPipeline = device.createRenderPipeline({
      label: 'bloom-down', layout: postLayout,
      vertex: { module: postModule, entryPoint: 'vsFull' },
      fragment: { module: postModule, entryPoint: 'fsDown', targets: [{ format: HDR_FORMAT }] },
    });
    this.upPipeline = device.createRenderPipeline({
      label: 'bloom-up', layout: postLayout,
      vertex: { module: postModule, entryPoint: 'vsFull' },
      fragment: { module: postModule, entryPoint: 'fsUp', targets: [{ format: HDR_FORMAT, blend: ADD }] },
    });

    // ---- composite ----
    const compModule = await makeShader(device, COMPOSITE_WGSL, 'composite');
    this.compBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ]});
    this.compPipeline = device.createRenderPipeline({
      label: 'composite',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.compBGL] }),
      vertex: { module: compModule, entryPoint: 'vsFull' },
      fragment: { module: compModule, entryPoint: 'fsComposite', targets: [{ format }] },
    });
    // params[4] params2[4] right[4] up[4] fwd[4] = 20 floats / 80 bytes.
    // Counted explicitly: getting this wrong once already cost a debugging round.
    this.compUniform = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.compScratch = new Float32Array(20);
    return this;
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    for (const t of this.textures ?? []) t.destroy?.();

    const mk = (w, h, fmt = HDR_FORMAT) => this.device.createTexture({
      size: { width: Math.max(1, w), height: Math.max(1, h) },
      format: fmt,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.farTex = mk(width, height);
    this.nearTex = mk(width, height);
    this.tauTex = mk(width, height, TAU_FORMAT);
    this.hdr = mk(width, height);
    this.bloom = [];
    let w = width, h = height;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      this.bloom.push({ tex: mk(w, h), w, h });
    }
    this.textures = [this.farTex, this.nearTex, this.tauTex, this.hdr, ...this.bloom.map((b) => b.tex)];

    for (const b of this.postUniforms) b.destroy?.();
    this.postUniforms = [];
    for (let i = 0; i < BLOOM_LEVELS * 2; i++) {
      this.postUniforms.push(this.device.createBuffer({
        size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    }
  }

  /**
   * Pack the splat uniform block. Layout must match Uniforms in shaders.js:
   *   viewProj[16] view[16] right[4] up[4] eye[4] params[4] params2[4]
   *   forward[4]   g0[4]    g1[4]    dust[4]  n0[4]  n1[4]
   * = 32 + 44 = 76 floats / 304 bytes. Offsets below are in FLOATS.
   *
   * n0/n1 are the two DISC NORMALS. The dust needs them: a lane is a thin
   * absorbing layer about the disc plane, and the shader has no other way to know
   * where that plane is — particles arrive as bare positions.
   */
  writeSplatUniforms(camera, aspect, galaxies) {
    const vp = camera.viewProjection(aspect);
    const eye = camera.eye;
    // ONE source for the basis, from the camera, so a roll applies to the
    // splat billboards and the starfield as well as to the view matrix.
    const { right, up, fwd } = camera.basis();
    const st = this.settings;
    const s = this.splatScratch;

    s.set(vp, 0);
    s.set(vp, 16);                                   // view slot, reserved
    s.set([right[0], right[1], right[2], 0], 32);
    s.set([up[0], up[1], up[2], 0], 36);
    s.set([eye[0], eye[1], eye[2], 0], 40);
    // params.w carries 2*tan(fov/2)/height so the shader turns a distance into
    // world-units-per-pixel without a divide chain
    const wppPerUnit = (2 * Math.tan(camera.fov / 2)) / Math.max(1, this.height);
    // In science mode the splat size and intensity are PINNED to calibrated
    // constants. They scale the accumulated density, so leaving them live meant
    // the "fixed full scale" divided a buffer that two sliders were still
    // moving — the mapping was stated and still not fixed.
    const splatSize = st.scienceMode ? SCIENCE_SPLAT : st.splatSize;
    // RESOLUTION COMPENSATION, interactive view only.
    //
    // A splat covers a fixed WORLD size, so on a bigger backing store the same
    // light is spread over more pixels and the image gets darker. Measured on
    // the live site at the default scenario: 6.50% of pixels lit at 1.26 Mpx,
    // 4.81% at 1.92, and 3.13% at 7.68 Mpx — a 4K-class display showed a
    // near-black frame while a laptop looked fine. The first outside user hit
    // exactly this and reported "just a black screen", and every measurement I
    // had taken all night was on a 1.26-1.9 Mpx window.
    //
    // Surface brightness per particle falls as 1/area, so the compensation is
    // linear in pixel area, clamped so a small window is not blown out and a
    // very large one does not saturate. Reference is 2.0 Mpx.
    //
    // NOT applied in science mode: that view is pinned to calibrated constants
    // and its accumulated density is divided by a fixed full scale, so scaling
    // intensity with the window would make the one honest instrument depend on
    // how big the browser is.
    const mpx = (this.width * this.height) / 1e6;
    const resComp = Math.min(4.0, Math.max(1.0, mpx / 2.0));
    const intensity = st.scienceMode ? SCIENCE_INTENSITY : st.intensity * resComp;
    s.set([splatSize, intensity, st.minPixels, wppPerUnit], 44);
    s.set([st.colourMode, 0, 0, aspect], 48);
    s.set([fwd[0], fwd[1], fwd[2], 0], 52);
    // kept for the composite pass, which anchors the starfield to the sky
    this._basis = { right, up, fwd, tanHalf: Math.tan(camera.fov / 2) };

    const g0 = galaxies?.[0]?.pos ?? [0, 0, 0];
    const g1 = galaxies?.[1]?.pos ?? g0;
    s.set([g0[0], g0[1], g0[2], 0], 56);
    s.set([g1[0], g1[1], g1[2], 0], 60);
    // dust off entirely in science mode: it is an approximation, and the honest
    // view must not carry an approximation that looks like data
    s.set([st.dustInner, st.dustOuter, st.scienceMode ? 0 : st.dustStrength, st.dustSoftness], 64);
    // DISC NORMALS at 68 and 72. .w carries the dust scale height in kpc, which
    // is what makes the absorbing layer thinner than the stellar disc — real dust
    // scale heights are a few times smaller than the stars'.
    //
    // NO SILENT FALLBACK. This used to read `?? [0, 0, 1]`, and because
    // RestrictedSim dropped discNormal on the way through, that default was what
    // shipped — a confidently wrong absorbing plane, tilted up to 90 degrees out
    // of the disc it was supposed to lie in, which still renders as a plausible
    // dark smudge. A wrong plane is worse than no dust, so if the normal is
    // missing the dust is switched OFF and the frame is visibly wrong instead of
    // subtly wrong.
    const n0 = galaxies?.[0]?.discNormal;
    const n1 = galaxies?.[1]?.discNormal ?? n0;
    if (!n0) {
      s[64 + 2] = 0;                                 // dust.z: strength -> off
      s.set([0, 0, 1, st.dustHeight], 68);
      s.set([0, 0, 1, st.dustHeight], 72);
      if (!this._warnedNoNormal) {
        this._warnedNoNormal = true;
        console.warn('renderer: galaxies carry no discNormal; dust disabled rather than guessed');
      }
    } else {
      s.set([n0[0], n0[1], n0[2], st.dustHeight], 68);
      s.set([n1[0], n1[1], n1[2], st.dustHeight], 72);
    }

    this.device.queue.writeBuffer(this.splatUniform, 0, s);
  }

  /**
   * @param {GPUTextureView} target swapchain view
   * @param {{posBuf:GPUBuffer, velBuf:GPUBuffer, count:number, orbit?:object}} sim
   */
  render(target, sim, camera, time = 0) {
    const dev = this.device;
    const aspect = this.width / Math.max(1, this.height);
    const st = this.settings;

    this.writeSplatUniforms(camera, aspect, sim.orbit?.galaxies);

    this.compScratch.set([st.exposure, st.scienceMode ? 0 : st.bloomMix,
                          st.scienceMode ? 1 : 0, st.scienceMode ? 0 : st.vignette], 0);
    // params2.w is the science view's FIXED full-scale constant. Deliberately
    // not derived from exposure or any other control: a readout whose mapping
    // moves with a slider is not a readout.
    this.compScratch.set([st.scienceMode ? 0 : st.starfield, time, aspect, st.scienceFullScale], 4);
    const b = this._basis;
    this.compScratch.set([b.right[0], b.right[1], b.right[2], 0], 8);
    this.compScratch.set([b.up[0], b.up[1], b.up[2], 0], 12);
    this.compScratch.set([b.fwd[0], b.fwd[1], b.fwd[2], b.tanHalf], 16);
    dev.queue.writeBuffer(this.compUniform, 0, this.compScratch);

    const splatBind = dev.createBindGroup({ layout: this.splatBGL, entries: [
      { binding: 0, resource: { buffer: this.splatUniform } },
      { binding: 1, resource: { buffer: sim.posBuf } },
      { binding: 2, resource: { buffer: sim.velBuf } },
    ]});

    // Validate the first real frame and shout about it. WebGPU reports the CAUSE
    // once and the CONSEQUENCES every frame forever, so a single validation
    // error arrives as hundreds of "invalid command buffer" warnings that name
    // nothing. That has now cost two debugging rounds: a reserved keyword, and a
    // uniform buffer 16 bytes short. This makes the first one audible.
    const validating = this._validated !== true;
    if (validating) { this._validated = true; dev.pushErrorScope('validation'); }

    const enc = dev.createCommandEncoder();
    const clear = (view) => ({ view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' });

    // ---- 1. splats into far / near / tau ----
    {
      const pass = enc.beginRenderPass({ colorAttachments: [
        clear(this.farTex.createView()),
        clear(this.nearTex.createView()),
        clear(this.tauTex.createView()),
      ]});
      pass.setPipeline(this.splatPipeline);
      pass.setBindGroup(0, splatBind);
      pass.draw(6, sim.count);
      pass.end();
    }

    // ---- 2. combine through the dust column ----
    {
      const bind = dev.createBindGroup({ layout: this.combineBGL, entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.farTex.createView() },
        { binding: 2, resource: this.nearTex.createView() },
        { binding: 3, resource: this.tauTex.createView() },
      ]});
      const pass = enc.beginRenderPass({ colorAttachments: [clear(this.hdr.createView())] });
      pass.setPipeline(this.combinePipeline);
      pass.setBindGroup(0, bind);
      pass.draw(6);
      pass.end();
    }

    // ---- 3. bloom, skipped entirely in science mode ----
    if (!st.scienceMode) {
      let u = 0;
      let srcView = this.hdr.createView();
      let sw = this.width, sh = this.height;
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        const dst = this.bloom[i];
        // bright-pass threshold on the FIRST downsample only; later levels are
        // already filtered and re-thresholding them would eat the halo
        dev.queue.writeBuffer(this.postUniforms[u], 0,
          new Float32Array([1 / sw, 1 / sh, st.bloomRadius, i === 0 ? st.bloomThreshold : 0]));
        const bind = dev.createBindGroup({ layout: this.postBGL, entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: srcView },
          { binding: 2, resource: { buffer: this.postUniforms[u] } },
        ]});
        const pass = enc.beginRenderPass({ colorAttachments: [clear(dst.tex.createView())] });
        pass.setPipeline(this.downPipeline);
        pass.setBindGroup(0, bind);
        pass.draw(6);
        pass.end();
        srcView = dst.tex.createView(); sw = dst.w; sh = dst.h;
        u++;
      }
      for (let i = BLOOM_LEVELS - 1; i > 0; i--) {
        const src = this.bloom[i], dst = this.bloom[i - 1];
        dev.queue.writeBuffer(this.postUniforms[u], 0, new Float32Array([1 / src.w, 1 / src.h, st.bloomRadius, 0]));
        const bind = dev.createBindGroup({ layout: this.postBGL, entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: src.tex.createView() },
          { binding: 2, resource: { buffer: this.postUniforms[u] } },
        ]});
        const pass = enc.beginRenderPass({ colorAttachments: [
          { view: dst.tex.createView(), loadOp: 'load', storeOp: 'store' }] });
        pass.setPipeline(this.upPipeline);
        pass.setBindGroup(0, bind);
        pass.draw(6);
        pass.end();
        u++;
      }
    }

    // ---- 4. composite ----
    {
      const bind = dev.createBindGroup({ layout: this.compBGL, entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.hdr.createView() },
        { binding: 2, resource: this.bloom[0].tex.createView() },
        { binding: 3, resource: { buffer: this.compUniform } },
      ]});
      const pass = enc.beginRenderPass({ colorAttachments: [{
        view: target, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(this.compPipeline);
      pass.setBindGroup(0, bind);
      pass.draw(6);
      pass.end();
    }

    dev.queue.submit([enc.finish()]);

    if (validating) {
      dev.popErrorScope().then((e) => {
        if (e) {
          this.firstFrameError = e.message;
          console.error('RENDER VALIDATION ERROR on first frame:\n' + e.message);
        }
      });
    }
  }
}
