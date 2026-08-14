/**
 * HDR splat renderer.
 *
 * Three stages:
 *   1. splats accumulate additively into an rgba16float target (no depth test:
 *      emission does not occlude emission, and sorting a million particles per
 *      frame to fake that would be both slow and wrong)
 *   2. a bloom chain: progressive downsample, then tent upsample, recombined
 *   3. composite with AgX tone mapping to the swapchain
 *
 * The measured physics cost at 1e6 particles is 0.67 ms of a 16.7 ms frame, so
 * essentially all of the budget belongs here.
 */

import { SPLAT_WGSL, POST_WGSL, COMPOSITE_WGSL } from './shaders.js';
import { multiply, sub, norm, cross } from './mat4.js';

const HDR_FORMAT = 'rgba16float';
const BLOOM_LEVELS = 6;

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
      splatSize: 0.055,
      intensity: 0.030,
      minPixels: 0.75,
      exposure: 1.0,
      bloomMix: 0.55,
      bloomRadius: 1.0,
      vignette: 0.30,
      starfield: 0.0016,
      colourMode: 0,      // 0 population, 1 provenance, 2 speed
      scienceMode: false,
    };
  }

  async init() {
    const device = this.device, format = this.format;

    // ---- splat pipeline ----
    const splatModule = await makeShader(device, SPLAT_WGSL, 'splat');
    this.splatBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    ]});
    this.splatPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.splatBGL] }),
      vertex: { module: splatModule, entryPoint: 'vs' },
      fragment: {
        module: splatModule, entryPoint: 'fs',
        targets: [{
          format: HDR_FORMAT,
          // pure additive. Emission adds; it never occludes.
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
    });
    this.splatUniform = device.createBuffer({ size: 208, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.splatScratch = new Float32Array(52);

    // ---- bloom pipelines ----
    const postModule = await makeShader(device, POST_WGSL, 'post');
    this.postBGL = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ]});
    const postLayout = device.createPipelineLayout({ bindGroupLayouts: [this.postBGL] });
    this.downPipeline = device.createRenderPipeline({
      layout: postLayout,
      vertex: { module: postModule, entryPoint: 'vsFull' },
      fragment: { module: postModule, entryPoint: 'fsDown', targets: [{ format: HDR_FORMAT }] },
    });
    this.upPipeline = device.createRenderPipeline({
      layout: postLayout,
      vertex: { module: postModule, entryPoint: 'vsFull' },
      fragment: {
        module: postModule, entryPoint: 'fsUp',
        targets: [{
          format: HDR_FORMAT,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        }],
      },
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
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.compBGL] }),
      vertex: { module: compModule, entryPoint: 'vsFull' },
      fragment: { module: compModule, entryPoint: 'fsComposite', targets: [{ format }] },
    });
    this.compUniform = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.compScratch = new Float32Array(8);
    return this;
  }

  resize(width, height) {
    if (width === this.width && height === this.height) return;
    this.width = width; this.height = height;
    for (const t of this.textures ?? []) t.destroy?.();

    const mk = (w, h) => this.device.createTexture({
      size: { width: Math.max(1, w), height: Math.max(1, h) },
      format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.hdr = mk(width, height);
    this.bloom = [];
    let w = width, h = height;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      this.bloom.push({ tex: mk(w, h), w, h });
    }
    this.textures = [this.hdr, ...this.bloom.map((b) => b.tex)];

    // one uniform buffer per post pass, holding that pass's texel size
    for (const b of this.postUniforms) b.destroy?.();
    this.postUniforms = [];
    const total = BLOOM_LEVELS * 2;
    for (let i = 0; i < total; i++) {
      this.postUniforms.push(this.device.createBuffer({
        size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    }
  }

  /** Pack the splat uniform block. Layout must match Uniforms in shaders.js. */
  writeSplatUniforms(camera, aspect, time) {
    const vp = camera.viewProjection(aspect);
    const eye = camera.eye;
    const fwd = norm(sub(camera.target, eye));
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const s = this.splatScratch;
    s.set(vp, 0);
    s.set(vp, 16);                                  // view slot: unused by the shader, kept for layout
    s.set([right[0], right[1], right[2], 0], 32);
    s.set([up[0], up[1], up[2], 0], 36);
    s.set([eye[0], eye[1], eye[2], 0], 40);
    // params.w carries 2*tan(fov/2)/height so the shader can turn a distance
    // into world-units-per-pixel without a divide chain
    const worldPerPixelPerUnit = (2 * Math.tan(camera.fov / 2)) / this.height;
    s.set([this.settings.splatSize, this.settings.intensity,
           this.settings.minPixels, worldPerPixelPerUnit], 44);
    s.set([this.settings.colourMode, time, 0, aspect], 48);
    this.device.queue.writeBuffer(this.splatUniform, 0, s);
  }

  /**
   * Render one frame.
   * @param {GPUTextureView} target swapchain view
   * @param {{posBuf:GPUBuffer, velBuf:GPUBuffer, count:number}} sim
   */
  render(target, sim, camera, time = 0) {
    const dev = this.device;
    const aspect = this.width / Math.max(1, this.height);
    this.writeSplatUniforms(camera, aspect, time);

    const st = this.settings;
    this.compScratch.set([st.exposure, st.scienceMode ? 0 : st.bloomMix,
                          st.scienceMode ? 1 : 0, st.scienceMode ? 0 : st.vignette], 0);
    this.compScratch.set([st.scienceMode ? 0 : st.starfield, time, aspect, 0], 4);
    dev.queue.writeBuffer(this.compUniform, 0, this.compScratch);

    const splatBind = dev.createBindGroup({ layout: this.splatBGL, entries: [
      { binding: 0, resource: { buffer: this.splatUniform } },
      { binding: 1, resource: { buffer: sim.posBuf } },
      { binding: 2, resource: { buffer: sim.velBuf } },
    ]});

    const enc = dev.createCommandEncoder();

    // ---- 1. splats into HDR ----
    {
      const pass = enc.beginRenderPass({ colorAttachments: [{
        view: this.hdr.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(this.splatPipeline);
      pass.setBindGroup(0, splatBind);
      pass.draw(6, sim.count);
      pass.end();
    }

    // ---- 2. bloom, skipped entirely in science mode ----
    if (!st.scienceMode) {
      let u = 0;
      let srcView = this.hdr.createView();
      let sw = this.width, sh = this.height;
      for (let i = 0; i < BLOOM_LEVELS; i++) {
        const dst = this.bloom[i];
        dev.queue.writeBuffer(this.postUniforms[u], 0,
          new Float32Array([1 / sw, 1 / sh, st.bloomRadius, 0]));
        const bind = dev.createBindGroup({ layout: this.postBGL, entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: srcView },
          { binding: 2, resource: { buffer: this.postUniforms[u] } },
        ]});
        const pass = enc.beginRenderPass({ colorAttachments: [{
          view: dst.tex.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear', storeOp: 'store' }] });
        pass.setPipeline(this.downPipeline);
        pass.setBindGroup(0, bind);
        pass.draw(6);
        pass.end();
        srcView = dst.tex.createView(); sw = dst.w; sh = dst.h;
        u++;
      }
      // upsample, additively folding each level into the one above
      for (let i = BLOOM_LEVELS - 1; i > 0; i--) {
        const src = this.bloom[i], dst = this.bloom[i - 1];
        dev.queue.writeBuffer(this.postUniforms[u], 0,
          new Float32Array([1 / src.w, 1 / src.h, st.bloomRadius, 0]));
        const bind = dev.createBindGroup({ layout: this.postBGL, entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: src.tex.createView() },
          { binding: 2, resource: { buffer: this.postUniforms[u] } },
        ]});
        const pass = enc.beginRenderPass({ colorAttachments: [{
          view: dst.tex.createView(), loadOp: 'load', storeOp: 'store' }] });
        pass.setPipeline(this.upPipeline);
        pass.setBindGroup(0, bind);
        pass.draw(6);
        pass.end();
        u++;
      }
    }

    // ---- 3. composite ----
    {
      const bind = dev.createBindGroup({ layout: this.compBGL, entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.hdr.createView() },
        { binding: 2, resource: this.bloom[0].tex.createView() },
        { binding: 3, resource: { buffer: this.compUniform } },
      ]});
      const pass = enc.beginRenderPass({ colorAttachments: [{
        view: target, clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store' }] });
      pass.setPipeline(this.compPipeline);
      pass.setBindGroup(0, bind);
      pass.draw(6);
      pass.end();
    }

    dev.queue.submit([enc.finish()]);
  }
}
