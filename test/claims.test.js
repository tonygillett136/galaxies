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
 * ROUND 7 found it here, in this file's own header: the inventory below used to
 * quote the README's frame rate as "16.6-16.7 ms median, 59.9-60.2 fps". The
 * README's table moved and this did not — the disclosure about an unregistered
 * figure had itself gone stale, which is the same failure one level out. It now
 * names the claim without quoting it.
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
 *
 * DELIBERATELY NOT REGISTERED, and named so the omission is a decision rather
 * than an oversight:
 *
 *   - THE FRAME RATE, i.e. the table in README.md. Deliberately cited by name
 *     rather than by value, because quoting it here is how this very paragraph
 *     went stale. It is a manual measurement of the full application over 150
 *     frames at a stated resolution, and no automated suite reproduces it.
 *     Registering it against a hardcoded literal would make the guard compare the
 *     document to a number someone typed — which looks guarded and is not, and is
 *     the exact failure this file exists to prevent. Round 6 changed it to 166 ms
 *     and nothing objected; that remains true. Round 7 showed the sharper cost:
 *     the table was "corrected" from 60 fps to 31-46 fps on measurements taken
 *     while six other WebGPU tabs were on the same GPU, and nothing caught it.
 *     An unregistered figure can be corrected in the WRONG DIRECTION silently.
 *   - Anything in `src/app` or `src/render`, which no headless check reaches.
 *
 * Registering a figure against a value invented for the purpose is worse than
 * leaving it unregistered, because it converts a known gap into a false
 * assurance.
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
  // Round 9. The prose used to say spin "matters more than how close the
  // encounter is", comparing a measured 6x against a pericentre dependence
  // nobody had ever run. The replacement is an exchange rate, and it appears in
  // three documents and one shipped blurb, so all four are registered here.
  { file: 'docs/GUIDE.md', re: /out to \*\*([\d.]+) kpc\*\*, nearly twice as far/,
    key: 'spinEquivPeriKpc', tol: 0.05, what: 'GUIDE, pericentre equivalent to a spin flip' },
  { file: 'src/engine/encounter.js', re: /reached prograde only at a ([\d.]+) kpc pericentre/,
    key: 'spinEquivPeriKpc', tol: 0.05, what: 'retrograde blurb, spin/distance exchange rate' },
  { file: 'film/youtube_description.txt', re: /25 to ([\d.]+) kiloparsecs/,
    key: 'spinEquivPeriKpc', tol: 0.05, what: 'film description, spin/distance exchange rate' },
  { file: 'README.md', re: /GPU and CPU agree to ([\d.e+-]+) kpc/,
    key: 'gpuAgreement', tol: 0.25, what: 'README GPU/CPU agreement' },
  { file: 'src/engine/adjoint.js', re: /worst ([\d.e+-]+) kpc over 3000 forward/,
    key: 'f32ReversalWorst', tol: 0.30, what: 'adjoint.js scope justification' },
  // Round 7: the README said 4e-10 here, a figure produced by no check in the
  // tree and 550x better than the code measures. Registered so the next drift
  // fails the build instead of being read by a reader.
  { file: 'README.md', re: /worst relative error of ([\d.e+-]+) over 15 components/,
    key: 'adjointFdWorst', tol: 0.50, what: 'README adjoint finite-difference agreement' },
  { file: 'src/engine/encounter.js', re: /\(([\d.]+) per\n \* cent of a disc beyond 20 kpc/,
    key: 'tidalProgradePct', tol: 0.05, what: 'encounter.js file header' },
  { file: 'src/engine/encounter.js', re: /beyond 20 kpc against ([\d.]+) per cent retrograde\)/,
    key: 'tidalRetroPct', tol: 0.08, what: 'encounter.js header, retrograde' },
  { file: 'DEVLOG.md', re: /peak surface density moves from the\s+centre to ~([\d.]+) kpc/,
    key: 'ringPeakKpc', tol: 0.15, what: 'DEVLOG ring peak radius' },
  { file: 'DEVLOG.md', re: /rises ([\d.]+)x there/,
    key: 'ringGain', tol: 0.15, what: 'DEVLOG ring density gain' },
  { file: 'src/engine/encounter.js', re: /within 5 kpc — well inside both discs — at (\d+) Myr/,
    key: 'mergerMyr', tol: 0.05, what: 'merger scenario blurb, coalescence epoch' },
  { file: 'src/engine/encounter.js', re: /first passage at ([\d.]+) kpc against a requested 30/,
    key: 'mergerPeriKpc', tol: 0.03, what: 'merger scenario blurb, first passage' },
  // docs/IDENTIFIABILITY.md — the file round 2 AND round 4 caught with stale
  // figures, in a document headed "Verified, not argued". Registering it is the
  // whole point: it had a sentence telling the reader to regenerate the table,
  // and the table went stale anyway.
  { file: 'docs/IDENTIFIABILITY.md', re: /\| λ = 1 \| ([\d.]+) \|/,
    key: 'meanR', tol: 0.01, what: 'IDENTIFIABILITY mass-epoch mean radius' },
  { file: 'docs/IDENTIFIABILITY.md', re: /\| λ = 1 \| [\d.]+ \| ([\d.]+) \|/,
    key: 'rmsR', tol: 0.01, what: 'IDENTIFIABILITY mass-epoch rms radius' },
  { file: 'docs/IDENTIFIABILITY.md', re: /\| λ = 1 \| [\d.]+ \| [\d.]+ \| ([\d.]+) \|/,
    key: 'maxR', tol: 0.01, what: 'IDENTIFIABILITY mass-epoch max radius' },
  { file: 'docs/IDENTIFIABILITY.md', re: /\| λ = 1 \| [\d.]+ \| [\d.]+ \| [\d.]+ \| ([\d.]+) \|/,
    key: 'sepR', tol: 0.01, what: 'IDENTIFIABILITY mass-epoch separation' },
  { file: 'docs/IDENTIFIABILITY.md', re: /rescaling: \*\*([\d.e+-]+)\*\*/,
    key: 'massEpochInvariance', tol: 0.5, what: 'IDENTIFIABILITY invariance' },
  { file: 'docs/IDENTIFIABILITY.md', re: /differs by \*\*(\d+) per cent\*\*/,
    key: 'massEpochControlPct', tol: 0.05, what: 'IDENTIFIABILITY control' },
  { file: 'src/engine/encounter.js', re: /(\d+) outside by ratio and \d+ inside-disc: (?:\d+) of \d+ outside the model/,
    key: 'catalogueOutsideByRatio', tol: 0.001, what: 'domainOfValidity docstring, outside-by-ratio count' },
  { file: 'src/engine/encounter.js', re: /inside-disc: (\d+) of \d+ outside the model/,
    key: 'catalogueOutside', tol: 0.001, what: 'domainOfValidity docstring, total outside' },
  { file: 'src/engine/encounter.js', re: /across the (\d+)\n \* Galaxy Zoo systems with a published fit/,
    key: 'catalogueN', tol: 0.001, what: 'encounter.js catalogue size' },
  // Round 6 made the README frame rate 10x wrong and replaced five DEVLOG
  // morphology figures with nonsense; both survived, because neither was
  // registered. A guard covers what it is told about and nothing else.
  { file: 'DEVLOG.md', re: /Prograde tidal fraction\n3\.9% → \*\*([\d.]+)%\*\*/,
    key: 'tidalProgradePct', tol: 0.06, what: 'DEVLOG prograde tidal fraction' },
  { file: 'DEVLOG.md', re: /retrograde zero → \*\*([\d.]+)%\*\*/,
    key: 'tidalRetroPct', tol: 0.10, what: 'DEVLOG retrograde tidal fraction' },
];

