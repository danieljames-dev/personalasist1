// NON-PRODUCTION BENCHMARK PROBE — resource-limit measurement runner.
//
// NOT the AION canonicalizer. NOT CanonicalContractValidatorV1. NOT a fixture loader.
// NOT a conformance harness. NOT a security boundary. NOT proof of production readiness.
//
// Emits measured facts only. Architectural recommendations live in
// docs/benchmarks/resource-limits-methodology.md and docs/contracts/resource-limits-profile.md.
//
// Synthetic data only. No personal or owner data. No network. Node built-ins only.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import * as S from './shapes.mjs';

const args = process.argv.slice(2);
const QUICK = args.includes('--quick');
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : null;

const RUNS = QUICK ? 3 : 9;
const WARMUP = QUICK ? 1 : 3;

// ---------------------------------------------------------------------------
// Measurement harness
// ---------------------------------------------------------------------------

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  const p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
  return { median: round(med), p95: round(p95), worst: round(s[s.length - 1]), min: round(s[0]) };
}
const round = (n) => Math.round(n * 1000) / 1000;

/**
 * Runs fn RUNS times after WARMUP, recording wall-clock ms and peak heap delta.
 * `expectThrow` inverts success accounting for rejection probes.
 */
function measure(name, category, fn, opts = {}) {
  const { inputBytes = null, expectThrow = false, note = null } = opts;
  for (let i = 0; i < WARMUP; i++) { try { fn(); } catch { /* warmup */ } }

  const durations = [];
  let completed = 0;
  let failureType = null;
  let outputBytes = null;

  // Memory accounting.
  //
  // An earlier revision of this harness sampled heapUsed only AFTER fn() returned, by which
  // point the value under test was already unreachable garbage, and it counted heapUsed
  // alone — which excludes Buffers and other external allocations entirely. That produced
  // physically impossible figures: hex.encode over 16 MiB reported a 2,120-byte peak delta
  // for a 33.5 MB output. Every number it produced was garbage-collection scheduling noise.
  //
  // This revision: collects before each run when --expose-gc is available, samples WHILE the
  // produced value is still retained, and totals heapUsed + external + arrayBuffers so
  // off-heap allocation is visible. `retain` keeps the value alive across the sample.
  const totalMem = () => { const m = process.memoryUsage(); return m.heapUsed + m.external + m.arrayBuffers; };

  if (globalThis.gc) globalThis.gc();
  const memBefore = process.memoryUsage();
  const totalBefore = totalMem();
  let peakTotal = totalBefore;
  let retain = null;

  for (let i = 0; i < RUNS; i++) {
    if (globalThis.gc) globalThis.gc();
    const base = totalMem();
    const t0 = process.hrtime.bigint();
    let threw = false;
    let result;
    try { result = fn(); } catch (e) { threw = true; failureType = e?.constructor?.name ?? 'Error'; }
    const t1 = process.hrtime.bigint();

    // Sample while `result` is still strongly referenced.
    retain = result;
    const during = totalMem();
    if (during - base > peakTotal - totalBefore) peakTotal = totalBefore + (during - base);

    durations.push(Number(t1 - t0) / 1e6);
    if (threw === expectThrow) completed++;
    if (!threw && outputBytes === null && typeof result === 'number') outputBytes = result;
    retain = null;
  }
  void retain;

  const memAfter = process.memoryUsage();
  const d = stats(durations);
  // Amplification is only meaningful when the input is large enough that heap-delta
  // granularity and allocator noise do not dominate. Below this floor the ratio is noise
  // and is reported as null rather than as a misleading large number.
  const AMPLIFICATION_MIN_INPUT_BYTES = 4096;
  const peakDelta = peakTotal - totalBefore;
  const amplification = inputBytes && inputBytes >= AMPLIFICATION_MIN_INPUT_BYTES
    ? round(peakDelta / inputBytes)
    : null;
  const amplificationNote = !globalThis.gc
    ? 'UNRELIABLE: run with --expose-gc; without it heap deltas are GC-schedule noise'
    : (inputBytes && inputBytes < AMPLIFICATION_MIN_INPUT_BYTES
        ? `not reported: input ${inputBytes}B below ${AMPLIFICATION_MIN_INPUT_BYTES}B noise floor`
        : null);
  // Cost per unit of structure is far more stable than the amplification ratio and is the
  // metric derivations should use. The ratio is retained for continuity but is NOT a
  // sound basis for choosing a limit — see the readiness review.
  const bytesPerUnit = opts.units ? round(peakDelta / opts.units) : null;
  const nsPerUnit = opts.units ? round((d.median * 1e6) / opts.units) : null;

  return {
    name, category, note,
    runs: RUNS, warmup: WARMUP,
    durationMs: d,
    opsPerSecond: d.median > 0 ? Math.round(1000 / d.median) : null,
    inputBytes, outputBytes,
    heapBeforeBytes: memBefore.heapUsed,
    heapAfterBytes: memAfter.heapUsed,
    peakTotalMemoryDeltaBytes: peakDelta,
    memoryAmplificationFactor: amplification,
    memoryAmplificationNote: amplificationNote,
    unitsUnderTest: opts.units ?? null,
    bytesPerUnit, nsPerUnit,
    completedAsExpected: completed,
    completionRate: round(completed / RUNS),
    failureType,
    // Explicitly unavailable in this environment/probe:
    cpuDurationMs: 'unavailable',
    gcObservations: globalThis.gc ? 'gc-exposed' : 'unavailable (run node --expose-gc for gc control)',
    cancellationLatencyMs: 'unavailable (no cancellable implementation exists)',
  };
}

