/**
 * The cross-check that justifies the CPU reference existing.
 *
 * The WGSL kernel and the JavaScript reference were written from the same
 * equations, in different languages, with different sign conventions and
 * different precision. If they agree to float32 tolerance over thousands of
 * steps, that is evidence about the physics. Either one agreeing with its own
 * earlier output would be evidence about nothing.
 */

import { group, checkAsync, expectChecks, below, above, ok } from './harness.js';
import { plummer, hernquist, composite } from '../src/engine/potentials.js';
import { RestrictedSim } from '../src/engine/cpu.js';
import { GpuSim, createDevice } from '../src/engine/gpu.js';
import { discOfRings } from '../src/engine/galaxy.js';
import { buildEncounter, SCENARIOS } from '../src/engine/encounter.js';
import * as K from '../src/engine/kepler.js';

/** An encounter with real structure: unequal masses, eccentric, inclined disc. */
function makeScenario() {
  const m1 = 1.0, m2 = 0.5, mu = m1 + m2, e = 0.7, rp = 3.0;
  const P1 = plummer(m1, 0.4), P2 = plummer(m2, 0.3);
  const s = K.stateAtTrueAnomaly(mu, e, rp, -1.9);      // inbound, before pericentre
  const f1 = m2 / mu, f2 = -m1 / mu;
  const galaxies = () => [
    { mass: m1, potential: P1, pos: s.r.map((x) => x * f1), vel: s.v.map((x) => x * f1) },
    { mass: m2, potential: P2, pos: s.r.map((x) => x * f2), vel: s.v.map((x) => x * f2) },
  ];
  const disc = () => discOfRings({
    potential: P1, rings: [0.6, 1.0, 1.4, 1.8, 2.2],
    inclination: 0.6, argPeri: 0.3,
    centre: s.r.map((x) => x * f1), velocity: s.v.map((x) => x * f1),
  });
  return { galaxies, disc };
}

const worstOf = (gpuVec4, cpuVec3, n) => {
  let worst = 0;
  for (let i = 0; i < n; i++) {
    worst = Math.max(worst, Math.hypot(
      gpuVec4[i * 4] - cpuVec3[i * 3],
      gpuVec4[i * 4 + 1] - cpuVec3[i * 3 + 1],
      gpuVec4[i * 4 + 2] - cpuVec3[i * 3 + 2]));
  }
  return worst;
};

