/**
 * The one conversion layer.
 *
 * Internal units are G = 1, length in kpc, mass in 1e10 solar masses. Physical
 * units are permitted in exactly three places: the UI display layer, readers for
 * observational data, and this file. A conversion anywhere else is a defect.
 *
 * The numbers here are asserted in test/physics.test.js against physical
 * constants. If the test and a comment disagree, the test is right.
 */

/** Gravitational constant in internal units. 1 by construction. */
export const G = 1;

// --- physical constants, the only place they appear ---

/** kpc (km/s)^2 / Msun. IAU nominal solar mass, CODATA G. */
export const G_PHYS = 4.300917270e-6;
export const KM_PER_KPC = 3.085677581e16;
export const S_PER_MYR = 3.1557e13;

/** Mass unit in solar masses. */
export const MASS_MSUN = 1e10;
/** Length unit in kpc. Kept explicit so the derivations below read correctly. */
export const LENGTH_KPC = 1;

/** Derived: 207.386530 km/s */
export const VELOCITY_KMS = Math.sqrt(G_PHYS * MASS_MSUN / LENGTH_KPC);
/** Derived: 4.714920 Myr */
export const TIME_MYR = (LENGTH_KPC * KM_PER_KPC / VELOCITY_KMS) / S_PER_MYR;

// --- conversions, named to/from so the direction cannot be misread ---

export const timeToMyr = (t) => t * TIME_MYR;
export const timeFromMyr = (t) => t / TIME_MYR;

export const speedToKms = (v) => v * VELOCITY_KMS;
export const speedFromKms = (v) => v / VELOCITY_KMS;

export const massToMsun = (m) => m * MASS_MSUN;
export const massFromMsun = (m) => m / MASS_MSUN;

export const lengthToKpc = (x) => x * LENGTH_KPC;
export const lengthFromKpc = (x) => x / LENGTH_KPC;

/**
 * Reference scales, for sanity when reading numbers on screen. A Milky Way-like
 * disc is about 5 mass units with a 3-unit scale length, and the Sun sits at
 * 8.2 units moving at about 1.12.
 */
export const REFERENCE = Object.freeze({
  milkyWayDiscMass: 5.0,
  milkyWayHaloMass: 100.0,
  milkyWayDiscScale: 3.0,
  solarRadius: 8.2,
  solarSpeed: 232 / 207.386530,
});