// Count value nodes without building a second structure.
function countNodes(v) {
  let n = 1;
  if (Array.isArray(v)) { for (const x of v) n += countNodes(x); }
  else if (v && typeof v === 'object') { for (const k in v) n += countNodes(v[k]); }
  return n;
}

// Approximate ACJ-1 §23 frame construction cost: 6 u32 + 1 u64 length prefixes, big-endian.
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

const results = [];
const push = (r) => { results.push(r); process.stdout.write(`  ${r.name.padEnd(46)} ${String(r.durationMs.median).padStart(10)} ms  ${String(r.opsPerSecond ?? '-').padStart(9)} op/s  amp ${r.memoryAmplificationFactor ?? '-'}\n`); };

// ---------------------------------------------------------------------------
// A. Depth
// ---------------------------------------------------------------------------
process.stdout.write('\nA. DEPTH\n');
for (const depth of QUICK ? [8, 63, 64, 65] : [8, 32, 63, 64, 65, 200, 1000]) {
  const src = S.nestArray(depth);
  push(measure(`depth.parse.nestArray(${depth})`, 'depth', () => JSON.parse(src), { inputBytes: src.length }));
}
for (const depth of QUICK ? [64] : [64, 1000]) {
  const src = S.nestObject(depth);
  push(measure(`depth.parse.nestObject(${depth})`, 'depth', () => JSON.parse(src), { inputBytes: src.length }));
}
// Adversarial depth: does the runtime bound depth for us? (Answer: no.)
{
  let parseBreak = null; let parseOk = null;
  for (const d of [1000, 8000, 64000, 128000, 500000, 1000000]) {
    let src;
    try { src = S.nestArray(d); } catch { parseBreak = d; break; }
    try { JSON.parse(src); parseOk = d; } catch { parseBreak = d; break; }
  }
  // Recursive traversal is the real hazard: JSON.parse is iterative, naive walkers are not.
  let walkBreak = null; let walkOk = null; let walkError = null;
  for (const d of [1000, 2000, 4000, 8000, 16000, 32000, 64000]) {
    const v = JSON.parse(S.nestArray(d));
    try { countNodes(v); walkOk = d; } catch (e) { walkBreak = d; walkError = e?.constructor?.name ?? 'Error'; break; }
  }
  results.push({
    name: 'depth.adversarial.runtimeCeilings', category: 'depth',
    note: 'Node\'s JSON.parse is iterative and does NOT bound nesting depth — it parsed every depth attempted. A naive RECURSIVE traversal overflows the stack far earlier. AION must impose its own depth limit; the runtime will not do it, and the limit must protect the traversal, not the parse.',
    deepestParsed: parseOk,
    firstFailingParseDepth: parseBreak,
    parserBoundsDepth: parseBreak !== null,
    deepestRecursivelyWalked: walkOk,
    firstFailingWalkDepth: walkBreak,
    walkFailureType: walkError,
    runs: 1, warmup: 0,
  });
  process.stdout.write(`  ${'depth.adversarial.runtimeCeilings'.padEnd(46)} parse ok to ${parseOk} (bounds=${parseBreak !== null}); recursive walk failed at ${walkBreak} (${walkError})\n`);
}