export async function runGpuTests(device, info) {
  expectChecks(5);
  group('GPU kernel vs CPU reference — two implementations, one physics');

  await checkAsync('adapter reports as expected', async () =>
    `${info.vendor ?? '?'} / ${info.architecture ?? '?'}`);

  await checkAsync('GPU matches CPU after 2000 steps of a real encounter', async () => {
    const { galaxies, disc } = makeScenario();
    const cpu = new RestrictedSim({ galaxies: galaxies(), particles: disc() });
    const gpu = new GpuSim(device, galaxies(), disc());
    const dt = 0.01, n = 2000;
    cpu.run(dt, n);
    gpu.run(dt, n);
    await device.queue.onSubmittedWorkDone();
    const g = await gpu.readPositions();
    const worst = worstOf(g, cpu.pos, cpu.count);
    ok(cpu.diagnostics().separation < 100, 'galaxies flew apart; scenario is wrong');
    gpu.destroy();
    return below(worst, 2e-3, `worst |dPosition| over ${cpu.count} particles, ${n} steps`);
  });

  await checkAsync('SENSITIVITY: the cross-check does catch a wrong force law', async () => {
    // Without this, a passing cross-check could mean "both correct" or
    // "comparison insensitive" and there is no way to tell them apart.
    const { galaxies, disc } = makeScenario();
    const cpu = new RestrictedSim({ galaxies: galaxies(), particles: disc() });
    const bent = galaxies();
    bent[0].potential = plummer(bent[0].potential.mass * 1.01, bent[0].potential.scale);
    const gpu = new GpuSim(device, bent, disc());
    const dt = 0.01, n = 2000;
    cpu.run(dt, n);
    gpu.run(dt, n);
    await device.queue.onSubmittedWorkDone();
    const g = await gpu.readPositions();
    const worst = worstOf(g, cpu.pos, cpu.count);
    gpu.destroy();
    return above(worst, 0.05, 'worst |dPosition| with primary mass 1% high');
  });

  await checkAsync('every implemented potential agrees between CPU and GPU', async () => {
    const out = [];
    for (const [name, P] of Object.entries({
      plummer: plummer(1.2, 0.5),
      hernquist: hernquist(1.2, 0.5),
      composite: composite([plummer(0.8, 0.3), hernquist(0.4, 1.1)]),
    })) {
      const d = () => discOfRings({ potential: P, rings: [1.0, 1.6, 2.2] });
      const gal = () => [{ mass: P.mass, potential: P, pos: [0, 0, 0], vel: [0, 0, 0] }];
      const cpu = new RestrictedSim({ galaxies: gal(), particles: d() });
      const gpu = new GpuSim(device, gal(), d());
      cpu.run(0.005, 1500); gpu.run(0.005, 1500);
      await device.queue.onSubmittedWorkDone();
      const worst = worstOf(await gpu.readPositions(), cpu.pos, cpu.count);
      gpu.destroy();
      out.push(`${name} ${worst.toExponential(1)}`);
      if (!(worst < 2e-3)) throw new Error(`${name}: worst |d| ${worst.toExponential(3)} exceeds 2e-3`);
    }
    return out.join(', ');
  });

  await checkAsync('CHARACTERISATION: float32 reversal residual on the SHIPPED configuration', async () => {
    // The earlier float32 figure (4.3e-7) came from a toy case: one particle,
    // a fixed point mass, float64 arithmetic quantised only at step boundaries.
    // A reviewer measured 3.4e-4 on the real thing — three orders worse — and
    // was right that the number underpinning the constant-memory adjoint was
    // measured on the wrong system.
    //
    // This measures the actual shipped path: full float32 GPU arithmetic, a real
    // scenario at the real timestep, through pericentre. Percentiles as well as
    // the worst case, because the worst case is one pericentre-grazing particle
    // and the distribution is what a gradient budget needs.
    const spec = structuredClone(SCENARIOS.prograde.spec);
    spec.particles = 20000;
    const { galaxies, particles } = buildEncounter(spec);
    const start = Float64Array.from(particles.pos);
    const gpu = new GpuSim(device, galaxies, particles);

    const dt = 0.02, n = 3000;                    // the shipped timestep
    gpu.run(dt, n);
    await device.queue.onSubmittedWorkDone();
    const mid = await gpu.readPositions();
    const moved = worstOf(mid, start, gpu.count);
    ok(moved > 5, `particles barely moved (${moved.toExponential(2)} kpc); test is vacuous`);

    gpu.run(-dt, n);
    await device.queue.onSubmittedWorkDone();
    const back = await gpu.readPositions();
    gpu.destroy();

    const errs = [];
    for (let i = 0; i < particles.count; i++) {
      errs.push(Math.hypot(back[i * 4] - start[i * 3],
                           back[i * 4 + 1] - start[i * 3 + 1],
                           back[i * 4 + 2] - start[i * 3 + 2]));
    }
    errs.sort((a, b) => a - b);
    const q = (p) => errs[Math.min(errs.length - 1, Math.floor(p * errs.length))];
    // Bounded loosely so a catastrophic regression trips, but the VALUE is the
    // point: it is the floor on gradient accuracy through a reversible-recompute
    // adjoint, and it decides the checkpoint interval.
    below(q(0.999), 5.0, 'p99.9 reversal residual (kpc)');
    return `median ${q(0.5).toExponential(1)} / p99 ${q(0.99).toExponential(1)} / p99.9 ${q(0.999).toExponential(1)} `
         + `/ worst ${errs[errs.length - 1].toExponential(1)} kpc, after ${n}+${n} steps at dt=${dt} `
         + `(particles moved up to ${moved.toFixed(0)} kpc)`;
  });
}

export { createDevice };
