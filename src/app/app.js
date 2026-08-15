/**
 * The interactive application.
 *
 * Design rule taken from the interaction-designer brief: controls change a
 * value, instruments tell you what the value is doing. Simulation tools are
 * usually all control and no instrument, which is why people fiddle without
 * learning. The scale bar, clock, separation and frame counter are instruments,
 * and every one of them is live and honest — the frame counter is a median over
 * 40 frames of the real scene, and it is always shown next to N.
 */

import { createDevice, GpuSim } from '../engine/gpu.js';
import { Renderer } from '../render/renderer.js';
import { OrbitCamera } from '../render/camera.js';
import { buildEncounter, SCENARIOS } from '../engine/encounter.js';
import { timeToMyr, timeFromMyr } from '../engine/units.js';
import { loadTargets, specFromFit, fitRows } from './detective.js';
import { TOUR } from './tour.js';
import { stellarColourJS, rampRange } from '../render/shaders.js';

const $ = (id) => document.getElementById(id);

export class App {
  constructor() {
    this.dt = 0.02;
    this.speed = 1;
    this.substeps = 4;
    this.mode = 'sandbox';
    this.scenarioKey = 'prograde';
    this.frameTimes = [];
    this.lastFrame = performance.now();
    this.tourStep = 0;
    this.follow = 'pair';
    this.reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // A user who asked the platform for no motion should not be handed a
    // full-screen animation the instant the page loads. Reduced motion
    // previously gated only a 0.28 s camera easing while playback autostarted.
    // Set ONCE here, and never again outside setPlaying(). start() calls
    // setPlaying(this.playing) as soon as the button exists, so the label agrees
    // with this from the first paint.
    this.playing = !this.reduceMotion;
  }

  async start() {
    const canvas = $('view');
    const { device, info } = await createDevice();
    this.device = device;
    this.adapterInfo = info;

    this.ctx = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    // premultiplied so the canvas can lay light over the SDSS backdrop
    this.ctx.configure({ device, format: this.format, alphaMode: 'premultiplied' });

    this.renderer = await Renderer.create(device, canvas, this.format);
    this.camera = new OrbitCamera({ distance: 66, theta: 0.5, phi: 1.15 }).attach(canvas);
    if (this.reduceMotion) this.camera.damping = 1;   // no easing

    this.buildUI();
    // The label must agree with the state the constructor chose — reduced motion
    // starts paused while index.html ships the button reading "Pause".
    this.setPlaying(this.playing);
    this.loadScenario(this.scenarioKey);
    this.restoreFromUrl();

    // Targets are optional: the app must work without the catalogue, because a
    // missing data file should degrade one mode rather than break the whole thing.
    loadTargets().then((cat) => { this.catalogue = cat; this.fillTargets(); })
      .catch((e) => {
        console.warn('target catalogue unavailable:', e.message);
        $('target').innerHTML = '<option>catalogue unavailable</option>';
        $('fitWarn').textContent = 'Run data/build_targets.py to fetch the observed-target catalogue.';
      });

    // Stop pretending after the device goes away. Without this the loop keeps
    // running, the clock keeps advancing and the fps readout keeps saying 60.
    globalThis.addEventListener('gpudevicelost', (e) => this.onDeviceLost(e.detail));

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();

    // THE CALL THAT USED TO BE HERE WAS DEAD, and its comment described a defect
    // it could not possibly fix.
    //
    // It read: frame once more "now that the scenario is at its view epoch",
    // citing the 848 kpc opening camera. But nothing advances the simulation
    // between loadScenario() above and this line — restoreFromUrl() returns
    // immediately without a ?sc= — so both calls saw simTime -51.735 and content
    // radius 69.693 and computed the same 193.4906 kpc. Round 7 instrumented an
    // otherwise byte-identical tree and measured the two calls as bit-for-bit
    // identical. The 848 kpc symptom was real and IS fixed, but by the separate
    // `mode === 'detective'` gate in selectTarget, not by this.
    //
    // What remains genuinely imperfect is stated rather than papered over: the
    // opening frame is computed at tStart, where the pair is near its widest, so
    // it is about 1.7x wider than the encounter a viewer watches moments later
    // (112.4 kpc would suit a 40.5 kpc separation; 90.9 kpc suits pericentre).
    // Reframing during playback needs to not fight a user who has zoomed, which
    // is a design question and not a one-liner, so it is an OPEN ACTION with
    // those numbers attached, and `f` reframes on demand in the meantime.

    requestAnimationFrame(() => this.frame());
  }

  /**
   * THE ONLY PLACE `playing` CHANGES.
   *
   * It used to be assigned in eight places. Two of them also updated the button,
   * with the same two lines copied out; the other six did not, so the label went
   * stale whenever anything but the button itself paused the clock. Reported
   * symptom: the button reads "Pause" while the simulation is stopped.
   *
   * Reachable ways to see it: press an arrow key to step a frame; open a shared
   * link carrying ?t=; enter a tour step that pins a time; lose the GPU; or —
   * guaranteed — load the page with prefers-reduced-motion set, where the app
   * starts paused and index.html ships the button reading "Pause".
   *
   * A duplicated pair of lines is why the other six were forgotten, so there is
   * one setter now and the state cannot be written without the label following.
   */
  setPlaying(on) {
    this.playing = !!on;
    const b = $('play');
    if (!b) return;
    b.textContent = this.playing ? 'Pause' : 'Play';
    b.classList.toggle('on', this.playing);
    b.setAttribute('aria-pressed', this.playing ? 'true' : 'false');
  }

  /** The device is gone: stop the loop and say so, rather than reading 60 fps. */
  onDeviceLost(info) {
    this.deviceLost = info ?? { reason: 'unknown', message: '' };
    this.setPlaying(false);
    $('fps').textContent = '— fps';
    $('ms').textContent = 'GPU LOST';
    const el = $('busy');
    if (el) {
      el.style.display = 'block';
      el.style.color = 'var(--warm)';
      el.textContent = `GPU device lost (${this.deviceLost.reason}) — reload to continue`;
    }
  }

  resize() {
    const canvas = $('view');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    canvas.width = w; canvas.height = h;
    this.renderer.resize(w, h);
  }

  // ---------------------------------------------------------------- modes