// ---------------------------------------------------------------------------
// B. Width
// ---------------------------------------------------------------------------
process.stdout.write('\nB. WIDTH\n');
for (const m of QUICK ? [4096] : [64, 1024, 4095, 4096, 4097, 65536]) {
  const src = S.wideObject(m);
  push(measure(`width.parse.wideObject(${m})`, 'width', () => JSON.parse(src), { inputBytes: src.length, units: m }));
}
for (const e of QUICK ? [65536] : [1024, 65535, 65536, 65537, 1000000]) {
  const src = S.largeArray(e);
  push(measure(`width.parse.largeArray(${e})`, 'width', () => JSON.parse(src), { inputBytes: src.length, units: e }));
}
{
  const src = S.manySmallContainers(QUICK ? 10000 : 100000);
  push(measure('width.parse.manySmallContainers', 'width', () => JSON.parse(src), { inputBytes: src.length, note: 'total-node cost spread across containers' }));
}
{
  const src = S.deepAndWide(QUICK ? 4 : 6, 6);
  push(measure('width.parse.deepAndWide', 'width', () => JSON.parse(src), { inputBytes: src.length, note: 'combined adversarial shape' }));
}

// ---------------------------------------------------------------------------
// C. Strings and Unicode
// ---------------------------------------------------------------------------
process.stdout.write('\nC. STRINGS AND UNICODE\n');
for (const b of QUICK ? [1048576] : [1024, 65536, 1048576, 4194304]) {
  const src = S.longAsciiString(b);
  push(measure(`string.parse.ascii(${b}B)`, 'string', () => JSON.parse(src), { inputBytes: src.length }));
}
{
  const chars = QUICK ? 100000 : 349525; // ~1 MiB at 3 bytes/char
  const src = S.longMultibyteString(chars);
  push(measure(`string.parse.multibyteUtf8(${chars}ch)`, 'string', () => JSON.parse(src), { inputBytes: Buffer.byteLength(src, 'utf8'), note: 'byte length != scalar count — both limits needed' }));
}
{
  const chars = QUICK ? 50000 : 200000;
  const nfd = S.longCombiningString(chars);
  const parsedNfd = JSON.parse(nfd).s;
  push(measure(`unicode.isNFC.check(${chars}ch)`, 'unicode', () => (parsedNfd.normalize('NFC') === parsedNfd ? 1 : 0), { inputBytes: Buffer.byteLength(nfd, 'utf8'), note: 'ACJ-1 §4 validator check — NFC verification, not normalization' }));
  push(measure(`unicode.normalizeNFC.transform(${chars}ch)`, 'unicode', () => parsedNfd.normalize('NFC'), { inputBytes: Buffer.byteLength(nfd, 'utf8'), note: 'cost if a producer converts before validation' }));

  const nfc = JSON.parse(S.longNfcString(chars)).s;
  push(measure(`unicode.isNFC.alreadyNFC(${chars}ch)`, 'unicode', () => (nfc.normalize('NFC') === nfc ? 1 : 0), { inputBytes: Buffer.byteLength(nfc, 'utf8'), note: 'common case cost' }));

  // Normalization expansion factor — how much can NFC change length?
  const expandProbe = 'ẛ̣'.repeat(1000);
  results.push({
    name: 'unicode.normalizationExpansion', category: 'unicode',
    note: 'Worst-case observed length change under NFC for a known expanding sequence.',
    inputScalars: expandProbe.length,
    nfcScalars: expandProbe.normalize('NFC').length,
    nfkdScalars: expandProbe.normalize('NFKD').length,
    expansionFactorNFKD: round(expandProbe.normalize('NFKD').length / expandProbe.length),
    runs: 1, warmup: 0,
  });
  process.stdout.write(`  ${'unicode.normalizationExpansion'.padEnd(46)} NFKD expansion x${round(expandProbe.normalize('NFKD').length / expandProbe.length)}\n`);
}
{
  const src = S.longMemberNames(QUICK ? 200 : 1000, 256);
  push(measure('string.parse.longMemberNames', 'string', () => JSON.parse(src), { inputBytes: src.length }));
}

