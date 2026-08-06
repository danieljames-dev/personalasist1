// NON-PRODUCTION BENCHMARK PROBE - Sprint 2.9 required workload evidence.
//
// NOT the AION canonicalizer. NOT CanonicalContractValidatorV1. NOT a fixture loader.
// NOT a conformance harness. NOT a security boundary. NOT proof of production readiness.
//
// Complements run.mjs (the Sprint 2.8 baseline, retained unchanged) by supplying the
// six size classes, six workload families, and boundary triples the DG-4 gate requires.
//
// Synthetic data only, from stable seeds. No personal data. No network. Node built-ins only.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import process from 'node:process';

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : null;

const RUNS = QUICK ? 3 : 9;
const WARMUP = QUICK ? 1 : 3;

const round = (n) => Math.round(n * 1000) / 1000;
function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const variance = s.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return {
    median: round(s[Math.floor(n / 2)]),
    p95: round(s[Math.min(n - 1, Math.floor(n * 0.95))]),
    worst: round(s[n - 1]),
    min: round(s[0]),
    stdDev: round(Math.sqrt(variance)),
  };
}

const totalMem = () => { const m = process.memoryUsage(); return m.heapUsed + m.external + m.arrayBuffers; };

const selfChecks = [];
function selfCheck(name, ok, detail) {
  selfChecks.push({ check: name, passed: Boolean(ok), detail });
  if (!ok) process.stdout.write(`  !! SELF-CHECK FAILED: ${name} - ${detail}\n`);
}

function measure(name, family, sizeClass, fn, opts = {}) {
  const { inputBytes = null, expectThrow = false, note = null, units = null, unitName = null } = opts;
  for (let i = 0; i < WARMUP; i++) { try { fn(); } catch { /* warmup */ } }

  const durations = [];
  let completed = 0, failureType = null, retain = null;
  if (globalThis.gc) globalThis.gc();
  let peakDelta = 0;

  for (let i = 0; i < RUNS; i++) {
    if (globalThis.gc) globalThis.gc();
    const base = totalMem();
    const t0 = process.hrtime.bigint();
    let threw = false, result;
    try { result = fn(); } catch (e) { threw = true; failureType = e?.constructor?.name ?? 'Error'; }
    const t1 = process.hrtime.bigint();
    retain = result;                       // keep alive across the sample
    const delta = totalMem() - base;
    if (delta > peakDelta) peakDelta = delta;
    durations.push(Number(t1 - t0) / 1e6);
    if (threw === expectThrow) completed++;
    retain = null;
  }
  void retain;

  const d = stats(durations);
  const amp = inputBytes && inputBytes >= 4096 ? round(peakDelta / inputBytes) : null;

  // Self-check: a probe that allocates a large output cannot show a near-zero delta.
  if (inputBytes && inputBytes >= 1048576 && !expectThrow && peakDelta === 0) {
    selfCheck(`${name}:nonzero-memory`, false, `input ${inputBytes}B but peak delta 0 - metric suspect`);
  }

  return {
    name, family, sizeClass, note,
    runs: RUNS, warmup: WARMUP,
    durationMs: d,
    opsPerSecond: d.median > 0 ? Math.round(1000 / d.median) : null,
    inputBytes,
    peakMemoryDeltaBytes: peakDelta,
    memoryAmplificationFactor: amp,
    unitsUnderTest: units, unitName,
    nsPerUnit: units ? round((d.median * 1e6) / units) : null,
    bytesPerUnit: units ? round(peakDelta / units) : null,
    completedAsExpected: completed,
    completionRate: round(completed / RUNS),
    failureType,
    cancellationLatencyMs: 'unavailable (no cancellable implementation exists)',
    cpuDurationMs: 'unavailable',
  };
}