  setMode(mode) {
    this.mode = mode;
    for (const b of document.querySelectorAll('#modes button')) b.classList.toggle('on', b.dataset.mode === mode);
    // data-mode is a LIST: the orbit and disc controls are shared between
    // Sandbox and Detect, because Detect cannot do its job without them.
    for (const s of document.querySelectorAll('section.mode')) {
      s.classList.toggle('on', s.dataset.mode.split(/\s+/).includes(mode));
    }
    const showImg = mode === 'detective';
    $('backdrop').style.opacity = showImg ? String(this.imgOpacity ?? 0.85) : '0';
    $('targetName').style.display = showImg ? 'block' : 'none';
    // No synthetic starfield or vignette over a REAL observation. The SDSS frame
    // has its own real stars and its own real noise; adding invented ones on top
    // and then inviting the user to judge a match is exactly the kind of quiet
    // contamination this project is meant not to do.
    this.renderer.settings.starfield = showImg ? 0 : 0.012;
    this.renderer.settings.vignette = showImg ? 0 : 0.30;
    // ENTERING DETECT MUST APPLY THE SCALE MATCH.
    //
    // Round 7 gated the scale-match assignment on `mode === 'detective'` to stop
    // it setting the SANDBOX opening camera (it was framing every first visit at
    // Arp 240's 848 kpc). That fixed the symptom and created a worse one: the
    // only unprompted selectTarget() comes from fillTargets(), which resolves
    // while the mode is still 'sandbox', so the assignment was skipped — and
    // nothing re-applied it on entry. Round 8 measured the result: the frame
    // spanned 160.3 kpc against a fieldKpc of 702.8, a factor of 4.38, while
    // #fitWarn read "Scale matched: frame is 703 kpc across".
    //
    // An overlay that is 4.4x out is a wrong answer. An overlay that is 4.4x out
    // while the panel says it is calibrated is the failure this project exists
    // to avoid, and it was being baked into every shared Detect link.
    if (mode === 'detective' && Number.isFinite(this.fieldKpc) && !this.cameraFromUrl) {
      this.camera._want.distance = this.fieldKpc / (2 * Math.tan(this.camera.fov / 2));
    }
    if (mode === 'tour') this.gotoTourStep(this.tourStep);
    if (mode === 'atlas') this.syncPad();
  }

  // ------------------------------------------------------------- scenarios

  loadScenario(key) {
    this.setBusy(true);
    this.scenarioKey = key;
    const sc = SCENARIOS[key];
    this.spec = structuredClone(sc.spec);
    // Per-scenario follow target. Following the pair midpoint is right when they
    // stay together and useless for a fly-by whose companion ends 400 kpc away.
    this.follow = sc.follow ?? 'pair';
    $('follow').value = this.follow;
    this.rebuild();
    $('blurb').textContent = sc.blurb;
    for (const b of document.querySelectorAll('[data-scenario]')) b.classList.toggle('on', b.dataset.scenario === key);
    this.syncSpecControls();
    // Frame the new scenario. Loading one and being shown a black frame with a
    // speck in it is the commonest way this app has looked broken while working.
    this.frameToContent();
    if (!this.seeking) this.setBusy(false);
  }

  syncSpecControls() {
    const set = (id, v) => { const e = $(id); if (e) { e.value = String(v); e.dispatchEvent(new Event('input')); } };
    set('massRatio', this.spec.massRatio ?? 1);
    set('rPeri', this.spec.rPeri ?? 4);
    set('ecc', this.spec.ecc ?? 1);
    set('friction', this.spec.friction ?? 0);
    set('inc1', this.spec.disc1?.inclination ?? 0);
    set('inc2', this.spec.disc2?.inclination ?? 0);
    $('retro1').checked = !!this.spec.disc1?.retrograde;
    $('retro2').checked = !!this.spec.disc2?.retrograde;

    // A control that reports a change it did not make is worse than one that is
    // missing. The ring scenario orients its disc from the MEASURED approach
    // direction, so `alignToApproach` overwrites whatever the tilt slider says —
    // measured: moving Primary tilt from 0 to 1.2 changed the particle positions
    // by exactly 0. The slider moved, the number updated, nothing happened.
    //
    // Disable it and say why, rather than letting it lie.
    for (const [id, disc, label] of [['inc1', this.spec.disc1, 'Primary'], ['inc2', this.spec.disc2, 'Secondary']]) {
      const el = $(id);
      if (!el) continue;
      const overridden = !!disc?.alignToApproach;
      el.disabled = overridden;
      el.title = overridden
        ? `${label} tilt is set by the scenario from the measured approach direction, so this control has no effect here.`
        : '';
      const out = $(`${id}v`);
      if (out) out.textContent = overridden ? 'set by approach direction' : out.textContent;
    }
  }