// ---------------------------------------------------------------------------
// D. Numeric representations
// ---------------------------------------------------------------------------
process.stdout.write('\nD. NUMERIC\n');
for (const w of ['max', 'min', 'over']) {
  const src = S.integerBoundary(w);
  push(measure(`numeric.parse.integer.${w}`, 'numeric', () => JSON.parse(src).n, { inputBytes: src.length, note: w === 'over' ? 'beyond ACJ-1 §7 exact range — parses without error, precision already lost' : null }));
}
{
  const { decimalStrings, scaledIntegers } = S.decimalCandidates(QUICK ? 2000 : 20000);
  const dj = '[' + decimalStrings.join(',') + ']';
  const sj = '[' + scaledIntegers.join(',') + ']';
  push(measure('numeric.parse.decimalStrings', 'numeric', () => JSON.parse(dj), { inputBytes: dj.length, note: 'ACJ-1 §9 candidate A' }));
  push(measure('numeric.parse.scaledIntegers', 'numeric', () => JSON.parse(sj), { inputBytes: sj.length, note: 'ACJ-1 §9 candidate B' }));
}
{
  // Demonstrate the precision hazard rather than assert it.
  // The literals MUST be string constants: computing them in JS would already lose
  // precision before stringification and would understate the hazard.
  const cases = ['9007199254740993', '9007199254740995', '18014398509481985', '123456789012345678901'];
  const observed = cases.map((lit) => {
    const parsed = JSON.parse(`{"n":${lit}}`).n;
    return { literal: lit, parsed: String(parsed), lossless: String(parsed) === lit };
  });
  const lossy = observed.filter((o) => !o.lossless);
  results.push({
    name: 'numeric.precisionHazard', category: 'numeric',
    note: 'Why ACJ-1 §7 caps integers at 2^53-1: beyond it JSON.parse silently returns a DIFFERENT number, with no error. Literals are string constants so the loss is the parser\'s, not the probe\'s.',
    maxSafeInteger: String(S.MAX_SAFE),
    cases: observed,
    lossyCount: lossy.length,
    floatSourcesRejectedByContract: S.floatSources(),
    runs: 1, warmup: 0,
  });
  process.stdout.write(`  ${'numeric.precisionHazard'.padEnd(46)} ${lossy.length}/${cases.length} literals above 2^53-1 parsed to a DIFFERENT value\n`);
  for (const o of lossy) process.stdout.write(`      ${o.literal} -> ${o.parsed}\n`);
}

// ---------------------------------------------------------------------------
// E. Parser failures — early vs late rejection
// ---------------------------------------------------------------------------
process.stdout.write('\nE. PARSER FAILURES (early vs late)\n');
{
  const pad = QUICK ? 100000 : 1000000;
  const early = S.invalidEscape(pad, false);
  const late = S.invalidEscape(pad, true);
  push(measure('reject.invalidEscape.early', 'reject', () => JSON.parse(early), { inputBytes: early.length, expectThrow: true }));
  push(measure('reject.invalidEscape.late', 'reject', () => JSON.parse(late), { inputBytes: late.length, expectThrow: true }));
  const trail = S.trailingContent(pad);
  push(measure('reject.trailingContent', 'reject', () => JSON.parse(trail), { inputBytes: trail.length, expectThrow: true }));
  const badnum = S.malformedNumberLate(pad);
  push(measure('reject.malformedNumber.late', 'reject', () => JSON.parse(badnum), { inputBytes: badnum.length, expectThrow: true }));
  const lateVal = S.lateInvalidValue(pad);
  push(measure('reject.lateInvalidValue.parseOK', 'reject', () => typeof JSON.parse(lateVal).bad, { inputBytes: lateVal.length, note: 'parses fine; ACJ-1 §8 float rejection is an S2 concern, not S0' }));
}
{
  const dup = S.duplicateMembers(QUICK ? 1000 : 10000);
  const parsed = JSON.parse(dup);
  results.push({
    name: 'reject.duplicateMembers.hostCollapse', category: 'reject',
    note: 'Why ACJ-1 §19 duplicate-member fixtures MUST be byte-authoritative: the host parser silently collapses them.',
    sourceMemberCount: QUICK ? 1000 : 10000,
    parsedKeyCount: Object.keys(parsed).length,
    lastWins: parsed.dup === (QUICK ? 999 : 9999),
    evidenceDestroyedByParsing: Object.keys(parsed).length === 1,
    runs: 1, warmup: 0,
  });
  process.stdout.write(`  ${'reject.duplicateMembers.hostCollapse'.padEnd(46)} ${QUICK ? 1000 : 10000} members -> ${Object.keys(parsed).length} key(s)\n`);
}
{
  const bad = S.invalidUtf8Bytes();
  const bom = S.bomBytes();
  push(measure('reject.invalidUtf8.rawBytes', 'reject', () => {
    const s = bad.toString('utf8');
    if (s.includes('�')) throw new TypeError('lone surrogate replaced');
    return JSON.parse(s);
  }, { inputBytes: bad.length, expectThrow: true, note: 'Buffer.toString replaces invalid sequences with U+FFFD — silent corruption unless checked' }));
  push(measure('reject.bom.rawBytes', 'reject', () => JSON.parse(bom.toString('utf8')), { inputBytes: bom.length, expectThrow: true }));
}

