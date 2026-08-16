/**
 * A two-galaxy encounter with SELF-GRAVITATING discs.
 *
 * Stage 1 of the live tier, and the approximation is stated rather than implied:
 *
 *   - the two galaxy CENTRES follow a two-body orbit integrated on the CPU in
 *     float64, under each other's FULL mass (bulge + disc + halo) plus the
 *     analytic Chandrasekhar drag. The disc mass is genuinely there, so the orbit
 *     must feel it;
 *   - the PARTICLES feel the rigid remainder of both galaxies (bulge + halo,
 *     with the Plummer disc term removed) plus the direct self-gravity of every
 *     live particle in both discs. No double counting: galaxy 2's disc reaches a
 *     particle in galaxy 1 as live particles, not as a rigid term;
 *   - the discs do NOT push back on the halo orbit. Each disc is 4.69% of its
 *     galaxy, so the back-reaction is small, but it is not zero and this is the
 *     leading approximation of Stage 1.
 *
 * The consequence to keep hold of: dynamical friction here is still an analytic
 * term on the centres. The wake is not simulated. Stage 2 (a live halo) is what
 * retires that, and it is gated on mass resolution — see PHASE2_PLAN.md.
 */

import { buildEncounter } from './encounter.js';
import { rigidWithoutDisc, liveExponentialDisc } from './livedisc.js';
import { liveHernquistHalo } from './livehalo.js';
import { RestrictedSim } from './cpu.js';
import { LiveSim } from './live.js';

/**
 * @param {GPUDevice} device
 * @param {Object} spec        same shape buildEncounter takes
 * @param {Object} o
 * @param {number} o.count     live particles PER DISC
 * @param {number} o.toomreQ
 * @param {number} o.eps       self-gravity softening, kpc
 */