  /** Rebuild from the current spec, preserving camera and appearance. */
  rebuild(viewTime = null) {
    // CANCEL ANY SEEK STILL IN FLIGHT. seek() is chunked across frames and a
    // full-span scrub takes ~3 s, during which every scenario button stays
    // clickable (setBusy only changes a cursor and aria-busy). rebuild() then
    // destroys the old sim and starts the new one at ITS t0 — but seekTarget
    // still pointed at the previous scenario's timeline, so the next frame's
    // pump() drove the new simulation towards an epoch from the old one.
    // loadScenario's `if (!this.seeking)` guard shows the window was known
    // about; this closes it.
    // A GENERATION TOKEN, because clearing the flags does not stop the pump.
    // Round 8 measured it: the already-queued rAF still fired, read
    // `seekTarget === null`, and `Math.abs(t - null)` coerces to 0 — so Reset
    // during a seek walked the NEW simulation to t = 0.0100 instead of leaving
    // it at its own t0 of -63.2100, taking 4,181 further steps with `seeking`
    // false and the busy indicator hidden. Worse, a second pump could start
    // alongside the orphan. A cancelled seek has to be identifiable, not merely
    // flagged.
    this.seekGen = (this.seekGen ?? 0) + 1;
    this.seeking = false;
    this.seekTarget = null;
    this.setBusy?.(false);
    if (this.sim) this.sim.destroy();
    const built = buildEncounter(this.spec);
    const { galaxies, particles, friction, t0 } = built;
    this.built = built;
    this.sim = new GpuSim(this.device, galaxies, particles, friction);
    // Friction is dissipative, so backwards is no longer the same path forwards.
    // Say so rather than letting the scrubber quietly stop meaning what it says.
    $('frictionNote').style.display = friction > 0 ? 'block' : 'none';
    $('periWarn').style.display = built.spec.periConverged ? 'none' : 'block';
    if (!built.spec.periConverged) {
      $('periWarn').textContent =
        `Pericentre solver did not converge (${built.spec.periWhy}): requested `
        + `${built.spec.requestedPeri.toFixed(1)} kpc, this orbit executes `
        + `${built.spec.executedPeri.toFixed(1)} kpc. The value shown is the orbit’s, not yours.`;
    }

    // DOMAIN OF VALIDITY. Making a bound orbit actually bound does not make it
    // modellable. If the two galaxies never separate by more than a disc radius,
    // a rigid-potential restricted three-body model with discs equilibrated in
    // isolation is not describing them, and the picture is not evidence of
    // anything. 21 of the 59 published fits are in that category. Saying so is
    // the honest behaviour; drawing something anyway is not.
    const dom = built.spec.domain;
    const dw = $('domainWarn');
    if (dom && !dom.ok) {
      dw.style.display = 'block';
      dw.textContent = dom.tier === 'inside-disc'
        ? `OUTSIDE THIS MODEL: ${dom.why}. What is drawn is not a prediction — treat it as a picture of the model failing, not of the galaxies.`
        : `AT THE EDGE OF THIS MODEL: ${dom.why}. The discs are not close to isolated, so tidal features here are not trustworthy.`;
    } else {
      dw.style.display = 'none';
    }
    // t0 anchors the clock to the EXECUTED closest approach, so t = 0 is the
    // moment the timeline marker claims it is.
    this.sim.time = t0;
    this.sim.orbit.time = t0;
    this.tStart = t0;
    $('count').textContent = particles.count.toLocaleString();
    const s = $('scrub');
    // Span is per-scenario. A fixed +200 ended the merger's timeline 133 time
    // units before it merges, so the one scenario whose whole point is the
    // merger could not be scrubbed to it.
    const lo = this.tStart, hi = lo + (this.spec.tSpan ?? 200);
    // SNAP THE SPAN TO THE STEP GRID. tStart is an unrounded float
    // (-51.73500000000177), so min + k*0.05 never lands on max: the browser
    // clamps to the last reachable step and the control stops one whole step
    // short of its own end. Measured: setting value = max left it reading
    // 148.214999999998 against a max of 148.26499999999822 — the end of the
    // timeline was simply not reachable by dragging.
    const STEP = 0.05;
    s.min = lo.toFixed(3);
    s.max = (lo + Math.round((hi - lo) / STEP) * STEP).toFixed(3);
    s.step = String(STEP);
    // pericentre is t = 0 by construction; put it where it actually falls
    const frac = Math.max(0, Math.min(1, (0 - lo) / (hi - lo)));
    $('periMark').style.left = `${frac * 100}%`;
    $('periLabel').style.left = `${frac * 100}%`;
    if (viewTime !== null) this.seek(viewTime);
  }

  /**
   * Step to a target time. Backwards is real reversal, not a replay.
   *
   * The guard is derived from the distance to travel, not a fixed 8000. It was
   * fixed, and the retuned Milky Way-scale timeline spans 200 time units at
   * dt = 0.02 — 10,000 steps — so the last fifth of every timeline silently
   * refused to move. Dragging the scrubber to the end left the clock short and
   * the picture wrong, with no indication that anything had been truncated.
   */
  seek(target) {
    // CHUNKED, because an unyielding loop here froze the tab for over two seconds.
    //
    // Measured: GpuSim.step() issues one queue.submit per step, so 6,000 steps
    // cost 1,050 ms of which 99.7% is submission overhead (the same work recorded
    // into a single encoder is 2.6 ms). A full-span scrub of `prograde` is 10,000
    // steps = 2,181 ms with no indicator, and a 2.4 s frozen tab is
    // indistinguishable from a crash.
    //
    // The real fix is to batch the submits — one encoder per seek, with the
    // galaxy trajectory uploaded once and indexed by step. That needs a
    // bind-group-layout change and per-dispatch dynamic offsets, and this
    // project's worst bugs have all come from bind-group layouts, so it is logged
    // in action_tracking rather than rushed. What this does instead is stop the
    // FREEZE: the work is spread across animation frames, the picture updates as
    // it goes, and a busy state is on screen throughout. Measured on a full-span
    // scrub of `prograde` at N = 300k: worst single main-thread block 2,200 ms ->
    // 100 ms at CHUNK 400, and 23 frames render during the seek where none did
    // before. Total elapsed is unchanged, because the submission overhead is the
    // cost; what changes is that the tab is alive and says so.
    this.seekTarget = target;
    if (this.seeking) return;                      // already draining; retarget only
    this.seeking = true;
    this.setBusy(true);

    const CHUNK = 200;                             // measured ~50 ms of submits per frame
    const gen = this.seekGen ?? 0;
    const pump = () => {
      // Superseded by a rebuild, or cancelled: this pump is an orphan.
      if ((this.seekGen ?? 0) !== gen || this.seekTarget === null) return;
      // A DEAD DEVICE IS NOT WORTH STEPPING. Without this the pump kept driving a
      // destroyed device for the rest of the seek — up to three seconds of calls
      // that are all no-ops — and then called setBusy(false) on completion, which
      // HID the "GPU device lost" banner because the banner borrows #busy. The
      // app ended up silent about the one thing it most needed to say.
      if (this.deviceLost) { this.seeking = false; return; }
      const tgt = this.seekTarget;
      let n = 0;
      while (Math.abs(this.sim.time - tgt) > this.dt * 0.5 && n++ < CHUNK) {
        this.sim.step(this.sim.time < tgt ? this.dt : -this.dt);
      }
      if (Math.abs(this.sim.time - tgt) > this.dt * 0.5) {
        requestAnimationFrame(pump);
      } else {
        this.seeking = false;
        this.seekTruncated = false;
        this.setBusy(false);
      }
    };
    pump();
  }

