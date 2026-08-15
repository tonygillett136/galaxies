/**
 * WebGPU restricted-problem simulation.
 *
 * Split by precision, not by convenience:
 *   - the galaxy orbit (2 bodies) integrates on the CPU in float64, via the same
 *     RestrictedSim used as the test reference, so the encounter geometry that
 *     every fitted parameter depends on never touches float32;
 *   - the test particles (up to millions) integrate on the GPU in float32, where
 *     the measured cost is 0.67 ms/step at 1e6 particles.
 *
 * The GPU kernel is asserted against the CPU reference in test/gpu.test.js.
 */

import { KERNELS, POTENTIAL_KIND } from './kernels.js';
import { RestrictedSim } from './cpu.js';

const GALAXY_STRIDE = 8;    // floats: vec4 posMass + vec4 params

/**
 * A composite potential cannot be one GPU entry, so it becomes several entries
 * sharing a centre. The kernel just sums over entries, so this needs no special
 * case there; only the position update has to keep components together.
 */
function flatten(galaxies) {
  const comps = [];
  galaxies.forEach((g, gi) => {
    const parts = g.potential.kind === 'composite' ? g.potential.parts : [g.potential];
    for (const p of parts) comps.push({ parent: gi, potential: p });
  });
  return comps;
}

export class GpuSim {
  constructor(device, galaxies, particles, friction = 0) {
    this.device = device;
    this.count = particles.count;

    // the CPU reference carries the galaxies; zero particles on this instance
    this.orbit = new RestrictedSim({
      galaxies, friction,
      particles: { count: 0, pos: new Float64Array(0), vel: new Float64Array(0) },
    });
    this.comps = flatten(galaxies);
    this.nComp = this.comps.length;

    // vec4-padded, matching WGSL storage stride
    const p4 = new Float32Array(Math.max(this.count, 1) * 4);
    const v4 = new Float32Array(Math.max(this.count, 1) * 4);
    for (let i = 0; i < this.count; i++) {
      p4[i * 4] = particles.pos[i * 3];
      p4[i * 4 + 1] = particles.pos[i * 3 + 1];
      p4[i * 4 + 2] = particles.pos[i * 3 + 2];
      // w channels carry provenance, free to transport and what makes
      // "colour by where this material came from" possible in the renderer
      p4[i * 4 + 3] = particles.radius ? particles.radius[i] : 0;
      v4[i * 4] = particles.vel[i * 3];
      v4[i * 4 + 1] = particles.vel[i * 3 + 1];
      v4[i * 4 + 2] = particles.vel[i * 3 + 2];
      v4[i * 4 + 3] = particles.origin ? particles.origin[i] : 0;
    }

    const mk = (arr) => {
      const b = device.createBuffer({
        size: Math.max(arr.byteLength, 16),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
             | GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
      });
      new Float32Array(b.getMappedRange()).set(arr); b.unmap(); return b;
    };

    this.posBuf = mk(p4);
    this.velBuf = mk(v4);
    const gSize = Math.max(this.nComp * GALAXY_STRIDE * 4, 32);
    this.gNow = device.createBuffer({ size: gSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.gNext = device.createBuffer({ size: gSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.parBuf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const module = device.createShaderModule({ code: KERNELS, label: 'restricted-kdk' });
    // Explicit layout. 'auto' prunes bindings an entry point does not reference,
    // which silently invalidated every dispatch in the first benchmark and
    // produced a throughput figure of 8.6e14 interactions/s for doing nothing.
    const bgl = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ]});
    this.pipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }),
      compute: { module, entryPoint: 'stepKDK' },
    });
    this.bind = device.createBindGroup({ layout: bgl, entries: [
      { binding: 0, resource: { buffer: this.gNow } },
      { binding: 1, resource: { buffer: this.gNext } },
      { binding: 2, resource: { buffer: this.posBuf } },
      { binding: 3, resource: { buffer: this.velBuf } },
      { binding: 4, resource: { buffer: this.parBuf } },
    ]});

    this.scratch = new Float32Array(Math.max(this.nComp * GALAXY_STRIDE, 8));
    this.parScratch = new ArrayBuffer(16);
    this.groups = Math.max(1, Math.ceil(this.count / 256));
    this.time = 0;
    this.steps = 0;
  }

  writeGalaxies(buffer) {
    const s = this.scratch;
    for (let i = 0; i < this.nComp; i++) {
      const { parent, potential } = this.comps[i];
      const g = this.orbit.galaxies[parent];
      const o = i * GALAXY_STRIDE;
      s[o] = g.pos[0]; s[o + 1] = g.pos[1]; s[o + 2] = g.pos[2];
      s[o + 3] = potential.mass;
      s[o + 4] = potential.scale ?? 0;
      s[o + 5] = POTENTIAL_KIND[potential.kind] ?? 0;
      s[o + 6] = potential.concentration ?? 10;
      s[o + 7] = 0;
    }
    this.device.queue.writeBuffer(buffer, 0, s, 0, this.nComp * GALAXY_STRIDE);
  }

  /**
   * Advance by dt. Negative dt runs backwards, in the same sense the CPU
   * reference does, which is what makes UI time-scrubbing real rather than a
   * replay of stored frames.
   */
  step(dt) {
    this.writeGalaxies(this.gNow);
    this.orbit.step(dt);
    this.writeGalaxies(this.gNext);

    new Uint32Array(this.parScratch, 0, 2).set([this.count, this.nComp]);
    new Float32Array(this.parScratch, 8, 1).set([dt]);
    this.device.queue.writeBuffer(this.parBuf, 0, this.parScratch);

    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bind);
    pass.dispatchWorkgroups(this.groups);
    pass.end();
    this.device.queue.submit([enc.finish()]);

    this.time += dt;
    this.steps++;
  }

  run(dt, n) { for (let i = 0; i < n; i++) this.step(dt); }

  /** Read particle positions back to the CPU. Slow; tests and export only. */
  async readPositions() {
    const bytes = Math.max(this.count, 1) * 16;
    const stage = this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(this.posBuf, 0, stage, 0, bytes);
    this.device.queue.submit([enc.finish()]);
    await stage.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(stage.getMappedRange().slice(0));
    stage.unmap(); stage.destroy();
    return out;   // vec4 stride
  }

  destroy() {
    for (const b of [this.posBuf, this.velBuf, this.gNow, this.gNext, this.parBuf]) b.destroy();
  }
}