export async function buildLiveEncounter(device, spec, o = {}) {
  const { count = 25000, toomreQ = 1.2, eps = 0.2, seed = 11 } = o;
  if (o.liveHalo) return buildFullyLiveEncounter(device, spec, o);

  // Two particles only: we want the orbit and the galaxy models, not the discs.
  const built = buildEncounter({ ...spec, particles: 2 });
  const G = built.galaxies;

  // The CPU orbit integrator sees the FULL potentials, because the disc mass is
  // real. Only the PARTICLES see the disc removed.
  const orbit = new RestrictedSim({
    friction: built.friction,
    galaxies: G.map((g) => ({
      mass: g.mass, potential: g.potential,
      pos: Array.from(g.pos), vel: Array.from(g.vel),
    })),
    particles: { count: 0, pos: new Float64Array(0), vel: new Float64Array(0) },
  });

  const rigids = [];
  const sets = [];
  G.forEach((g, i) => {
    const { rigid, discMass } = rigidWithoutDisc(g.potential);
    rigids.push(rigid);
    const d = (i === 0 ? spec.disc1 : spec.disc2) ?? {};
    sets.push(liveExponentialDisc({
      count, discMass, rigid, toomreQ,
      // scaleLength tracks the model's own disc scale, which carries the mass
      // ratio's cube-root scaling. Hard-coding 3.0 would give the secondary a
      // disc the wrong size for its halo.
      scaleLength: rigidWithoutDisc(g.potential).discScale,
      rMax: d.rMax ?? 4.5,
      thickness: d.thickness ?? 0.1,
      inclination: d.inclination ?? 0,
      centre: Array.from(g.pos), velocity: Array.from(g.vel),
      retrograde: !!d.retrograde,
      origin: i, seed: seed + i * 977,
    }));
  });

  // Inclination is applied here rather than inside liveExponentialDisc, so the
  // disc generator stays a flat-disc-in-its-own-plane function and the tilt is
  // one rotation applied to positions and velocities together.
  sets.forEach((s, i) => {
    const d = (i === 0 ? spec.disc1 : spec.disc2) ?? {};
    const inc = d.inclination ?? 0, node = d.node ?? d.argPeri ?? 0;
    if (!inc && !node) return;
    const c = Array.from(G[i].pos), v0 = Array.from(G[i].vel);
    const ci = Math.cos(inc), si = Math.sin(inc);
    const cn = Math.cos(node), sn = Math.sin(node);
    for (let k = 0; k < s.count; k++) {
      for (const [arr, off] of [[s.pos, c], [s.vel, v0]]) {
        let x = arr[k * 3] - off[0], y = arr[k * 3 + 1] - off[1], z = arr[k * 3 + 2] - off[2];
        // tilt about x, then rotate about z
        const y1 = y * ci - z * si, z1 = y * si + z * ci;
        arr[k * 3] = (x * cn - y1 * sn) + off[0];
        arr[k * 3 + 1] = (x * sn + y1 * cn) + off[1];
        arr[k * 3 + 2] = z1 + off[2];
      }
    }
  });

  // merge the two discs into one particle set
  const total = sets.reduce((a, s) => a + s.count, 0);
  const pos = new Float32Array(total * 3), vel = new Float32Array(total * 3);
  const mass = new Float32Array(total), radius = new Float32Array(total), origin = new Float32Array(total);
  let k = 0;
  for (const s of sets) {
    pos.set(s.pos, k * 3); vel.set(s.vel, k * 3);
    mass.set(s.mass, k); radius.set(s.radius, k); origin.set(s.origin, k);
    k += s.count;
  }

  const sim = await LiveSim.create(
    device,
    G.map((g, i) => ({ pos: Array.from(g.pos), potential: rigids[i] })),
    { count: total, pos, vel, mass, radius, origin },
    eps,
  );

  return {
    sim, orbit, sets, rigids, built,
    /** Advance both, keeping the rigid centres in step with the CPU orbit. */
    step(dt) {
      orbit.step(dt);
      sim.step(dt, orbit.galaxies.map((g) => Array.from(g.pos)));
    },
    run(dt, n) { for (let i = 0; i < n; i++) this.step(dt); },
    separation() {
      const a = orbit.galaxies[0].pos, b = orbit.galaxies[1].pos;
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    },
    destroy() { sim.destroy(); },
  };
}


/**
 * A FULLY live encounter: disc, bulge and halo are all particles, for both
 * galaxies. Nothing is rigid and nothing follows a prescribed orbit — the two
 * galaxies attract each other through their own particles, so **dynamical
 * friction is real** rather than an analytic drag on the centres, and the wake
 * that produces it exists.
 *
 * The halo and bulge are sampled by Eddington inversion in the TOTAL potential
 * of their own galaxy, which is what stops them contracting when the disc is
 * placed inside them. See eddington.js.
 *
 * WHAT THIS COSTS AND WHAT IT BUYS. Every component being live means no CPU
 * orbit integrator, so there is no float64 two-body trajectory underneath: the
 * encounter geometry is now a float32 N-body result like everything else. In
 * exchange, the merger timescale is a prediction rather than an input, and the
 * remnant is produced by a potential that varies in time — which is the
 * mechanism the rigid-halo runs could not reproduce.
 *
 * The bulge is the resolution limit here: Hernquist a = 0.5 kpc against a
 * softening of 0.2 kpc is about two and a half softening lengths, which is
 * marginal. It carries 1.42% of the mass, so it is a small error on a small
 * component, but it is the first thing to distrust if the centre misbehaves.
 */