  /**
   * A visible busy state. There was none anywhere — grep for busy, spinner,
   * progress, cursor:wait or aria-busy returned nothing — so every long rebuild
   * looked like the page had died.
   */
  setBusy(on) {
    // THE DEVICE-LOST NOTICE OUTRANKS THE BUSY INDICATOR. Both use #busy, and a
    // seek converging after the device died called setBusy(false) and hid the
    // banner — text still set, element display:none, leaving the user with a
    // frozen picture and no explanation. Losing the device is terminal; nothing
    // that finishes afterwards gets to clear the message.
    if (this.deviceLost && !on) return;
    const el = $('busy');
    if (el) el.style.display = on ? 'block' : 'none';
    document.body.style.cursor = on ? 'progress' : '';
    document.body.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  // ------------------------------------------------------------- detective

  fillTargets() {
    const sel = $('target');
    sel.innerHTML = '';
    for (const t of this.catalogue.targets) {
      const o = document.createElement('option');
      o.value = t.name;
      o.textContent = t.hasImage ? t.name : `${t.name} (no image)`;
      sel.appendChild(o);
    }
    sel.onchange = () => this.selectTarget(sel.value, true);
    // A restored link's target wins over "whatever sorted first".
    const want = this.wantTarget
      && this.catalogue.targets.some((t) => t.name === this.wantTarget)
      ? this.wantTarget : this.catalogue.targets[0].name;
    sel.value = want;
    this.selectTarget(want);
  }

  selectTarget(name, userInitiated = false) {
    const t = this.catalogue.targets.find((x) => x.name === name);
    if (!t) return;
    this.target = t;
    this.targetName = t.name;              // so a shared link can carry it
    $('backdrop').src = t.hasImage ? `./data/targets/${t.image}` : '';
    $('backdrop').style.opacity = this.mode === 'detective' ? String(this.imgOpacity ?? 0.85) : '0';
    const zTag = t.z
      ? `z=${t.z.toFixed(4)} ${t.zKind === 'spec' ? 'spec' : 'PHOTO — scale unreliable'}`
      : 'no redshift — UNCALIBRATED';
    $('targetName').innerHTML =
      `${t.name}<small>${(t.aliases || '').split(',').slice(1, 3).join(' · ').trim() || 'SDSS ' + t.sdssId}`
      + `<br>${zTag}</small>`;

    const rows = fitRows(t.fit);
    $('fitTable').innerHTML = rows.length
      ? rows.map((r) => `<tr class="${r.mapped ? '' : 'unmapped'}"><td>${r.k}${r.mapped ? '' : ' (not mapped)'}</td><td>${r.v}</td></tr>`).join('')
      : '<tr><td colspan="2">No published fit for this target.</td></tr>';

    // Match the camera so one simulated kpc covers the same screen distance as
    // one observed kpc. Without this the overlay is decorative: two things can
    // be made to look alike at any scale.
    const notes = [];
    if (t.kpcPerArcsec) {
      const cat = this.catalogue;
      const fieldKpc = t.kpcPerArcsec * cat.cutoutScaleArcsecPerPixel * cat.cutoutSizePx;
      this.fieldKpc = fieldKpc;
      // ONLY IN DETECT. fillTargets() resolves after start() and calls
      // selectTarget(targets[0]), so this scale-matching used to run while the app
      // was sitting in Sandbox — setting the opening camera from the angular
      // diameter of a target the user had not selected. Measured on the live site:
      // the first view was at 848 kpc for a content radius of 34, i.e. Arp 240's
      // frame width, in the prograde scenario. Round 4 saw the same mechanism
      // overwrite a restored camera from a shared link.
      // A RESTORED CAMERA OUTRANKS THE SCALE MATCH. The catalogue resolves after
      // restoreFromUrl(), so this line ran last and overwrote the ?cam= a shared
      // link had just applied — the viewing geometry is a fitted parameter here,
      // not a preference, so losing it changes the thing being compared. It is
      // still applied for a selection the user actually made.
      if (this.mode === 'detective' && (userInitiated || !this.cameraFromUrl)) {
        this.camera._want.distance = fieldKpc / (2 * Math.tan(this.camera.fov / 2));
      }
      notes.push(`Scale matched: frame is ${fieldKpc.toFixed(0)} kpc across, z = ${t.z.toFixed(4)}.`);
      if (t.zKind === 'photo') {
        notes.push('SCALE UNRELIABLE: this is a PHOTOMETRIC redshift, not spectroscopic. '
                 + 'These are routinely wrong by large factors — Arp 240’s is off by about five — '
                 + 'so the physical scale of this overlay may be badly wrong.');
      }
    } else {
      this.fieldKpc = null;
      notes.push('NO REDSHIFT for this target, so the overlay is UNCALIBRATED: '
               + 'simulated kpc and observed arcsec are not on the same scale and a visual match means nothing.');
    }

    const m = specFromFit(t.fit);
    $('fitWarn').innerHTML = [...notes, ...(m ? m.notes : [])].map((n) => `• ${n}`).join('<br>');
    $('loadFit').disabled = !m;
  }

  loadPublishedFit() {
    if (!this.target?.fit) return;
    const m = specFromFit(this.target.fit);
    if (!m) return;
    this.spec = m.spec;
    this.rebuild(m.viewTime);
    this.setPlaying(false);
    this.syncSpecControls();
  }

  /**
   * The colour key. Colour was carrying meaning with nothing to read it against,
   * which makes it decoration that looks like data — and the stellar-population
   * ramp in particular is physically MOTIVATED but not calibrated, so saying so
   * matters more than the gradient does.
   */
  updateLegend() {
    const mode = this.renderer.settings.colourMode;
    // The population bar is SAMPLED from the same ramp the shader uses, over the
    // t range the shader actually reaches. Hand-written stops advertised the
    // t = 0 and t = 1 colours while the shader spans only 0.06 to 0.80 on a
    // 13.5 kpc disc, so both ends of the key showed colours no particle has.
    const [t0, t1] = rampRange(13.5);
    const stops = [];
    for (let i = 0; i <= 8; i++) {
      const t = t0 + (t1 - t0) * (i / 8);
      const [r, g, b] = stellarColourJS(t);
      stops.push(`rgb(${r},${g},${b}) ${(100 * i / 8).toFixed(0)}%`);
    }
    const popRamp = `linear-gradient(90deg,${stops.join(',')})`;
    const ramp = 'linear-gradient(90deg,#ff6b2e,#ffdbae,#9ec2ff)';
    const spec = {
      0: { title: 'Stellar population (by birth radius, indicative)',
           bar: popRamp, ends: ['older, inner', 'younger, outer'] },
      1: { title: 'Origin galaxy',
           bar: 'linear-gradient(90deg,#73b8ff 0 50%,#ff8c4d 50% 100%)',
           ends: ['primary', 'secondary'] },
      2: { title: 'Speed', bar: ramp, ends: ['slow', 'fast'] },
    }[mode] ?? { title: '', bar: 'none', ends: ['', ''] };
    $('legendTitle').textContent = spec.title;
    $('legendBar').style.background = spec.bar;
    $('legendEnds').innerHTML = spec.ends.map((e) => `<span>${e}</span>`).join('');
    $('legend').style.display = this.renderer.settings.scienceMode ? 'none' : 'block';
  }

  // ------------------------------------------------------------------ tour

  gotoTourStep(i) {
    this.tourStep = Math.max(0, Math.min(TOUR.length - 1, i));
    const step = TOUR[this.tourStep];
    $('tourText').textContent = step.text;
    for (const b of document.querySelectorAll('#tourList button')) {
      b.classList.toggle('on', Number(b.dataset.step) === this.tourStep);
    }
    if (step.scenario) this.loadScenario(step.scenario);
    if (step.spec) { Object.assign(this.spec, structuredClone(step.spec)); this.rebuild(); }
    if (step.camera) {
      const c = this.camera;
      c._want.distance = step.camera.distance ?? c._want.distance;
      c._want.theta = step.camera.theta ?? c._want.theta;
      c._want.phi = step.camera.phi ?? c._want.phi;
    }
    if (step.colourMode !== undefined) {
      this.renderer.settings.colourMode = step.colourMode;
      $('colour').value = String(step.colourMode);
    }
    if (step.time !== undefined) { this.setPlaying(false); this.seek(step.time); }
    if (step.play) this.setPlaying(true);
  }

  // ----------------------------------------------------------------- atlas

  syncPad() {
    const inc = this.spec.disc1?.inclination ?? 0;
    const rp = this.spec.rPeri ?? 4;
    const x = (inc + 1.57) / 3.14;
    const y = 1 - (rp - 2) / 78;
    $('padDot').style.left = `${x * 100}%`;
    $('padDot').style.top = `${Math.max(0, Math.min(1, y)) * 100}%`;
    $('atlasTilt').textContent = `${(inc * 57.2958).toFixed(0)}°`;
    $('atlasPeri').textContent = `${rp.toFixed(1)} kpc`;
  }

  padTo(fx, fy) {
    const inc = fx * 3.14 - 1.57;
    // 2-80 kpc, matching the retuned Milky Way-scale engine. The pad still
    // spanned 0.5-12 kpc from the dwarf era, so EVERY point on it was a
    // penetrating collision and the whole field explored one uninteresting
    // corner of the space it claims to map.
    const rp = 2 + (1 - fy) * 78;
    this.spec.disc1.inclination = inc;
    this.spec.disc2.inclination = -inc * 0.7;
    this.spec.rPeri = rp;
    this.spec.disc1.retrograde = $('atlasRetro').checked;
    this.spec.disc2.retrograde = $('atlasRetro').checked;
    $('retro1').checked = $('retro2').checked = $('atlasRetro').checked;
    const t = this.sim ? this.sim.time : this.spec.tStart;
    this.rebuild();
    this.seek(Math.max(this.tStart, t));
    this.syncPad();
    // The pad wrote the spec and left the sandbox sliders reading their old
    // values, so the two modes disagreed about the same encounter.
    this.syncSpecControls();
  }

  // -------------------------------------------------------------- lifecycle

  frame() {
    const now = performance.now();
    const frameMs = now - this.lastFrame;
    this.lastFrame = now;
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length > 40) this.frameTimes.shift();

    if (this.playing) {
      for (let i = 0; i < this.substeps; i++) this.sim.step(this.dt * this.speed);
    }

    // KEEP THE SUBJECT IN FRAME AS THE ENCOUNTER EVOLVES.
    //
    // The camera used to be framed exactly once, at load, from the content at
    // tStart — where the pair is near its widest — and never again. Nothing
    // reframed on a slider change, a scrub, or 1,900 Myr of evolution. Measured
    // on the merger scenario at +1898 Myr: content radius had shrunk 56 -> 22.3
    // kpc while the camera sat at 173.8, i.e. 2.8x too far. Light on screen fell
    // to 8.05% of pixels against 33.4% when correctly framed — which reads, on a
    // large display, as a blank black screen. That is the first thing a visitor
    // sees if they leave it running, and the fix was a keyboard shortcut nobody
    // knows about.
    //
    // Two rules keep this from fighting the user, which is why it was deferred
    // rather than rushed: it NEVER runs once the user has zoomed (until they
    // ask for a reframe with `f`), and it acts only on a real drift, easing
    // through the camera's existing damping rather than snapping. The 1.45/0.7
    // band is the trade: wider leaves the subject too small (0.55 left the frame
    // 1.8x too wide and only 16% of pixels lit), narrower makes the camera
    // fidget during an encounter.
    if (!this.camera.userZoomed && !this.seeking && this.mode !== 'detective') {
      const r = this.contentRadius();
      const framed = this.framedRadius || r;
      if (r > 1e-6 && (r / framed > 1.45 || r / framed < 0.7)) {
        this.framedRadius = r;
        const fov = this.camera.fov ?? (50 * Math.PI / 180);
        this.camera._want.distance = Math.min(4000, Math.max(8, r / Math.tan(fov / 2) * 1.15));
      }
    }

    // Keep something in frame. The camera targeted the barycentre, which is
    // stationary but is NOT where the galaxies are: the ring scenario's pair
    // separates by hundreds of kpc, putting the primary far outside a 78 kpc
    // view. The result was a black screen with correct physics behind it.
    //
    // (This comment used to quote 444 kpc, a figure from a build superseded
    // twice over. A number in a comment that nothing regenerates is a number
    // that will be wrong; the separation is an instrument on screen instead.)
    this.applyFollow();
    this.camera.update();
    this.renderer.render(this.ctx.getCurrentTexture().createView(), this.sim, this.camera, now * 0.001);
    this.updateInstruments(frameMs);
    if (this.deviceLost) return;          // do not keep drawing a dead device
    requestAnimationFrame(() => this.frame());
  }

