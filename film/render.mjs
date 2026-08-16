import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
const OUT = process.env.FILM_OUT || './out';
/**
 * OFFLINE RENDERER. Not a screen recorder.
 *
 * Steps the simulation a fixed amount, captures that exact frame, repeats. The
 * output frame rate is therefore a free choice rather than whatever the machine
 * happened to manage: 60fps here, captured at about 8fps. Rendering 4K costs
 * 17.9 ms/frame; the 132 ms is readback, so resolution is nearly free.
 *
 * Frames are piped straight into ffmpeg. 29,000 4K stills would be ~40 GB on
 * disk and there is no reason for them to touch it.
 */
const name = process.argv[2];
const cfg = JSON.parse(process.argv[3]);
const FPS = 60, W = 3840, H = 2160;
const frames = Math.round(cfg.seconds * FPS);
const spf = cfg.stepsPerFrame;

const ff = spawn('ffmpeg', ['-v','error','-y','-f','image2pipe','-framerate',String(FPS),
  '-i','-','-c:v','libx264','-crf','16','-preset','medium','-pix_fmt','yuv420p',
  `${OUT}/${name}.mp4`], { stdio:['pipe','inherit','inherit'] });

const b = await chromium.launch({ channel:'chrome', headless:false, args:['--enable-unsafe-webgpu'] });
const p = await b.newPage({ viewport:{ width:W, height:H } });
await p.goto(`http://127.0.0.1:8787/index.html?sc=${cfg.scenario}`, { waitUntil:'load' });
await p.waitForFunction(() => globalThis.__app && globalThis.__app.device, null, { timeout:180000 });
await p.waitForTimeout(4000);

// preflight framing, unless a fixed dolly was given
let d0 = cfg.fixedDist?.[0], d1 = cfg.fixedDist?.[1];
if (!cfg.fixedDist) {
  const fit = await p.evaluate(async (c) => {
    const a = globalThis.__app; a.playing = false;
    const extent = async (t) => {
      a.seek(t); await new Promise(r=>setTimeout(r,4500));
      const pos = await a.sim.readPositions(), g = a.sim.orbit.galaxies;
      const cx=(g[0].pos[0]+g[1].pos[0])/2, cy=(g[0].pos[1]+g[1].pos[1])/2, cz=(g[0].pos[2]+g[1].pos[2])/2;
      const r=[]; for(let i=0;i<a.sim.count;i+=7){ const d=Math.hypot(pos[i*4]-cx,pos[i*4+1]-cy,pos[i*4+2]-cz); if(Number.isFinite(d)) r.push(d); }
      r.sort((x,y)=>x-y); return r[Math.floor(r.length*0.985)];
    };
    return { r0: await extent(c.t0), r1: await extent(c.t1) };
  }, cfg);
  const fov = 45*Math.PI/180, M = cfg.margin ?? 1.12;
  d0 = fit.r0/Math.tan(fov/2)*M; d1 = fit.r1/Math.tan(fov/2)*M;
}

await p.evaluate((c) => {
  const a = globalThis.__app;
  a.playing = false; a.camera.userZoomed = true; a.follow = c.follow || 'pair';
  document.body.classList.add('collapsed');
  for (const id of ['hudTop','hudBottom','legend','sciNote','timeline','panelToggle','scalebar','targetName','busy'])
    { const el=document.getElementById(id); if(el) el.style.display='none'; }
  if (c.colour !== undefined) a.renderer.settings.colourMode = c.colour;
  // EXPOSURE, pinned to the 1080p reference.
  //
  // The app scales intensity with backing-store area, because a splat covers a
  // fixed world size and spreads its light over more pixels as resolution goes
  // up. That compensation is right for a browser window and wrong here: at
  // 3840x2160 it applies a 4.0x boost against 1.04x at 1920x1080, and the 4K
  // frames clipped at 252 where the 1080p reference peaked at 217.
  // Pin the product so the film is graded the same at any render size.
  const mpx = (a.renderer.width * a.renderer.height) / 1e6;
  const resComp = Math.min(4.0, Math.max(1.0, mpx / 2.0));
  a.renderer.settings.intensity = 0.022 * 1.037 / resComp;
  a.seek(c.t0);
}, cfg);
await p.waitForTimeout(7000);