// ---------------------------------------------------------------------------
// Iterative node counting - B-3. Recursion would exhaust the stack on the very
// shapes a node limit exists to reject, so the counter must be iterative.
// Counts: root, every scalar, every object, every array, recursively.
// Does NOT count: member names, punctuation, whitespace, tokens, bytes.
// ---------------------------------------------------------------------------
function countNodesIterative(root, cap = Number.MAX_SAFE_INTEGER) {
  let count = 0;
  const stack = [root];
  while (stack.length) {
    const v = stack.pop();
    count++;
    if (count > cap) return { count, exceeded: true };   // stop at the crossing node
    if (Array.isArray(v)) { for (let i = v.length - 1; i >= 0; i--) stack.push(v[i]); }
    else if (v && typeof v === 'object') { for (const k in v) stack.push(v[k]); }
  }
  return { count, exceeded: false };
}

function countNodesRecursive(v) {
  let n = 1;
  if (Array.isArray(v)) { for (const x of v) n += countNodesRecursive(x); }
  else if (v && typeof v === 'object') { for (const k in v) n += countNodesRecursive(v[k]); }
  return n;
}

// ---------------------------------------------------------------------------
// UTF-16 code-unit member ordering - ACJ-1 §2 / RFC 8785 §3.2.3
// ---------------------------------------------------------------------------
function utf16Compare(a, b) {
  // JavaScript strings ARE UTF-16 and < compares code units, so the default
  // relational operators already produce the required order. Array.prototype.sort()
  // with no comparator also compares UTF-16 code units. This is NOT true of every
  // runtime - see probe_python.py.
  return a < b ? -1 : a > b ? 1 : 0;
}
function codePointCompare(a, b) {
  const ai = [...a], bi = [...b];
  const n = Math.min(ai.length, bi.length);
  for (let i = 0; i < n; i++) {
    const d = ai[i].codePointAt(0) - bi[i].codePointAt(0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return ai.length - bi.length;
}

// ---------------------------------------------------------------------------
// Deterministic synthetic generators (stable seeds - no randomness)
// ---------------------------------------------------------------------------
const G = {
  nestArray: (d) => '['.repeat(d) + 'null' + ']'.repeat(d),
  wideObject: (m) => '{' + Array.from({ length: m }, (_, i) => `"m${i}":${i}`).join(',') + '}',
  largeArray: (e) => '[' + Array.from({ length: e }, (_, i) => i).join(',') + ']',
  manySmall: (c) => '[' + Array.from({ length: c }, () => '{"a":1}').join(',') + ']',
  longString: (b) => '{"s":"' + 'a'.repeat(b) + '"}',
  multibyte: (c) => '{"s":"' + '中'.repeat(c) + '"}',
  // Exactly N value nodes: array root (1) + N-1 scalars
  exactNodes: (n) => '[' + Array.from({ length: Math.max(0, n - 1) }, () => '0').join(',') + ']',
};

const results = [];
const push = (r) => {
  results.push(r);
  process.stdout.write(`  ${r.name.padEnd(44)} ${String(r.durationMs.median).padStart(9)} ms  ${String(r.sizeClass).padEnd(10)} amp ${r.memoryAmplificationFactor ?? '-'}\n`);
};

// ===========================================================================
// SIZE CLASSES x WORKLOAD FAMILIES
// ===========================================================================
const SIZE_CLASSES = QUICK
  ? [['minimal', 1], ['candidate', 4096]]
  : [['minimal', 1], ['small', 64], ['moderate', 1024], ['large', 65536], ['candidate', 4096]];

process.stdout.write('\nFAMILY 1: RAW PARSING (S0) x size classes\n');
for (const [cls, m] of SIZE_CLASSES) {
  const src = G.wideObject(m);
  push(measure(`f1.parse.wideObject(${m})`, 'raw-parsing', cls, () => JSON.parse(src),
    { inputBytes: src.length, units: m, unitName: 'member' }));
}

process.stdout.write('\nFAMILY 2: STRUCTURAL TRAVERSAL AND NODE COUNTING (S1)\n');
for (const [cls, n] of (QUICK ? [['moderate', 65536]] : [['moderate', 65536], ['large', 262144], ['candidate', 1048576]])) {
  const src = G.exactNodes(n);
  const v = JSON.parse(src);
  const r = measure(`f2.countNodes.iterative(${n})`, 'traversal', cls,
    () => countNodesIterative(v), { inputBytes: src.length, units: n, unitName: 'node' });
  const c = countNodesIterative(v);
  r.observedNodeCount = c.count;
  r.expectedNodeCount = n;
  selfCheck(`f2.nodeCount(${n})`, c.count === n, `expected ${n}, counted ${c.count}`);
  push(r);
}

// Node-limit boundary triple - the crossing node is materialized, counting stops there.
{
  const LIMIT = QUICK ? 4096 : 65536;
  const triple = {};
  for (const [label, n] of [['limitMinusOne', LIMIT - 1], ['atLimit', LIMIT], ['limitPlusOne', LIMIT + 1]]) {
    const v = JSON.parse(G.exactNodes(n));
    const res = countNodesIterative(v, LIMIT);
    triple[label] = { nodes: n, counted: res.count, exceeded: res.exceeded };
  }
  const ok = triple.limitMinusOne.exceeded === false
    && triple.atLimit.exceeded === false
    && triple.limitPlusOne.exceeded === true;
  selfCheck('f2.boundaryTriple', ok, JSON.stringify(triple));
  results.push({
    name: 'f2.nodeLimit.boundaryTriple', family: 'traversal', sizeClass: 'boundary',
    note: 'Inclusivity: below accepted, at accepted, above rejected. Counting stops at the crossing node.',
    limit: LIMIT, ...triple, runs: 1, warmup: 0,
  });
  process.stdout.write(`  ${'f2.nodeLimit.boundaryTriple'.padEnd(44)} limit=${LIMIT}  -1:${triple.limitMinusOne.exceeded} at:${triple.atLimit.exceeded} +1:${triple.limitPlusOne.exceeded}\n`);
}

// Iterative vs recursive - why the counter must be iterative.
{
  let recBreak = null, recOk = null, iterOk = null;
  for (const d of [1000, 4000, 8000, 16000, 64000]) {
    const v = JSON.parse(G.nestArray(d));
    try { countNodesRecursive(v); recOk = d; } catch { recBreak = d; break; }
  }
  for (const d of [8000, 64000, 200000]) {
    const v = JSON.parse(G.nestArray(d));
    try { countNodesIterative(v); iterOk = d; } catch { /* record below */ }
  }
  results.push({
    name: 'f2.counting.iterativeVsRecursive', family: 'traversal', sizeClass: 'adversarial',
    note: 'A recursive counter overflows on exactly the shapes a node limit exists to reject. B-3 therefore requires an iterative counter.',
    deepestRecursive: recOk, firstFailingRecursive: recBreak, deepestIterative: iterOk,
    runs: 1, warmup: 0,
  });
  selfCheck('f2.iterativeSurvivesDeeper', (iterOk ?? 0) > (recOk ?? 0),
    `iterative ${iterOk} vs recursive ${recOk}`);
  process.stdout.write(`  ${'f2.counting.iterativeVsRecursive'.padEnd(44)} recursive fails at ${recBreak}; iterative ok to ${iterOk}\n`);
}

process.stdout.write('\nFAMILY 3: MEMBER ORDERING AND SERIALIZATION PROXY (S3)\n');
{
  // The ordering divergence, measured in Node.
  const KEYS = ['￿', '\u{10000}', '', 'a'];
  const utf16 = [...KEYS].sort(utf16Compare);
  const codept = [...KEYS].sort(codePointCompare);
  const diverges = JSON.stringify(utf16) !== JSON.stringify(codept);
  const describe = (k) => ({
    codePoints: [...k].map((c) => '0x' + c.codePointAt(0).toString(16)),
    utf16CodeUnits: Array.from({ length: k.length }, (_, i) => '0x' + k.charCodeAt(i).toString(16)),
  });
  results.push({
    name: 'f3.ordering.utf16VsCodePoint.node', family: 'ordering', sizeClass: 'minimal',
    note: 'JavaScript strings ARE UTF-16 and default sort compares code units, so Node is conformant BY DEFAULT. Python is not - see probe_python.py. The divergence is real and runtime-specific.',
    keys: KEYS.map(describe),
    utf16Order: utf16.map(describe), codePointOrder: codept.map(describe),
    diverges, nodeDefaultIsConformant: JSON.stringify([...KEYS].sort()) === JSON.stringify(utf16),
    runs: 1, warmup: 0,
  });
  selfCheck('f3.orderingDiverges', diverges, 'UTF-16 and code-point orders must differ for these keys');
  process.stdout.write(`  ${'f3.ordering.utf16VsCodePoint.node'.padEnd(44)} diverges=${diverges}  nodeDefaultConformant=${JSON.stringify([...KEYS].sort()) === JSON.stringify(utf16)}\n`);

  // Sorting cost - the operation ACJ-1 §30 cites as justifying the member limit.
  for (const [cls, m] of (QUICK ? [['candidate', 4096]] : [['moderate', 1024], ['candidate', 4096], ['large', 65536]])) {
    const keys = Array.from({ length: m }, (_, i) => (i % 3 === 0 ? `k${i}\u{10000}` : `k${i}`));
    push(measure(`f3.sort.utf16(${m})`, 'ordering', cls, () => [...keys].sort(utf16Compare),
      { units: m, unitName: 'key', inputBytes: keys.reduce((a, k) => a + Buffer.byteLength(k), 0) }));
  }
  // Serialization proxy: sort members then re-emit.
  for (const [cls, m] of (QUICK ? [['candidate', 4096]] : [['moderate', 1024], ['candidate', 4096]])) {
    const obj = JSON.parse(G.wideObject(m));
    push(measure(`f3.serializeProxy.sortAndEmit(${m})`, 'ordering', cls, () => {
      const ks = Object.keys(obj).sort(utf16Compare);
      let out = '{';
      for (let i = 0; i < ks.length; i++) { if (i) out += ','; out += JSON.stringify(ks[i]) + ':' + JSON.stringify(obj[ks[i]]); }
      return out + '}';
    }, { units: m, unitName: 'member' }));
  }
}

process.stdout.write('\nFAMILY 4: AION FRAME v1 CONSTRUCTION (S4)\n');
function buildFrame(payload) {
  const fields = ['1', 'aion.object.integrity', 'acj-1', 'aion.object', '1', ''];
  const parts = [];
  for (const f of fields) {
    const b = Buffer.from(f, 'utf8');
    const len = Buffer.alloc(4); len.writeUInt32BE(b.length, 0);
    parts.push(len, b);
  }
  const plen = Buffer.alloc(8); plen.writeBigUInt64BE(BigInt(payload.length), 0);
  parts.push(plen, payload);
  return Buffer.concat(parts);
}
for (const [cls, b] of (QUICK ? [['candidate', 1048576]] : [['minimal', 1024], ['moderate', 65536], ['large', 1048576], ['candidate', 16777216]])) {
  const payload = Buffer.alloc(b, 0x61);
  const r = measure(`f4.frame.build(${b})`, 'framing', cls, () => buildFrame(payload), { inputBytes: b });
  const framed = buildFrame(payload);
  r.framedBytes = framed.length;
  r.lengthPrefixOverheadBytes = 6 * 4 + 8;
  selfCheck(`f4.frameOverhead(${b})`, framed.length === b + 32 + Buffer.byteLength('1aion.object.integrityacj-1aion.object1'),
    `framed ${framed.length}, payload ${b}`);
  push(r);
}

process.stdout.write('\nFAMILY 5: DIGEST COMPUTATION (S5)\n');
for (const [cls, b] of (QUICK ? [['candidate', 1048576]] : [['minimal', 1024], ['moderate', 65536], ['large', 1048576], ['candidate', 16777216]])) {
  const framed = buildFrame(Buffer.alloc(b, 0x61));
  push(measure(`f5.digest.sha256(${b})`, 'digest', cls,
    () => createHash('sha256').update(framed).digest(), { inputBytes: framed.length }));
}

process.stdout.write('\nFAMILY 6: EARLY AND LATE REJECTION (S0/S2)\n');
for (const [cls, pad] of (QUICK ? [['candidate', 262144]] : [['moderate', 65536], ['large', 1048576], ['adversarial', 4194304]])) {
  const early = `{"s":"\\q${'a'.repeat(pad)}"}`;
  const late = `{"s":"${'a'.repeat(pad)}\\q"}`;
  const e = measure(`f6.reject.early(${pad})`, 'rejection', cls, () => JSON.parse(early), { inputBytes: early.length, expectThrow: true });
  const l = measure(`f6.reject.late(${pad})`, 'rejection', cls, () => JSON.parse(late), { inputBytes: late.length, expectThrow: true });
  e.rejectionPoint = 'byte 7 of input'; l.rejectionPoint = 'final bytes of input';
  l.lateVsEarlyRatio = e.durationMs.median > 0 ? round(l.durationMs.median / e.durationMs.median) : null;
  push(e); push(l);
}

// Combined adversarial pressure: depth AND width AND nodes together.
process.stdout.write('\nCOMBINED ADVERSARIAL PRESSURE\n');
{
  const build = (depth, width) => {
    let inner = '0';
    for (let d = 0; d < depth; d++) {
      inner = '{' + Array.from({ length: width }, (_, i) => `"m${i}":${inner}`).join(',') + '}';
    }
    return inner;
  };
  const src = build(QUICK ? 4 : 6, 6);
  const v = JSON.parse(src);
  const c = countNodesIterative(v);
  const r = measure('combined.deepAndWide', 'traversal', 'adversarial', () => JSON.parse(src),
    { inputBytes: src.length, units: c.count, unitName: 'node' });
  r.observedNodeCount = c.count;
  r.note = 'Stays within per-container depth/member limits while accumulating nodes - the bypass L-07 exists to close.';
  push(r);
}

// ---------------------------------------------------------------------------
// Environment and emit
// ---------------------------------------------------------------------------
let commit = 'unavailable', dirty = 'unavailable';
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* ignore */ }
try { dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length ? 'dirty' : 'clean'; } catch { /* ignore */ }

const cpus = os.cpus();
const allChecksPassed = selfChecks.every((c) => c.passed);
const report = {
  schema: 'aion.resource-limit-workloads.v1',
  disclaimer: 'NON-PRODUCTION PROBE. Not the AION canonicalizer, validator, fixture loader, conformance harness, or a security boundary. Measured facts only. A proxy is not proof of the future production implementation.',
  environment: {
    runtime: 'Node', nodeVersion: process.version, v8Version: process.versions.v8,
    osFamily: os.type(), osRelease: os.release(), architecture: os.arch(),
    processorClass: cpus[0]?.model?.trim() ?? 'unavailable', logicalCores: cpus.length,
    physicalMemoryBytes: os.totalmem(),
    gitCommit: commit, workingTree: dirty, gcExposed: Boolean(globalThis.gc),
    externalDriveParticipated: false,
    notes: [
      'Run from the local NVMe working repository, not the external backup drive.',
      'Security software was not disabled; background load is part of the measured reality.',
      'No personal or owner data. Deterministic synthetic shapes from stable seeds.',
      'No network access. No external service calls.',
    ],
  },
  runConfig: { runs: RUNS, warmup: WARMUP, quick: QUICK },
  selfChecks,
  allSelfChecksPassed: allChecksPassed,
  unavailableMeasurements: [
    'cpuDurationMs - not attributable per probe at this granularity',
    'cancellationLatencyMs - no cancellable implementation exists',
    'concurrentInFlightOperations - no server or scheduler exists',
    'storageIo - deliberately not measured; benchmarks avoid the external drive',
  ],
  results,
};

if (OUT) { writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n', 'utf8'); process.stdout.write(`\nJSON written to ${OUT}\n`); }
process.stdout.write(`\nProbes: ${results.length}  self-checks: ${selfChecks.filter((c) => c.passed).length}/${selfChecks.length} passed  Node ${process.version}  commit ${commit.slice(0, 7)} (${dirty})\n`);

// A benchmark run that fails its own self-checks must not be reported as success.
if (!allChecksPassed) { process.stdout.write('\nSELF-CHECKS FAILED - results are not trustworthy\n'); process.exit(1); }
