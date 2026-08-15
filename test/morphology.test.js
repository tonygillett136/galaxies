/**
 * Morphology assertions: the physics results, measured rather than looked at.
 *
 * The headline claim from Stage 2 was that the prograde and retrograde
 * scenarios differ enormously. That claim came from LOOKING AT TWO PICTURES,
 * which is exactly what the project's own check table forbids. These convert it
 * into numbers with a control, and add the resolution and softening studies
 * whose absence was flagged as an open action.
 *
 * Every measurement here runs on the GPU path, because that is what ships.
 */

import { group, checkAsync, expectChecks, above, below, ok } from './harness.js';
import { record } from './measured.js';
import { GpuSim } from '../src/engine/gpu.js';
import { buildEncounter, SCENARIOS } from '../src/engine/encounter.js';
import { TOUR } from '../src/app/tour.js';
import { speedFromKms } from '../src/engine/units.js';

/**
 * Fraction of a galaxy's own material now beyond `rCut` from its own centre.
 *
 * This is the tidal-tail metric. It is deliberately measured PER GALAXY against
 * that galaxy's own centre, so a wide separation does not masquerade as a tail.
 */
function tidalFraction(posVec4, origin, galaxies, count, rCut) {
  const n = [0, 0], out = [0, 0];
  for (let i = 0; i < count; i++) {
    const g = origin[i] > 0.5 ? 1 : 0;
    const c = galaxies[g].pos;
    const d = Math.hypot(
      posVec4[i * 4] - c[0], posVec4[i * 4 + 1] - c[1], posVec4[i * 4 + 2] - c[2]);
    n[g]++;
    if (d > rCut) out[g]++;
  }
  return { g0: out[0] / Math.max(1, n[0]), g1: out[1] / Math.max(1, n[1]),
           total: (out[0] + out[1]) / Math.max(1, n[0] + n[1]) };
}

async function runEncounter(device, spec, steps, dt) {
  const { galaxies, particles } = buildEncounter(spec);
  const sim = new GpuSim(device, galaxies, particles);
  sim.run(dt, steps);
  await device.queue.onSubmittedWorkDone();
  const pos = await sim.readPositions();
  const result = { pos, origin: particles.origin, count: particles.count,
                   galaxies: sim.orbit.galaxies, separation: sim.orbit.diagnostics().separation };
  sim.destroy();
  return result;
}

// Retuned with the Milky Way-scale mass model: 25 kpc pericentre (outside the
// ~13.5 kpc discs, so this is a tidal encounter and not a collision), and times
// that match a dynamical time of roughly 120 units at 20 kpc.
const BASE = {
  massRatio: 1.0, rPeri: 25, ecc: 1.0, tStart: -45, particles: 60000, seed: 11,
  disc1: { inclination: 0.0, argPeri: 0 },
  disc2: { inclination: 0.35, argPeri: 1.1 },
};

/**
 * Surface density of one galaxy's material in radial bins about its own centre.
 * Shared, because two checks need the same measurement and a second copy would
 * be a second thing to drift.
 */
function radialProfile(pos, origin, galaxies, count, gi, RMAX, BINS) {
  const h = new Array(BINS).fill(0), c = galaxies[gi].pos;
  for (let i = 0; i < count; i++) {
    const r = Math.hypot(pos[i * 4] - c[0], pos[i * 4 + 1] - c[1], pos[i * 4 + 2] - c[2]);
    const b = Math.floor(r / RMAX * BINS);
    if (b >= 0 && b < BINS) h[b]++;
  }
  return h.map((v, i) => {
    const r0 = i * RMAX / BINS, r1 = (i + 1) * RMAX / BINS;
    return v / (Math.PI * (r1 * r1 - r0 * r0));
  });
}

