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

const acc = [0, 0, 0];

/** Abramowitz & Stegun 7.1.26; max abs error 1.5e-7, ample here. */
function erf(x) {
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
                 - 0.284496736) * t * t - 0.254829592 * t * Math.exp(-x * x);
  return s * y;
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
    this.galaxies = galaxies.map((g) => ({
      mass: g.mass, potential: g.potential,
      pos: Float64Array.from(g.pos), vel: Float64Array.from(g.vel),
      acc: new Float64Array(3),
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

    // Galaxy-galaxy, SYMMETRISED.
    //
    // Each galaxy feels the other's extended potential rather than a point mass,
    // because at pericentre the separation is comparable to the scale radii.
    // But evaluating each side independently violates Newton's third law as soon
    // as the two profiles differ: a_12 samples galaxy 2's enclosed-mass profile
    // at d while a_21 samples galaxy 1's, and m1*M2,enc(d) != m2*M1,enc(d) when
    // the scale radii differ. Measured before this fix: at mass ratio 0.1 and
    // separation 2 the force on the primary was 34 per cent larger than the
    // force on the secondary, so momentum was not conserved in any unequal-mass
    // encounter — which is all of them except the symmetric case.
    //
    // The pair force is therefore computed once, as the mean of the two
    // one-sided estimates, and applied equal and opposite. That is exactly
    // momentum-conserving by construction, reduces to the correct answer when
    // the profiles match, and its remaining error is in the MAGNITUDE of the
    // close-passage force rather than in a conservation law. Asserted in
    // test/physics.test.js across mass ratios with deliberately mismatched scales.
    for (let i = 0; i < gs.length; i++) {
      for (let j = i + 1; j < gs.length; j++) {
        const dx = gs[i].pos[0] - gs[j].pos[0];
        const dy = gs[i].pos[1] - gs[j].pos[1];
        const dz = gs[i].pos[2] - gs[j].pos[2];

        gs[j].potential.accel(dx, dy, dz, acc);
        const ax1 = acc[0], ay1 = acc[1], az1 = acc[2];     // accel of i, from j
        gs[i].potential.accel(-dx, -dy, -dz, acc);
        const ax2 = acc[0], ay2 = acc[1], az2 = acc[2];     // accel of j, from i

        // mean of the two force estimates, along the separation
        const fx = 0.5 * (gs[i].mass * ax1 - gs[j].mass * ax2);
        const fy = 0.5 * (gs[i].mass * ay1 - gs[j].mass * ay2);
        const fz = 0.5 * (gs[i].mass * az1 - gs[j].mass * az2);

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
      // diverging as 1/r drives the drag to infinity. Without this floor the pair
      // gained energy by a factor of 250 instead of losing it.
      const dRaw = Math.hypot(dx, dy, dz);
      const d = Math.max(dRaw, 0.5 * Math.max(gs[0].potential.scale, gs[1].potential.scale));
      const vx = gs[0].vel[0] - gs[1].vel[0];
      const vy = gs[0].vel[1] - gs[1].vel[1];
      const vz = gs[0].vel[2] - gs[1].vel[2];
      const v = Math.hypot(vx, vy, vz);

      if (v > 1e-9 && d > 1e-9) {
        const chandra = (P, other) => {
          const rho = P.density ? P.density(d) : 0;
          if (rho <= 0) return 0;
          const sigma = Math.max(P.vcirc(d) / Math.SQRT2, 1e-6);
          const X = v / (Math.SQRT2 * sigma);
          const f = erf(X) - (2 * X / Math.sqrt(Math.PI)) * Math.exp(-X * X);
          return 4 * Math.PI * this.friction * other.mass * rho * Math.max(f, 0) / (v * v * v);
        };
        // drag coefficient felt by each galaxy in the other's field
        const k0 = chandra(gs[1].potential, gs[0]);   // galaxy 0 through 1's halo
        const k1 = chandra(gs[0].potential, gs[1]);   // galaxy 1 through 0's halo
        // symmetrise the FORCE, then apply equal and opposite along -v_rel
        let F = 0.5 * (gs[0].mass * k0 + gs[1].mass * k1);

        // Cap the per-step drag impulse. Drag is a stiff force: if F/m * dt
        // exceeds the relative velocity, an explicit integrator overshoots,
        // REVERSES the velocity and amplifies it, so a decelerating force
        // accelerates. Limit the change to a quarter of v per step, which leaves
        // the physics untouched in every regime where the formula is valid and
        // only clips the regime where the integrator would fail regardless.
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
        const d = Math.hypot(
          gs[i].pos[0] - gs[j].pos[0],
          gs[i].pos[1] - gs[j].pos[1],
          gs[i].pos[2] - gs[j].pos[2]);
        // symmetrised: neither galaxy is privileged as "the source"
        pe += 0.5 * gs[i].mass * gs[j].potential.potential(d)
            + 0.5 * gs[j].mass * gs[i].potential.potential(d);
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