  /**
   * Frame the encounter: set the camera distance so the pair and its tidal
   * material fill the view.
   *
   * The camera distance was fixed at 66 kpc when the app was constructed and
   * NOTHING ever changed it. Scenarios span 14 to 55 kpc pericentre and separate
   * to hundreds of kpc, so the subject was routinely a small object in the middle
   * of a large black frame — visible in review/40-final-live.png, where an 88 kpc
   * pair occupies about a sixth of the height. The ring scenario, the most
   * spectacular thing the engine does, ran off the edges entirely.
   *
   * The extent is estimated rather than measured: half the current separation
   * plus a disc radius and a half. Reading 300,000 particle positions back from
   * the GPU to compute a true bounding radius would cost more than the framing is
   * worth, and this proxy is within a factor the eye cannot distinguish. It is an
   * ESTIMATE and is labelled as one — it is not reported as a measurement
   * anywhere.
   */
  contentRadius() {
    const g = this.sim?.orbit?.galaxies;
    if (!g || g.length < 2) return 40;
    const sep = Math.hypot(g[0].pos[0] - g[1].pos[0], g[0].pos[1] - g[1].pos[1], g[0].pos[2] - g[1].pos[2]);
    const disc = 4.5 * (this.spec?.disc1?.scaleLength ?? 3.0);
    return Math.max(20, sep * 0.5 + disc * 1.5);
  }

