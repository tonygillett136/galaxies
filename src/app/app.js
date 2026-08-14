/**
 * The interactive application.
 *
 * Design rule taken from the interaction-designer brief: controls change a
 * value, instruments tell you what the value is doing. Simulation tools are
 * usually all control and no instrument, which is why people fiddle without
 * learning. Everything on screen that is not a control is an instrument, and the
 * scale bar, the clock and the frame counter are all live and honest.
 */

import { createDevice, GpuSim } from '../engine/gpu.js';
import { Renderer } from '../render/renderer.js';
import { OrbitCamera } from '../render/camera.js';
import { buildEncounter, SCENARIOS } from '../engine/encounter.js';
import { timeToMyr } from '../engine/units.js';

const $ = (id) => document.getElementById(id);

export class App {
  constructor() {
    this.playing = true;
    this.dt = 0.02;
    this.speed = 1;
    this.substeps = 4;
    this.scenarioKey = 'prograde';
    this.frameTimes = [];
    this.lastFrame = performance.now();
  }

  async start() {
    const canvas = $('view');
    const { device, info } = await createDevice();
    this.device = device;
    this.adapterInfo = info;

    this.ctx = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.ctx.configure({ device, format: this.format, alphaMode: 'opaque' });

    this.renderer = await Renderer.create(device, canvas, this.format);
    // pulled back from 42: at 42 the tidal tails ran off the top of the frame,
    // and a tail that leaves the picture is the whole point of the picture
    this.camera = new OrbitCamera({ distance: 66, theta: 0.5, phi: 1.15 }).attach(canvas);

    this.buildUI();
    this.loadScenario(this.scenarioKey);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.resize();

    requestAnimationFrame(() => this.frame());
  }

  resize() {
    const canvas = $('view');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    canvas.width = w; canvas.height = h;
    this.renderer.resize(w, h);
  }

  loadScenario(key) {
    this.scenarioKey = key;
    const sc = SCENARIOS[key];
    this.spec = structuredClone(sc.spec);
    this.rebuild();
    $('blurb').textContent = sc.blurb;
    for (const b of document.querySelectorAll('[data-scenario]')) {
      b.classList.toggle('on', b.dataset.scenario === key);
    }
  }

  /** Rebuild the simulation from the current spec, preserving camera and settings. */
  rebuild() {
    if (this.sim) this.sim.destroy();
    const { galaxies, particles } = buildEncounter(this.spec);
    this.sim = new GpuSim(this.device, galaxies, particles);
    this.startTime = this.spec.tStart;
    this.sim.time = this.spec.tStart;
    this.sim.orbit.time = this.spec.tStart;
    $('count').textContent = particles.count.toLocaleString();
  }

  /** Step to a target time. Backwards is real reversal, not a replay. */
  seek(target) {
    const maxSteps = 4000;
    let guard = 0;
    while (Math.abs(this.sim.time - target) > this.dt * 0.5 && guard++ < maxSteps) {
      this.sim.step(this.sim.time < target ? this.dt : -this.dt);
    }
  }

  frame() {
    const now = performance.now();
    const frameMs = now - this.lastFrame;
    this.lastFrame = now;
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > 40) this.frameTimes.shift();

    if (this.playing) {
      for (let i = 0; i < this.substeps; i++) this.sim.step(this.dt * this.speed);
    }

    this.camera.update();
    this.renderer.render(
      this.ctx.getCurrentTexture().createView(),
      { posBuf: this.sim.posBuf, velBuf: this.sim.velBuf, count: this.sim.count },
      this.camera, now * 0.001);

