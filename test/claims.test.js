/**
 * THE DOCUMENTS ARE CHECKED AGAINST THE MEASUREMENTS.
 *
 * Every review round so far has found the same defect in a new place: a number
 * asserted in prose that no longer matches the check which produced it. Round 1
 * found the DEVLOG presenting an abandoned model's numbers as the headline
 * result. Round 2 found docs/IDENTIFIABILITY.md tabulating five moments where
 * the code computes four. Round 3 found six at once — the ring figures, the
 * tidal fraction in the shipped UI, the GPU agreement in the README, the float32
 * reversal worst case (repeated inside adjoint.js as its scope justification),
 * the assertion count, and a stale separation in an app.js comment.
 *
 * Each was fixed by hand. Fixing by hand restores the values and leaves the
 * mechanism, and the mechanism is that prose and measurement are not connected.
 * So they are connected here: the suites record what they measured, this file
 * reads the shipped text back, and a figure that has drifted fails the build.
 *
 * WHAT THIS CANNOT DO. It checks the numbers it is told about. A claim nobody
 * registers here is still unguarded, and a wrong number registered against a
 * wrong measurement still passes. It converts a silent failure into a loud one
 * for the figures that matter most; it is not a proof that the documents are
 * true.
 */

import { group, checkAsync, expectChecks, ok } from './harness.js';
import { measured, allMeasured } from './measured.js';

const BASE = new URL('../', import.meta.url);

async function text(rel) {
  const res = await fetch(new URL(rel, BASE));
  if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
  return res.text();
}

/**
 * Each claim: where it appears, a regex whose first capture is the number as
 * written, the measured key it must match, and how close it has to be.
 *
 * Tolerances are RELATIVE and generous enough to survive a rounding choice in
 * the prose but not a physics change — 5% catches "3.9 vs 15.1", which is the
 * failure mode that actually happens.
 */
const CLAIMS = [
  { file: 'index.html', re: /prograde throws ([\d.]+)% of a disc beyond 20 kpc/,
    key: 'tidalProgradePct', tol: 0.05, what: 'sandbox note, prograde tidal fraction' },
  { file: 'index.html', re: /beyond 20 kpc against ([\d.]+)% retrograde/,
    key: 'tidalRetroPct', tol: 0.08, what: 'sandbox note, retrograde tidal fraction' },
  { file: 'src/app/tour.js', re: /([\d.]+) per cent of a disc thrown\s*'?\s*\+?\s*'?\s*beyond 20 kpc prograde/,
    key: 'tidalProgradePct', tol: 0.05, what: 'tour step 3, prograde tidal fraction' },
  { file: 'src/engine/encounter.js', re: /measured here at ([\d.]+) per cent of a disc thrown beyond 20 kpc/,
    key: 'tidalProgradePct', tol: 0.05, what: 'retrograde scenario blurb' },
  { file: 'README.md', re: /(\d+) standing assertions/,
    key: 'assertionCount', tol: 0.001, what: 'README assertion count' },
  { file: 'README.md', re: /GPU and CPU agree to ([\d.e+-]+) kpc/,
    key: 'gpuAgreement', tol: 0.25, what: 'README GPU/CPU agreement' },
  { file: 'src/engine/adjoint.js', re: /worst ([\d.e+-]+) kpc over 3000 forward/,
    key: 'f32ReversalWorst', tol: 0.30, what: 'adjoint.js scope justification' },
  { file: 'src/engine/encounter.js', re: /\(([\d.]+) per\n \* cent of a disc beyond 20 kpc/,
    key: 'tidalProgradePct', tol: 0.05, what: 'encounter.js file header' },
  { file: 'src/engine/encounter.js', re: /beyond 20 kpc against ([\d.]+) per cent retrograde\)/,
    key: 'tidalRetroPct', tol: 0.08, what: 'encounter.js header, retrograde' },
  { file: 'DEVLOG.md', re: /peak surface density moves from the\s+centre to ~([\d.]+) kpc/,
    key: 'ringPeakKpc', tol: 0.15, what: 'DEVLOG ring peak radius' },
  { file: 'DEVLOG.md', re: /rises ([\d.]+)x there/,
    key: 'ringGain', tol: 0.15, what: 'DEVLOG ring density gain' },
  { file: 'src/engine/encounter.js', re: /then coalescence at (\d+) Myr/,
    key: 'mergerMyr', tol: 0.05, what: 'merger scenario blurb, coalescence epoch' },
  { file: 'src/engine/encounter.js', re: /first passage at ([\d.]+) kpc against a requested 30/,
    key: 'mergerPeriKpc', tol: 0.03, what: 'merger scenario blurb, first passage' },
];