async function buildFullyLiveEncounter(device, spec, o = {}) {
  const { count = 12000, haloCount = 38000, bulgeCount = 3600,
          toomreQ = 1.2, eps = 0.2, seed = 11 } = o;

  const built = buildEncounter({ ...spec, particles: 2 });
  const G = built.galaxies;
  const sets = [];

  G.forEach((g, i) => {
    const model = g.potential;                       // bulge + plummer disc + halo
    const { rigid, discMass, discScale } = rigidWithoutDisc(model);
    const halo = rigid.parts.reduce((x, y) => (y.mass > x.mass ? y : x));
    const bulge = rigid.parts.find((x) => x !== halo);
    const d = (i === 0 ? spec.disc1 : spec.disc2) ?? {};
    const centre = Array.from(g.pos), velocity = Array.from(g.vel);

    // The disc still needs an ANALYTIC bulge+halo to set its circular speed and
    // its dispersions; those components are live, but they realise that same
    // profile, so the analytic form is the right thing to build against.
    sets.push(liveExponentialDisc({
      count, discMass, rigid, toomreQ, scaleLength: discScale,
      rMax: d.rMax ?? 4.5, thickness: d.thickness ?? 0.1,
      centre, velocity, retrograde: !!d.retrograde,
      origin: i, seed: seed + i * 977,
    }));
    sets.push(liveHernquistHalo({
      count: haloCount, mass: halo.mass, a: halo.scale, rMax: 15 * halo.scale,
      centre, velocity, origin: 2 + i, seed: seed + 5000 + i * 977,
      totalPotential: model,
    }));
    sets.push(liveHernquistHalo({
      count: bulgeCount, mass: bulge.mass, a: bulge.scale, rMax: 15 * bulge.scale,
      centre, velocity, origin: 4 + i, seed: seed + 9000 + i * 977,
      totalPotential: model,
    }));
  });

  // inclination applied to the DISC sets only; the spheroids are isotropic
  sets.forEach((s2, k) => {
    if (k % 3 !== 0) return;
    const i = k / 3;
    const d = (i === 0 ? spec.disc1 : spec.disc2) ?? {};
    const inc = d.inclination ?? 0, node = d.node ?? d.argPeri ?? 0;
    if (!inc && !node) return;
    const c = Array.from(G[i].pos), v0 = Array.from(G[i].vel);
    const ci = Math.cos(inc), si = Math.sin(inc), cn = Math.cos(node), sn = Math.sin(node);
    for (let j = 0; j < s2.count; j++) {
      for (const [arr, off] of [[s2.pos, c], [s2.vel, v0]]) {
        const x = arr[j * 3] - off[0], y = arr[j * 3 + 1] - off[1], z = arr[j * 3 + 2] - off[2];
        const y1 = y * ci - z * si, z1 = y * si + z * ci;
        arr[j * 3] = (x * cn - y1 * sn) + off[0];
        arr[j * 3 + 1] = (x * sn + y1 * cn) + off[1];
        arr[j * 3 + 2] = z1 + off[2];
      }
    }
  });

  const total = sets.reduce((a, s2) => a + s2.count, 0);
  const pos = new Float32Array(total * 3), vel = new Float32Array(total * 3);
  const mass = new Float32Array(total), radius = new Float32Array(total), origin = new Float32Array(total);
  let k = 0;
  for (const s2 of sets) {
    pos.set(s2.pos, k * 3); vel.set(s2.vel, k * 3);
    mass.set(s2.mass, k); radius.set(s2.radius, k); origin.set(s2.origin, k);
    k += s2.count;
  }

  // No rigid components at all.
  const sim = await LiveSim.create(device, [], { count: total, pos, vel, mass, radius, origin }, eps);

  // Index ranges, so the analysis can address a population without re-deriving it
  const ranges = {}; let off = 0;
  for (let i = 0; i < 2; i++) {
    ranges[`disc${i}`] = [off, off + count]; off += count;
    ranges[`halo${i}`] = [off, off + haloCount]; off += haloCount;
    ranges[`bulge${i}`] = [off, off + bulgeCount]; off += bulgeCount;
  }

  return {
    sim, sets, built, ranges, fullyLive: true,
    step(dt) { sim.step(dt); },
    run(dt, n) { for (let i = 0; i < n; i++) sim.step(dt); },
    destroy() { sim.destroy(); },
  };
}