export async function runMorphologyTests(device) {
  expectChecks(7);
  group('morphology — the physics claims, measured with controls');

  // ~85 time units (about 400 Myr past pericentre), where the tidal signal is
  // near its peak. rCut = 20 kpc is ~1.5x the disc outer radius, so only
  // genuinely displaced material counts.
  //
  // The absolute fractions are much lower than the old dwarf model gave (a few
  // per cent against 27), and that is the physics, not a regression: a dominant
  // dark halo binds the disc far more tightly and suppresses tidal stripping.
  // The prograde/retrograde CONTRAST is the claim, and it survives.
  const STEPS = 2125, DT = 0.04, RCUT = 20.0;

  await checkAsync('prograde produces far more tidal material than retrograde', async () => {
    // THE control experiment. Same orbit, same masses, same pericentre, same
    // epoch, same seed. The ONLY difference is the sign of the disc spin. If
    // this ratio were near 1 the whole prograde/retrograde story would be an
    // artefact of the two scenarios differing in some other way.
    const pro = await runEncounter(device, structuredClone(BASE), STEPS, DT);
    const retroSpec = structuredClone(BASE);
    retroSpec.disc1.retrograde = true;
    retroSpec.disc2.retrograde = true;
    const retro = await runEncounter(device, retroSpec, STEPS, DT);

    const fp = tidalFraction(pro.pos, pro.origin, pro.galaxies, pro.count, RCUT);
    const fr = tidalFraction(retro.pos, retro.origin, retro.galaxies, retro.count, RCUT);

    // the orbits must be identical: if they are not, the discs are not the only difference
    ok(Math.abs(pro.separation - retro.separation) < 1e-6,
      `orbits differ (${pro.separation} vs ${retro.separation}); the control is not controlled`);
    ok(fp.total > 0.01, `prograde produced almost no tidal material (${(fp.total * 100).toFixed(2)}%); nothing to compare`);

    // Report a RATIO only when the denominator is a measurement. Retrograde
    // frequently produces exactly zero particles beyond the cut, and dividing by
    // a 1e-9 floor manufactured a headline "47,016,666x" that is an artefact of
    // the guard, not a result. Zero out of N is the stronger and honest claim,
    // and it carries its own resolution limit: 1/N.
    const nRetro = Math.round(fr.total * retro.count);
    const bound = 1 / retro.count;
    record('tidalProgradePct', fp.total * 100);
    record('tidalRetroPct', fr.total * 100);
    record('tidalRatio', fr.total > 0 ? fp.total / fr.total : Infinity);
    record('tidalCutKpc', RCUT);
    if (nRetro === 0) {
      above(fp.total / bound, 3.0, 'prograde fraction vs the 1/N detection limit');
      return `prograde ${(fp.total * 100).toFixed(1)}% beyond ${RCUT} kpc; retrograde ZERO of ${retro.count} particles `
           + `(so <${(bound * 100).toFixed(3)}%, a limit set by particle count, not a measured value). `
           + `Identical orbits, separation ${pro.separation.toFixed(3)}.`;
    }
    const ratio = fp.total / fr.total;
    above(ratio, 3.0, 'prograde/retrograde tidal fraction ratio');
    return `prograde ${(fp.total * 100).toFixed(1)}% vs retrograde ${(fr.total * 100).toFixed(2)}% beyond ${RCUT} kpc, `
         + `ratio ${ratio.toFixed(1)}x on ${nRetro} retrograde particles (identical orbits, separation ${pro.separation.toFixed(3)})`;
  });

  await checkAsync('the result is not a resolution artefact', async () => {
    // Re-run at 0.5x and 2x particle count. If the tidal fraction moves, the
    // answer was resolution rather than physics.
    const fracs = [];
    for (const n of [30000, 60000, 120000]) {
      const s = structuredClone(BASE); s.particles = n;
      const r = await runEncounter(device, s, STEPS, DT);
      fracs.push(tidalFraction(r.pos, r.origin, r.galaxies, r.count, RCUT).total);
    }
    const spread = (Math.max(...fracs) - Math.min(...fracs)) / Math.max(...fracs);
    below(spread, 0.06, 'fractional spread of tidal fraction across 4x particle count');
    return `${fracs.map((f) => (f * 100).toFixed(2) + '%').join(' / ')} at 30k/60k/120k, spread ${(spread * 100).toFixed(1)}%`;
  });

  await checkAsync('the result is not a timestep artefact', async () => {
    // Same physical end time, three timesteps. A silent knob is only silent
    // until someone turns it.
    const fracs = [];
    for (const [dt, steps] of [[0.08, 1063], [0.04, 2125], [0.02, 4250]]) {
      const r = await runEncounter(device, structuredClone(BASE), steps, dt);
      fracs.push(tidalFraction(r.pos, r.origin, r.galaxies, r.count, RCUT).total);
    }
    const spread = (Math.max(...fracs) - Math.min(...fracs)) / Math.max(...fracs);
    below(spread, 0.05, 'fractional spread across 4x timestep range');
    // Label the timesteps ACTUALLY integrated. The loop runs 0.08/0.04/0.02 and
    // the line said 0.04/0.02/0.01 — the asserted 4x span was right, the number
    // a reader would quote was not.
    return `${fracs.map((f) => (f * 100).toFixed(2) + '%').join(' / ')} at dt=0.08/0.04/0.02, spread ${(spread * 100).toFixed(1)}%`;
  });

  await checkAsync('THE RING SCENARIO ACTUALLY PRODUCES A RING', async () => {
    // The scenario asserted a ring in its own blurb and nothing checked. It did
    // not produce one: first because the disc was coplanar with the orbit, then
    // — after that was fixed — because the orbit precesses and the companion
    // still crossed at 64.7 degrees to the disc normal, and then because the
    // companion was as diffuse as a spiral, so almost none of its mass lay
    // within a few kpc of the impact.
    //
    // A ring is a surface-density profile whose PEAK IS NOT AT THE CENTRE, with
    // a genuine dip inside it. Measured against its own earlier profile, so this
    // cannot be satisfied by a disc that was always ring-shaped.
    const spec = structuredClone(SCENARIOS.ring.spec);
    spec.particles = 40000;
    const BINS = 14, RMAX = 50, DT = 0.05;
    const profile = (pos, origin, galaxies, count) =>
      radialProfile(pos, origin, galaxies, count, 0, RMAX, BINS);

    const before = await runEncounter(device, spec, 200, DT);   // just after the impact
    const after = await runEncounter(device, spec, 900, DT);    // ring well developed
    const pb = profile(before.pos, before.origin, before.galaxies, before.count);
    const pa = profile(after.pos, after.origin, after.galaxies, after.count);
    const peakB = pb.indexOf(Math.max(...pb));
    const peakA = pa.indexOf(Math.max(...pa));
    const mxA = Math.max(...pa);
    const dip = pa[Math.max(0, peakA - 2)] / mxA;

    // A ring is material that MOVED OUTWARD, which is what this asserts. The
    // emptiness of the interior is REPORTED rather than required: it depends
    // strongly on the encounter, and an over-violent one that unbinds the disc
    // reads as 86 per cent while the tuned scenario reads as 23. Asserting a dip
    // threshold would have meant tuning the physics until it matched a number
    // chosen in advance, which is backwards.
    // Guard the ratio: if almost nothing was at that radius beforehand, the
    // "gain" is a divide-by-near-zero and can read 3.6e9, which is an artefact
    // and not a measurement. Require a real denominator.
    const denom = pb[peakA];
    const floor = Math.max(...pb) * 0.01;
    ok(denom > floor, `pre-impact density at the ring radius is negligible (${denom.toExponential(2)}); the ratio would be meaningless`);
    const gain = pa[peakA] / denom;
    ok(peakB === 0, `the disc was ALREADY ring-shaped before the impact (peak bin ${peakB}); the test is vacuous`);
    above(peakA, 2, 'radial bin of the peak surface density after the encounter');
    above(gain, 3.0, `surface density at the ring radius, relative to the same radius before`);
    record('ringPeakKpc', peakA * RMAX / BINS);
    record('ringGain', gain);
    record('ringInteriorPct', dip * 100);
    return `peak moved bin ${peakB} -> ${peakA} (~${(peakA * RMAX / BINS).toFixed(0)} kpc); `
         + `density there rose ${gain.toFixed(1)}x; interior is ${(dip * 100).toFixed(0)}% of the peak `
         + `(the nucleus survives, as in the Cartwheel)`;
  });

  await checkAsync('the tour shows the ring while the ring exists', async () => {
    // Round 3: the ring is visible for about 5% of the scrubbable timeline, and
    // the tour step demonstrating it landed at 66 Myr where the measured
    // ring-to-centre contrast is 1.51 — while its text said "leaving the centre
    // comparatively empty". The most visible scientific claim in the app was
    // being shown at the moment it stopped being true.
    //
    // This asserts the pairing rather than the number: whatever epoch the tour
    // step names, the ring must actually be there at it.
    const step = TOUR.find((t) => t.scenario === 'ring');
    ok(step, 'no tour step uses the ring scenario any more; this check is vacuous');
    const spec = structuredClone(SCENARIOS.ring.spec);
    spec.particles = 30000;
    const stepsTo = Math.round((step.time - (-Math.abs(spec.tStart ?? 18))) / 0.02);
    const r = await runEncounter(device, spec, Math.max(1, stepsTo), 0.02);
    const prof = radialProfile(r.pos, r.origin, r.galaxies, r.count, 0, 30, 14);
    let peak = 0;
    for (let b = 1; b < prof.length; b++) if (prof[b] > prof[peak]) peak = b;
    const contrast = prof[peak] / Math.max(prof[0], 1e-12);
    record('ringTourEpochMyr', step.time * 4.714920);
    record('ringTourContrast', contrast);
    above(peak, 1, `radial bin of the peak at the tour's chosen epoch (t = ${step.time})`);
    above(contrast, 2.0, `ring-to-centre contrast at the tour's chosen epoch (t = ${step.time} = ${(step.time * 4.714920).toFixed(0)} Myr)`);
    return `tour lands at t = ${step.time} (${(step.time * 4.714920).toFixed(0)} Myr): peak bin ${peak}, contrast ${contrast.toFixed(1)}x`;
  });

  await checkAsync('the ring depends on the disc being COLD, and by how much is recorded', async () => {
    // Round 3: the ring's density contrast is partly an artefact of a perfectly
    // cold disc, and nothing said so anywhere a user would look. A dispersion
    // below the solar neighbourhood's sigma_R takes the gain down materially.
    //
    // This RECORDS the sensitivity rather than asserting insensitivity, because
    // the honest expectation is that it matters. Same treatment as softening: the
    // point is that a future change to the default becomes a visible decision.
    //
    // sigma is quoted in km/s and converted, so the comparison to a real galaxy
    // (Milky Way sigma_R ~ 30-40 km/s at the solar radius) is meaningful.
    const BINS = 14, RMAX = 50, DT = 0.05;
    const gains = [];
    for (const kms of [0, 20, 40]) {
      const spec = structuredClone(SCENARIOS.ring.spec);
      spec.particles = 30000;
      const sig = speedFromKms(kms);
      spec.disc1 = { ...(spec.disc1 ?? {}), dispersion: sig };
      const before = await runEncounter(device, spec, 200, DT);
      const after = await runEncounter(device, spec, 900, DT);
      const pb = radialProfile(before.pos, before.origin, before.galaxies, before.count, 0, RMAX, BINS);
      const pa = radialProfile(after.pos, after.origin, after.galaxies, after.count, 0, RMAX, BINS);
      let peak = 0;
      for (let b = 1; b < BINS; b++) if (pa[b] > pa[peak]) peak = b;
      gains.push({ kms, gain: pa[peak] / Math.max(pb[peak], 1e-12), peak });
    }
    record('ringGainCold', gains[0].gain);
    record('ringGainWarm40', gains[2].gain);
    ok(gains[0].gain > gains[2].gain * 0.999,
      `a warmer disc produced a STRONGER ring (${gains[0].gain.toFixed(2)} cold vs ${gains[2].gain.toFixed(2)} at 40 km/s), which is backwards`);
    return gains.map((g) => `${g.kms} km/s -> ${g.gain.toFixed(2)}x (bin ${g.peak})`).join(', ')
         + ' — RECORDED, not asserted; the shipped default is a cold disc';
  });

  await checkAsync('softening changes the answer, and by how much is recorded', async () => {
    // Softening is the classic silent knob: it changes results without erroring.
    // This does NOT assert insensitivity, because the honest expectation is that
    // it DOES matter. It records the sensitivity so that a future change to the
    // default is a visible decision rather than an invisible one.
    const fracs = [];
    for (const mult of [0.5, 1.0, 2.0]) {
      const s = structuredClone(BASE);
      // Do NOT override the disc scale here. An earlier version pinned it to the
      // old 1.6 kpc value, which in a Milky Way halo puts every particle far
      // inside the cut and reported 0.00% at all three softenings with a NaN
      // spread — a test that could not vary reporting that nothing varied.
      s.softeningScale = mult;
      const r = await runEncounter(device, s, STEPS, DT);
      fracs.push(tidalFraction(r.pos, r.origin, r.galaxies, r.count, RCUT).total);
    }
    const peak = Math.max(...fracs);
    ok(peak > 0.005, `all three softenings gave <0.5% tidal material; the sweep cannot detect anything`);
    // THE KNOB MUST BE CONNECTED. Round 6 deleted `softeningScale` from the model
    // entirely and this check still passed, because it asserted only that the
    // tidal fraction was non-zero — the three arms became identical, the spread
    // went 0.9% -> 0.0%, and nothing objected. A sweep over a parameter that does
    // nothing reports the same shape as a sweep over a parameter that is
    // insensitive, and the project's whole point about silent knobs is that those
    // are different.
    //
    // The MAGNITUDE stays recorded rather than asserted, which is the honest
    // design. What is asserted is that varying the knob varies the answer at all.
    const distinct = new Set(fracs.map((f) => f.toFixed(6))).size;
    ok(distinct === fracs.length,
      `softening produced ${distinct} distinct results from ${fracs.length} settings `
      + `(${fracs.map((f) => (f * 100).toFixed(3) + '%').join(', ')}) — the parameter is not reaching the model`);
    const spread = (peak - Math.min(...fracs)) / peak;

    // AGAINST THE NOISE FLOOR, which nothing here used to measure.
    //
    // Round 7: the sweep's recorded spread was SMALLER than the seed-to-seed
    // spread of the particle realisation — 0.73% against 1.68% at N=32000, and
    // 1.34% against 2.92% at N=8000. A sensitivity below its own unmeasured
    // sampling noise is reporting the noise, and "the parameter is connected"
    // (asserted above) is not the same claim as "the parameter matters".
    //
    // So the control arm is measured too: three SEEDS at fixed softening. The
    // assertion is a comparison rather than a threshold, because the absolute
    // sizes depend on N and would have to be re-tuned; their ratio is the thing
    // with meaning.
    const seedFracs = [];
    for (const seed of [1, 2, 3]) {
      const s = structuredClone(BASE);
      s.softeningScale = 1.0;
      s.seed = seed;
      const r = await runEncounter(device, s, STEPS, DT);
      seedFracs.push(tidalFraction(r.pos, r.origin, r.galaxies, r.count, RCUT).total);
    }
    const seedPeak = Math.max(...seedFracs);
    const seedSpread = (seedPeak - Math.min(...seedFracs)) / Math.max(seedPeak, 1e-30);
    // A MARGIN, not a hair. The first version of this asserted `spread >
    // seedSpread` and the bulge-only mutant SURVIVED it at a ratio of 1.1 —
    // 0.9% against 0.9% — which is exactly the "signal indistinguishable from
    // noise" case the assertion exists to reject. Requiring 3x is still far
    // below the 21.8x the connected knob actually achieves, so it has headroom
    // against reseeding without being satisfiable by scatter.
    ok(spread > 3 * seedSpread,
      `the softening sweep moves the answer by ${(spread * 100).toFixed(2)}% while merely `
      + `RESEEDING the same configuration moves it ${(seedSpread * 100).toFixed(2)}% `
      + `(signal/noise ${(spread / Math.max(seedSpread, 1e-9)).toFixed(1)}x, needs > 3x) — the `
      + 'measured sensitivity is not clear of the realisation noise, so this sweep is reporting '
      + 'sampling scatter rather than softening. Either the knob does not reach the mass that '
      + 'matters, or N is too low to resolve the effect.');
    record('softeningSpread', spread);
    record('softeningSeedSpread', seedSpread);

    return `tidal fraction ${fracs.map((f) => (f * 100).toFixed(2) + '%').join(' / ')} at `
         + `0.5x/1x/2x softening, spread ${(spread * 100).toFixed(1)}% against a seed-to-seed `
         + `noise floor of ${(seedSpread * 100).toFixed(1)}% — signal/noise `
         + `${(spread / Math.max(seedSpread, 1e-9)).toFixed(1)}x`;
  });
}