/**
 * THE comparison, in one place, called by the real check AND by the sensitivity
 * check.
 *
 * Round 4 rewrote the sensitivity check "to drive the real comparison" and gave
 * it a seven-line private copy instead, under a comment saying it drove the real
 * one. Round 5 proved the consequence: neutering the live loop AND drifting the
 * headline physics figure in index.html from 15.1% to 99.9% — a 580% error in a
 * sentence users read — still gave 75/75 green with the sensitivity check
 * passing. Two rounds running, the fix for "the guard cannot fail" could not fail.
 *
 * A private copy is not a test of the thing it copies. There is one function now.
 */
/**
 * A LEDGER OF WORK ACTUALLY DONE, kept inside the comparison itself.
 *
 * Round 7 defeated the round-6 canary in one line:
 *
 *   const r = c === CANARY ? compareClaim(files.get(c.file), c) : { status: 'accepted' };
 *
 * The canary still went through the real comparison and was still rejected, so
 * the canary was satisfied — while all 24 real claims were routed around it and
 * a shipped figure could be 6.6x wrong with the suite fully green. A canary
 * proves the loop ran for the CANARY. It cannot prove the loop ran for anything
 * else, and asserting on its verdict alone is asserting on one row.
 *
 * So the ledger lives here, in the function a bypass must skip in order to work.
 * Skipping the call is what the bypass IS, so the entry never appears and the
 * count assertion fires. Verified by mutation, not by argument.
 */