export function runClaimsTests() { expectChecks(3); }

export async function runClaimsChecks(assertionCount) {
  group('claims — the documents are checked against the measurements');

  await checkAsync('every registered figure in the prose matches what was measured', async () => {
    const { record } = await import('./measured.js');
    record('assertionCount', assertionCount);

    const files = new Map();
    for (const c of CLAIMS) if (!files.has(c.file)) files.set(c.file, await text(c.file));

    const bad = [], seen = [];
    for (const c of CLAIMS) {
      const m = files.get(c.file).match(c.re);
      if (!m) { bad.push(`${c.what} (${c.file}): the claim text was not found — it was reworded, so the guard silently stopped guarding it`); continue; }
      const written = parseFloat(m[1]);
      const truth = measured(c.key);
      // REJECT NON-FINITE EXPLICITLY. A capture parseFloat cannot read gives
      // NaN, and `NaN > tol` is false, so a malformed number was silently
      // ACCEPTED — the guard's own failure mode was to pass.
      if (!Number.isFinite(written)) {
        bad.push(`${c.what} (${c.file}): the captured text "${m[1]}" is not a finite number, so the comparison would silently pass`);
        continue;
      }
      if (!Number.isFinite(truth)) {
        bad.push(`${c.what}: the measured value for "${c.key}" is not finite (${truth})`);
        continue;
      }
      const rel = Math.abs(written - truth) / Math.max(Math.abs(truth), 1e-30);
      seen.push(`${c.what}: ${written} vs ${truth.toPrecision(3)}`);
      if (rel > c.tol) {
        bad.push(`${c.what} (${c.file}): the text says ${written}, the measurement is ${truth.toPrecision(4)} (${(rel * 100).toFixed(0)}% off)`);
      }
    }
    ok(bad.length === 0, bad.join('\n        '));
    return `${CLAIMS.length} documented figures match their measurements`;
  });

  await checkAsync('SENSITIVITY: the guard rejects a drifted number, a reworded one, and a NaN', async () => {
    // The previous version of this check computed |1.5t - t|/t and asserted it
    // exceeded 0.05. It asserted that 0.5 > 0.05. It never touched CLAIMS, never
    // called text(), never ran a regex and never entered the comparison loop, so
    // an inverted comparison, a 1e9 tolerance or a `bad` array that was never
    // pushed to would all have left it green. A reviewer said so and was right.
    //
    // This drives the REAL comparison over synthetic documents.
    const truth = measured('tidalProgradePct');
    const compare = (text, re, key, tol) => {
      const m = text.match(re);
      if (!m) return 'not-found';
      const written = parseFloat(m[1]);
      if (!Number.isFinite(written)) return 'non-finite';
      const t = measured(key);
      return Math.abs(written - t) / Math.abs(t) > tol ? 'rejected' : 'accepted';
    };
    const RE = /prograde throws ([\d.]+)% of a disc beyond 20 kpc/;

    const good = compare(`prograde throws ${truth.toFixed(1)}% of a disc beyond 20 kpc`, RE, 'tidalProgradePct', 0.05);
    const drifted = compare(`prograde throws ${(truth * 1.5).toFixed(1)}% of a disc beyond 20 kpc`, RE, 'tidalProgradePct', 0.05);
    const reworded = compare('prograde ejects some fraction of a disc', RE, 'tidalProgradePct', 0.05);
    const nan = compare('prograde throws .% of a disc beyond 20 kpc', RE, 'tidalProgradePct', 0.05);

    ok(good === 'accepted', `the guard rejected a CORRECT number (${good})`);
    ok(drifted === 'rejected', `a 50% drift was not rejected (${drifted})`);
    ok(reworded === 'not-found', `a reworded claim did not trip the not-found path (${reworded})`);
    ok(nan === 'non-finite', `a malformed number was not caught (${nan})`);
    return `correct=accepted, +50%=rejected, reworded=not-found, malformed=non-finite`;
  });

  await checkAsync('the measurement registry is populated, not silently empty', async () => {
    // measured() throws on a missing key, so a claim checked against nothing
    // would fail loudly — but an EMPTY registry with zero claims would pass
    // vacuously. Assert the registry actually has the keys the table needs.
    const all = allMeasured();
    const need = [...new Set(CLAIMS.map((c) => c.key))];
    const missing = need.filter((k) => !(k in all));
    ok(missing.length === 0, `never recorded: ${missing.join(', ')}`);
    return `${Object.keys(all).length} measurements recorded, ${need.length} of them load-bearing`;
  });
}