    this.updateInstruments(frameMs);
    requestAnimationFrame(() => this.frame());
  }

  updateInstruments(frameMs) {
    const med = [...this.frameTimes].sort((a, b) => a - b)[Math.floor(this.frameTimes.length / 2)] || frameMs;
    // Reported with the particle count, because a frame rate without N is not a
    // measurement of anything.
    $('fps').textContent = `${(1000 / med).toFixed(0)} fps`;
    $('ms').textContent = `${med.toFixed(1)} ms`;

    const myr = timeToMyr(this.sim.time);
    $('clock').textContent = `${myr >= 0 ? '+' : ''}${myr.toFixed(0)} Myr`;
    $('clocknote').textContent = myr < 0 ? 'before pericentre' : 'after pericentre';
    $('sep').textContent = `${this.sim.orbit.diagnostics().separation.toFixed(1)} kpc`;

    if (!this.scrubbing) {
      const sl = $('scrub');
      sl.value = String(this.sim.time);
    }

    // Scale bar: choose a round number of kpc that lands near 130 px.
    const wpp = this.camera.worldPerPixel($('view').clientHeight);
    const targetKpc = wpp * 130;
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    let pick = nice[nice.length - 1];
    for (const n of nice) if (n >= targetKpc) { pick = n; break; }
    $('barfill').style.width = `${Math.round(pick / wpp)}px`;
    $('barlabel').textContent = `${pick} kpc`;
  }

  buildUI() {
    const scen = $('scenarios');
    for (const [key, sc] of Object.entries(SCENARIOS)) {
      const b = document.createElement('button');
      b.textContent = sc.label;
      b.dataset.scenario = key;
      b.onclick = () => this.loadScenario(key);
      scen.appendChild(b);
    }

    $('play').onclick = () => {
      this.playing = !this.playing;
      $('play').textContent = this.playing ? 'Pause' : 'Play';
      $('play').classList.toggle('on', this.playing);
    };
    $('reset').onclick = () => { this.rebuild(); };

    const scrub = $('scrub');
    scrub.oninput = () => {
      this.scrubbing = true;
      this.playing = false;
      $('play').textContent = 'Play';
      $('play').classList.remove('on');
      this.seek(parseFloat(scrub.value));
    };
    scrub.onchange = () => { this.scrubbing = false; };

    const bind = (id, apply, fmt = (v) => v.toFixed(2)) => {
      const el = $(id), out = $(id + 'v');
      const run = () => {
        const v = parseFloat(el.value);
        apply(v);
        if (out) out.textContent = fmt(v);
      };
      el.oninput = run; run();
    };

    const rs = this.renderer.settings;
    bind('speed', (v) => { this.speed = v; }, (v) => `${v.toFixed(2)}x`);
    bind('size', (v) => { rs.splatSize = v; }, (v) => v.toFixed(3));
    bind('intensity', (v) => { rs.intensity = v; }, (v) => v.toFixed(3));
    bind('exposure', (v) => { rs.exposure = v; });
    bind('bloom', (v) => { rs.bloomMix = v; });

    $('colour').onchange = (e) => { rs.colourMode = parseInt(e.target.value, 10); };
    $('science').onchange = (e) => {
      rs.scienceMode = e.target.checked;
      document.body.classList.toggle('science', e.target.checked);
    };

    // Encounter parameters: changing one rebuilds. This is the sandbox.
    const param = (id, key, fmt) => {
      const el = $(id), out = $(id + 'v');
      const run = () => {
        const v = parseFloat(el.value);
        if (out) out.textContent = fmt ? fmt(v) : v.toFixed(2);
      };
      el.oninput = run;
      el.onchange = () => {
        const v = parseFloat(el.value);
        if (key === 'inc1') this.spec.disc1.inclination = v;
        else if (key === 'inc2') this.spec.disc2.inclination = v;
        else this.spec[key] = v;
        this.rebuild();
      };
      run();
    };
    param('massRatio', 'massRatio');
    param('rPeri', 'rPeri', (v) => `${v.toFixed(1)} kpc`);
    param('ecc', 'ecc');
    param('inc1', 'inc1', (v) => `${(v * 57.2958).toFixed(0)}°`);
    param('inc2', 'inc2', (v) => `${(v * 57.2958).toFixed(0)}°`);

    $('retro').onchange = (e) => {
      this.spec.disc1.retrograde = e.target.checked;
      this.spec.disc2.retrograde = e.target.checked;
      this.rebuild();
    };

    $('panelToggle').onclick = () => document.body.classList.toggle('collapsed');

    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === ' ') { e.preventDefault(); $('play').click(); }
      if (e.key === 'r') $('reset').click();
      if (e.key === 's') { $('science').checked = !$('science').checked; $('science').dispatchEvent(new Event('change')); }
      if (e.key === 'ArrowLeft') { this.playing = false; this.sim.step(-this.dt * 8); }
      if (e.key === 'ArrowRight') { this.playing = false; this.sim.step(this.dt * 8); }
    });
  }
}
