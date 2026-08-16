/**
 * The LIVE tier: particles with mass that feel each other.
 *
 * Construction mirrors GpuSim deliberately, so the two can be compared, but the
 * integration is arranged differently and the reason is cost. See livekernels.js
 * for why the acceleration is cached rather than recomputed.
 *
 * Rigid components are still passed in as `galaxies` and are still analytic.
 * The intended Stage 1 configuration is a live disc and bulge inside a rigid
 * halo: the halo carries 93.9% of the mass, so making it live at this particle
 * budget would make each halo particle ~11x heavier than a disc particle and
 * heat the disc by two-body relaxation, destroying the structure the exercise
 * exists to produce.
 */

import { LIVE_KERNELS } from './livekernels.js';
import { makeShader } from './shadercheck.js';
import { POTENTIAL_KIND } from './kernels.js';

const GALAXY_STRIDE = 8;   // two vec4f

export class LiveSim {
  /**
   * @param {GPUDevice} device
   * @param {Array} galaxies  rigid components: {pos, mass, potential:{kind, a, c}}
   * @param {Object} particles {count, pos:Float32Array(3N), vel, mass:Float32Array(N),
   *                            radius?, origin?}
   * @param {number} eps  self-gravity softening, in kpc
   */
  static async create(device, galaxies, particles, eps, opts = {}) {
    const s = new LiveSim();
    await s._init(device, galaxies, particles, eps, opts);
    return s;
  }

  async _init(device, galaxies, particles, eps, opts = {}) {
    this.device = device;
    this.count = particles.count;
    this.eps = eps;
    // Flatten composites into leaf components, exactly as GpuSim does: the
    // kernel loop knows about single potentials, not about composites.
    this.comps = [];
    (galaxies ?? []).forEach((g, gi) => {
      const parts = g.potential.kind === 'composite' ? g.potential.parts : [g.potential];
      // `galaxy` is the index the component came from, so setCentres can move a
      // whole galaxy's components together without re-flattening.
      for (const potential of parts) this.comps.push({ pos: g.pos, potential, galaxy: gi });
    });
    this.nComp = Math.max(1, this.comps.length);

    const n = this.count;
    const p4 = new Float32Array(n * 4);
    const v4 = new Float32Array(n * 4);
    const m1 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      p4[i * 4] = particles.pos[i * 3];
      p4[i * 4 + 1] = particles.pos[i * 3 + 1];
      p4[i * 4 + 2] = particles.pos[i * 3 + 2];
      p4[i * 4 + 3] = particles.radius ? particles.radius[i] : 0;
      v4[i * 4] = particles.vel[i * 3];
      v4[i * 4 + 1] = particles.vel[i * 3 + 1];
      v4[i * 4 + 2] = particles.vel[i * 3 + 2];
      v4[i * 4 + 3] = particles.origin ? particles.origin[i] : 0;
      m1[i] = particles.mass[i];
    }
    this.totalMass = m1.reduce((a, b) => a + b, 0);

    const mk = (arr, extra = 0) => {
      const b = device.createBuffer({
        size: Math.max(arr.byteLength, 16),
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | extra,
        mappedAtCreation: true,
      });
      new Float32Array(b.getMappedRange()).set(arr); b.unmap(); return b;
    };