// ---------------------------------------------------------------------------
// F. Framing, hex, digest
// ---------------------------------------------------------------------------
process.stdout.write('\nF. FRAMING / HEX / DIGEST\n');
for (const b of QUICK ? [1048576] : [1024, 65536, 1048576, 16777216]) {
  const payload = Buffer.alloc(b, 0x61);
  push(measure(`frame.build(${b}B)`, 'framing', () => buildFrame(payload), { inputBytes: b, note: 'ACJ-1 §23 — 32 bytes of length prefixes' }));
  push(measure(`digest.sha256(${b}B)`, 'digest', () => createHash('sha256').update(payload).digest(), { inputBytes: b }));
  push(measure(`hex.encode(${b}B)`, 'hex', () => payload.toString('hex'), { inputBytes: b, note: 'AFX-1 byte evidence — 2x size' }));
}
{
  const payload = Buffer.alloc(1024, 0x61);
  const framed = buildFrame(payload);
  results.push({
    name: 'frame.overheadBytes', category: 'framing',
    note: 'Fixed length-prefix overhead: 6 u32 + 1 u64.',
    payloadBytes: payload.length, framedBytes: framed.length,
    overheadBytes: framed.length - payload.length - Buffer.byteLength('1aion.object.integrityacj-1aion.object1', 'utf8'),
    lengthPrefixBytes: 6 * 4 + 8,
    runs: 1, warmup: 0,
  });
  process.stdout.write(`  ${'frame.overheadBytes'.padEnd(46)} length prefixes = ${6 * 4 + 8} bytes\n`);
}
{
  // Framing rejection shapes.
  const payload = Buffer.alloc(64, 0x61);
  const framed = buildFrame(payload);
  const truncated = framed.subarray(0, framed.length - 10);
  const trailing = Buffer.concat([framed, Buffer.from([0x00])]);
  results.push({
    name: 'frame.rejectionShapes', category: 'framing',
    note: 'Sizes only — no frame parser exists to measure rejection latency against.',
    framedBytes: framed.length, truncatedBytes: truncated.length, trailingBytes: trailing.length,
    rejectionLatencyMs: 'unavailable (no frame decoder implemented)',
    runs: 1, warmup: 0,
  });
}

// ---------------------------------------------------------------------------
// G. Memory amplification headline
// ---------------------------------------------------------------------------
process.stdout.write('\nG. MEMORY AMPLIFICATION\n');
for (const [label, src] of [
  ['wideObject(65536)', S.wideObject(QUICK ? 4096 : 65536)],
  ['largeArray(1000000)', S.largeArray(QUICK ? 65536 : 1000000)],
  ['manySmall(100000)', S.manySmallContainers(QUICK ? 10000 : 100000)],
]) {
  push(measure(`memory.parse.${label}`, 'memory', () => JSON.parse(src), { inputBytes: src.length, note: 'peak heap delta / input bytes' }));
}

// ---------------------------------------------------------------------------
// Environment + emit
// ---------------------------------------------------------------------------
let commit = 'unavailable';
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* ignore */ }
let dirty = 'unavailable';
try { dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0 ? 'dirty' : 'clean'; } catch { /* ignore */ }

const cpus = os.cpus();
const report = {
  schema: 'aion.resource-limit-benchmark.v1',
  disclaimer: 'NON-PRODUCTION PROBE. Not the AION canonicalizer, validator, fixture loader, conformance harness, or a security boundary. Measured facts only.',
  environment: {
    osFamily: os.type(), osRelease: os.release(), platform: os.platform(),
    architecture: os.arch(),
    processorClass: cpus[0]?.model?.trim() ?? 'unavailable',
    logicalCores: cpus.length,
    physicalMemoryBytes: os.totalmem(),
    nodeVersion: process.version,
    v8Version: process.versions.v8,
    gitCommit: commit,
    workingTree: dirty,
    gcExposed: Boolean(globalThis.gc),
    externalDriveParticipated: false,
    notes: [
      'Benchmarks run from the local NVMe working repository, not from the external backup drive.',
      'Security software was not disabled; background load may affect results.',
      'No personal or owner data. Synthetic shapes only. No network access.',
    ],
  },
  runConfig: { runs: RUNS, warmup: WARMUP, quick: QUICK },
  unavailableMeasurements: [
    'cpuDurationMs — process.cpuUsage deltas are not attributable per-probe at this granularity',
    'cancellationLatencyMs — no cancellable implementation exists',
    'concurrentInFlightOperations — no server or scheduler exists',
    'crossRuntimeAgreement — no second runtime exists',
    'storageIo — deliberately not measured; benchmarks avoid the external drive',
  ],
  results,
};

if (OUT) { writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n', 'utf8'); process.stdout.write(`\nJSON written to ${OUT}\n`); }
process.stdout.write(`\nProbes: ${results.length}  Node ${process.version}  commit ${commit.slice(0, 7)} (${dirty})\n`);
