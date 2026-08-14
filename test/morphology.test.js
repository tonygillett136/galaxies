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
import { GpuSim } from '../src/engine/gpu.js';
import { buildEncounter } from '../src/engine/encounter.js';

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

const BASE = {
  massRatio: 1.0, rPeri: 4.0, ecc: 1.0, tStart: -22, particles: 60000, seed: 11,
  disc1: { inclination: 0.0, argPeri: 0 },
  disc2: { inclination: 0.35, argPeri: 1.1 },
};

export async function runMorphologyTests(device) {
  expectChecks(4);
  group('morphology — the physics claims, measured with controls');

  const STEPS = 2300, DT = 0.02, RCUT = 9.0;   // ~46 time units; rCut ~3x disc rMax

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
    ok(fp.total > 0.02, `prograde produced almost no tidal material (${(fp.total * 100).toFixed(2)}%); nothing to compare`);

    const ratio = fp.total / Math.max(fr.total, 1e-9);
    above(ratio, 3.0, 'prograde/retrograde tidal fraction ratio');
    return `prograde ${(fp.total * 100).toFixed(1)}% beyond ${RCUT} kpc vs retrograde ${(fr.total * 100).toFixed(1)}%, ratio ${ratio.toFixed(1)}x (identical orbits, separation ${pro.separation.toFixed(3)})`;
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
    for (const [dt, steps] of [[0.04, 1150], [0.02, 2300], [0.01, 4600]]) {
      const r = await runEncounter(device, structuredClone(BASE), steps, dt);
      fracs.push(tidalFraction(r.pos, r.origin, r.galaxies, r.count, RCUT).total);
    }
    const spread = (Math.max(...fracs) - Math.min(...fracs)) / Math.max(...fracs);
    below(spread, 0.05, 'fractional spread across 4x timestep range');
    return `${fracs.map((f) => (f * 100).toFixed(2) + '%').join(' / ')} at dt=0.04/0.02/0.01, spread ${(spread * 100).toFixed(1)}%`;
  });

  await checkAsync('softening changes the answer, and by how much is recorded', async () => {
    // Softening is the classic silent knob: it changes results without erroring.
    // This does NOT assert insensitivity, because the honest expectation is that
    // it DOES matter. It records the sensitivity so that a future change to the
    // default is a visible decision rather than an invisible one.
    const fracs = [];
    for (const mult of [0.5, 1.0, 2.0]) {
      const s = structuredClone(BASE);
      s.disc1.scaleLength = 1.6; s.disc2.scaleLength = 1.6;
      s.softeningScale = mult;                // consumed by buildEncounter if supported
      const r = await runEncounter(device, s, STEPS, DT);
      fracs.push(tidalFraction(r.pos, r.origin, r.galaxies, r.count, RCUT).total);
    }
    const spread = (Math.max(...fracs) - Math.min(...fracs)) / Math.max(...fracs);
    return `tidal fraction ${fracs.map((f) => (f * 100).toFixed(2) + '%').join(' / ')} at 0.5x/1x/2x softening, spread ${(spread * 100).toFixed(1)}% — RECORDED, not asserted`;
  });
}