  /** Set the camera distance to frame the content. `f` at the default fov ~ fills the view. */
  frameToContent() {
    // An explicit reframe (load, `f`, a scenario change) hands framing back to
    // the app: the user's previous zoom is no longer what they asked for.
    this.camera.userZoomed = false;
    this.framedRadius = this.contentRadius();
    // IN DETECT, THE FRAME IS AN INSTRUMENT. The camera distance there is not a
    // matter of taste: it is set so one screen equals fieldKpc, which is what
    // makes the simulation and the SDSS cutout comparable at all. Round 7
    // measured `f` in Detect taking 191.25 kpc to 164.95 — a 13.8% scale error —
    // and wiping the pan registration, while the note still read "Scale
    // matched". A silently wrong scale bar is worse than no scale bar, so here
    // `f` re-centres and leaves the calibration and the registration alone.
    if (this.mode === 'detective' && Number.isFinite(this.fieldKpc)) {
      this.camera._want.distance = this.fieldKpc / (2 * Math.tan(this.camera.fov / 2));
      return;
    }
    const r = this.contentRadius();
    const fov = this.camera.fov ?? (50 * Math.PI / 180);
    const d = r / Math.tan(fov / 2) * 1.15;
    this.camera._want.distance = Math.min(4000, Math.max(8, d));
    this.camera.clearPan?.();
  }

  /** Point the camera at whatever the user asked to follow. */
  applyFollow() {
    const g = this.sim?.orbit?.galaxies;
    if (!g || this.follow === 'bary') return;
    if (this.follow === 'primary') this.camera.setTarget(Array.from(g[0].pos));
    else if (this.follow === 'secondary' && g[1]) this.camera.setTarget(Array.from(g[1].pos));
    else if (this.follow === 'pair' && g[1]) {
      this.camera.setTarget([
        (g[0].pos[0] + g[1].pos[0]) / 2,
        (g[0].pos[1] + g[1].pos[1]) / 2,
        (g[0].pos[2] + g[1].pos[2]) / 2]);
    }
  }

