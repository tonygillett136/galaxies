/**
 * The one shot the restricted tier cannot produce: a galaxy alone, with spiral
 * arms that GREW rather than being drawn in.
 *
 * Act I ends on a disc left to itself. In the restricted tier that disc is a
 * smooth featureless annulus, because spiral structure is a collective
 * phenomenon and there is no collective when the particles are massless. Here
 * the disc is self-gravitating, it is started at Toomre Q = 1.2, and the shot
 * begins at t = 160 — the epoch where the m=2 amplitude over its own shot-noise
 * floor was measured to peak.
 *
 * The renderer takes a LiveSim unchanged: it reads posBuf, velBuf and count, and
 * treats `orbit` as optional. Nothing had to be adapted.
 *
 * PHYSICS IS NOT SUB-STEPPED HERE. The other shots advance the simulation
 * between motion-blur sub-samples, which costs 16x the physics; that is free in
 * the restricted tier and is not here. This shot turns slowly enough that
 * per-frame object motion is a fraction of a pixel, so the blur that matters is
 * the camera's, and only the camera is sub-sampled. Stated because it is a
 * difference between this shot and the rest, not because it is invisible.
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';

const OUT = process.env.FILM_OUT || './out';
const name = process.argv[2] || 'control_live';
const cfg = JSON.parse(process.argv[3] || '{}');
const FPS = 60, W = 3840, H = 2160;
const SUB = Number(process.env.FILM_SUB || cfg.sub || 16);
const N = cfg.particles ?? 80000;
const Q = cfg.toomreQ ?? 1.2;
const SETTLE = cfg.settle ?? 160;          // time units of pre-evolution
const DT = cfg.dt ?? 0.05;
const frames = Math.round((cfg.seconds ?? 20) * FPS);
const spf = cfg.stepsPerFrame ?? 0.35;

const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS),
  '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
  `${OUT}/${name}.mp4`], { stdio: ['pipe', 'inherit', 'inherit'] });

const b = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu'] });
const p = await b.newPage({ viewport: { width: W, height: H } });
p.on('pageerror', (e) => console.error('PAGEERROR', e.message.slice(0, 300)));
await p.goto('http://127.0.0.1:8787/index.html', { waitUntil: 'load' });
await p.waitForFunction(() => globalThis.__app && globalThis.__app.device, null, { timeout: 180000 });
await p.waitForTimeout(4000);

const t0 = Date.now();
process.stderr.write(`  ${name}: building live disc N=${N} Q=${Q}, settling ${SETTLE} time units\n`);

await p.evaluate(async ({ N, Q, SETTLE, DT, SUB }) => {
  const a = globalThis.__app;
  a.frame = () => {};                       // stop the app's loop; see render.mjs
  a.playing = false; a.camera.userZoomed = true;
  document.body.classList.add('collapsed');
  for (const id of ['hudTop', 'hudBottom', 'legend', 'sciNote', 'timeline', 'panelToggle',
                    'scalebar', 'targetName', 'busy', 'domainWarn', 'frictionNote', 'periWarn'])
    { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

  const { galaxyModel } = await import('./src/engine/encounter.js');
  const { rigidWithoutDisc, liveExponentialDisc } = await import('./src/engine/livedisc.js');
  const { LiveSim } = await import('./src/engine/live.js');
  const { rigid, discMass } = rigidWithoutDisc(galaxyModel(1.0));
  const ic = liveExponentialDisc({
    count: N, discMass, scaleLength: 3.0, rigid, toomreQ: Q,
    seed: 11, rMax: 4.5, thickness: 0.1,
  });
  const sim = await LiveSim.create(a.device, [{ pos: [0, 0, 0], potential: rigid }], ic, 0.2);
  // settle to the epoch where the measured m=2 amplitude peaks
  sim.run(DT, Math.round(SETTLE / DT));
  await a.device.queue.onSubmittedWorkDone();
  a.sim.destroy?.();
  a.sim = sim;

  // exposure pinned exactly as render.mjs does, then divided across sub-samples
  const mpx = (a.renderer.width * a.renderer.height) / 1e6;
  const resComp = Math.min(4.0, Math.max(1.0, mpx / 2.0));
  const st = a.renderer.settings;
  st.intensity = (0.022 * 1.037 / resComp) / SUB;
  st.dustStrength = st.dustStrength / SUB;
}, { N, Q, SETTLE, DT, SUB });

process.stderr.write(`  ${name}: settled in ${((Date.now() - t0) / 1000).toFixed(0)}s, rendering ${frames} frames\n`);

const write = (buf) => new Promise((res) => ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res));
const t1 = Date.now();
for (let n = 0; n < frames; n++) {
  const u0 = n / (frames - 1), u1 = Math.min(1, (n + 1) / (frames - 1));
  await p.evaluate(([sub, steps, a0, a1, c]) => new Promise((done) => {
    requestAnimationFrame(() => {
      const a = globalThis.__app;
      for (let i = 0; i < steps; i++) a.sim.step(c.dt);
      for (let k = 0; k < sub; k++) {
        const uu = a0 + (a1 - a0) * ((k + 0.5) / sub);
        const e = uu * uu * (3 - 2 * uu);
        a.camera.theta = a.camera._want.theta = c.theta0 + c.thetaSweep * uu;
        a.camera.phi = a.camera._want.phi = c.phi + c.phiSweep * e;
        a.camera.distance = a.camera._want.distance = c.d0 + (c.d1 - c.d0) * e;
        a.renderer.splat(a.sim, a.camera, k === 0);
      }
      a.renderer.finish(a.ctx.getCurrentTexture().createView(), 0);
      done();
    });
  }), [SUB, Math.round(spf), u0, u1, {
    dt: DT, theta0: cfg.theta0 ?? 0.2, thetaSweep: cfg.thetaSweep ?? 0.9,
    phi: cfg.phi ?? 1.30, phiSweep: cfg.phiSweep ?? -0.35,
    d0: cfg.dist?.[0] ?? 95, d1: cfg.dist?.[1] ?? 78,
  }]);
  await write(await p.screenshot({ type: 'jpeg', quality: 92 }));
  if (n % 300 === 0) process.stderr.write(`  ${name} ${n}/${frames} ${((Date.now() - t1) / 1000 / 60).toFixed(1)}min\n`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
console.log(`${name}: ${frames} frames @${FPS}fps 4K, live self-gravitating disc, `
  + `${((Date.now() - t1) / 1000 / 60).toFixed(1)} min`);
await b.close();
