/**
 * Measured values, recorded by the suites that measure them.
 *
 * WHY THIS EXISTS
 *
 * Three review rounds found the same failure in a different place each time: a
 * number in prose that no longer matches the check that produced it. Round 3
 * counted six confirmed mismatches at once, across DEVLOG, REVIEW_LOG, README,
 * the shipped UI, an in-code comment and four screenshots. Every previous fix
 * was a manual sweep, which restores the values and leaves the mechanism intact
 * — and the mechanism is that prose and measurement are not connected.
 *
 * So: the suite that measures a headline figure records it here, and
 * claims.test.js reads the prose back and fails the build on drift. A physics
 * change that moves a number now breaks a test instead of quietly making the
 * documents wrong.
 *
 * The governing rule from the project's own check table — recompute numbers from
 * the final state as the last step — becomes something the build enforces rather
 * than something I have to remember.
 */

const values = new Map();

export function record(key, value) { values.set(key, value); }
export function measured(key) {
  if (!values.has(key)) throw new Error(`no measurement recorded for "${key}"`);
  return values.get(key);
}
export function allMeasured() { return Object.fromEntries(values); }