export const evaluated = [];

export function compareClaim(text, claim) {
  const out = compareClaimInner(text, claim);
  // RECORD THE MATCHED TEXT, not just the identity of the claim.
  //
  // Round 8 pre-seeded this ledger straight from CLAIMS —
  // `evaluated = CLAIMS.map((c) => ({file: c.file, key: c.key, status: 'accepted'}))` —
  // which satisfied both ledger assertions before a single comparison had run,
  // and combined with round 7's bypass shipped a 6.6x-wrong figure green. An
  // entry that can be constructed from CLAIMS alone proves nothing about CLAIMS
  // having been compared. `matched` is a substring of the fetched document, so
  // it cannot be manufactured from the table, and the check asserts exactly that.
  const m = typeof text === 'string' ? text.match(claim.re) : null;
  evaluated.push({ file: claim.file, key: claim.key, status: out.status, matched: m ? m[0] : null });
  return out;
}

function compareClaimInner(text, claim) {
  const m = text.match(claim.re);
  if (!m) return { status: 'not-found' };
  const written = parseFloat(m[1]);
  if (!Number.isFinite(written)) return { status: 'non-finite', written: m[1] };
  const truth = measured(claim.key);
  if (!Number.isFinite(truth)) return { status: 'bad-measurement', truth };
  const rel = Math.abs(written - truth) / Math.max(Math.abs(truth), 1e-30);
  return { status: rel > claim.tol ? 'rejected' : 'accepted', written, truth, rel };
}

export function runClaimsTests() { expectChecks(3); }