    this.posBuf = mk(p4, GPUBufferUsage.VERTEX);
    this.velBuf = mk(v4, GPUBufferUsage.VERTEX);
    this.massBuf = mk(m1);
    this.accBuf = device.createBuffer({
      size: Math.max(n * 16, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.gBuf = device.createBuffer({
      size: Math.max(this.nComp * GALAXY_STRIDE * 4, 32),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.parBuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

    const module = await makeShader(device, LIVE_KERNELS, 'live-nbody');
    // Explicit layout, never 'auto': 'auto' prunes bindings an entry point does
    // not reference, so `kick` would get a different layout from `computeAccel`
    // and the shared bind group would be invalid. This is the failure that once
    // reported 8.6e14 interactions/s for doing nothing.
    const bgl = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    ]});
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    const pipe = (entryPoint) => device.createComputePipeline({ layout, compute: { module, entryPoint } });
    this.pAccel = pipe('computeAccel');
    this.pKickDrift = pipe('kickDrift');
    this.pKick = pipe('kick');
    this.bind = device.createBindGroup({ layout: bgl, entries: [
      { binding: 0, resource: { buffer: this.gBuf } },
      { binding: 1, resource: { buffer: this.posBuf } },
      { binding: 2, resource: { buffer: this.velBuf } },
      { binding: 3, resource: { buffer: this.accBuf } },
      { binding: 4, resource: { buffer: this.massBuf } },
      { binding: 5, resource: { buffer: this.parBuf } },
    ]});

    this.groups = Math.max(1, Math.ceil(n / 256));
    this.tiles = Math.max(1, Math.ceil(n / 256));

    // DISPATCH SPLITTING. One O(N^2) dispatch at 175k particles runs ~278 ms and
    // macOS resets the GPU mid-run. Cap the work per dispatch instead: the tile
    // loop already existed, it just needed a range. 4e9 pair-interactions is
    // about 36 ms at the measured 1.1e11/s, comfortably inside whatever the
    // watchdog's real threshold is (which was never measured, only crossed).
    const maxPairs = opts.maxPairsPerDispatch ?? 4e9;
    const tilesPerDispatch = Math.max(1, Math.floor(maxPairs / Math.max(n * 256, 1)));
    this.chunks = [];
    for (let t = 0; t < this.tiles; t += tilesPerDispatch) {
      this.chunks.push([t, Math.min(t + tilesPerDispatch, this.tiles)]);
    }

    this.time = 0;
    this.steps = 0;
    this._writeGalaxies();
    this._writeParams(0, 0, this.tiles);
    this._primed = false;
  }

  _writeGalaxies() {
    const s = new Float32Array(Math.max(this.nComp * GALAXY_STRIDE, 8));
    // Field names match GpuSim.writeGalaxies exactly (mass / scale / kind /
    // concentration). They differ from the constructor arguments of
    // potentials.js on purpose, and getting them wrong here would produce a
    // silently different potential rather than an error.
    this.comps.forEach(({ pos, potential }, i) => {
      const o = i * GALAXY_STRIDE;
      s[o] = pos[0]; s[o + 1] = pos[1]; s[o + 2] = pos[2];
      s[o + 3] = potential.mass;
      s[o + 4] = potential.scale ?? 0;
      s[o + 5] = POTENTIAL_KIND[potential.kind] ?? 0;
      s[o + 6] = potential.concentration ?? 10;
      s[o + 7] = 0;
    });
    this.device.queue.writeBuffer(this.gBuf, 0, s);
  }

  _writeParams(dt, tile0, tile1) {
    const b = new ArrayBuffer(32), dv = new DataView(b);
    dv.setUint32(0, this.count, true);
    dv.setUint32(4, this.comps.length, true);
    dv.setFloat32(8, dt, true);
    dv.setFloat32(12, this.eps, true);
    dv.setUint32(16, tile0, true);
    dv.setUint32(20, tile1, true);
    this.device.queue.writeBuffer(this.parBuf, 0, b);
  }

  /**
   * The full acceleration, as several short dispatches. The first chunk writes
   * `acc` and adds the rigid components; the rest accumulate into it. Each chunk
   * is its own submission because the tile range lives in the uniform buffer and
   * a writeBuffer only takes effect between submissions.
   */
  _accumulateAccel(dt) {
    for (const [t0, t1] of this.chunks) {
      this._writeParams(dt, t0, t1);
      const enc = this.device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setBindGroup(0, this.bind);
      pass.setPipeline(this.pAccel);
      pass.dispatchWorkgroups(this.groups);
      pass.end();
      this.device.queue.submit([enc.finish()]);
    }
  }

  /**
   * One leapfrog KDK step. Exactly ONE O(N^2) pass, by keeping the acceleration.
   *
   * `centresAtEnd` is the position of each rigid galaxy at t+dt, for an encounter
   * where the halos are moving. It must be applied BETWEEN the drift and the
   * acceleration, because the acceleration being computed is the one at the end
   * of the step and it has to see the potential there. Writing it before the
   * drift instead evaluates the new positions against the old potential, which
   * is a half-step of lag that accumulates into a visibly wrong orbit rather
   * than into an error.
   */
  step(dt, centresAtEnd = null) {
    const dev = this.device;

    if (!this._primed) { this._accumulateAccel(dt); this._primed = true; }

    this._writeParams(dt, 0, this.tiles);
    const e1 = dev.createCommandEncoder();
    const p1 = e1.beginComputePass();
    p1.setBindGroup(0, this.bind);
    p1.setPipeline(this.pKickDrift); p1.dispatchWorkgroups(this.groups);
    p1.end();
    dev.queue.submit([e1.finish()]);

    if (centresAtEnd) this.setCentres(centresAtEnd);

    this._accumulateAccel(dt);

    this._writeParams(dt, 0, this.tiles);
    const e2 = dev.createCommandEncoder();
    const p2 = e2.beginComputePass();
    p2.setBindGroup(0, this.bind);
    p2.setPipeline(this.pKick); p2.dispatchWorkgroups(this.groups);
    p2.end();
    dev.queue.submit([e2.finish()]);

    this.time += dt;
    this.steps++;
  }

  /**
   * Move the rigid components. `centres` is one position per GALAXY, in the order
   * they were passed to the constructor; every component flattened out of that
   * galaxy's composite moves with it.
   */
  setCentres(centres) {
    for (const c of this.comps) c.pos = centres[c.galaxy];
    this._writeGalaxies();
  }

  run(dt, n) { for (let i = 0; i < n; i++) this.step(dt); }

  async _read(buf, bytes) {
    const stage = this.device.createBuffer({ size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(buf, 0, stage, 0, bytes);
    this.device.queue.submit([enc.finish()]);
    await stage.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(stage.getMappedRange().slice(0));
    stage.unmap(); stage.destroy();
    return out;
  }

  readPositions() { return this._read(this.posBuf, this.count * 16); }
  readVelocities() { return this._read(this.velBuf, this.count * 16); }
  readMasses() { return this._read(this.massBuf, this.count * 4); }

  destroy() {
    for (const b of [this.posBuf, this.velBuf, this.massBuf, this.accBuf, this.gBuf, this.parBuf]) b.destroy();
  }
}
