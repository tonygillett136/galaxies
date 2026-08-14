/**
 * Detective mode: compare the simulation against a real observed system.
 *
 * The honest part of this module is the mapping, and specifically what it
 * REFUSES to map.
 *
 * Galaxy Zoo Mergers Table 4 publishes five fitted parameters per system: mass
 * ratio, r_min (pericentre, kpc), t_min (time since pericentre, Myr),
 * eccentricity, and beta. Four of those translate directly into this engine's
 * encounter spec. `beta` does not, because I have not read Holincheck et al.
 * 2016 closely enough to know what it parameterises, and guessing at an angle
 * convention is exactly the kind of plausible-looking error that produces a
 * confident wrong overlay.
 *
 * Two further caveats that are surfaced in the UI rather than buried here:
 *
 *  1. The published fits were obtained with JSPAM's potential and disc model,
 *     which is not this engine's. Loading their numbers into this model does not
 *     reproduce their result and is not expected to.
 *  2. Disc orientations are NOT taken from the published fit. They are the
 *     user's to set. So a good visual match found this way is a match found by
 *     hand, which is what Toomre and Toomre did in 1972 and is worth exactly
 *     what that is worth.
 */

import { timeFromMyr } from '../engine/units.js';

export const UNMAPPED = ['beta'];

/** Load the catalogue built by data/build_targets.py. */
export async function loadTargets(base = './data/targets/targets.json') {
  const res = await fetch(base);
  if (!res.ok) throw new Error(`targets.json ${res.status}`);
  const cat = await res.json();
  cat.targets.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  return cat;
}

/**
 * Translate a published fit into an encounter spec.
 * Returns { spec, viewTime, mapped, unmapped, notes }.
 */
export function specFromFit(fit, opts = {}) {
  if (!fit) return null;
  const mapped = [];
  const spec = {
    // THE GAUGE, declared rather than defaulted. Mass and epoch are an exactly
    // flat direction (verified to 1e-8; see docs/IDENTIFIABILITY.md), so total
    // mass cannot be recovered from morphology and must be pinned. m1 = 1 is a
    // Milky Way analogue at 7.0e11 Msun. Physical mass comes from an external
    // constraint — a rotation curve or Tully-Fisher — never from a fit to shape.
    // Do not "fix" this by making it free: free is exactly what it must not be.
    m1: 1.0,
    particles: opts.particles ?? 320000,
    seed: 7,
    disc1: { inclination: opts.inc1 ?? 0.25, argPeri: opts.arg1 ?? 0.0 },
    disc2: { inclination: opts.inc2 ?? -0.4, argPeri: opts.arg2 ?? 1.3 },
  };

  // Clamping is REPORTED, not silent. Several published fits sit far outside
  // what this engine models — Arp 240's fit has eccentricity 3.7 and an 81 kpc
  // pericentre — and a button labelled "load published fit" that quietly loads
  // something else is worse than one that refuses.
  const clamped = [];
  const clamp = (v, lo, hi, name, unit = '') => {
    const c = Math.min(hi, Math.max(lo, v));
    if (Math.abs(c - v) > 1e-9) clamped.push(`${name} ${v.toFixed(2)}${unit} → ${c.toFixed(2)}${unit}`);
    return c;
  };

  if (Number.isFinite(fit.massRatio)) {
    // the search allowed ratios up to 889, which are not encounters of two
    // comparable galaxies; invert so the primary is always the heavier
    const mr = fit.massRatio > 1 ? 1 / fit.massRatio : fit.massRatio;
    spec.massRatio = clamp(mr, 0.05, 1, 'mass ratio');
    mapped.push('massRatio');
  } else spec.massRatio = 1.0;

  if (Number.isFinite(fit.rMin_kpc)) {
    spec.rPeri = clamp(fit.rMin_kpc, 0.3, 20, 'pericentre', ' kpc');
    mapped.push('rMin -> rPeri');
  } else spec.rPeri = 4.0;

  if (Number.isFinite(fit.ecc)) {
    spec.ecc = clamp(fit.ecc, 0.4, 2.0, 'eccentricity');
    mapped.push('ecc');
  } else spec.ecc = 1.0;

  // t_min is the epoch we want to LOOK at, not where the run starts. Start well
  // before pericentre and integrate forward to it.
  let viewTime = 0;
  if (Number.isFinite(fit.tMin_Myr)) {
    viewTime = timeFromMyr(Math.min(1200, Math.max(0, fit.tMin_Myr)));
    mapped.push('tMin -> view epoch');
  }
  spec.tStart = -Math.max(18, viewTime * 0.9);

  const notes = [
    'Published fit used JSPAM’s potential and disc model, not this engine’s. The numbers transfer; the result does not.',
    'Disc orientations are yours to set — they are not in the mapped fit.',
    '“beta” is not mapped: its convention has not been read from the paper.',
    'Table 4 Min/Max are search bounds, not uncertainties. Only ± is a spread.',
  ];
  if (clamped.length) {
    notes.unshift(`CLAMPED to this engine’s range — this is no longer the published fit: ${clamped.join('; ')}.`);
  }
  return { spec, viewTime, mapped, unmapped: UNMAPPED, clamped, notes };
}

/** Human-readable rows for the parameter table, with ± kept distinct from bounds. */
export function fitRows(fit) {
  if (!fit) return [];
  const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
  const pm = (v, e, d = 2) => (Number.isFinite(v)
    ? `${v.toFixed(d)}${Number.isFinite(e) ? ` ± ${e.toFixed(d)}` : ''}` : '—');
  return [
    { k: 'Mass ratio', v: pm(fit.massRatio, fit.massRatio_err), mapped: true },
    { k: 'Pericentre', v: pm(fit.rMin_kpc, fit.rMin_err, 1) + ' kpc', mapped: true },
    { k: 'Since pericentre', v: pm(fit.tMin_Myr, fit.tMin_err, 0) + ' Myr', mapped: true },
    { k: 'Eccentricity', v: pm(fit.ecc, fit.ecc_err), mapped: true },
    { k: 'beta', v: pm(fit.beta, fit.beta_err), mapped: false },
  ];
}
