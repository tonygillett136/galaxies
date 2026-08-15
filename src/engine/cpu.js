/**
 * CPU reference implementation of the restricted problem.
 *
 * This is not the code that ships. It exists so the WGSL kernel has something
 * independent to be checked against. Two implementations written from the same
 * equations but in different languages, agreeing to floating-point tolerance, is
 * evidence. One implementation reproducing its own previous output is not.
 *
 * Integrator: leapfrog in kick-drift-kick form. Symplectic, second order, and
 * exactly time-reversible, which we rely on twice: as a test (integrate forward
 * then backward and land where you started, measured at 5e-16 in float64) and
 * later as the mechanism for constant-memory gradients through a long rollout.
 */

import { pairTable } from './pairforce.js';

const acc = [0, 0, 0];

const outerScaleOf = (P) => {
  const parts = P.kind === 'composite' ? P.parts : [P];
  return Math.max(...parts.map((p) => p.scale).filter((s) => s > 0));
};

/**
 * The friction validity ratio, EXPORTED so its test can call the shipped code.
 *
 * Round 3's test re-implemented this locally, and a reviewer proved the test
 * inert by DELETING the gate from cpu.js entirely and watching the suite pass
 * with byte-identical output. A guard that does not call the thing it guards is
 * not a guard. `frictionWeight` below is the same function the integrator uses.
 */
export function frictionWeightX(perturber, field) {
  return outerScaleOf(perturber) / Math.max(outerScaleOf(field), 1e-9);
}

/** Validity weight for treating `perturber` as a point mass inside `field`. */
export function frictionWeight(perturber, field) {
  const x = frictionWeightX(perturber, field);
  if (x >= 3) return 0;
  const t = Math.max(0, Math.min(1, (x - 1) / 2));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Abramowitz & Stegun 7.1.26. Max absolute error 1.5e-7.
 *
 *   erf(x) = 1 - (a1 t + a2 t^2 + a3 t^3 + a4 t^4 + a5 t^5) exp(-x^2)
 *
 * The exponential multiplies the WHOLE polynomial. My first version applied it
 * to the last term only, which is wrong by up to 0.149 absolute — erf(3) came
 * out as 0.9494 instead of 0.99998 — so every dynamical friction magnitude was
 * wrong. It was found by a reviewer reading the expression, not by any test,
 * because the friction tests only asserted that energy fell and the orbit
 * decayed, and a wrong-by-15%-of-full-scale erf still does both.
 *
 * That is the lesson worth keeping: an assertion on the SIGN of an effect
 * cannot detect an error in its MAGNITUDE. There is now a direct check against
 * known values of erf.
 */
export function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741
             + t * (-1.453152027 + t * 1.061405429))));
  return s * (1 - poly * Math.exp(-x * x));
}

export class RestrictedSim {
  /**
   * @param {object} opts
   * @param {Array<{mass:number, potential:object, pos:number[], vel:number[]}>} opts.galaxies
   * @param {{count:number, pos:ArrayLike<number>, vel:ArrayLike<number>}} opts.particles
   */
  constructor({ galaxies, particles, friction = 0 }) {
    /** Coulomb logarithm lnL. 0 disables friction entirely. */
    this.friction = friction;
    // THIS MAP IS A DELIVERY BOUNDARY, and it silently ate a shipped feature.
    //
    // Round 7 found the dust-lane fix inert: buildEncounter attached discNormal
    // to each galaxy, the uniform block grew 68 -> 76 floats to carry it, the
    // shader confined dust about it — and this literal dropped the field on the
    // floor. The renderer reads sim.orbit.galaxies, i.e. THESE objects, so it
    // took its `?? [0, 0, 1]` fallback in every frame of every scenario. The
    // fallback is exactly right for one disc in the whole project (prograde's
    // primary, inclination 0), and that is the disc the verifying screenshot
    // was taken from. Measured cost elsewhere: the antennae's mean dust column
    // ran at 0.09 of what the fix intended, the ring's at 0.048.
    //
    // Anything the RENDERER needs must be copied here explicitly. Adding a
    // field to the galaxy spec is not enough on its own.
    this.galaxies = galaxies.map((g) => ({
      mass: g.mass, potential: g.potential,
      pos: Float64Array.from(g.pos), vel: Float64Array.from(g.vel),
      acc: new Float64Array(3),
      discNormal: g.discNormal ? Array.from(g.discNormal) : undefined,
    }));

    // Internal state is ALWAYS Float64, even when callers hand us Float32 arrays
    // sized for the GPU. This is the reference implementation: it exists to be
    // more accurate than the thing it checks, so it must not inherit the thing's
    // precision. Measured: running it in Float32 put the time-reversal residual
    // at 4.3e-7 after 6000 steps, which is roundoff, not an integrator defect.
    this.p = particles;
    this.count = particles.count;
    this.pos = Float64Array.from(particles.pos);
    this.vel = Float64Array.from(particles.vel);
    this.pacc = new Float64Array(particles.count * 3);
    this.time = 0;
    this.steps = 0;
    this.computeAccelerations();
  }

