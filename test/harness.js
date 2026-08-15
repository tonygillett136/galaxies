/**
 * Minimal test harness. Runs in the browser so the same suite can exercise the
 * CPU reference and the WebGPU path, which is the point: the thing that ships is
 * the GPU code, so the GPU code is what has to be asserted.
 */

const results = [];
let currentGroup = 'ungrouped';
let expectedTotal = 0;

export function group(name) { currentGroup = name; }

/**
 * Declare how many checks this suite intends to run.
 *
 * This exists because the suite has already reported "all green" twice while
 * silently running a fraction of its checks: once when an un-awaited async check
 * let report() fire first, and once in the benchmark when invalid bind groups
 * made every dispatch a no-op. Both times the output was indistinguishable from
 * success. A pass rate cannot detect missing tests. Only a count can.
 */
export function expectChecks(n) { expectedTotal += n; }

/**
 * The DECLARED total. README quotes this rather than a hand-counted number, and
 * report() already fails the build when the actual count differs from it, so the
 * figure in the documentation is guarded at both ends.
 */
export function expectedCount() { return expectedTotal; }

export function check(name, fn) {
  const t0 = performance.now();
  try {
    const detail = fn();
    results.push({ group: currentGroup, name, pass: true, detail: detail ?? '', ms: performance.now() - t0 });
  } catch (e) {
    results.push({ group: currentGroup, name, pass: false, detail: e.message, ms: performance.now() - t0 });
  }
}

export async function checkAsync(name, fn) {
  const t0 = performance.now();
  try {
    const detail = await fn();
    results.push({ group: currentGroup, name, pass: true, detail: detail ?? '', ms: performance.now() - t0 });
  } catch (e) {
    results.push({ group: currentGroup, name, pass: false, detail: e.message, ms: performance.now() - t0 });
  }
}

// --- assertions. Every failure message carries the actual numbers, because a
// bare "assertion failed" costs a debugging round trip every single time. ---

export function close(actual, expected, tol, what = 'value') {
  const err = Math.abs(actual - expected);
  const rel = Math.abs(expected) > 1e-30 ? err / Math.abs(expected) : err;
  if (!(rel <= tol)) {
    throw new Error(`${what}: got ${actual.toPrecision(10)}, expected ${expected.toPrecision(10)}, rel err ${rel.toExponential(3)} > ${tol}`);
  }
  return `${what} rel err ${rel.toExponential(2)}`;
}

export function below(actual, limit, what = 'value') {
  if (!(actual <= limit)) throw new Error(`${what}: ${actual.toExponential(4)} exceeds limit ${limit.toExponential(4)}`);
  return `${what} = ${actual.toExponential(2)} (limit ${limit.toExponential(2)})`;
}

export function above(actual, limit, what = 'value') {
  if (!(actual >= limit)) throw new Error(`${what}: ${actual.toExponential(4)} is below required ${limit.toExponential(4)}`);
  return `${what} = ${actual.toExponential(2)} (required >= ${limit.toExponential(2)})`;
}

export function ok(cond, message) {
  if (!cond) throw new Error(message);
  return message;
}

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);

export function report(el) {
  const groups = [...new Set(results.map((r) => r.group))];
  const failed = results.filter((r) => !r.pass);
  let s = '';
  for (const g of groups) {
    s += `\n${g}\n`;
    for (const r of results.filter((x) => x.group === g)) {
      s += `  ${r.pass ? 'PASS' : 'FAIL'}  ${r.name.padEnd(58)} ${r.detail}\n`;
    }
  }
  s += `\n${results.length - failed.length}/${results.length} passed`;
  s += failed.length ? `, ${failed.length} FAILED` : ', all green';

  const missing = expectedTotal - results.length;
  if (expectedTotal && missing !== 0) {
    s += `\n\n** CHECK COUNT MISMATCH: expected ${expectedTotal}, ran ${results.length}`
       + ` (${missing > 0 ? missing + ' never ran' : (-missing) + ' unexpected'}).`
       + `\n** A suite that skips checks reports exactly like a suite that passes them.`;
  }
  const bad = failed.length > 0 || (expectedTotal && missing !== 0);
  s += `\nRESULT: ${bad ? 'FAIL' : 'PASS'}\n`;
  if (el) el.textContent = s;
  globalThis.__testResults = {
    total: results.length, expected: expectedTotal, failed: failed.length,
    complete: missing === 0, results,
  };
  return s;
}