// MOTION BLUR. Splatting is additive and happens before tone mapping, so
// summing SUB sub-frames and scaling intensity by 1/SUB is the exact time
// average of the image rather than an approximation of one. The sub-frames
// advance BOTH the simulation and the camera, so object motion and camera
// motion both blur. Every frame of the previous cut was an infinitely sharp
// instant, which is the single clearest "this is CG" tell.
//
// The dust column accumulates in the same pass, so dustStrength is scaled too:
// without that the extinction comes out SUB times too opaque.
const SUB = Number(process.env.FILM_SUB || cfg.sub || 1);
await p.evaluate((sub) => {
  const a = globalThis.__app;
  // STOP THE APP'S OWN FRAME LOOP. app.frame() reschedules itself on
  // requestAnimationFrame and calls renderer.render(), whose splat pass begins
  // with loadOp 'clear'. Harmless while render() was atomic; with accumulation
  // it fires BETWEEN sub-splats and wipes them, and exposure fell to 0.25 of a
  // single-sample render.
  //
  // Neutering render() alone is NOT enough and the failure is worse: the loop
  // keeps running, still takes its own getCurrentTexture() each frame, draws
  // nothing into it, and presents THAT — so the canvas goes black and every
  // captured frame with it. Measured: identical 0.159 mean luma whether or not
  // a splat had just been issued.
  //
  // app.frame() reschedules via `() => this.frame()`, which resolves `frame` at
  // call time, so replacing it stops the loop after at most one more tick.
  a.frame = () => {};
  const st = a.renderer.settings;
  st._i0 = st._i0 ?? st.intensity;
  st._d0 = st._d0 ?? st.dustStrength;
  st.intensity = st._i0 / sub;
  st.dustStrength = st._d0 / sub;
}, SUB);

const write = (buf) => new Promise((res) => ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res));
const t0 = Date.now();
for (let n = 0; n < frames; n++) {
  const u0 = n/(frames-1), u1 = Math.min(1, (n+1)/(frames-1));
  await p.evaluate(([sub, spf2, u0b, u1b, c, dir]) => new Promise((done) => {
    // The work must happen INSIDE a requestAnimationFrame callback. A WebGPU
    // canvas is only composited as part of an animation frame, so with the app's
    // own loop stopped (it clears, see above) a render issued from a bare
    // evaluate never reaches the screen and every frame comes out black.
    requestAnimationFrame(() => {
    const a = globalThis.__app;
    const lerp = (x, y, t) => x + (y - x) * t;
    const cam = (uu) => {
      const e = uu*uu*(3-2*uu);
      return [ (c.theta0 ?? 0.5) + (c.thetaSweep ?? 0.3)*uu,
               (c.phi ?? 1.15) + (c.phiSweep ?? 0)*e,
               c.d0 + (c.d1 - c.d0)*e ];
    };
    // one sub-step of simulation per sub-sample; the total per frame is
    // unchanged, so the shot's timing is identical to a non-blurred render
    const subDt = a.dt * dir * (spf2 / sub);
    for (let k = 0; k < sub; k++) {
      a.sim.step(subDt);
      const [th, ph, di] = cam(lerp(u0b, u1b, (k + 0.5) / sub));
      a.camera.theta = a.camera._want.theta = th;
      a.camera.phi = a.camera._want.phi = ph;
      a.camera.distance = a.camera._want.distance = di;
      a.renderer.splat(a.sim, a.camera, k === 0);
    }
    a.renderer.finish(a.ctx.getCurrentTexture().createView(), 0);
    done();
    });
  }), [SUB, spf, u0, u1,
      { theta0: cfg.theta0, thetaSweep: cfg.thetaSweep, phi: cfg.phi, phiSweep: cfg.phiSweep, d0, d1 },
      cfg.dir ?? 1]);
  await write(await p.screenshot({ type:'jpeg', quality:92 }));
  if (n % 300 === 0) process.stderr.write(`  ${name} ${n}/${frames} sub=${SUB} ${((Date.now()-t0)/1000/60).toFixed(1)}min\n`);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
const t = await p.evaluate(() => +globalThis.__app.sim.time.toFixed(1));
console.log(`${name}: ${frames} frames @${FPS}fps 4K, ended t=${t}, ${((Date.now()-t0)/1000/60).toFixed(1)} min`);
await b.close();
