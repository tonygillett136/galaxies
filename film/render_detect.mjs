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
await p.goto('http://127.0.0.1:8787/index.html', { waitUntil:'load' });
await p.waitForFunction(() => globalThis.__app && globalThis.__app.device, null, { timeout:180000 });
await p.waitForTimeout(4000);

await p.evaluate(async () => {
  const a = globalThis.__app;
  a.setMode('detective');
  await new Promise(r=>setTimeout(r,900));
  const names=[...document.getElementById('target').options].map(o=>o.value).filter(Boolean);
  a.selectTarget(names.find(n=>/242|4676|Mice/i.test(n)) || names[0], true);
  await new Promise(r=>setTimeout(r,1600));
});
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
  const mpx = (a.renderer.width * a.renderer.height) / 1e6;
  const resComp = Math.min(4.0, Math.max(1.0, mpx / 2.0));
  a.renderer.settings.intensity = 0.022 * 1.037 / resComp;
  a.seek(c.t0);
}, cfg);
await p.waitForTimeout(7000);

const write = (buf) => new Promise((res) => ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res));
let acc = 0;
const t0 = Date.now();
for (let n = 0; n < frames; n++) {
  const u = n/(frames-1), ease = u*u*(3-2*u);
  acc += spf;
  const whole = Math.floor(acc); acc -= whole;
  await p.evaluate(([s, th, ph, di, dir, uu]) => {
    globalThis.__app.__u = uu;
    const a = globalThis.__app;
    for (let i=0;i<s;i++) a.sim.step(a.dt * dir);
    a.camera.theta = a.camera._want.theta = th;
    a.camera.phi = a.camera._want.phi = ph;
    a.camera.distance = a.camera._want.distance = di;
    const bd = document.getElementById('backdrop');
    if (bd) bd.style.opacity = String(0.92 - 0.5*Math.sin(Math.PI*(a.__u ?? 0)));
    a.renderer.render(a.ctx.getCurrentTexture().createView(), a.sim, a.camera, 0);
  }, [whole,
      (cfg.theta0 ?? 0.5) + (cfg.thetaSweep ?? 0.3)*u,
      (cfg.phi ?? 1.15) + (cfg.phiSweep ?? 0)*ease,
      d0 + (d1-d0)*ease,
      cfg.dir ?? 1, u]);
  await write(await p.screenshot({ type:'jpeg', quality:92 }));
  if (n % 300 === 0) process.stderr.write(`  ${name} ${n}/${frames} ${((Date.now()-t0)/1000/60).toFixed(1)}min\n`);
}
ff.stdin.end();
await new Promise(r => ff.on('close', r));
const t = await p.evaluate(() => +globalThis.__app.sim.time.toFixed(1));
console.log(`${name}: ${frames} frames @${FPS}fps 4K, ended t=${t}, ${((Date.now()-t0)/1000/60).toFixed(1)} min`);
await b.close();