  /** Copy internal state out to Float32 buffers for rendering or GPU upload. */
  syncOut(pos32, vel32) {
    if (pos32) pos32.set(this.pos);
    if (vel32) vel32.set(this.vel);
  }

  /** Acceleration of every galaxy from every other, and of every particle from all galaxies. */
  computeAccelerations() {
    const gs = this.galaxies;
    for (const g of gs) { g.acc[0] = 0; g.acc[1] = 0; g.acc[2] = 0; }

    // Galaxy-galaxy: the MUTUAL force between two extended distributions,
    // summed over component pairs.
    //
    // Two wrong versions preceded this one and both are worth recording.
    //
    // First, each galaxy felt the other's potential evaluated one-sidedly. That
    // breaks Newton's third law as soon as the profiles differ, because a_12
    // samples galaxy 2's enclosed mass at d while a_21 samples galaxy 1's:
    // measured 34 per cent force asymmetry at mass ratio 0.1.
    //
    // Second, I replaced it with the MEAN of the two one-sided estimates. That
    // is exactly momentum-conserving, and it is also 2.83x too strong at close
    // separation — a reviewer measured 2.9x to 4.5x. Both one-sided estimates
    // use the other body's full mass at d, which double-counts the softening
    // that each extended profile already provides.
    //
    // The right answer is the convolution of the two mass distributions, and it
    // has no elementary closed form.
    //
    // ROUND 2 USED ONE ANYWAY: F = M_i M_j d / (d^2 + a_i^2 + a_j^2)^{3/2}, under
    // a comment asserting it was "exact for the Plummer components" and erred
    // "in the direction of more softening rather than less". Round 3 measured it
    // against quadrature and BOTH halves were false. Summed over a real galaxy
    // pair it is 1.2x too strong at 5 kpc, 2.35x at 16, and 2.65x at 25 — the
    // shipped prograde scenario's own pericentre — and for Plummer-Plummer it is
    // 1.29x too strong at d=5, not exact. The convolution of two Plummer
    // DENSITIES is not a Plummer density; only a single Plummer sphere's
    // POTENTIAL has the softened point-mass form, which is what I confused.
    //
    // The solver hid it: it retunes the Kepler pericentre until the executed
    // r_min matches the request, so the DISTANCE of closest approach stayed
    // right while the SPEED through it did not.
    //
    // src/engine/pairforce.js now computes the exact force and the exact mutual
    // potential energy by quadrature and tabulates them. See that file for the
    // derivation and for the checks: |F| = dW/dd to 1.00000 between two
    // independently derived integrals, and the point-mass limit to 2e-6.
    for (let i = 0; i < gs.length; i++) {
      for (let j = i + 1; j < gs.length; j++) {
        const dx = gs[i].pos[0] - gs[j].pos[0];
        const dy = gs[i].pos[1] - gs[j].pos[1];
        const dz = gs[i].pos[2] - gs[j].pos[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        const d = Math.sqrt(d2);

        // |F| from the table, converted to the per-axis coefficient k = |F|/d so
        // the equal-and-opposite application below is unchanged.
        const tab = pairTable(gs[i].potential, gs[j].potential);
        const k = d > 1e-12 ? tab.force(d) / d : 0;

        // force on i points from i towards j, i.e. along -d
        const fx = -k * dx, fy = -k * dy, fz = -k * dz;
        gs[i].acc[0] += fx / gs[i].mass;
        gs[i].acc[1] += fy / gs[i].mass;
        gs[i].acc[2] += fz / gs[i].mass;
        gs[j].acc[0] -= fx / gs[j].mass;
        gs[j].acc[1] -= fy / gs[j].mass;
        gs[j].acc[2] -= fz / gs[j].mass;
      }
    }

    // --- Chandrasekhar dynamical friction, optional ---
    //
    // Without it the galaxy centres conserve energy exactly and can NEVER merge:
    // they swing past each other forever. Both JSPAM (the cross-validation
    // reference) and Identikit (the incumbent) include a friction treatment, and
    // a reviewer was right that a scenario blurbed as a merger could not merge.
    //
    //   a_drag = -4 pi lnL M rho(d) [erf(X) - (2X/sqrt(pi)) e^-X^2] v / |v|^3
    //   X = |v| / (sqrt(2) sigma),  sigma ~ v_circ(d) / sqrt(2)
    //
    // Force-symmetrised like gravity, so linear momentum is still conserved
    // exactly even though ENERGY is not — energy loss is the entire point.
    //
    // THIS BREAKS TIME-REVERSIBILITY, and correctly so: friction is dissipative,
    // so running the clock backwards cannot retrace the path. Leapfrog's exact
    // reversibility only holds for velocity-independent forces. Off by default
    // for that reason, and the interface says so when it is on.
    if (this.friction > 0 && gs.length === 2) {
      const dx = gs[0].pos[0] - gs[1].pos[0];
      const dy = gs[0].pos[1] - gs[1].pos[1];
      const dz = gs[0].pos[2] - gs[1].pos[2];
      // Floor the separation used for density and dispersion. Chandrasekhar's
      // formula describes a compact satellite moving through a SMOOTH field; once
      // the cores overlap that picture has failed anyway, and a Hernquist density
      // diverging as 1/r drives the drag to infinity.
      //
      // The floor is a CORE scale, not the halo scale. It was half the LARGEST
      // component radius, which for these models is the 20 kpc halo — a 10 kpc
      // floor, wider than the 13.5 kpc discs, active on a tenth of all merger
      // steps. That is not a cure for core overlap, it is a cap on the whole
      // interesting range. Now half the SMALLEST component scale, which is the
      // bulge and is what "cores overlap" actually refers to.
      const coreScale = (P) => {
        const parts = P.kind === 'composite' ? P.parts : [P];
        return Math.min(...parts.map((p) => p.scale).filter((s) => s > 0));
      };
      const dRaw = Math.hypot(dx, dy, dz);
      const d = Math.max(dRaw, 0.5 * Math.max(coreScale(gs[0].potential), coreScale(gs[1].potential)));
      const vx = gs[0].vel[0] - gs[1].vel[0];
      const vy = gs[0].vel[1] - gs[1].vel[1];
      const vz = gs[0].vel[2] - gs[1].vel[2];
      const v = Math.hypot(vx, vy, vz);

      if (v > 1e-9 && d > 1e-9) {
        // Validity gate. Chandrasekhar's derivation assumes the perturber is
        // COMPACT compared with the field it ploughs through. Applied blindly it
        // gives nonsense in the reverse case: because the drag force scales as
        // M^2, a heavy galaxy moving through a tiny satellite's wispy halo
        // out-drags the satellite by a factor of 20, even against a density a
        // million times lower. That term is not a small correction, it is the
        // formula being used outside its domain.
        //
        // ROUND 2's VERSION OF THIS GATE WAS INERT, and round 3 caught it from
        // two independent lenses with identical arithmetic.
        //
        // It computed x = coreOf(perturber) / P.scale where coreOf took the MIN
        // over components (the bulge, 0.5*rScale) while a composite's `.scale`
        // is the MAX (the halo, 20*rScale). That is a built-in factor of 40
        // against the gate ever firing. Measured w = 1.0000 at every mass ratio
        // the interface can reach — 1.0, 0.6, 0.1, 0.05 — first moving at
        // q ~ 1e-5, where the slider stops at 0.05. Meanwhile the M^2 pathology
        // it was written to suppress is 400x at that same slider minimum.
        //
        // The asserting test passed because it used bare non-composite
        // potentials, where min and max coincide: it validated a branch
        // galaxyModel() cannot produce. A test must exercise the object the
        // application actually builds.
        //
        // THE CRITERION IS SIZE ASYMMETRY, NOT SEPARATION, and getting here took
        // three attempts. Recorded because the shape of the error repeated.
        //
        //   Round 2: x = coreOf(perturber) / scale(field), min-over-perturber
        //     against max-over-field — a built-in factor of 40, so w = 1.0000
        //     always. Inert.
        //   Round 3 (mine): x = R_perturber / separation. Defensible-sounding
        //     and wrong in BOTH directions. Beyond ~100 kpc both weights are 1
        //     and the pathology runs at 20.4x the physical term; below ~33 kpc
        //     it zeroes ALL drag, so the merger scenario could no longer merge
        //     at any lnL — the apocentre falls below the cutoff and the pair
        //     stalls. It destroyed a round-1 fix and defeated a round-2 one.
        //
        // The defect being suppressed is specific: a heavy galaxy treated as a
        // point perturber inside a SMALL satellite's halo, where the M^2 scaling
        // makes the nonsense term dominate. That is a statement about the two
        // galaxies' relative SIZES. It has nothing to do with how far apart they
        // are, which is why gating on separation broke the physics — a formula
        // being unreliable in detail does not mean the effect is absent, and
        // dynamical friction during close approach is exactly what drives real
        // mergers.
        //
        //     x = R_perturber / R_field   (OUTER scale on both sides)
        //     w = 1 for x <= 1, smoothstep to 0 by x >= 3
        //
        // which is what round 2's comment always SAID it did. Measured:
        //   q=1.0  big-through-small 1.000   small-through-big 1.000
        //   q=0.6  0.976 / 1.000     q=0.1  0.385 / 1.000     q=0.05  0.055 / 1.000
        // The pathological term dies, the legitimate one survives at every
        // separation, and the merger merges again.
        //
        // The drag is force-symmetrised, so the reaction matters as much as the
        // term: a heavy galaxy dragged through a light satellite's wispy halo
        // produces a force that, divided by the SATELLITE's small mass, dominates
        // its acceleration. That is how the M^2 pathology reaches the light body
        // — through Newton's third law rather than directly.
        const chandra = (P, other) => {
          const rho = P.density ? P.density(d) : 0;
          if (rho <= 0) return 0;
          // CALL the exported gate. Round 4 exported frictionWeight() so its test
          // would stop re-implementing the logic — and then left this site with an
          // INLINE COPY of the same smoothstep, sharing only frictionWeightX. So
          // the test exercised a function nothing in the simulation called, and
          // round 5 proved it: five separate mutations of the inline copy, each
          // reverting or weakening the gate, produced byte-identical suite output.
          // The comment above frictionWeight even claimed "the same function the
          // integrator uses", which was false the moment it was written.
          const w = frictionWeight(other.potential, P);
          if (w <= 0) return 0;
          const sigma = Math.max(P.vcirc(d) / Math.SQRT2, 1e-6);
          const X = v / (Math.SQRT2 * sigma);
          const f = erf(X) - (2 * X / Math.sqrt(Math.PI)) * Math.exp(-X * X);
          return w * 4 * Math.PI * this.friction * other.mass * rho * Math.max(f, 0) / (v * v * v);
        };
        // Drag felt by each galaxy in the other's field. TWO DISTINCT PROCESSES,
        // so the total is their SUM.
        //
        // I originally averaged them, copying the symmetrisation pattern used
        // for gravity. That was wrong and cost exactly a factor of two, measured
        // by a reviewer at 2.000 on every one of 17,942 merger steps. Gravity
        // needed symmetrising because two one-sided estimates of ONE force
        // disagreed; here each drag is already its own equal-and-opposite
        // internal pair, and averaging them discards half the dissipation.
        const k0 = chandra(gs[1].potential, gs[0]);   // galaxy 0 through 1's halo
        const k1 = chandra(gs[0].potential, gs[1]);   // galaxy 1 through 0's halo
        let F = gs[0].mass * k0 + gs[1].mass * k1;

        // Cap the per-step drag impulse. Drag is a stiff force: if F/m * dt
        // exceeds the relative velocity, an explicit integrator overshoots,
        // REVERSES the velocity and amplifies it, so a decelerating force
        // accelerates. Limit the change to a quarter of v per step, which leaves
        // the physics untouched in every regime where the formula is valid and
        // only clips the regime where the integrator would fail regardless.
        // 0.25 / dt IS CORRECT, and I broke it in round 4 by "fixing" a
        // dimensional inconsistency that was not one.
        //
        // The drag is applied below as `acc -= F * vx / mass`, where vx is a
        // component of the relative velocity VECTOR rather than a unit vector. So
        // the acceleration magnitude is F|v|/m, not F/m, and
        //     |a| dt <= 0.25 |v|   =>   F|v|dt/m <= 0.25|v|   =>   F/m <= 0.25/dt
        // with |v| cancelling exactly. Comparing F/m against 0.25/dt is therefore
        // dimensionally right and my 0.25 v/dt made the cap |v| times too
        // permissive.
        //
        // A round-4 reviewer reported this as dimensionally inconsistent and I
        // changed it without checking how F is applied. Someone else's report is
        // the hypothesis to test, not the premise to act on — which is written in
        // this project's own ways-of-working, and I did not follow it.
        const dtAbs = Math.abs(this._dt || 0.02);
        const maxK = 0.25 / dtAbs;                      // max fractional dv per step
        const worst = Math.max(F / gs[0].mass, F / gs[1].mass);
        if (worst > maxK) F *= maxK / worst;

        gs[0].acc[0] -= F * vx / gs[0].mass;
        gs[0].acc[1] -= F * vy / gs[0].mass;
        gs[0].acc[2] -= F * vz / gs[0].mass;
        gs[1].acc[0] += F * vx / gs[1].mass;
        gs[1].acc[1] += F * vy / gs[1].mass;
        gs[1].acc[2] += F * vz / gs[1].mass;
      }
    }

    const count = this.count, pos = this.pos, pa = this.pacc;
    for (let k = 0; k < count; k++) {
      const x = pos[k * 3], y = pos[k * 3 + 1], z = pos[k * 3 + 2];
      let ax = 0, ay = 0, az = 0;
      for (const g of gs) {
        g.potential.accel(x - g.pos[0], y - g.pos[1], z - g.pos[2], acc);
        ax += acc[0]; ay += acc[1]; az += acc[2];
      }
      pa[k * 3] = ax; pa[k * 3 + 1] = ay; pa[k * 3 + 2] = az;
    }
  }

  kick(h) {
    for (const g of this.galaxies) {
      g.vel[0] += g.acc[0] * h; g.vel[1] += g.acc[1] * h; g.vel[2] += g.acc[2] * h;
    }
    const vel = this.vel, pa = this.pacc;
    for (let k = 0; k < this.count * 3; k++) vel[k] += pa[k] * h;
  }

  drift(dt) {
    for (const g of this.galaxies) {
      g.pos[0] += g.vel[0] * dt; g.pos[1] += g.vel[1] * dt; g.pos[2] += g.vel[2] * dt;
    }
    const pos = this.pos, vel = this.vel;
    for (let k = 0; k < this.count * 3; k++) pos[k] += vel[k] * dt;
  }

  /**
   * One KDK step. Negative dt runs it backwards exactly — UNLESS friction is on,
   * in which case the force is velocity-dependent, the symplectic guarantee no
   * longer applies, and reversal is only approximate. That is the physics:
   * dissipation is irreversible.
   */
  step(dt) {
    this._dt = dt;
    this.kick(0.5 * dt);
    this.drift(dt);
    this.computeAccelerations();
    this.kick(0.5 * dt);
    this.time += dt;
    this.steps++;
  }

  run(dt, n) { for (let i = 0; i < n; i++) this.step(dt); return this; }

  /**
   * Diagnostics for the GALAXY subsystem only. The test particles are massless,
   * so they carry no energy and cannot be part of a conservation check. Saying
   * that out loud because a "total energy" that silently includes massless
   * particles produces a reassuring flat line that means nothing.
   */
  diagnostics() {
    const gs = this.galaxies;
    let ke = 0, pe = 0;
    for (const g of gs) {
      ke += 0.5 * g.mass * (g.vel[0] ** 2 + g.vel[1] ** 2 + g.vel[2] ** 2);
    }
    for (let i = 0; i < gs.length; i++) {
      for (let j = i + 1; j < gs.length; j++) {
        const d2 = (gs[i].pos[0] - gs[j].pos[0]) ** 2
                 + (gs[i].pos[1] - gs[j].pos[1]) ** 2
                 + (gs[i].pos[2] - gs[j].pos[2]) ** 2;
        // The potential MUST match the force law used above. A potential energy
        // computed from a different law than the force is not an energy, and
        // the conservation test built on it would be checking nothing.
        //
        // Both now come from the same table, and pairforce.js asserts they are
        // consistent (F = -dW/dd), so this cannot silently drift apart from the
        // force the way the previous hand-written pair did.
        pe += pairTable(gs[i].potential, gs[j].potential).potential(Math.sqrt(d2));
      }
    }
    let lx = 0, ly = 0, lz = 0;
    for (const g of gs) {
      lx += g.mass * (g.pos[1] * g.vel[2] - g.pos[2] * g.vel[1]);
      ly += g.mass * (g.pos[2] * g.vel[0] - g.pos[0] * g.vel[2]);
      lz += g.mass * (g.pos[0] * g.vel[1] - g.pos[1] * g.vel[0]);
    }
    return {
      time: this.time, steps: this.steps,
      kinetic: ke, potential: pe, energy: ke + pe,
      angularMomentum: [lx, ly, lz],
      angularMomentumMag: Math.hypot(lx, ly, lz),
      separation: gs.length > 1 ? Math.hypot(
        gs[0].pos[0] - gs[1].pos[0],
        gs[0].pos[1] - gs[1].pos[1],
        gs[0].pos[2] - gs[1].pos[2]) : NaN,
    };
  }

  snapshot() {
    return {
      time: this.time,
      galaxies: this.galaxies.map((g) => ({ pos: Array.from(g.pos), vel: Array.from(g.vel) })),
      pos: this.pos.slice(), vel: this.vel.slice(),
    };
  }
}