  updateInstruments(frameMs) {
    if (this.deviceLost) return;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)] || frameMs;
    $('fps').textContent = `${(1000 / med).toFixed(0)} fps`;
    $('ms').textContent = `${med.toFixed(1)} ms`;

    const myr = timeToMyr(this.sim.time);
    $('clock').textContent = `${myr >= 0 ? '+' : ''}${myr.toFixed(0)} Myr`;
    $('clocknote').textContent = myr < 0 ? 'before pericentre' : 'after pericentre';
    $('sep').textContent = `${this.sim.orbit.diagnostics().separation.toFixed(1)} kpc`;

    if (!this.scrubbing) $('scrub').value = String(this.sim.time);

    const wpp = this.camera.worldPerPixel($('view').clientHeight);
    const targetKpc = wpp * 130;
    const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    let pick = nice[nice.length - 1];
    for (const n of nice) if (n >= targetKpc) { pick = n; break; }
    $('barfill').style.width = `${Math.round(pick / wpp)}px`;
    $('barlabel').textContent = `${pick} kpc`;
  }

  // ------------------------------------------------------------ url state

  urlState() {
    const s = this.spec;
    return new URLSearchParams({
      m: this.mode, sc: this.scenarioKey,
      mr: (s.massRatio ?? 1).toFixed(2), rp: (s.rPeri ?? 4).toFixed(1),
      e: (s.ecc ?? 1).toFixed(2),
      i1: (s.disc1?.inclination ?? 0).toFixed(2), i2: (s.disc2?.inclination ?? 0).toFixed(2),
      rg1: s.disc1?.retrograde ? '1' : '0',
      rg2: s.disc2?.retrograde ? '1' : '0',
      // friction was dropped, so a merging system arrived at the recipient as a
      // fly-by: the shared link showed a different physical system
      fr: String(s.friction ?? 0),
      nd1: (s.disc1?.node ?? 0).toFixed(3),
      nd2: (s.disc2?.node ?? 0).toFixed(3),
      t: this.sim.time.toFixed(2),
      cd: String(this.renderer.settings.colourMode),
      sci: this.renderer.settings.scienceMode ? '1' : '0',
      sp: String(this.speed),
      fo: this.follow,
      // THE TARGET. Detect exists to compare against one specific observed pair,
      // and the link that shares "this state" carried eighteen keys and not the
      // one naming which galaxy you were looking at. A shared Detect link landed
      // the recipient on whatever sorted first in the catalogue.
      ...(this.targetName ? { tg: this.targetName } : {}),
      // viewing geometry travels with the state: it is a fitted parameter, not
      // a camera preference, so a shared link must reproduce the projection
      cam: [this.camera.distance.toFixed(1), this.camera.theta.toFixed(3),
            this.camera.phi.toFixed(3), this.camera.roll.toFixed(3)].join(','),
    }).toString();
  }

  restoreFromUrl() {
    const q = new URLSearchParams(location.search);
    if (!q.has('sc')) return;
    try {
      this.loadScenario(q.get('sc'));
      const n = (k, d) => (q.has(k) ? parseFloat(q.get(k)) : d);
      this.spec.massRatio = n('mr', this.spec.massRatio);
      this.spec.rPeri = n('rp', this.spec.rPeri);
      this.spec.ecc = n('e', this.spec.ecc);
      this.spec.disc1.inclination = n('i1', this.spec.disc1.inclination);
      this.spec.disc2.inclination = n('i2', this.spec.disc2.inclination);
      this.spec.disc1.retrograde = q.get('rg1') === '1' || q.get('rg') === '1';
      this.spec.disc2.retrograde = q.get('rg2') === '1' || q.get('rg') === '1';
      this.spec.friction = n('fr', this.spec.friction ?? 0);
      this.spec.disc1.node = n('nd1', this.spec.disc1.node ?? 0);
      this.spec.disc2.node = n('nd2', this.spec.disc2.node ?? 0);
      this.rebuild();
      if (q.has('t')) { this.setPlaying(false); this.seek(parseFloat(q.get('t'))); }
      // updateLegend() matters as much as the mode itself: without it a shared
      // ?cd=1 link renders provenance colours under the "Stellar population"
      // key, which fails on exactly the URLs people send to other people.
      if (q.has('cd')) {
        this.renderer.settings.colourMode = parseInt(q.get('cd'), 10);
        $('colour').value = q.get('cd');
        this.updateLegend();
      }
      if (q.get('sci') === '1') { $('science').checked = true; $('science').dispatchEvent(new Event('change')); }
      if (q.has('sp')) { $('speed').value = q.get('sp'); $('speed').dispatchEvent(new Event('input')); }
      if (q.has('fo')) { this.follow = q.get('fo'); $('follow').value = this.follow; }
      if (q.has('cam')) {
        const [d, th, ph, rl] = q.get('cam').split(',').map(Number);
        Object.assign(this.camera._want, { distance: d, theta: th, phi: ph, roll: rl || 0 });
        if (Number.isFinite(rl)) { $('roll').value = String(rl); $('roll').dispatchEvent(new Event('input')); }
      }
      // Recorded before setMode, and consumed by fillTargets() when the
      // catalogue resolves — which happens AFTER this runs, so it cannot be
      // applied here.
      if (q.has('tg')) this.wantTarget = q.get('tg');
      this.cameraFromUrl = q.has('cam');
      this.setMode(q.get('m') || 'sandbox');
      this.syncSpecControls();
    } catch (e) { console.warn('could not restore state from URL:', e); }
  }

  // ---------------------------------------------------------------- wiring

  buildUI() {
    for (const [key, sc] of Object.entries(SCENARIOS)) {
      const b = document.createElement('button');
      b.textContent = sc.label; b.dataset.scenario = key;
      b.onclick = () => this.loadScenario(key);
      $('scenarios').appendChild(b);
    }
    for (const b of document.querySelectorAll('#modes button')) {
      b.onclick = () => this.setMode(b.dataset.mode);
    }
    TOUR.forEach((s, i) => {
      const b = document.createElement('button');
      b.textContent = `${i + 1}. ${s.title}`; b.dataset.step = String(i);
      b.onclick = () => this.gotoTourStep(i);
      $('tourList').appendChild(b);
    });
    $('tourPrev').onclick = () => this.gotoTourStep(this.tourStep - 1);
    $('tourNext').onclick = () => this.gotoTourStep(this.tourStep + 1);

    $('play').onclick = () => {
      this.setPlaying(!this.playing);
    };
    $('reset').onclick = () => this.rebuild();
    $('loadFit').onclick = () => this.loadPublishedFit();

    $('share').onclick = async () => {
      const url = `${location.origin}${location.pathname}?${this.urlState()}`;
      try { await navigator.clipboard.writeText(url); $('share').textContent = 'Link copied'; }
      catch { history.replaceState(null, '', url); $('share').textContent = 'Link in address bar'; }
      setTimeout(() => { $('share').textContent = 'Copy link to this state'; }, 1800);
    };

    const scrub = $('scrub');
    scrub.oninput = () => {
      this.scrubbing = true; this.setPlaying(false);
      this.seek(parseFloat(scrub.value));
    };
    scrub.onchange = () => { this.scrubbing = false; };

    const bind = (id, apply, fmt = (v) => v.toFixed(2)) => {
      const el = $(id), out = $(id + 'v');
      const run = () => { const v = parseFloat(el.value); apply(v); if (out) out.textContent = fmt(v); };
      el.oninput = run; run();
    };
    const rs = this.renderer.settings;
    bind('speed', (v) => { this.speed = v; }, (v) => `${v.toFixed(2)}x`);
    bind('size', (v) => { rs.splatSize = v; }, (v) => v.toFixed(3));
    bind('intensity', (v) => { rs.intensity = v; }, (v) => v.toFixed(3));
    bind('exposure', (v) => { rs.exposure = v; });
    bind('bloom', (v) => { rs.bloomMix = v; });
    bind('dust', (v) => { rs.dustStrength = v; }, (v) => v.toFixed(1));
    bind('imgOpacity', (v) => {
      this.imgOpacity = v;
      if (this.mode === 'detective') $('backdrop').style.opacity = String(v);
    }, (v) => v.toFixed(2));
    bind('imgScale', (v) => { $('backdrop').style.transform = `scale(${v})`; }, (v) => `${v.toFixed(2)}x`);
    bind('roll', (v) => { this.camera._want.roll = v; }, (v) => `${(v * 57.2958).toFixed(0)}°`);

    $('follow').onchange = (e) => { this.follow = e.target.value; };
    $('colour').onchange = (e) => {
      rs.colourMode = parseInt(e.target.value, 10);
      this.updateLegend();
    };
    $('science').onchange = (e) => {
      rs.scienceMode = e.target.checked;
      // SCIENCE VIEW HIDES THE BACKDROP. The composite returns alpha 0 over a
      // premultiplied canvas, so in Detect the simulation ADDS to the SDSS image
      // — while the science HUD asserts an exact invertible pixel-to-density
      // mapping. That made it a false instrument in the one mode where a user is
      // most likely to trust it. A quantitatively readable frame is the entire
      // point of the mode, so it takes precedence over the overlay.
      if (this.mode === 'detective') {
        $('backdrop').style.opacity = e.target.checked ? '0' : String(this.imgOpacity ?? 0.85);
      }
      document.body.classList.toggle('science', e.target.checked);
      // State the mapping on screen. A readout with an unstated scale is a
      // picture, and the whole point of this view is that it is not one.
      $('sciNote').style.display = e.target.checked ? 'block' : 'none';
      $('sciScale').textContent = rs.scienceFullScale.toFixed(2);
      this.updateLegend();
    };

    const param = (id, key, fmt) => {
      const el = $(id), out = $(id + 'v');
      const run = () => { if (out) out.textContent = fmt ? fmt(parseFloat(el.value)) : parseFloat(el.value).toFixed(2); };
      el.oninput = run;
      el.onchange = () => {
        const v = parseFloat(el.value);
        if (key === 'inc1') this.spec.disc1.inclination = v;
        else if (key === 'inc2') this.spec.disc2.inclination = v;
        else this.spec[key] = v;
        const t = this.sim.time;
        this.rebuild();
        this.seek(Math.max(this.tStart, t));
      };
      run();
    };
    param('friction', 'friction', (v) => (v === 0 ? 'off' : v.toFixed(2)));
    param('massRatio', 'massRatio');
    param('rPeri', 'rPeri', (v) => `${v.toFixed(1)} kpc`);
    param('ecc', 'ecc');
    param('inc1', 'inc1', (v) => `${(v * 57.2958).toFixed(0)}°`);
    param('inc2', 'inc2', (v) => `${(v * 57.2958).toFixed(0)}°`);
    // Per-disc spin. A single "both discs" toggle made the most instructive
    // configuration in the whole subject — one prograde, one retrograde —
    // literally unreachable from the interface.
    const spin = (id, which) => {
      $(id).onchange = (e) => {
        this.spec[which].retrograde = e.target.checked;
        const t = this.sim.time; this.rebuild(); this.seek(Math.max(this.tStart, t));
      };
    };
    spin('retro1', 'disc1');
    spin('retro2', 'disc2');
    $('atlasRetro').onchange = () => this.syncPad();

    // atlas pad
    const pad = $('pad');
    let padding = false;
    const padXY = (e) => {
      const r = pad.getBoundingClientRect();
      this.padTo(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
                 Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
    };
    let padFrame = 0;
    pad.addEventListener('pointerdown', (e) => { padding = true; pad.setPointerCapture(e.pointerId); padXY(e); });
    // COALESCED to one rebuild per animation frame. padTo() calls rebuild() and
    // seek(), and it was wired straight to pointermove: a single 8-move drag
    // fired 9 rebuilds and blocked 2,367 ms in one gesture, against a panel that
    // promises "the shape of the space is something you feel rather than read".
    let padPending = null;
    pad.addEventListener('pointermove', (e) => {
      if (!padding) return;
      const r = pad.getBoundingClientRect();
      padPending = [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
                    Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))];
      if (padPending && !padFrame) {
        padFrame = requestAnimationFrame(() => {
          padFrame = 0;
          const p = padPending; padPending = null;
          if (p) this.padTo(p[0], p[1]);
        });
      }
    });
    const padEnd = (e) => { padding = false; try { pad.releasePointerCapture(e.pointerId); } catch {} };
    pad.addEventListener('pointerup', padEnd);
    pad.addEventListener('pointercancel', padEnd);

    $('panelToggle').onclick = () => document.body.classList.toggle('collapsed');

    window.addEventListener('keydown', (e) => {
      const tag = e.target.tagName;
      const onControl = tag === 'INPUT' || tag === 'SELECT';
      // Arrow keys belong to a focused slider or select; everything else is a
      // global shortcut. The handler used to bail on ANY control, so every
      // advertised shortcut died the moment a user touched a slider — which in a
      // panel of eighteen sliders is immediately.
      if (onControl && e.key.startsWith('Arrow')) return;

      // TYPING, not control-ness, is what must suppress a letter shortcut.
      //
      // The previous fix gated only the Arrow keys and left f/r/s/1-4 on
      // `!onControl`, with a comment claiming the whole bug was fixed. Round 7
      // measured it: `f` was dead from #rPeri, #scrub, #retro1 and #follow, and
      // alive only from BODY, the canvas, a button and the atlas pad. The panel
      // has 20 inputs and 3 selects and NOT ONE is text, number or search — so
      // the gate suppressed every shortcut and protected no typing whatsoever.
      // A range slider and a checkbox have no use for the letter `f`.
      const typing = e.target.isContentEditable
        || (tag === 'TEXTAREA')
        || (tag === 'INPUT' && /^(text|number|search|email|url|tel|password)$/i.test(e.target.type || 'text'));

      const modes = ['sandbox', 'detective', 'tour', 'atlas'];
      if (e.key >= '1' && e.key <= '4' && !typing) this.setMode(modes[Number(e.key) - 1]);
      // Space must NOT be stolen from a focused control. Fixing the "shortcuts
      // die on any focused control" bug overshot the other way: Space is how a
      // keyboard user toggles a checkbox or presses a button, so the retrograde
      // checkboxes — the whole point of the prograde/retrograde comparison — had
      // no keyboard route at all, and every panel button silently paused
      // playback instead of activating. `s` was gated by !onControl already, so
      // there was no fallback either.
      const activates = onControl || tag === 'BUTTON' || e.target.isContentEditable;
      if (e.key === ' ' && !activates) { e.preventDefault(); $('play').click(); }
      if (e.key === 'r' && !typing) $('reset').click();
      if (e.key === 'f' && !typing) this.frameToContent();
      if (e.key === 's' && !typing) { $('science').checked = !$('science').checked; $('science').dispatchEvent(new Event('change')); }
      if (e.key === 'ArrowLeft') { this.setPlaying(false); this.sim.step(-this.dt * 8); }
      if (e.key === 'ArrowRight') { this.setPlaying(false); this.sim.step(this.dt * 8); }
      if (e.key === 'ArrowDown' && this.mode === 'tour') this.gotoTourStep(this.tourStep + 1);
      if (e.key === 'ArrowUp' && this.mode === 'tour') this.gotoTourStep(this.tourStep - 1);
    });

    // The atlas pad was a bare div: atlas mode's ONLY control, with no tabindex,
    // no role and no key handling, so the mode was unreachable by keyboard.
    pad.setAttribute('tabindex', '0');
    pad.setAttribute('role', 'application');
    pad.setAttribute('aria-label', 'Parameter field: left and right change disc tilt, up and down change pericentre');
    pad.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      const r = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!r) return;
      e.preventDefault();
      const dot = $('padDot');
      const fx = Math.max(0, Math.min(1, parseFloat(dot.style.left) / 100 + r[0]));
      const fy = Math.max(0, Math.min(1, parseFloat(dot.style.top) / 100 + r[1]));
      this.padTo(fx, fy);
    });

    // Sync renderer state FROM the DOM, do not assume they start equal.
    //
    // Browsers restore form control state across a reload, so the science
    // checkbox can come back checked while renderer.settings.scienceMode
    // defaults to false. The result is a HUD announcing "SCIENCE VIEW — linear,
    // no tone curve" over a frame that plainly has bloom and a starfield: the
    // interface asserting something about the image that is not true, which is
    // the exact failure this project spends its time avoiding elsewhere.
    // ONLY the display-level controls. The retrograde checkboxes are driven the
    // other way — syncSpecControls sets them FROM the spec — and firing their
    // handlers here runs before this.spec exists.
    for (const id of ['science', 'colour']) {
      const el = $(id);
      if (el) el.dispatchEvent(new Event('change'));
    }
    this.updateLegend();
    this.setMode('sandbox');
  }
}