/** Request an adapter and device with the limits this project needs. */
export async function createDevice() {
  if (!navigator.gpu) throw new Error('WebGPU not available in this browser');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter');
  const lim = adapter.limits;
  const device = await adapter.requestDevice({
    requiredLimits: {
      maxStorageBufferBindingSize: Math.min(lim.maxStorageBufferBindingSize, 1 << 30),
      maxBufferSize: Math.min(lim.maxBufferSize, 1 << 30),
    },
  });
  // DEVICE LOSS AND UNCAPTURED ERRORS, which the app had no handling for at all.
  //
  // Round 4 destroyed two sim buffers under a live loop and got 185 uncaptured
  // errors in 700 ms with zero app-side logging — and the fps readout went UP.
  // After device.destroy() the rAF loop kept running, sim.time kept advancing,
  // and the instrument read a steady "60 fps / 16.7 ms" — precisely BECAUSE the
  // device was dead: every GPU call becomes a no-op, so the callback lands on
  // vsync exactly. The frame counter times rAF deltas and never awaits the GPU.
  //
  // In a project whose stated first principle is that instruments must not lie,
  // that is the worst possible failure mode: the reading is not merely wrong,
  // it is BEST when the situation is worst.
  //
  // `device.lost` is a promise that never rejects, so this cannot throw; the flag
  // it sets is what the render loop and the fps readout consult.
  device.__lost = null;
  device.lost.then((info) => {
    device.__lost = info;
    console.error(`WebGPU device lost (${info.reason}): ${info.message}`);
    globalThis.dispatchEvent(new CustomEvent('gpudevicelost', { detail: info }));
  });
  device.addEventListener?.('uncapturederror', (e) => {
    device.__errorCount = (device.__errorCount ?? 0) + 1;
    // log the first few in full, then count, so a runaway does not drown the console
    if (device.__errorCount <= 5) console.error('WebGPU uncaptured error:', e.error?.message ?? e.error);
    else if (device.__errorCount === 6) console.error('WebGPU: further uncaptured errors suppressed');
  });

  return { adapter, device, info: adapter.info ?? {} };
}