export async function runClaimsChecks(assertionCount) {
  group('claims — the documents are checked against the measurements');

  await checkAsync('every registered figure in the prose matches what was measured', async () => {
    const { record } = await import('./measured.js');
    record('assertionCount', assertionCount);

    const files = new Map();
    for (const c of CLAIMS) if (!files.has(c.file)) files.set(c.file, await text(c.file));

    // A FLOOR ON THE TABLE ITSELF. Round 5 emptied CLAIMS and got a green
    // "0 documented figures match their measurements" — all three claims checks
    // derive their expectations from CLAIMS, so deleting the table satisfies all
    // of them. The project already solved exactly this for check counts with
    // expectChecks(); the claims table had no equivalent.
    ok(CLAIMS.length >= 20,
      `the CLAIMS table has shrunk to ${CLAIMS.length} entries — figures were removed rather than fixed`);

    // A CANARY, evaluated through the SAME loop as everything else.
    //
    // For four consecutive rounds this check has been neuterable in one line:
    // replace the comparison with {status:'accepted'} and every document can be
    // arbitrarily wrong while the suite reports "22 documented figures match".
    // A separate sensitivity check cannot fix that, because it exercises a
    // different call site — which is exactly the defect it kept being rewritten
    // to fix.
    //
    // So the live loop carries a claim that MUST be rejected. If the loop is
    // disabled, short-circuited, or its tolerance widened, the canary stops
    // being rejected and THIS check fails. The guard now verifies itself.
    const truth = measured('tidalProgradePct');
    const CANARY = { file: '__canary__', key: 'tidalProgradePct', tol: 0.05,
      what: 'canary', re: /canary ([\d.]+)%/ };
    files.set('__canary__', `canary ${(truth * 3).toFixed(2)}%`);

    const bad = [];
    for (const c of [...CLAIMS, CANARY]) {
      const r = compareClaim(files.get(c.file), c);
      if (c === CANARY) {
        ok(r.status === 'rejected',
          `THE CANARY WAS NOT REJECTED (status "${r.status}"). A deliberately 3x-wrong figure `
          + 'passed the live comparison, so the comparison is not running and every other '
          + 'figure in this check is unverified.');
        continue;
      }
      if (r.status === 'not-found') {
        bad.push(`${c.what} (${c.file}): the claim text was not found — it was reworded, so the guard silently stopped guarding it`);
      } else if (r.status === 'non-finite') {
        bad.push(`${c.what} (${c.file}): the captured text "${r.written}" is not a finite number, so the comparison would silently pass`);
      } else if (r.status === 'bad-measurement') {
        bad.push(`${c.what}: the measured value for "${c.key}" is not finite (${r.truth})`);
      } else if (r.status === 'rejected') {
        bad.push(`${c.what} (${c.file}): the text says ${r.written}, the measurement is ${r.truth.toPrecision(4)} (${(r.rel * 100).toFixed(0)}% off)`);
      }
    }
    ok(bad.length === 0, bad.join('\n        '));

    // THE LEDGER. Every claim must have gone THROUGH compareClaim, and the
    // evidence has to be something only the real comparison could produce.
    //
    // Round 8 defeated the first version four ways, each keeping 79/79 green
    // while shipping a wrong figure. All four are guarded here:
    //   (a) pre-seeding `evaluated` from CLAIMS         -> `matched` must be real document text
    //   (b) laundering a rejection through the return   -> the recorded STATUS is asserted
    //   (c) widening ONE claim's declared tolerance     -> tolerances are bounded independently
    //   (d) discriminating probe text from real text    -> probes now use the real documents
    const seen = new Set(evaluated.map((e) => `${e.file}|${e.key}`));
    const missing = CLAIMS.filter((c) => !seen.has(`${c.file}|${c.key}`))
      .map((c) => `${c.what} (${c.file})`);
    ok(missing.length === 0,
      `${missing.length} registered claims never reached the comparison: ${missing.join('; ')}. `
      + 'They were iterated over but not evaluated, which is what a short circuit around the '
      + 'canary looks like.');

    // (a) UNFORGEABLE ENTRIES. Every ledger entry must quote text that actually
    // occurs in the file it names. A ledger built from CLAIMS cannot do this.
    const forged = evaluated.filter((e) => {
      if (e.file === '__canary__') return false;
      const src = files.get(e.file);
      // `matched` must have SUBSTANCE. The first version accepted any string a
      // src.includes() call would swallow — and src.includes('') is true for
      // every file, so a ledger preseeded with `matched: ''` sailed through the
      // check written to catch exactly that. An emptiness test is not a
      // provenance test.
      if (typeof e.matched !== 'string' || e.matched.length < 8) return true;
      if (!src || !src.includes(e.matched)) return true;
      // and it must carry the digits it claims to have compared
      return !/\d/.test(e.matched);
    }).map((e) => `${e.file}|${e.key}`);
    ok(forged.length === 0,
      `${forged.length} ledger entries do not quote text from the file they claim to have read `
      + `(${forged.join('; ')}) — the ledger was populated by something other than the comparison.`);

    // (b) THE RECORDED VERDICT IS LOAD-BEARING. It used to be written and never
    // read, so compareClaim could push the honest status and return a laundered
    // one. `bad` is now derived from the ledger, not from the loop's return value.
    const ledgerBad = evaluated.filter((e) => e.file !== '__canary__' && e.status !== 'accepted')
      .map((e) => `${e.what ?? e.key} (${e.file}): ${e.status}`);
    ok(ledgerBad.length === 0,
      `the comparison RECORDED ${ledgerBad.length} non-accepted results that the report did not `
      + `surface: ${ledgerBad.join('; ')} — a verdict was laundered between comparison and report.`);
    const canaryEntries = evaluated.filter((e) => e.file === '__canary__');
    ok(canaryEntries.length >= 1 && canaryEntries.every((e) => e.status === 'rejected'),
      'the canary is missing from the ledger or was not recorded as rejected');
    ok(evaluated.length >= CLAIMS.length + 1,
      `the comparison ran ${evaluated.length} times for ${CLAIMS.length} claims plus a canary — `
      + 'fewer evaluations than claims means the loop was short-circuited');

    // (c) THE TOLERANCES ARE BOUNDED HERE, not by themselves.
    //
    // The round-7 probe derived its own bounds from `c.tol` and compared them
    // against a comparison that also used `c.tol` — it tested each tolerance
    // against itself and agreed by construction for ANY value. Widening one
    // entry from 0.05 to 0.60 shipped a 53%-wrong figure green while the check
    // printed "each at its own declared tolerance". This needs no adversary:
    // it is what anyone does to turn a red build green.
    const LOOSE_ALLOWED = 2;          // massEpochInvariance and the adjoint FD figure
    const loose = CLAIMS.filter((c) => c.tol > 0.30).map((c) => `${c.what} (${c.tol})`);
    ok(CLAIMS.every((c) => c.tol <= 0.50),
      'a claim tolerance exceeds 0.50: ' + CLAIMS.filter((c) => c.tol > 0.5).map((c) => c.what).join('; '));
    ok(loose.length <= LOOSE_ALLOWED,
      `${loose.length} claims carry a tolerance above 30% (${loose.join('; ')}), and only `
      + `${LOOSE_ALLOWED} are sanctioned. Widening a tolerance to make a build pass unguards that `
      + 'figure permanently; raising this ceiling has to be a deliberate, visible edit.');

    // (d) THE PROBE RUNS ON THE REAL DOCUMENTS, at a magnitude fixed HERE rather
    // than derived from the tolerance being audited. Round 8 defeated the
    // synthetic-text probe with a one-line predicate on the input; the probe now
    // traverses the same text, the same call site and the same ledger as the
    // live claims, so no predicate can separate them.
    const blunt = [];
    for (const c of CLAIMS) {
      const truth = measured(c.key);
      const src = files.get(c.file);
      if (!Number.isFinite(truth) || truth === 0 || !src) continue;
      const m = src.match(c.re);
      if (!m) continue;
      // The substitute must keep the SHAPE the regex expects — writing "531.000"
      // where the pattern captures (\d+) makes the match fail rather than the
      // comparison reject, which reports as a pass and is exactly the kind of
      // false green this file exists to stop.
      const wrong = truth * 3;                        // 200% off: outside every sanctioned tolerance
      const wrongStr = /^\d+$/.test(m[1]) ? String(Math.max(1, Math.round(wrong))) : wrong.toPrecision(4);
      const doctored = src.replace(m[0], m[0].replace(m[1], wrongStr));
      if (doctored === src) continue;
      const probe = compareClaim(doctored, c);
      if (probe.status === 'not-found') {
        blunt.push(`${c.what}: the doctored probe did not re-match, so this claim's guard could `
          + 'not be exercised at all');
      } else if (probe.status !== 'rejected') {
        blunt.push(`${c.what}: a 3x-wrong figure (${wrongStr}) was ACCEPTED at tol ${c.tol}`
          + ` — the comparison read ${probe.written} against a measurement of ${probe.truth}`);
      }
    }
    ok(blunt.length === 0,
      'the comparison accepts a figure three times the measured value for: ' + blunt.join('; ')
      + ' — that claim is not guarded whatever its declared tolerance says');

    return `${CLAIMS.length} documented figures match their measurements; ${evaluated.length} `
         + 'evaluations on the ledger, each quoting real document text, each recorded verdict '
         + 'asserted, and every claim seen to REJECT a 3x-wrong figure in its own file';
  });

  await checkAsync('SENSITIVITY: the guard rejects a drift, a rewording and a malformed number', async () => {
    // Calls compareClaim — THE function the live check calls, not a copy of it.
    // Round 4's version declared its own seven-line comparison under a comment
    // claiming it drove the real one; round 5 showed the real loop could be
    // neutered entirely with this still green.
    const c = CLAIMS[0];
    const truth = measured(c.key);
    const doc = (n) => `prograde throws ${n}% of a disc beyond 20 kpc`;

    const good = compareClaim(doc(truth.toFixed(1)), c).status;
    const drifted = compareClaim(doc((truth * 1.5).toFixed(1)), c).status;
    const reworded = compareClaim('prograde ejects some fraction of a disc', c).status;
    const nan = compareClaim(doc('.'), c).status;

    ok(c.key === 'tidalProgradePct' && /prograde throws/.test(String(c.re)),
      'CLAIMS[0] is no longer the tidal-fraction claim this check is written against');
    ok(good === 'accepted', `the guard rejected a CORRECT number (${good})`);
    ok(drifted === 'rejected', `a 50% drift was not rejected (${drifted})`);
    ok(reworded === 'not-found', `a reworded claim did not trip the not-found path (${reworded})`);
    ok(nan === 'non-finite', `a malformed number was not caught (${nan})`);
    return 'correct=accepted, +50%=rejected, reworded=not-found, malformed=non-finite — via compareClaim()';
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
